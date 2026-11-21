"""画像編集(web/cca_imgedit.js)のサーバー側。

- CCAObjectRemove: 塗った範囲のオブジェクトを除去する。FLUX.2 Klein 4B とオブジェクト除去 LoRA(fal/flux-2-klein-4B-object-remove-lora、Apache-2.0)で、
  消す所を赤い四角で囲んだ画像を「Remove the highlighted object from the scene」で編集し、四角の中だけを元の画像に戻す
  (四角の外は元の画素のまま)。大きな画像は、四角のまわりだけを切り出して処理する
- CCALamaRemove: 塗った範囲のオブジェクトを除去する(軽い方法)。LaMa(big-lama.pt、Apache-2.0。models/inpaint)を ComfyUI に入っている
  spandrel で読み、塗った所(少し広げる)のまわりだけを切り出して埋め、塗った所だけを元の画像に戻す。追加のノードはいらない
- save_edit: 編集した画像を、元の画像と同じフォルダに「元の名前_edit.png」で保存する(あれば _edit_1、_edit_2 …)
"""
import math
import os
import re

import folder_paths
import torch
import torch.nn.functional as F

from .i18n import tr
from .panel import CATEGORY, LABELS, _call, _require_file, apply_lora
from .prefix import prefix_folder

REMOVE_PROMPT = "Remove the highlighted object from the scene"
LORA_HINT = re.compile(r"object[-_ ]?remov|kdekt5q7", re.I)

_cache = {"key": None, "models": None}


def load_models(unet_name, clip_name, vae_name, lora_name, lora_strength):
    """前回と同じファイルなら読み直さない"""
    key = (unet_name, clip_name, vae_name, lora_name, round(float(lora_strength), 4))
    if _cache["key"] == key and _cache["models"] is not None:
        return _cache["models"]
    _cache["key"], _cache["models"] = None, None
    model = _call("UNETLoader", unet_name=unet_name, weight_dtype="default")[0]
    # パネルと同じ読み方(壊れたファイル・1 つも当たらない LoRA はわかりやすいエラーにする)
    model = apply_lora(model, None, lora_name, float(lora_strength), 0.0, "オブジェクト除去 LoRA", tr("オブジェクト除去"))[0]
    clip = _call("CLIPLoader", clip_name=clip_name, type="flux2", device="default")[0]
    vae = _call("VAELoader", vae_name=vae_name)[0]
    _cache["key"], _cache["models"] = key, (model, clip, vae)
    return _cache["models"]


def work_size(w, h, megapixels):
    """縦横比を保って、だいたい megapixels(百万画素)になる大きさ(16 の倍数)"""
    k = math.sqrt(max(0.05, float(megapixels)) * 1_000_000 / max(1, w * h))
    return max(256, int(round(w * k / 16)) * 16), max(256, int(round(h * k / 16)) * 16)


def generate(model, clip, vae, image, seed, steps, cfg, megapixels=1.0):
    """赤い四角を描いた画像 → 消した画像。切り出しの縦横比のまま、だいたい megapixels の大きさで作る。
    FLUX.2 Klein の処理(CCAFlux2Klein)をそのまま使う"""
    from .extra_models import CCAFlux2Klein
    tw, th = work_size(image.shape[2], image.shape[1], megapixels)
    img = F.interpolate(image[..., :3].movedim(-1, 1), size=(th, tw), mode="bilinear", align_corners=False,
                        antialias=True).movedim(1, -1).clamp(0, 1)
    return CCAFlux2Klein().run(model=model, clip=clip, vae=vae, positive=REMOVE_PROMPT, negative="",
                               seed=int(seed), steps=int(steps), cfg=float(cfg), sampler_name="euler",
                               scheduler="simple", width=tw, height=th, size_by_scale=True,
                               ref_images=[img])[0]


