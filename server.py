"""フロントエンド(web/*.js)向けの API。"""
import asyncio
import json
import os

import folder_paths

from .i18n import tr
from . import addons, audiogen, history, i18n, imgedit, model_dirs, model_guide, store, tile, uploads, videoedit, wildcards
from .downloads import links_for
from .panel import NODE_INSTALL_HELP, choice_lists, edit_format_info, node_installed, parse_loras
from .specs import (
    ALL_WIDGETS, COMMON_TASK_DEFAULTS, COMMON_TYPE_DEFAULTS, IMAGE_WIDGETS, LABELS, MODEL_TYPES, NONE,
    SIZE_MODES, VISIBLE_TYPES,
    size_step,
    TASK_DEFAULTS, TASK_LABELS, TASKS_ALL, TYPE_DEFAULTS, TYPE_INFO, Hint, builtin_presets,
    image_names, image_roles, keys_for, standard_files, uses_mask, visible_widgets,
)

FILE_KEYS = {
    "unet_name": "unets", "wan_high_unet": "unets", "wan_low_unet": "unets",
    "ckpt_name": "ckpts", "clip_name": "clips", "vae_name": "vaes", "audio_vae_name": "vaes",
    "turbo_lora_name": "loras", "turbo_lora_low_name": "loras",
    "edit_lora_name": "edit_loras",
    "clip_name_2": "clips", "latent_upscale_name": "latent_upscalers",
}
# 選択肢を持つ項目 → 一覧名(既定値の解決はしないものも含む)
LIST_KEYS = {**FILE_KEYS, "hires_upscaler": "upscalers"}
# 選択肢の一覧名 → ComfyUI のフォルダ種別
LIST_KIND = {"unets": "diffusion_models", "ckpts": "checkpoints", "clips": "text_encoders",
             "vaes": "vae", "loras": "loras", "edit_loras": "loras", "upscalers": "upscale_models",
             "latent_upscalers": "latent_upscale_models"}
SIZE_PRESETS = [
    [512, 512], [512, 768], [768, 512], [1024, 1024], [896, 1152], [1152, 896],
    [832, 1216], [1216, 832], [768, 1344], [1344, 768], [704, 1280], [1280, 704],
    [1328, 1328], [2048, 2048], [3104, 3104], [864, 480], [480, 864], [1280, 704], [704, 1280],
]


MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".sft")


def _base(f):
    return f.replace("\\", "/").rsplit("/", 1)[-1]


def resolve_file(spec, files):
    """既定値のファイル名を実在するファイル名に解決する。

    文字列: 完全一致 → 拡張子なし一致 → 前方一致。見つからなければ名前をそのまま返す(拡張子を補う)
    Hint  : 条件に合う最初のファイル。無ければ (none)
    """
    if spec is None or spec == NONE:
        return NONE
    if isinstance(spec, Hint):
        for f in sorted(files, key=lambda x: (len(_base(x)), x.lower())):
            if spec.match(f):
                return f
        if not spec.fallback:
            return NONE
        spec = spec.fallback  # 入れるべきファイル名を出す(パネルに「見つかりません」と入手先が出る)
    s = str(spec).lower()
    for f in files:  # フォルダ付きの名前(Kandinsky 6 など)
        p = f.replace("\\", "/").lower()
        if p == s or (p.endswith(MODEL_EXTS) and os.path.splitext(p)[0] == s):
            return f
    for f in files:
        if _base(f).lower() == s:
            return f
    for f in files:
        b = _base(f).lower()
        if b.endswith(MODEL_EXTS) and os.path.splitext(b)[0] == s:
            return f
    for f in files:
        if _base(f).lower().startswith(s):
            return f
    return spec if s.endswith(MODEL_EXTS) else spec + ".safetensors"


