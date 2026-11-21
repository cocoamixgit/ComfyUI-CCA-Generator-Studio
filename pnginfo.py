"""生成した画像に生成情報を入れて保存する(第25版)。

PNG に次を入れる:
  parameters … A1111 / Forge と同じ書き方の生成情報(プロンプト・ネガティブ・ステップ数・サンプラー・CFG・シード・
                サイズ・モデルとハッシュ・LoRA とハッシュ・Hires など)。多くの投稿サイト・ツールが読める形
  prompt / workflow … ComfyUI 本体の SaveImage と同じ(ComfyUI にドラッグして開き直せる)

ハッシュ(投稿サイトがモデルを見分ける値):
  モデル・VAE … ファイル全体の SHA256 の先頭 10 文字(A1111 の Model hash。サイトの AutoV2)
  LoRA       … safetensors は中身(先頭の見出しを除いた所)の SHA256 の先頭 12 文字(A1111 の Lora hashes。AutoV3)
大きいファイルは計算に時間が掛かるので、ファイルの大きさ・更新日時と一緒に user/default/cca_generator/model_hashes.json に覚える。
"""
import hashlib
import json
import logging
import os
import threading

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths

from .panel import parse_loras
from .specs import NONE, TYPE_INFO, hires_supported
from .store import _base_dir

TOOL_NAME = "CCA Generator"
TOOL_VERSION = 1
HASH_FILE = "model_hashes.json"
_lock = threading.Lock()

# ComfyUI のサンプラー名 → A1111 / Forge の書き方(無いものはそのまま)
SAMPLER_NAMES = {
    "euler": "Euler", "euler_ancestral": "Euler a", "euler_cfg_pp": "Euler CFG++", "euler_ancestral_cfg_pp": "Euler a CFG++",
    "heun": "Heun", "heunpp2": "Heun++ 2", "dpm_2": "DPM2", "dpm_2_ancestral": "DPM2 a", "lms": "LMS",
    "dpm_fast": "DPM fast", "dpm_adaptive": "DPM adaptive", "dpmpp_2s_ancestral": "DPM++ 2S a",
    "dpmpp_sde": "DPM++ SDE", "dpmpp_sde_gpu": "DPM++ SDE", "dpmpp_2m": "DPM++ 2M", "dpmpp_2m_sde": "DPM++ 2M SDE",
    "dpmpp_2m_sde_gpu": "DPM++ 2M SDE", "dpmpp_3m_sde": "DPM++ 3M SDE", "dpmpp_3m_sde_gpu": "DPM++ 3M SDE",
    "ddpm": "DDPM", "lcm": "LCM", "ipndm": "iPNDM", "ipndm_v": "iPNDM v", "deis": "DEIS", "ddim": "DDIM",
    "uni_pc": "UniPC", "uni_pc_bh2": "UniPC", "res_multistep": "Res Multistep", "er_sde": "ER SDE",
    "gradient_estimation": "Gradient Estimation",
}
SCHEDULER_NAMES = {
    "normal": "Normal", "karras": "Karras", "exponential": "Exponential", "sgm_uniform": "SGM Uniform",
    "simple": "Simple", "ddim_uniform": "DDIM", "beta": "Beta", "linear_quadratic": "Linear Quadratic",
    "kl_optimal": "KL Optimal", "align_your_steps": "Align Your Steps",
}


# ---------------------------------------------------------------- ハッシュ
def _hash_path():
    return os.path.join(_base_dir(), HASH_FILE)