def color_match(res, ref, keep, strength=1.0):
    """res を ref の色に合わせる(色あせ・色ずれを打ち消す)。keep [H,W](True = 変わっていないはずの所)で、
    色ごとに平均と散らばりを比べて res 全体を直す。strength 0〜1(0 は何もしない)。比べる所が少なければそのまま"""
    strength = max(0.0, min(1.0, float(strength)))
    keep = keep.bool()
    if strength <= 0 or int(keep.sum()) < 64:
        return res
    out = res.clone()
    for c in range(3):
        a, b = res[0, :, :, c][keep], ref[0, :, :, c][keep]
        ma, mb = a.mean(), b.mean()
        sa, sb = a.std().clamp(min=1e-4), b.std()
        scale = (sb / sa).clamp(0.5, 2.0)
        fixed = (res[0, :, :, c] - ma) * scale + mb
        out[0, :, :, c] = res[0, :, :, c] * (1 - strength) + fixed * strength
    return out.clamp(0, 1)


def regions(w, h, x0, y0, x1, y1):
    """(四角, 切り出す範囲, 線の太さ)。四角は画像の中に収め、切り出しは四角のまわりに余白をとる(最低 512px 四方)"""
    x0, x1 = sorted((max(0, min(w - 1, int(x0))), max(1, min(w, int(x1)))))
    y0, y1 = sorted((max(0, min(h - 1, int(y0))), max(1, min(h, int(y1)))))
    x1, y1 = max(x1, x0 + 1), max(y1, y0 + 1)
    bw, bh = x1 - x0, y1 - y0
    pad = max(64, int(0.75 * max(bw, bh)))
    cx0, cy0, cx1, cy1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    for lo, hi, size in ((0, 2, w), (1, 3, h)):  # 小さすぎるときは 512px まで広げる
        box = [cx0, cy0, cx1, cy1]
        need = min(512, size) - (box[hi] - box[lo])
        if need > 0:
            box[lo] -= need // 2
            box[hi] += need - need // 2
        cx0, cy0, cx1, cy1 = box
    cx0, cy0 = max(0, cx0), max(0, cy0)
    cx1, cy1 = min(w, cx1), min(h, cy1)
    line = max(2, round(max(cx1 - cx0, cy1 - cy0) / 200))
    return (x0, y0, x1, y1), (cx0, cy0, cx1, cy1), line


def draw_box(img, x0, y0, x1, y1, line):
    """img [1,H,W,3] に赤い四角(枠線)を描く"""
    out = img.clone()
    h, w = out.shape[1], out.shape[2]
    red = torch.tensor([1.0, 0.0, 0.0], dtype=out.dtype, device=out.device)
    a0, b0 = max(0, x0 - line), max(0, y0 - line)
    a1, b1 = min(w, x1 + line), min(h, y1 + line)
    out[:, b0:min(h, y0 + line), a0:a1, :3] = red
    out[:, max(0, y1 - line):b1, a0:a1, :3] = red
    out[:, b0:b1, a0:min(w, x0 + line), :3] = red
    out[:, b0:b1, max(0, x1 - line):a1, :3] = red
    return out


def blend_mask(h, w, x0, y0, x1, y1, feather):
    """四角の中が 1、まわり feather px でなめらかに 0 になる [H,W]"""
    ys = torch.arange(h, dtype=torch.float32).view(h, 1)
    xs = torch.arange(w, dtype=torch.float32).view(1, w)
    dx = torch.maximum(x0 - xs, xs - (x1 - 1)).clamp(min=0)
    dy = torch.maximum(y0 - ys, ys - (y1 - 1)).clamp(min=0)
    d = torch.sqrt(dx * dx + dy * dy)
    return (1.0 - d / max(1.0, float(feather))).clamp(0.0, 1.0)


