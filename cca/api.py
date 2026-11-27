"""外部のツールから生成を頼むための API(画面を開かずに、生成パネルと同じ処理を流す)。

入口は 3 種類。どれも同じ処理(_submit)に集まる。
  CCA 形式    POST /cca_generator/api/generate   GET /cca_generator/api/jobs/<id>   POST .../cancel   GET /cca_generator/api/models
  WebUI 形式  /sdapi/v1/txt2img  img2img  sd-models  samplers  schedulers  loras  options  progress  interrupt
  OpenAI 形式 /v1/images/generations  /v1/images/edits  /v1/models
指定しなかった項目は、生成パネルの前回設定(無ければ既定値)を使う。
"""
import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import random
import re
import time
import uuid

import folder_paths

from . import store, uploads, wfconv
from .i18n import tr
from .prefix import expand_prefix

MAX_BATCH = 100
WAIT_LIMIT = 3600
_JOBS = {}
_STATE = {"type": None}
_NUM = re.compile(r"[^a-z0-9]")


class ApiError(Exception):
    def __init__(self, msg, status=400):
        super().__init__(msg)
        self.status = status


def _norm(s):
    return _NUM.sub("", str(s).lower())


def _base(f):
    return str(f).replace("\\", "/").rsplit("/", 1)[-1]


def _stem(f):
    return os.path.splitext(_base(f))[0]


def _find(name, options):
    """ファイル名(フォルダ・拡張子・末尾の [ハッシュ] は省いてよい)から、選択肢のひとつを探す"""
    s = re.sub(r"\s*\[[0-9a-fA-F]+\]\s*$", "", str(name or "").strip()).replace("\\", "/")
    if not s:
        return None
    low = s.lower()
    for f in options:
        if str(f).replace("\\", "/").lower() == low:
            return f
    for f in options:
        if _base(f).lower() in (low, _base(low)) or _stem(f).lower() == _stem(low):
            return f
    n = _norm(_stem(s))
    return next((f for f in options if _norm(_stem(f)) == n), None)


def _alias(value, options, names):
    """サンプラー・スケジューラー名(ComfyUI の名前でも、WebUI の表示名でも)"""
    table = {}
    for o in options:
        table.setdefault(_norm(o), o)
        table.setdefault(_norm(names.get(o, o)), o)
    return table.get(_norm(value))


def _num(v, d=None, cast=float):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return d


def _bytes(x):
    if isinstance(x, (bytes, bytearray)):
        return bytes(x)
    s = str(x or "")
    if s.startswith("data:"):
        s = s.split(",", 1)[-1]
    try:
        return base64.b64decode(s, validate=False)
    except Exception:  # noqa: BLE001
        raise ApiError(tr("画像を読み込めません")) from None


def _image(data):
    from PIL import Image, ImageOps
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        return ImageOps.exif_transpose(im)
    except Exception:  # noqa: BLE001
        raise ApiError(tr("画像を読み込めません")) from None


def _png(im):
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def mask_l(data, invert=False, from_alpha=False):
    """マスク(白 = 描き直す所)の PNG。from_alpha: 透明な所を描き直す所にする"""
    from PIL import ImageOps
    im = _image(_bytes(data))
    m = ImageOps.invert(im.getchannel("A")) if from_alpha and "A" in im.getbands() else im.convert("L")
    return _png(ImageOps.invert(m) if invert else m)


# ---------------------------------------------------------------- パネルの値
def _panel_keys():
    from .panel import CCAGeneratorPanel
    return CCAGeneratorPanel.INPUT_TYPES().get("required", {})


def _panel_defaults():
    out = {}
    for k, spec in _panel_keys().items():
        opts = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        if "default" in opts:
            out[k] = opts["default"]
        elif isinstance(spec[0], (list, tuple)) and spec[0]:
            out[k] = spec[0][0]
    return out


def _is_type(x):
    from .specs import MODEL_TYPES
    return bool(x) and any(_norm(t) == _norm(x) for t in MODEL_TYPES)


def _pick_type(req):
    from .specs import MODEL_TYPES, VISIBLE_TYPES
    want = req.get("model_type") or (req.get("model") if _is_type(req.get("model")) else None)
    if want:
        mt = next((t for t in MODEL_TYPES if _norm(t) == _norm(want)), None)
        if not mt:
            raise ApiError(tr("モデル種別が見つかりません: {name}", name=want))
        return mt
    last = _STATE["type"] or (store.load_all().get("state", {}).get("last") or {}).get("model_type")
    return last if last in MODEL_TYPES else VISIBLE_TYPES[0]