def _resolved_defaults(name, task, c):
    vals = dict(COMMON_TYPE_DEFAULTS)
    vals.update(COMMON_TASK_DEFAULTS)
    vals.update(TYPE_DEFAULTS.get(name, {}))
    vals.update(TASK_DEFAULTS[name][task])
    if vals.get("unet_dtype") is None:
        vals["unet_dtype"] = c["dtypes"][0]
    if vals.get("clip_device") is None:
        vals["clip_device"] = c["clip_devices"][0]
    if vals.get("clip_type") not in c["clip_types"]:
        vals["clip_type"] = ("stable_diffusion" if "stable_diffusion" in c["clip_types"]
                             else c["clip_types"][0])
    for k, folder in FILE_KEYS.items():
        vals[k] = resolve_file(vals.get(k), c[folder][1:])
    loras = []
    for l in vals.get("loras") or []:
        l = dict(l)
        l["name"] = resolve_file(l.get("name"), c["loras"][1:])
        loras.append(l)
    vals["loras"] = json.dumps(parse_loras(loras), ensure_ascii=False)
    vals.setdefault("auto_image_size", False)
    return vals


def build_spec():
    c = choice_lists()
    types_info, visible, defaults, keys, roles, mask = {}, {}, {}, {}, {}, {}
    names, presets, std = {}, {}, {}
    for name in MODEL_TYPES:
        info = TYPE_INFO[name]
        type_keys, task_keys = keys_for(name)
        keys[name] = {"type": type_keys, "task": task_keys}
        first = _resolved_defaults(name, info["tasks"][0], c)
        defaults[name] = {"type": {k: first[k] for k in type_keys}, "tasks": {}}
        for task in info["tasks"]:
            vals = _resolved_defaults(name, task, c)
            defaults[name]["tasks"][task] = {k: vals[k] for k in task_keys if k in vals}
            visible[f"{name}::{task}"] = visible_widgets(name, task)
            roles[f"{name}::{task}"] = list(image_roles(name, task))
            names[f"{name}::{task}"] = list(image_names(name, task))
            presets[f"{name}::{task}"] = [
                {"name": p["name"], "positive": p["positive"], "negative": p["negative"]}
                for p in builtin_presets(name, task)]
            mask[f"{name}::{task}"] = uses_mask(name, task)
            std[f"{name}::{task}"] = standard_files(name, task)
        need = info.get("needs_node")
        types_info[name] = {
            "base": info["base"], "family": info["family"], "is_turbo": info["is_turbo"], "loader": info["loader"],
            "kind": info["kind"], "tasks": list(info["tasks"]),
            "max_images": dict(info["max_images"]), "negative": info["negative"],
            "cfg": info["cfg"], "size_step": size_step(name), "hidden": info["hidden"],
            # 第10版: 種別の短い説明・枠で配置を指定できるタスク・音声も作るか
            "note": info.get("note", ""), "layout": dict(info.get("layout") or {}), "audio": bool(info.get("audio")),
            "needs_node": need or "",
            # 第11版: モデルの選び方の案内のキーと、この種別の(公式の)モデルのライセンス
            "guide": model_guide.guide_key(info) or "", "license": model_guide.type_license(name, info),
            # 追加ノードが必要で、まだ入っていないときの案内(Kandinsky 6)
            "missing_node": (NODE_INSTALL_HELP.get(need, need) if need and not node_installed(need) else ""),
            # 第42版: 声・音楽の作り方・欄の名前と入力例・結果の種類・入れ方の案内があるか
            "gen": info.get("gen") or "", "labels": info.get("labels") or {}, "output": info.get("output") or "",
            "addon": bool(need and need in addons.ADDONS),
        }
    return {
        "version": 9, "size_modes": SIZE_MODES, "guides": guides(),
        # 選べる種別(MiniMax はワークフローに残すが一覧からは外す)。all_types はワークフローにある全部
        "types": list(VISIBLE_TYPES), "all_types": list(MODEL_TYPES),
        "image_widgets": list(IMAGE_WIDGETS),
        "model_guide": {"guides": model_guide.GUIDES, "licenses": model_guide.LICENSES,
                        "glossary": model_guide.GLOSSARY, "checked": model_guide.CHECKED},
        "tasks_all": list(TASKS_ALL), "task_labels": TASK_LABELS,
        "types_info": types_info, "visible": visible, "defaults": defaults, "keys": keys,
        "image_roles": roles, "image_names": names, "builtin_presets": presets,
        "mask": mask, "labels": LABELS, "widgets": list(ALL_WIDGETS), "standard_files": std,
        "file_keys": FILE_KEYS, "list_keys": LIST_KEYS, "list_kind": LIST_KIND, "size_presets": SIZE_PRESETS,
        "preset_file": os.path.join(store._base_dir(), store.PRESET_FILE),
        "audio_preset_file": os.path.join(store._base_dir(), store.AUDIO_PRESET_FILE),
        # 第42版: 音楽・音声の設定の既定値と選べる値
        "audio": audiogen.spec(),
        "choices": c,
    }