def remove_object(image, x0, y0, x1, y1, run, mask=None, area="paint", grow=12, feather=8, color=0.0):
    """image [1,H,W,C] の四角のオブジェクト除去。run(赤い四角を描いた切り出し) → 消した切り出し(大きさは問わない)。
    mask [H,W](塗った所)と area "paint" なら、塗った所(grow px 広げ、feather px でなめらかに)だけを差し替える。
    area "box" か mask が無ければ、四角の中を差し替える。color: 変わっていないはずの所で色を合わせる強さ(0〜1)"""
    img = image[:1]
    h, w = img.shape[1], img.shape[2]
    (x0, y0, x1, y1), (cx0, cy0, cx1, cy1), line = regions(w, h, x0, y0, x1, y1)
    crop = img[:, cy0:cy1, cx0:cx1, :3]
    bx0, by0, bx1, by1 = x0 - cx0, y0 - cy0, x1 - cx0, y1 - cy0
    marked = draw_box(crop, bx0, by0, bx1, by1, line)
    res = run(marked)[:1, :, :, :3].to(crop.dtype)
    if res.shape[1] != crop.shape[1] or res.shape[2] != crop.shape[2]:
        res = F.interpolate(res.movedim(-1, 1), size=(crop.shape[1], crop.shape[2]), mode="bilinear",
                            align_corners=False).movedim(1, -1)
    # 四角(と線)の中は消した画像、外は元の画像。境目はなめらかに
    g2 = line + 3
    m = blend_mask(crop.shape[1], crop.shape[2], bx0 - g2, by0 - g2, bx1 + g2, by1 + g2, max(6, line * 3))
    pm = None
    if mask is not None:
        mk = mask.float()
        if mk.dim() == 3:
            mk = mk[0]
        if mk.shape != (h, w):
            mk = F.interpolate(mk[None, None], size=(h, w), mode="bilinear", align_corners=False)[0, 0]
        pm = (mk[cy0:cy1, cx0:cx1] > 0.5).float()
        if float(pm.max()) <= 0:
            pm = None
    # 色を合わせる: 塗った所(広げた所)と四角の線の外は、元と同じはずなので、そこで比べる
    keep = (grow_mask(pm, max(int(grow), 2) + int(feather) + 4) <= 0) if pm is not None else (m <= 0)
    # 赤い四角の線のまわり(消し残りが出やすい所)は比べない
    ch_, cw_ = crop.shape[1], crop.shape[2]
    outer = blend_mask(ch_, cw_, bx0 - g2 - 2, by0 - g2 - 2, bx1 + g2 + 2, by1 + g2 + 2, 1) > 0
    inner = blend_mask(ch_, cw_, bx0 + line + 2, by0 + line + 2, bx1 - line - 2, by1 - line - 2, 1) >= 1
    keep = keep & ~(outer & ~inner)
    res = color_match(res.clamp(0, 1), crop, keep, color)
    if pm is not None and area == "paint":
        m = feather_mask(grow_mask(pm, int(grow)), int(feather)) if int(feather) > 0 else grow_mask(pm, int(grow))
    m = m.to(crop.dtype).view(1, crop.shape[1], crop.shape[2], 1)
    out = img.clone()
    out[:, cy0:cy1, cx0:cx1, :3] = crop * (1 - m) + res * m
    return out


class CCAObjectRemove:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("画像編集の「オブジェクト除去」。FLUX.2 Klein 4B とオブジェクト除去 LoRA で、四角の中のオブジェクトを除去して周りに合わせて埋めます"
                   "(四角の外は元のまま)。")
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        i = lambda d, lo, hi: ("INT", {"default": d, "min": lo, "max": hi})  # noqa: E731
        return {"required": {
            "image": ("IMAGE",),
            "x0": i(0, 0, 32768), "y0": i(0, 0, 32768), "x1": i(64, 1, 32768), "y1": i(64, 1, 32768),
            "unet_name": ("STRING", {"default": ""}), "clip_name": ("STRING", {"default": ""}),
            "vae_name": ("STRING", {"default": ""}), "lora_name": ("STRING", {"default": ""}),
            "lora_strength": ("FLOAT", {"default": 1.1, "min": 0.0, "max": 3.0, "step": 0.05}),
            "steps": i(20, 1, 100), "cfg": ("FLOAT", {"default": 4.0, "min": 1.0, "max": 20.0, "step": 0.1}),
            "seed": i(0, 0, 0xFFFFFFFF),
        }, "optional": {
            "mask": ("MASK",),
            "area": (["paint", "box"], {"default": "paint"}),
            "grow": i(12, 0, 128), "feather": i(8, 0, 128),
            "color_match": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
            "megapixels": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 4.0, "step": 0.05}),
        }}

    def run(self, image, x0, y0, x1, y1, unet_name, clip_name, vae_name, lora_name, lora_strength, steps, cfg, seed,
            mask=None, area="paint", grow=12, feather=8, color_match=1.0, megapixels=1.0):
        label = tr("オブジェクト除去")
        _require_file(unet_name, "diffusion_models", LABELS.get("unet_name", "モデル"), label)
        _require_file(clip_name, "text_encoders", LABELS.get("clip_name", "テキストエンコーダー"), label)
        _require_file(vae_name, "vae", LABELS.get("vae_name", "VAE"), label)
        _require_file(lora_name, "loras", "オブジェクト除去 LoRA", label)
        model, clip, vae = load_models(unet_name, clip_name, vae_name, lora_name, lora_strength)
        return (remove_object(image, x0, y0, x1, y1, lambda marked: generate(model, clip, vae, marked, seed, steps, cfg, megapixels),
                              mask=mask, area=area, grow=grow, feather=feather, color=color_match),)