def _pick_task(req, info, has_images):
    tasks = info["tasks"]
    if req.get("task"):
        t = str(req["task"]).upper()
        if t not in tasks:
            raise ApiError(tr("このモデル種別では「{task}」を使えません", task=t))
        return t
    t = next((x for x in tasks if x in (("I2I", "I2V") if has_images else ("T2I", "T2V"))), None)
    if not t:
        raise ApiError(tr("このモデル種別は画像からの生成に対応していません") if has_images else tr("このモデル種別では「{task}」を使えません", task="T2I"))
    return t


def _loras(req, c):
    """loras(名前と強さの一覧)と、プロンプトの <lora:名前:強さ> → (プロンプト, パネルの LoRA 一覧 / 指定が無ければ None)"""
    text = str(req.get("prompt") or "")
    items = [dict(x) if isinstance(x, dict) else {"name": x} for x in (req.get("loras") or [])]
    for m in re.finditer(r"<lora:([^:>]+)(?::([-0-9.]+))?>", text):
        items.append({"name": m.group(1), "strength": _num(m.group(2), 1.0)})
    text = re.sub(r"\s*<lora:[^>]*>", "", text).strip()
    if not items:
        return text, None
    files = c["loras"][1:]
    out = []
    for it in items:
        f = _find(it.get("name"), files)
        if not f:
            raise ApiError(tr("LoRA が見つかりません: {name}", name=it.get("name")))
        s = _num(it.get("strength"), 1.0)
        out.append({"name": f, "strength": s, "clip": _num(it.get("clip"), s), "target": "both", "on": True})
    return text, out


def _values(req, c):
    """リクエスト → (パネルの値, モデル種別, タスク, 出力の種類)"""
    from . import server as srv
    from .specs import IMAGE_WIDGETS, NONE, TYPE_INFO, hires_supported, max_images, size_step, uses_mask
    mt = _pick_type(req)
    info = TYPE_INFO[mt]
    if info["kind"] not in ("image", "video"):
        raise ApiError(tr("このモデル種別は音声・3D の生成に対応していません(API は画像・動画のみ)"))
    images = [req["images"]] if isinstance(req.get("images"), (str, bytes)) else list(req.get("images") or [])
    task = _pick_task(req, info, bool(images))
    text, loras = _loras(req, c)
    if not text:
        raise ApiError(tr("プロンプトがありません"))
    v = _panel_defaults()
    v.update(srv._resolved_defaults(mt, task, c))
    st = store.load_all().get("state", {})
    v.update(st.get("types", {}).get(mt, {}))
    v.update(st.get("tasks", {}).get(f"{mt}::{task}", {}))
    for k in IMAGE_WIDGETS:
        v[k] = NONE
    v.update(model_type=mt, task=task, positive=text)
    if req.get("negative_prompt") is not None:
        v["negative"] = str(req["negative_prompt"])
    if loras is not None:
        v["loras"] = json.dumps(loras, ensure_ascii=False)
    # モデルのファイル(指定が無ければパネルの設定)
    if req.get("model") and not _is_type(req["model"]):
        key = {"ckpt": "ckpt_name", "wan14": "wan_high_unet", "unet": "unet_name"}.get(info["loader"])
        lst = (info.get("lists") or {}).get(key) or ("ckpts" if key == "ckpt_name" else "unets")
        f = _find(req["model"], [x for x in c.get(lst, []) if x != NONE]) if key else None
        if f:
            v[key] = f
        elif req.get("strict_model"):
            raise ApiError(tr("ファイルが見つかりません: {name}", name=req["model"]))
    # 数値・サンプラー
    step = size_step(mt) or 8
    w, h = _num(req.get("width"), cast=int), _num(req.get("height"), cast=int)
    if w and h:
        v["width"], v["height"] = max(step, round(w / step) * step), max(step, round(h / step) * step)
    v["auto_image_size"] = not (w and h) if images else False
    for k, rk, cast in (("steps", "steps", int), ("cfg", "cfg", float), ("denoise", "denoise", float),
                        ("video_length", "length", int), ("video_fps", "fps", float)):
        x = _num(req.get(rk), cast=cast)
        if x is not None:
            v[k] = x
    from . import panel
    from .pnginfo import SAMPLER_NAMES, SCHEDULER_NAMES
    for k, rk, names, opts in (("sampler_name", "sampler", SAMPLER_NAMES, panel.SAMPLERS),
                               ("scheduler", "scheduler", SCHEDULER_NAMES, panel.SCHEDULERS)):
        if req.get(rk):
            a = _alias(req[rk], opts, names)
            if a:
                v[k] = a
    hr = req.get("hires") or {}
    if hr.get("enable") and hires_supported(mt, task):
        v["hires_enable"] = True
        for k, rk, cast in (("hires_scale", "scale", float), ("hires_steps", "steps", int),
                            ("hires_denoise", "denoise", float), ("hires_cfg", "cfg", float)):
            x = _num(hr.get(rk), cast=cast)
            if x is not None:
                v[k] = x
        up = _find(hr.get("upscaler"), c["upscalers"]) or _alias(hr.get("upscaler"), c["upscalers"], {})
        if up:
            v["hires_upscaler"] = up
    v["image_output_prefix"] = expand_prefix(v.get("image_output_prefix"))
    v["video_output_prefix"] = expand_prefix(v.get("video_output_prefix"))
    # 入力画像(output の中の保存先に入れて、パネルの入力画像1〜に指定する)
    mask = req.get("mask") if images and uses_mask(mt, task) else None
    for i, data in enumerate(images[:max_images(mt, task)]):
        im = _image(_bytes(data))
        if i == 0 and mask:
            from PIL import Image, ImageOps
            rgb = im.convert("RGB")
            m = Image.open(io.BytesIO(mask)).convert("L").resize(rgb.size)
            rgb.putalpha(ImageOps.invert(m))  # 描き直す所を透明にする(読み込むと、その所がマスクになる)
            png, sub = _png(rgb), "cca_masks"
        else:
            png, sub = _png(im.convert("RGBA") if "A" in im.getbands() else im.convert("RGB")), "cca_api"
        r = uploads.save_upload(png, f"api_{hashlib.sha1(png).hexdigest()[:12]}.png", v["image_output_prefix"], sub)
        v[IMAGE_WIDGETS[i]] = r["value"]
    return v, mt, task, info["kind"]