def guides():
    """モデル種別ごとの使い方(パネルの「? 使い方」で表示する Markdown)。tools/notes.py が元"""
    try:
        import importlib.util
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "notes.py")
        spec = importlib.util.spec_from_file_location("cca_notes_runtime", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return {"usage": mod.USAGE, "types": {t: md for t, md in mod.GUIDES}}
    except Exception as e:  # noqa: BLE001
        return {"usage": f"使い方を読み込めませんでした: {e}", "types": {}}


def register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return False
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return False
    routes = instance.routes

    def _bad(msg):
        return web.json_response({"ok": False, "error": str(msg)}, status=400)

    @routes.get("/cca_generator/spec")
    async def cca_generator_spec(request):
        try:
            return web.json_response(build_spec())
        except Exception as e:  # noqa: BLE001
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.get("/cca_generator/i18n")
    async def cca_generator_i18n(request):
        try:
            return web.json_response(i18n.info(comfy=request.query.get("comfy")))
        except Exception as e:  # noqa: BLE001
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.post("/cca_generator/i18n")
    async def cca_generator_set_lang(request):
        try:
            body = await request.json()
            choice = str(body.get("choice") or "auto")
            if choice != "auto" and choice not in [p["code"] for p in i18n.packs()]:
                return _bad(i18n.tr("その言語の言語パックがありません: {code}", code=choice))
            comfy = body.get("comfy")
            return web.json_response(i18n.info(comfy=str(comfy) if comfy else None, choice=choice))
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/imgedit/save")
    async def cca_generator_imgedit_save(request):
        # 画像編集: 「画像の保存先」(prefix)のフォルダに「元の名前_edit.png」で保存(あれば _edit_1、_edit_2 …)
        try:
            form = await request.post()
            f = form.get("image")
            data = f.file.read() if hasattr(f, "file") else None
            return web.json_response({"ok": True, **imgedit.save_edit(data, form.get("source", ""), form.get("prefix"),
                                                                      form.get("name"), form.get("ext"))})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    # ---------------------------------------------------------------- 入れた画像・動画(input は使わず、保存先に保存する)
    @routes.post("/cca_generator/upload")
    async def cca_generator_upload(request):
        try:
            form = await request.post()
            f = form.get("file")
            if f is None or not hasattr(f, "file"):
                return _bad(tr("ファイルがありません"))
            data = f.file.read()
            loop = asyncio.get_running_loop()
            info = await loop.run_in_executor(None, lambda: uploads.save_upload(
                data, getattr(f, "filename", "") or "image.png", form.get("prefix") or "", form.get("sub") or ""))
            return web.json_response({"ok": True, **info})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    # 結果の画像などを、入力画像のプルダウンの選択肢(最近の画像)に入れる
    @routes.post("/cca_generator/remember_image")
    async def cca_generator_remember_image(request):
        try:
            data = await request.json()
            uploads.remember(str(data.get("value") or ""))
            return web.json_response({"ok": True})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    # 処理が終わったら、作業用の画像(temp/cca_edit)と結果の画像(temp の PreviewImage)を消す
    @routes.post("/cca_generator/temp_cleanup")
    async def cca_generator_temp_cleanup(request):
        try:
            data = await request.json()
            return web.json_response({"ok": True, "removed": imgedit.temp_cleanup(data.get("files") or [])})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    # ---------------------------------------------------------------- 一時保存(動画編集・画像編集)
    @routes.get("/cca_generator/history")
    async def cca_generator_history_list(request):
        try:
            kind = request.query.get("kind", "")
            return web.json_response({"items": history.list_entries(kind), "max_auto": history.MAX_AUTO, "dir": history.root(kind)})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/history/save")
    async def cca_generator_history_save(request):
        try:
            form = await request.post()

            def blob(k):
                f = form.get(k)
                return f.file.read() if hasattr(f, "file") else None
            try:
                info = json.loads(form.get("info") or "{}")
            except ValueError:
                info = {}
            loop = asyncio.get_running_loop()
            # レイヤーの画像(第24版の画像編集): file:L<id>.png
            files = {k[5:]: blob(k) for k in form.keys() if k.startswith("file:")}
            item = await loop.run_in_executor(None, lambda: history.save(
                form.get("kind", ""), form.get("data") or "{}", name=form.get("name", ""), auto=form.get("auto") == "1",
                hid=form.get("id", ""), title=form.get("title", ""), info=info,
                thumb=blob("thumb"), img=blob("img"), orig=blob("orig"), files=files))
            return web.json_response({"ok": True, "item": item})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/history/get")
    async def cca_generator_history_get(request):
        try:
            return web.json_response({"ok": True, **history.get(request.query.get("kind", ""), request.query.get("id", ""))})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/history/file")
    async def cca_generator_history_file(request):
        try:
            path = history.file_path(request.query.get("kind", ""), request.query.get("id", ""), request.query.get("f", ""))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        ctype = "image/jpeg" if path.endswith(".jpg") else "image/png"
        return web.FileResponse(path, headers={"Content-Type": ctype, "Cache-Control": "no-store"})

    # ---- 第25版: 全設定の書き出し / 読み込み(サーバー側の分。ブラウザ側の分は web/cca_settings.js が足す)
    @routes.get("/cca_generator/settings/export")
    async def cca_generator_settings_export(request):
        try:
            from . import settings_io
            return web.json_response({"ok": True, "data": settings_io.export_all()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/settings/import")
    async def cca_generator_settings_import(request):
        try:
            from . import settings_io
            body = await request.json()
            cats = body.get("cats")
            res = settings_io.import_all(body.get("data"), body.get("mode", "merge"), cats if isinstance(cats, list) else None)
            return web.json_response({"ok": True, **res})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/settings/forge_styles")
    async def cca_generator_settings_forge_styles(request):
        """第28版: Forge / A1111 の styles.csv(ファイルの中身そのもの)を、読み込める設定の形にして返す(まだ保存はしない)"""
        try:
            from . import settings_io
            raw = await request.content.read(settings_io.FORGE_MAX_BYTES + 1)
            data, info = settings_io.forge_styles(raw)
            return web.json_response({"ok": True, "data": data, "info": info})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/history/rename")
    async def cca_generator_history_rename(request):
        try:
            data = await request.json()
            return web.json_response({"ok": True, "item": history.rename(data.get("kind", ""), data.get("id", ""), data.get("name", ""))})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/history/open")
    async def cca_generator_history_open(request):
        try:
            data = await request.json()
            return web.json_response({"ok": True, "path": history.open_dir(data.get("kind", ""))})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/history/delete")
    async def cca_generator_history_delete(request):
        try:
            data = await request.json()
            return web.json_response({"ok": history.delete(data.get("kind", ""), data.get("id", ""))})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/videoedit/media")
    async def cca_generator_videoedit_media(request):
        # 動画編集: 選べる動画・画像と、文字に使うフォント
        try:
            font = videoedit.find_font()
            return web.json_response({**videoedit.media_list(), "font": os.path.basename(font) if font else None,
                                      "font_dir": videoedit.user_font_dir()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/videoedit/fonts")
    async def cca_generator_videoedit_fonts(request):
        # 文字に使えるフォント(この PC のフォントと、フォントのフォルダのフォント)。初回は少し時間がかかるので別のスレッドで
        try:
            refresh = request.query.get("refresh") == "1"
            loop = asyncio.get_running_loop()
            fonts = await loop.run_in_executor(None, lambda: videoedit.font_list(refresh))
            d = videoedit.find_font()
            dflt = next((f for f in fonts if f["key"] == d), None) if d else None
            return web.json_response({"fonts": fonts, "default": dflt or ({"key": d, "family": os.path.basename(d)} if d else None),
                                      "font_dir": videoedit.user_font_dir()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/videoedit/font_file")
    async def cca_generator_videoedit_font_file(request):
        # プレビューで同じフォントを使うため。一覧にあるフォントだけを返す
        f = videoedit.font_entry(request.query.get("key", ""))
        if not f:
            return _bad("フォントが見つかりません")
        path, _ = videoedit.font_path_index(f["key"])
        ext = os.path.splitext(path)[1].lower()
        ctype = {".ttf": "font/ttf", ".otf": "font/otf", ".ttc": "font/collection"}.get(ext, "application/octet-stream")
        return web.FileResponse(path, headers={"Content-Type": ctype, "Cache-Control": "max-age=3600"})

    @routes.get("/cca_generator/videoedit/gfonts")
    async def cca_generator_videoedit_gfonts(request):
        try:
            refresh = request.query.get("refresh") == "1"
            loop = asyncio.get_running_loop()
            return web.json_response(await loop.run_in_executor(None, lambda: videoedit.google_font_families(refresh)))
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/videoedit/gfont")
    async def cca_generator_videoedit_gfont(request):
        # Google Fonts のフォントを fonts/google に入れる
        try:
            data = await request.json()
            loop = asyncio.get_running_loop()
            saved = await loop.run_in_executor(None, lambda: videoedit.google_font_download(data.get("family", ""), data.get("weights") or (400, 700)))
            return web.json_response({"ok": True, "fonts": saved})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/videoedit/styles")
    async def cca_generator_videoedit_styles(request):
        # 文字の書式のテンプレート(おすすめ ★ と保存したもの)
        try:
            return web.json_response(videoedit.text_style_list())
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/videoedit/styles")
    async def cca_generator_videoedit_styles_post(request):
        try:
            data = await request.json()
            act = data.get("action")
            if act == "save":
                store.save_text_style(data.get("name"), data.get("style") or {})
            elif act == "delete":
                store.delete_text_style(data.get("name"))
            elif act == "hide":
                store.hide_text_style(data.get("name"), True)
            elif act == "unhide":
                store.hide_text_style(data.get("name"), False)
            else:
                return _bad("action が不正です")
            return web.json_response({"ok": True, **videoedit.text_style_list()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/watermarks")
    async def cca_generator_watermarks(request):
        # 透かしの画像(user/default/cca_generator/watermarks)
        try:
            return web.json_response({"items": videoedit.watermark_list()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/watermarks")
    async def cca_generator_watermarks_add(request):
        try:
            form = await request.post()
            f = form.get("image")
            if f is None or not hasattr(f, "file"):
                return _bad("画像がありません")
            item = videoedit.watermark_save(f.file.read(), getattr(f, "filename", "watermark.png"))
            return web.json_response({"ok": True, "item": item, "items": videoedit.watermark_list()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/watermarks/file")
    async def cca_generator_watermarks_file(request):
        # 透かしの画像(一覧・プレビュー用)
        try:
            path = videoedit._watermark_path(request.query.get("name", ""))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.FileResponse(path, headers={"Content-Type": "image/png", "Cache-Control": "no-cache"})

    @routes.post("/cca_generator/watermarks/delete")
    async def cca_generator_watermarks_delete(request):
        try:
            data = await request.json()
            videoedit.watermark_delete(data.get("name"))
            return web.json_response({"ok": True, "items": videoedit.watermark_list()})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/videoedit/probe")
    async def cca_generator_videoedit_probe(request):
        try:
            return web.json_response(videoedit.probe(request.query.get("value", "")))
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    # 第26版: 音の大きさの一覧(動画編集のタイムラインの波形・音量メーター)
    @routes.get("/cca_generator/videoedit/peaks")
    async def cca_generator_videoedit_peaks(request):
        try:
            import asyncio
            value = request.query.get("value", "")
            return web.json_response(await asyncio.get_running_loop().run_in_executor(None, videoedit.audio_peaks, value))
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.get("/cca_generator/state")
    async def cca_generator_state(request):
        return web.json_response(store.load_all())

    @routes.post("/cca_generator/state")
    async def cca_generator_save_state(request):
        try:
            store.save_state(await request.json())
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True})

    @routes.post("/cca_generator/state/reset")
    async def cca_generator_reset_state(request):
        try:
            data = await request.json()
            store.reset_state((data or {}).get("model_type"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True})

    @routes.get("/cca_generator/choices")
    async def cca_generator_choices(request):
        # モデル一覧だけを読み直す(ページの再読み込み不要)。ComfyUI の一覧キャッシュは
        # 「後から作られたフォルダ」を見逃すことがあるため、ここで捨ててから数え直す
        try:
            model_dirs.invalidate_all()
            return web.json_response(choice_lists())
        except Exception as e:  # noqa: BLE001
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    @routes.get("/cca_generator/model_dirs")
    async def cca_generator_model_dirs(request):
        try:
            sm = model_dirs.find_stability_matrix()
        except Exception:  # noqa: BLE001
            sm = None
        return web.json_response({"kinds": model_dirs.info(), "stability_matrix": sm})

    @routes.post("/cca_generator/model_dirs")
    async def cca_generator_model_dirs_edit(request):
        try:
            data = await request.json()
            if data.get("action") == "add":
                path = model_dirs.add(data.get("kind"), data.get("path"))
            elif data.get("action") == "add_sm":
                path = model_dirs.add_stability_matrix(data.get("path") or None)
            elif data.get("action") == "remove":
                model_dirs.remove(data.get("kind"), data.get("path"))
                path = data.get("path")
            else:
                raise ValueError(tr('action が不正です'))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "path": path})

    @routes.post("/cca_generator/open_folder")
    async def cca_generator_open_folder(request):
        try:
            data = await request.json()
            path = model_dirs.open_folder(data.get("path"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "path": path})

    @routes.get("/cca_generator/addon_help")
    async def cca_generator_addon_help(request):
        try:
            return web.json_response(addons.addon_help(request.query.get("node", "")))
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/open_output")
    async def cca_generator_open_output(request):
        # 生成した画像・動画のフォルダを開く(ファイルを選んだ状態で)
        try:
            data = await request.json()
            path = addons.open_output(data.get("filename", ""), data.get("subfolder", ""), data.get("type", "output"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "path": path})

    @routes.get("/cca_generator/file_check")
    async def cca_generator_file_check(request):
        # 選んだファイルが壊れていないか(.safetensors の見出しと大きさを比べる)。画像編集の「オブジェクト除去」の前に使う
        from .panel import KNOWN_BROKEN, file_problem
        kind = request.query.get("kind", "")
        name = request.query.get("name", "")
        if kind not in model_dirs.KINDS:
            return _bad("kind が不正です")
        try:
            path = folder_paths.get_full_path(kind, name) if name else None
        except Exception:
            path = None
        prob = file_problem(path) if path else None
        base = os.path.basename(name.replace("\\", "/")).lower()
        return web.json_response({"ok": True, "found": bool(path), "broken": bool(prob),
                                  "size": (prob or {}).get("size"), "need": (prob or {}).get("need"),
                                  "better": KNOWN_BROKEN.get(base) if prob else None, "path": path or ""})

    @routes.get("/cca_generator/file_help")
    async def cca_generator_file_help(request):
        kind = request.query.get("kind", "")
        name = request.query.get("name", "")
        if kind not in model_dirs.KINDS:
            return _bad("kind が不正です")
        info = model_dirs.info().get(kind)
        if not info["paths"]:
            # 実在するフォルダが無いときは ComfyUI 標準の場所を 1 つだけ案内する(開くときに作る)
            try:
                first = folder_paths.get_folder_paths(kind)[0]
                info = {**info, "paths": [{"path": first, "registered": first, "custom": False,
                                            "source": "default", "real": "", "count": 0}]}
            except Exception:
                pass
        # 実体のパス(リンクの先)で、モデルファイルの多い順(= 実際に使っている場所が先)
        return web.json_response({"kind": kind, "label": info["label"], "folders": info["paths"],
                                  "links": links_for(name, kind)})

    @routes.get("/cca_generator/edit_format")
    async def cca_generator_edit_format(request):
        # MOSS Edit: 「自動」のときにどの形式で読むか(パネルに表示する)
        try:
            info = edit_format_info(request.query.get("format", ""), request.query.get("name", ""))
        except Exception as e:  # noqa: BLE001
            return _bad(str(e))
        return web.json_response(info)

    @routes.post("/cca_generator/preset")
    async def cca_generator_save_preset(request):
        try:
            data = await request.json()
            name = store.save_preset(data.get("name"), data.get("positive"), data.get("negative"), data.get("group") or "")
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "name": name})

    # 第42版: 声・音楽を作る小さな処理(prompt)。保存先の %date% などはここで置き換える
    @routes.post("/cca_generator/audio/prompt")
    async def cca_generator_audio_prompt(request):
        try:
            from .prefix import expand_prefix
            v = dict((await request.json()).get("values") or {})
            v["_aprefix"] = expand_prefix(v.get("audio_output_prefix") or "audio/CCA")
            v["_vprefix"] = expand_prefix(v.get("video_output_prefix") or "video/CCA")
            prompt, kind, used = audiogen.build_prompt(v)
            return web.json_response({"ok": True, "prompt": prompt, "kind": kind, "used": used})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/audio/transcribe")
    async def cca_generator_audio_transcribe(request):
        try:
            d = await request.json()
            return web.json_response({"ok": True, "prompt": audiogen.transcribe_prompt(d.get("value"), d.get("model"), d.get("lang"))})
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/preset/hide")
    async def cca_generator_hide_preset(request):
        try:
            data = await request.json()
            store.hide_builtin(data.get("id"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True})

    @routes.post("/cca_generator/preset/unhide")
    async def cca_generator_unhide_preset(request):
        try:
            data = await request.json()
            n = store.unhide_builtin(data.get("base"), data.get("task"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "restored": n})

    # ---- 第29版: ワイルドカード(__名前__)と、複数画像タイル生成のまとめ
    @routes.get("/cca_generator/wildcards")
    async def cca_generator_wildcards(request):
        try:
            return web.json_response(wildcards.listing())
        except Exception as e:  # noqa: BLE001
            return _bad(e)

    @routes.post("/cca_generator/wildcards/save")
    async def cca_generator_wildcards_save(request):
        try:
            data = await request.json()
            name = wildcards.save(data.get("name"), data.get("lines"), data.get("old"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "name": name})

    @routes.post("/cca_generator/wildcards/delete")
    async def cca_generator_wildcards_delete(request):
        try:
            data = await request.json()
            existed = wildcards.delete(data.get("name"), bool(data.get("revert")))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "deleted": existed})

    @routes.post("/cca_generator/wildcards/unhide")
    async def cca_generator_wildcards_unhide(request):
        try:
            n = wildcards.unhide()
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "restored": n})

    @routes.post("/cca_generator/tile")
    async def cca_generator_tile(request):
        try:
            data = await request.json()
            res = await asyncio.to_thread(tile.make, data.get("images"), data.get("opts"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, **res})

    @routes.get("/cca_generator/tile_settings")
    async def cca_generator_tile_settings(request):
        return web.json_response({"ok": True, "values": store.tile_settings()})

    @routes.post("/cca_generator/tile_settings")
    async def cca_generator_tile_settings_save(request):
        try:
            data = await request.json()
            store.save_tile_settings(data.get("values"))
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True})

    @routes.post("/cca_generator/preset/delete")
    async def cca_generator_delete_preset(request):
        try:
            data = await request.json()
            existed = store.delete_preset(data.get("name"), data.get("group") or "")
        except Exception as e:  # noqa: BLE001
            return _bad(e)
        return web.json_response({"ok": True, "deleted": existed})

    return True


def register_prompt_hook():
    try:
        from server import PromptServer
    except Exception:
        return False
    instance = getattr(PromptServer, "instance", None)
    if instance is None or not hasattr(instance, "add_on_prompt_handler"):
        return False
    from .split import on_prompt
    instance.add_on_prompt_handler(on_prompt)
    return True