# ---------------------------------------------------------------- オブジェクト除去(軽い方法: LaMa)
INPAINT_FOLDER = "inpaint"  # ComfyUI の inpaint 系の追加ノード(comfyui-inpaint-nodes など)と同じ置き場所
_lama = {"key": None, "model": None}


def ensure_inpaint_folder():
    """models/inpaint を ComfyUI のフォルダとして使えるようにする(追加ノードが登録済みならそのまま)"""
    if INPAINT_FOLDER not in folder_paths.folder_names_and_paths:
        folder_paths.folder_names_and_paths[INPAINT_FOLDER] = (
            [os.path.join(folder_paths.models_dir, INPAINT_FOLDER)], set(folder_paths.supported_pt_extensions))


def load_lama(name):
    """オブジェクト除去モデル(LaMa)。前回と同じファイルなら読み直さない"""
    ensure_inpaint_folder()
    label = tr("オブジェクト除去")
    _require_file(name, INPAINT_FOLDER, "オブジェクト除去モデル(LaMa)", label)
    path = folder_paths.get_full_path(INPAINT_FOLDER, name)
    st = os.stat(path)
    key = (path, st.st_size, st.st_mtime_ns)
    if _lama["key"] == key:
        return _lama["model"]
    from spandrel import MaskedImageModelDescriptor, ModelLoader
    import comfy.utils
    sd = None
    if path.lower().endswith(".pt"):
        # 配布されている big-lama.pt は TorchScript(lama-cleaner / IOPaint と同じファイル)。中の重みだけを使う
        try:
            sd = torch.jit.load(path, map_location="cpu").state_dict()
        except Exception:  # noqa: BLE001
            sd = None
    if sd is None:
        sd = comfy.utils.load_torch_file(path, safe_load=True)
    try:
        model = ModelLoader().load_from_state_dict(sd)
    except Exception as e:  # noqa: BLE001
        raise ValueError(tr("「{name}」はオブジェクト除去モデル(LaMa)として読めませんでした: {error}", name=name, error=e)) from e
    if not isinstance(model, MaskedImageModelDescriptor):
        raise ValueError(tr("「{name}」はオブジェクト除去モデル(LaMa など)ではありません({arch})", name=name, arch=model.architecture.name))
    model.eval()
    _lama["key"], _lama["model"] = key, model
    return model


def grow_mask(mask, px):
    """[H,W] のマスクを px だけ広げる(最大フィルター)"""
    if px <= 0:
        return mask
    k = 2 * int(px) + 1
    return F.max_pool2d(mask[None, None], k, stride=1, padding=int(px))[0, 0]


def feather_mask(mask, px):
    """[H,W] のマスクの縁を px だけなめらかにする(外へはみ出さない)"""
    if px <= 0:
        return mask
    k = 2 * int(px) + 1
    soft = F.avg_pool2d(F.pad(mask[None, None], (px, px, px, px), mode="replicate"), k, stride=1)[0, 0]
    return soft.clamp(0, 1)