# ---------------------------------------------------------------- キュー・結果
def _inst():
    from server import PromptServer
    return PromptServer.instance


def _queue_ids():
    q = _inst().prompt_queue
    run, pend = (getattr(q, "get_current_queue_volatile", None) or q.get_current_queue)()
    return [x[1] for x in run], [x[1] for x in pend]


async def _post_prompt(prompt):
    import aiohttp
    url = f"http://127.0.0.1:{getattr(_inst(), 'port', 8188)}/prompt"
    async with aiohttp.ClientSession() as s:
        async with s.post(url, json={"prompt": prompt, "client_id": "cca_api"}) as r:
            j = await r.json(content_type=None)
            if r.status != 200 or "prompt_id" not in (j or {}):
                ne = " / ".join(f"{e.get('message')}: {e.get('details')}" for x in (j or {}).get("node_errors", {}).values() for e in x.get("errors", []))
                msg = ((j or {}).get("error") or {}).get("message") or r.status
                raise ApiError(tr("生成を受け付けられませんでした: {msg}", msg=f"{msg}{' (' + ne + ')' if ne else ''}"), 500)
            return j["prompt_id"]


async def _submit(req):
    """生成をキューに入れる → ジョブ"""
    from .panel import choice_lists
    n = max(1, min(MAX_BATCH, _num(req.get("batch"), 1, int)))
    base = _num(req.get("seed"), -1, int)
    base = base if base >= 0 else random.randint(0, 2**32 - 1)
    v, mt, task, kind = _values(req, choice_lists())
    if kind not in req.get("kinds", ("image", "video")):
        raise ApiError(tr("このモデル種別は動画を作ります。画像を作る種別を選んでください"))
    keys = _panel_keys()
    ids, seeds = [], []
    for i in range(n):
        panel, prompt = wfconv.template(kind)
        v["seed"] = (base + i) % (2**64)
        prompt[panel]["inputs"] = {k: v[k] for k in keys if k in v}
        ids.append(await _post_prompt(prompt))
        seeds.append(v["seed"])
    job = {"id": uuid.uuid4().hex, "ids": ids, "seeds": seeds, "model_type": mt, "task": task, "kind": kind,
           "created": int(time.time()), "cancelled": False,
           "info": {k: v[k] for k in ("positive", "negative", "steps", "cfg", "sampler_name", "scheduler", "width", "height") if k in v}}
    _JOBS[job["id"]] = job
    for k in sorted(_JOBS, key=lambda x: _JOBS[x]["created"])[:-200]:
        _JOBS.pop(k, None)
    return job