def _read_hashes():
    try:
        with open(_hash_path(), "r", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:  # noqa: BLE001  無い・壊れている → 計算し直す
        return {}


def _write_hashes(d):
    path = _hash_path()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _sha256(path, offset=0):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        f.seek(offset)
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _safetensors_offset(path):
    with open(path, "rb") as f:
        n = int.from_bytes(f.read(8), "little")
    return 8 + n


def file_hashes(path, lora=False):
    """{"sha256": ファイル全体, "tensors": safetensors の中身(LoRA のときだけ)}。覚えた値があれば計算しない"""
    path = os.path.abspath(path)
    st = os.stat(path)
    sig = [st.st_size, int(st.st_mtime)]
    want = ["sha256"] + (["tensors"] if lora and path.lower().endswith(".safetensors") else [])
    with _lock:
        cache = _read_hashes()
        e = cache.get(path)
        if isinstance(e, dict) and e.get("sig") == sig and all(k in e for k in want):
            return e
    e = {"sig": sig}
    e["sha256"] = _sha256(path)
    if "tensors" in want:
        e["tensors"] = _sha256(path, _safetensors_offset(path))
    with _lock:
        cache = _read_hashes()
        cache[path] = e
        _write_hashes(cache)
    return e


def _full(folder, name):
    if not name or name == NONE:
        return None
    try:
        return folder_paths.get_full_path(folder, name)
    except Exception:  # noqa: BLE001
        return None


def _stem(name):
    base = os.path.basename(str(name).replace("\\", "/"))
    return os.path.splitext(base)[0]


def model_hash(folder, name):
    p = _full(folder, name)
    if not p:
        return ""
    try:
        return file_hashes(p)["sha256"][:10]
    except Exception:  # noqa: BLE001  読めなくても保存は続ける
        logging.exception("[CCA Generator] モデルのハッシュを計算できませんでした: %s", name)
        return ""


def lora_hash(name, folders=("loras",)):
    for folder in folders:
        p = _full(folder, name)
        if not p:
            continue
        try:
            e = file_hashes(p, lora=True)
            return (e.get("tensors") or e["sha256"])[:12]
        except Exception:  # noqa: BLE001
            logging.exception("[CCA Generator] LoRA のハッシュを計算できませんでした: %s", name)
            return ""
    return ""


# ---------------------------------------------------------------- 実行した設定(prompt の CCA の内部ノードから読む)
def collect(prompt):
    """prompt(API 形式)から、パネルの値を {キー: 値} で返す。パネルが無ければ None"""
    if not isinstance(prompt, dict):
        return None
    by = {}
    for n in prompt.values():
        if isinstance(n, dict) and n.get("class_type") and n["class_type"] not in by:
            by[n["class_type"]] = n.get("inputs") or {}
    panel = by.get("CCAGeneratorPanel", {})
    parts = ["CCAGenModels", "CCAGenPrompt", "CCAGenSeed", "CCAGenSampling", "CCAGenHires"]
    if not panel and not any(p in by for p in parts):
        return None
    out = dict(panel)
    for p in parts:
        out.update(by.get(p, {}))
    # つないだ入力(リスト)は値ではないので使わない
    return {k: v for k, v in out.items() if not isinstance(v, list)}


def _quote(v):
    s = str(v)
    if not any(c in s for c in ',\n:"'):
        return s
    return json.dumps(s, ensure_ascii=False)


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    return str(int(f)) if f == int(f) else f"{f:g}"


def build_parameters(v, width, height):
    """A1111 / Forge の書き方の生成情報(文字列)"""
    mt, task = v.get("model_type"), v.get("task")
    info = TYPE_INFO.get(mt) or {}
    loader = info.get("loader")
    positive = v.get("positive_text") if v.get("positive_text") is not None else v.get("positive", "")
    positive = str(positive or "")
    negative = str(v.get("negative") or "")

    # LoRA(パネルの一覧・Turbo・MOSS の Edit)
    loras = []
    try:
        for l in parse_loras(v.get("loras")):
            if l["on"] and l["name"] and l["name"] != NONE:
                loras.append((l["name"], l["strength"], ("loras",)))
    except Exception:  # noqa: BLE001
        pass
    if info.get("is_turbo") and v.get("turbo_lora_name") not in (None, "", NONE):
        loras.insert(0, (v["turbo_lora_name"], v.get("turbo_lora_strength", 1.0), ("loras",)))
    if info.get("base") == "MOSS" and task == "I2I" and v.get("edit_lora_name") not in (None, "", NONE):
        loras.append((v["edit_lora_name"], v.get("edit_lora_strength", 1.0), ("loras", "model_patches")))

    text = positive
    tags = " ".join(f"<lora:{_stem(n)}:{_num(s)}>" for n, s, _ in loras)
    if tags:
        text = f"{text.rstrip()}{', ' if text.strip() else ''}{tags}" if text.strip() else tags
    lines = [text]
    if negative.strip():
        lines.append(f"Negative prompt: {negative}")

    hires = bool(v.get("hires_enable")) and mt in TYPE_INFO and hires_supported(mt, task)
    sampler = str(v.get("sampler_name") or "")
    sched = str(v.get("scheduler") or "")
    f = []
    if v.get("steps") is not None:
        f.append(("Steps", _num(v["steps"])))
    if sampler:
        f.append(("Sampler", SAMPLER_NAMES.get(sampler, sampler)))
    if sched:
        f.append(("Schedule type", SCHEDULER_NAMES.get(sched, sched)))
    if v.get("cfg") is not None:
        f.append(("CFG scale", _num(v["cfg"])))
    if v.get("seed") is not None:
        f.append(("Seed", _num(v["seed"])))
    if hires:
        try:
            bw, bh = int(v.get("width")), int(v.get("height"))
        except (TypeError, ValueError):
            sc = float(v.get("hires_scale") or 1) or 1
            bw, bh = round(width / sc), round(height / sc)
        f.append(("Size", f"{bw}x{bh}"))
    else:
        f.append(("Size", f"{width}x{height}"))

    # モデル
    if loader == "ckpt":
        name, folder = v.get("ckpt_name"), "checkpoints"
    elif loader == "wan14":
        name, folder = v.get("wan_high_unet"), "diffusion_models"
    else:
        name, folder = v.get("unet_name"), "diffusion_models"
    if name and name != NONE:
        h = model_hash(folder, name)
        if h:
            f.append(("Model hash", h))
        f.append(("Model", _stem(name)))
    if loader != "ckpt" and v.get("vae_name") not in (None, "", NONE):
        h = model_hash("vae", v["vae_name"])
        if h:
            f.append(("VAE hash", h))
        f.append(("VAE", os.path.basename(str(v["vae_name"]))))

    if hires:
        f.append(("Denoising strength", _num(v.get("hires_denoise", 0.45))))
        f.append(("Hires upscale", _num(v.get("hires_scale", 1.5))))
        if int(float(v.get("hires_steps") or 0)) > 0:
            f.append(("Hires steps", _num(v["hires_steps"])))
        if v.get("hires_upscaler"):
            f.append(("Hires upscaler", str(v["hires_upscaler"])))
        if float(v.get("hires_cfg") or 0) > 0:
            f.append(("Hires CFG Scale", _num(v["hires_cfg"])))
    elif task == "I2I" and v.get("denoise") is not None and float(v["denoise"]) < 1:
        f.append(("Denoising strength", _num(v["denoise"])))

    hs = []
    for n, _s, folders in loras:
        h = lora_hash(n, folders)
        if h:
            hs.append(f"{_stem(n)}: {h}")
    if hs:
        f.append(("Lora hashes", ", ".join(hs)))
    tmpl = v.get("wildcard_template")
    if isinstance(tmpl, str) and tmpl.strip() and tmpl != positive:
        f.append(("Template", tmpl))  # ワイルドカードを置き換える前の文(Dynamic Prompts と同じ名前)
    f.append(("Version", f"{TOOL_NAME} v{TOOL_VERSION} (ComfyUI)"))
    lines.append(", ".join(f"{k}: {_quote(val)}" for k, val in f))
    return "\n".join(lines)


# ---------------------------------------------------------------- 保存するノード(SaveImage の代わり)
class CCASaveImage:
    CATEGORY = "CCA Generator"
    FUNCTION = "save_images"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    DESCRIPTION = ("画像を保存する(ComfyUI の Save Image と同じ)。生成パネルの設定から、プロンプト・モデルとハッシュ・"
                   "LoRA・Hires などを A1111 / Forge と同じ書き方の生成情報(parameters)として PNG に入れる。")

    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type = "output"
        self.compress_level = 4

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",),
                             "filename_prefix": ("STRING", {"default": "ComfyUI"})},
                "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"}}

    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        from comfy.cli_args import args
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0])
        params = None
        if not args.disable_metadata:
            try:
                v = collect(prompt)
                if v:
                    params = build_parameters(v, int(images[0].shape[1]), int(images[0].shape[0]))
            except Exception:  # noqa: BLE001  生成情報が作れなくても画像は保存する
                logging.exception("[CCA Generator] 生成情報を作れませんでした")
        results = []
        for batch_number, image in enumerate(images):
            arr = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
            metadata = None
            if not args.disable_metadata:
                metadata = PngInfo()
                if params:
                    metadata.add_text("parameters", params)
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))
            name = filename.replace("%batch_num%", str(batch_number))
            file = f"{name}_{counter:05}_.png"
            img.save(os.path.join(full_output_folder, file), pnginfo=metadata, compress_level=self.compress_level)
            results.append({"filename": file, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}}


NODES = {"CCASaveImage": (CCASaveImage, "CCA 画像を保存(生成情報つき)")}