def lama_inpaint(image, mask, model, grow=8, max_side=1024, device=None, feather=3, color=0.0):
    """image [1,H,W,C](0〜1)、mask [H,W] or [1,H,W](1 = 消す所) → 消した画像 [1,H,W,C]。
    塗った所を囲む範囲のまわりだけ(最低 512px 四方)を切り出し、長い辺が max_side より大きければ縮めて LaMa に通し、
    元の大きさに戻して、塗った所(grow px 広げ、縁をなめらかに)だけを差し替える"""
    img = image[:1].float()
    h, w = img.shape[1], img.shape[2]
    m = mask.float()
    if m.dim() == 3:
        m = m[0]
    if m.shape != (h, w):
        m = F.interpolate(m[None, None], size=(h, w), mode="bilinear", align_corners=False)[0, 0]
    m = (m > 0.5).float()
    if float(m.max()) <= 0:
        return image
    m = grow_mask(m, int(grow))
    ys, xs = torch.nonzero(m, as_tuple=True)
    _, (cx0, cy0, cx1, cy1), _ = regions(w, h, int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = img[:, cy0:cy1, cx0:cx1, :3]
    cm = m[cy0:cy1, cx0:cx1]
    ch, cw = crop.shape[1], crop.shape[2]
    k = min(1.0, float(max_side) / max(ch, cw))
    th, tw = max(8, int(round(ch * k))), max(8, int(round(cw * k)))
    x = crop.movedim(-1, 1)
    mm = cm[None, None]
    if (th, tw) != (ch, cw):
        x = F.interpolate(x, size=(th, tw), mode="bilinear", align_corners=False, antialias=True)
        mm = (F.interpolate(mm, size=(th, tw), mode="bilinear", align_corners=False) > 0.01).float()
    ph, pw = (-th) % 8, (-tw) % 8  # LaMa は 8 の倍数
    if ph or pw:
        x = F.pad(x, (0, pw, 0, ph), mode="reflect" if min(th, tw) > max(ph, pw) else "replicate")
        mm = F.pad(mm, (0, pw, 0, ph))
    if device is None:
        import comfy.model_management as mmg
        device = mmg.get_torch_device()
    model.to(device)
    with torch.no_grad():
        out = model(x.to(device), mm.to(device)).float().cpu()
    out = out[:, :, :th, :tw]
    if (th, tw) != (ch, cw):
        out = F.interpolate(out, size=(ch, cw), mode="bilinear", align_corners=False)
    out = out.movedim(1, -1).clamp(0, 1)
    # 色を合わせる(塗った所から離れた所は元と同じはずなので、そこで比べる)
    out = color_match(out, crop, grow_mask(cm, int(feather) + 4) <= 0, color)
    blend = (feather_mask(cm, int(feather)) if int(feather) > 0 else cm).view(1, ch, cw, 1)
    res = img.clone()
    res[:, cy0:cy1, cx0:cx1, :3] = crop * (1 - blend) + out * blend
    return res.to(image.dtype)


class CCALamaRemove:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("画像編集の「オブジェクト除去」の軽い方法。LaMa(big-lama.pt)で、塗った所をまわりに合わせて埋めます"
                   "(塗った所の外は元のまま)。追加のノードはいりません。")
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",), "mask": ("MASK",),
            "model_name": ("STRING", {"default": "big-lama.pt"}),
            "grow": ("INT", {"default": 8, "min": 0, "max": 64}),
            "max_side": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 8}),
        }, "optional": {
            "feather": ("INT", {"default": 3, "min": 0, "max": 64}),
            "color_match": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
        }}

    def run(self, image, mask, model_name, grow=8, max_side=1024, feather=3, color_match=1.0):
        model = load_lama(model_name)
        return (lama_inpaint(image, mask, model, grow, max_side, feather=feather, color=color_match),)


ensure_inpaint_folder()


# ---------------------------------------------------------------- 保存(元の名前_edit.png)
EDIT_SUFFIX = re.compile(r"_edit(?:_\d+)?$")


def parse_value(value):
    """"sub/name.png [output]" → (type, subfolder, filename)。注記が無ければ input"""
    v = str(value or "").strip()
    m = re.match(r"^(.*?)\s*\[(input|output|temp)\]$", v)
    typ = m.group(2) if m else "input"
    path = (m.group(1) if m else v).replace("\\", "/").strip("/")
    sub, _, name = path.rpartition("/")
    return typ, sub, name