def _entry(pid):
    return (_inst().prompt_queue.get_history(prompt_id=pid) or {}).get(pid)


def _one(pid):
    e = _entry(pid)
    if e:
        st = e.get("status") or {}
        msgs = st.get("messages") or []
        if any(m[0] == "execution_interrupted" for m in msgs):
            return "cancelled", None
        err = next((m for m in msgs if m[0] == "execution_error"), None)
        if err or st.get("status_str") == "error":
            return "error", ((err[1] if err else {}) or {}).get("exception_message") or tr("生成に失敗しました")
        return "done", None
    run, pend = _queue_ids()
    return ("running" if pid in run else "queued" if pid in pend else "lost"), None


def _status(job):
    res = [_one(p) for p in job["ids"]]
    for s in ("error", "cancelled", "running", "queued"):
        hit = next((r for r in res if r[0] == s), None)
        if hit:
            return hit
    if job["cancelled"] or any(r[0] == "lost" for r in res):
        return "cancelled", None
    return "done", None


async def _wait(job):
    end = time.time() + WAIT_LIMIT
    while time.time() < end:
        st, err = _status(job)
        if st in ("done", "error", "cancelled"):
            return st, err
        await asyncio.sleep(0.4)
    raise ApiError(tr("時間内に終わりませんでした"), 504)


def _files(job, data=False, base=""):
    out = []
    for pid in job["ids"]:
        for o in ((_entry(pid) or {}).get("outputs") or {}).values():
            for f in o.get("images") or []:
                path = os.path.join(folder_paths.get_directory_by_type(f.get("type", "output")) or "", f.get("subfolder") or "", f["filename"])
                kind = "video" if o.get("animated") and f["filename"].lower().endswith((".mp4", ".webm", ".mov", ".mkv", ".webp", ".gif")) else "image"
                ent = {"filename": f["filename"], "subfolder": f.get("subfolder") or "", "type": f.get("type", "output"), "kind": kind,
                       "view": f"{base}/view?filename={f['filename']}&subfolder={f.get('subfolder') or ''}&type={f.get('type', 'output')}"}
                if data and os.path.isfile(path):
                    with open(path, "rb") as fp:
                        ent["data"] = base64.b64encode(fp.read()).decode()
                out.append(ent)
    return out


def _job_json(job, data=False, base=""):
    st, err = _status(job)
    out = {"ok": True, "job_id": job["id"], "status": st, "model_type": job["model_type"], "task": job["task"], "seeds": job["seeds"]}
    if err:
        out["error"] = err
    if st == "done":
        out["files"] = _files(job, data, base)
    return out


def _cancel(job):
    job["cancelled"] = True
    q = _inst().prompt_queue
    run, _ = _queue_ids()
    for pid in job["ids"]:
        q.delete_queue_item(lambda x, pid=pid: x[1] == pid)
        if pid in run:
            import comfy.model_management as mm
            mm.interrupt_current_processing()


async def _finish(job):
    st, err = await _wait(job)
    if st != "done":
        raise ApiError(err or (tr("中止しました") if st == "cancelled" else tr("生成に失敗しました")), 500)
    return _files(job, True)


# ---------------------------------------------------------------- 入力の読み替え
def _hires(d):
    return {"enable": d.get("enable_hr"), "scale": d.get("hr_scale"), "upscaler": d.get("hr_upscaler"),
            "steps": d.get("hr_second_pass_steps"), "denoise": d.get("denoising_strength"), "cfg": d.get("hr_cfg")}


def _from_webui(d, edit):
    o = d.get("override_settings") or {}
    return {"prompt": d.get("prompt"), "negative_prompt": d.get("negative_prompt"), "seed": d.get("seed"),
            "steps": d.get("steps"), "cfg": d.get("cfg_scale"), "width": d.get("width"), "height": d.get("height"),
            "sampler": d.get("sampler_name") or d.get("sampler_index"), "scheduler": d.get("scheduler"),
            "batch": max(1, _num(d.get("batch_size"), 1, int)) * max(1, _num(d.get("n_iter"), 1, int)),
            "model": o.get("sd_model_checkpoint") or _STATE["type"], "model_type": d.get("model_type"), "task": d.get("task"),
            "images": d.get("init_images") if edit else None,
            "mask": mask_l(d["mask"], bool(d.get("inpainting_mask_invert"))) if edit and d.get("mask") else None,
            "denoise": d.get("denoising_strength") if edit else None,
            "hires": {} if edit else _hires(d), "kinds": ("image",)}


def _from_native(d):
    d = dict(d)
    if isinstance(d.get("image"), (str, bytes)) and not d.get("images"):
        d["images"] = [d["image"]]
    if d.get("mask"):
        d["mask"] = mask_l(d["mask"])
    d["strict_model"] = True
    return d


def _size(s):
    if not s or s == "auto":
        return None, None
    m = re.fullmatch(r"(\d+)x(\d+)", str(s).strip().lower())
    if not m:
        raise ApiError(tr("サイズの指定が正しくありません: {size}", size=s))
    return int(m.group(1)), int(m.group(2))


async def _form(request):
    """JSON でも multipart でも、{名前: 値} にする(ファイルは中身のバイト列の一覧)"""
    if request.content_type.startswith("multipart/"):
        out = {}
        for k, val in (await request.post()).items():
            out.setdefault(k.removesuffix("[]"), []).append(val.file.read() if hasattr(val, "file") else val)
        return {k: (x if len(x) > 1 or k in ("image", "mask") else x[0]) for k, x in out.items()}
    d = await request.json()
    if not isinstance(d, dict):
        raise ApiError(tr("リクエストの形式が正しくありません"))
    return d


def _from_openai(d, edit):
    w, h = _size(d.get("size"))
    img = d.get("image") if edit else None
    if isinstance(img, (bytes, bytearray, str)):
        img = [img]
    mk = d.get("mask")
    mk = mk[0] if isinstance(mk, list) else mk
    return {"prompt": d.get("prompt"), "batch": _num(d.get("n"), 1, int), "width": w, "height": h,
            "model": d.get("model"), "model_type": d.get("model_type"), "task": d.get("task"),
            "images": img or None, "mask": mask_l(mk, from_alpha=True) if edit and mk else None,
            "seed": d.get("seed"), "steps": d.get("steps"), "cfg": d.get("cfg"), "kinds": ("image",)}


# ---------------------------------------------------------------- 登録
def _authorize(request):
    """APIキーの設定(初期はすべて断る / キーあり / キーなしで誰でも)に従って確かめる。Authorization: Bearer <キー> か X-API-Key: <キー>"""
    auth = request.headers.get("Authorization", "")
    key = auth[7:].strip() if auth[:7].lower() == "bearer " else request.headers.get("X-API-Key", "").strip()
    r = store.api_key_check(key)
    if r == "closed":
        raise ApiError(tr("外部 API は止めています。ComfyUI の設定の「外部ツールから使う API のキー」で、キーを決めるか、空欄で設定してください"), 403)
    if r is False:
        raise ApiError(tr("APIキーが正しくありません(Authorization: Bearer <キー> か X-API-Key で送ってください)"), 401)