def target_for(value, fallback_name="image", prefix=None, name=None, ext="png"):
    """保存先 (フォルダ, ファイル名, 種類, subfolder)。

    prefix(生成パネルの「画像の保存先」)があれば、そのフォルダ(%date% などを置き換えたもの)に保存する。
    無いとき: 元が output の中なら同じフォルダ、input の画像なら output の一番上(input には入れない)。temp は output の同じ名前のフォルダ。
    """
    name_ = name
    typ, sub, name = parse_value(value)
    if prefix is not None:
        sub = prefix_folder(prefix)
    elif typ == "input":
        sub = ""
    typ = "output"
    base = folder_paths.get_directory_by_type(typ) or folder_paths.get_input_directory()
    folder = os.path.abspath(os.path.join(base, sub))
    if os.path.commonpath([folder, os.path.abspath(base)]) != os.path.abspath(base):
        raise ValueError(tr("保存先のフォルダが不正です"))
    ext = ext if ext in SAVE_EXTS else "png"
    os.makedirs(folder, exist_ok=True)
    custom = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", os.path.basename(str(name_ or "")).strip())
    custom = re.sub(r"\.(png|jpe?g|webp)$", "", custom, flags=re.I).strip(" .")[:120]
    if custom:
        # 名前を決めたとき: その名前(あれば _1、_2 …)
        fname, n = f"{custom}.{ext}", 1
        while os.path.exists(os.path.join(folder, fname)):
            fname = f"{custom}_{n}.{ext}"
            n += 1
        return folder, fname, typ, sub
    stem = os.path.splitext(os.path.basename(name or ""))[0] or fallback_name
    stem = re.sub(r"[\\/:*?\"<>|]", "_", EDIT_SUFFIX.sub("", stem)) or fallback_name
    fname = f"{stem}_edit.{ext}"
    n = 1
    while os.path.exists(os.path.join(folder, fname)):
        fname = f"{stem}_edit_{n}.{ext}"
        n += 1
    return folder, fname, typ, sub


SAVE_EXTS = ("png", "jpg", "webp")


def image_kind(data):
    """画像のバイト列の形式(png / jpg / webp)。どれでもなければ None"""
    if not data:
        return None
    if data.startswith(b"\x89PNG"):
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def save_edit(data, value, prefix=None, name=None, ext=None):
    """画像(PNG / JPEG / WebP)のバイト列を保存して {filename, subfolder, type, value, path} を返す。
    prefix: 生成パネルの「画像の保存先」。name: ファイル名(拡張子なし。空なら「元の名前_edit」)。ext: 形式(中身と合っていること)"""
    kind = image_kind(data)
    if kind is None or (ext and ext.lower().replace("jpeg", "jpg") != kind):
        raise ValueError(tr("PNG の画像ではありません") if (ext or "png") == "png" else tr("画像の形式が合いません"))
    folder, fname, typ, sub = target_for(value, prefix=prefix, name=name, ext=kind)
    path = os.path.join(folder, fname)
    with open(path, "wb") as f:
        f.write(data)
    rel = f"{sub}/{fname}" if sub else fname
    return {"filename": fname, "subfolder": sub, "type": typ, "path": path, "value": f"{rel} [{typ}]"}


def temp_cleanup(files):
    """temp の中のファイルを消す(作業用の temp/cca_edit と、PreviewImage の結果)。temp の外・フォルダは消さない"""
    base = os.path.realpath(folder_paths.get_temp_directory())
    removed = 0
    for it in files[:50]:
        if not isinstance(it, dict) or it.get("type", "temp") != "temp":
            continue
        name = os.path.basename(str(it.get("filename") or ""))
        if not name:
            continue
        path = os.path.realpath(os.path.join(base, str(it.get("subfolder") or ""), name))
        if os.path.commonpath([path, base]) != base or not os.path.isfile(path):
            continue
        try:
            os.remove(path)
            removed += 1
        except OSError:
            pass
    return removed


NODES = {"CCAObjectRemove": (CCAObjectRemove, "CCA オブジェクト除去(画像編集)"),
         "CCALamaRemove": (CCALamaRemove, "CCA オブジェクト除去・軽い(LaMa・画像編集)")}