def register(routes, web):
    def guarded(fmt):
        def deco(fn):
            async def wrap(request):
                try:
                    _authorize(request)
                    return await fn(request)
                except ApiError as e:
                    msg, status = str(e), e.status
                except Exception as e:  # noqa: BLE001
                    logging.exception("[CCA Generator] API")
                    msg, status = str(e), 500
                body = {"ok": False, "error": msg} if fmt == "cca" else {"detail": msg} if fmt == "webui" else {"error": {"message": msg, "type": "invalid_request_error"}}
                return web.json_response(body, status=status)
            return wrap
        return deco

    def host(request):
        return f"{request.scheme}://{request.host}"

    def jobof(request):
        job = _JOBS.get(request.match_info["id"])
        if not job:
            raise ApiError(tr("ジョブが見つかりません"), 404)
        return job

    # ---- CCA 形式
    @routes.post("/cca_generator/api/generate")
    @guarded("cca")
    async def api_generate(request):
        d = await _form(request)
        job = await _submit(_from_native(d))
        if d.get("wait"):
            await _wait(job)
        return web.json_response(_job_json(job, bool(d.get("include_data")), host(request)))

    @routes.get("/cca_generator/api/jobs/{id}")
    @guarded("cca")
    async def api_job(request):
        return web.json_response(_job_json(jobof(request), request.query.get("include_data") in ("1", "true"), host(request)))

    @routes.post("/cca_generator/api/jobs/{id}/cancel")
    @guarded("cca")
    async def api_cancel(request):
        job = jobof(request)
        _cancel(job)
        return web.json_response({"ok": True, "job_id": job["id"]})

    @routes.get("/cca_generator/api/models")
    @guarded("cca")
    async def api_models(request):
        from . import panel
        from .specs import TYPE_INFO, VISIBLE_TYPES
        c = panel.choice_lists()
        return web.json_response({"ok": True, "model_types": [{"name": t, "kind": TYPE_INFO[t]["kind"], "tasks": TYPE_INFO[t]["tasks"]} for t in VISIBLE_TYPES],
                                  "samplers": list(panel.SAMPLERS), "schedulers": list(panel.SCHEDULERS), "loras": c["loras"][1:]})

    # ---- WebUI 形式
    async def webui_run(request, edit):
        job = await _submit(_from_webui(await _form(request), edit))
        files = await _finish(job)
        return web.json_response({"images": [f["data"] for f in files if f.get("data")], "parameters": {},
                                  "info": json.dumps({**job["info"], "seed": job["seeds"][0], "all_seeds": job["seeds"], "model_type": job["model_type"]}, ensure_ascii=False)})

    @routes.post("/sdapi/v1/txt2img")
    @guarded("webui")
    async def sd_txt2img(request):
        return await webui_run(request, False)

    @routes.post("/sdapi/v1/img2img")
    @guarded("webui")
    async def sd_img2img(request):
        return await webui_run(request, True)

    @routes.get("/sdapi/v1/sd-models")
    @guarded("webui")
    async def sd_models(request):
        from .specs import VISIBLE_TYPES
        return web.json_response([{"title": t, "model_name": t, "hash": None, "sha256": None, "filename": t, "config": None} for t in VISIBLE_TYPES])

    @routes.get("/sdapi/v1/samplers")
    @guarded("webui")
    async def sd_samplers(request):
        from . import panel
        from .pnginfo import SAMPLER_NAMES
        return web.json_response([{"name": SAMPLER_NAMES.get(s, s), "aliases": [s], "options": {}} for s in panel.SAMPLERS])

    @routes.get("/sdapi/v1/schedulers")
    @guarded("webui")
    async def sd_schedulers(request):
        from . import panel
        from .pnginfo import SCHEDULER_NAMES
        return web.json_response([{"name": s, "label": SCHEDULER_NAMES.get(s, s), "aliases": None, "default_rank": 0, "need_inner_model": False} for s in panel.SCHEDULERS])

    @routes.get("/sdapi/v1/loras")
    @guarded("webui")
    async def sd_loras(request):
        from . import panel
        return web.json_response([{"name": _stem(f), "alias": _stem(f), "path": f, "metadata": {}} for f in panel.choice_lists()["loras"][1:]])

    @routes.get("/sdapi/v1/options")
    @guarded("webui")
    async def sd_options(request):
        return web.json_response({"sd_model_checkpoint": _pick_type({})})

    @routes.post("/sdapi/v1/options")
    @guarded("webui")
    async def sd_set_options(request):
        from .specs import MODEL_TYPES
        d = await request.json()
        t = next((x for x in MODEL_TYPES if _norm(x) == _norm(d.get("sd_model_checkpoint"))), None)
        if t:
            _STATE["type"] = t
        return web.json_response({})

    @routes.get("/sdapi/v1/progress")
    @guarded("webui")
    async def sd_progress(request):
        run, pend = _queue_ids()
        return web.json_response({"progress": 0.0 if run else 1.0, "eta_relative": 0.0, "state": {"job_count": len(run) + len(pend)}, "current_image": None, "textinfo": None})

    @routes.post("/sdapi/v1/interrupt")
    @guarded("webui")
    async def sd_interrupt(request):
        import comfy.model_management as mm
        mm.interrupt_current_processing()
        return web.json_response({})

    # ---- OpenAI 形式
    async def openai_run(request, edit):
        d = await _form(request)
        job = await _submit(_from_openai(d, edit))
        files = await _finish(job)
        url = d.get("response_format") == "url"
        data = [{"url": host(request) + f["view"]} if url else {"b64_json": f["data"]} for f in files if f["kind"] == "image"]
        return web.json_response({"created": int(time.time()), "data": data})

    @routes.post("/v1/images/generations")
    @guarded("openai")
    async def oa_generations(request):
        return await openai_run(request, False)

    @routes.post("/v1/images/edits")
    @guarded("openai")
    async def oa_edits(request):
        return await openai_run(request, True)

    @routes.get("/v1/models")
    @guarded("openai")
    async def oa_models(request):
        from .specs import VISIBLE_TYPES
        return web.json_response({"object": "list", "data": [{"id": t, "object": "model", "created": 0, "owned_by": "cca-generator"} for t in VISIBLE_TYPES]})
