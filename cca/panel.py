"""CCA Generator のノード。

- CCAGeneratorPanel  : ワークフロー上の操作パネル(全項目を持つ)。
- CCAGen*(内部ノード): キュー投入時に split.py がパネルを役割ごとに分割して置き換える先。
  役割ごとに分けることで ComfyUI のキャッシュが効き、Seed だけ変えたときにモデルの読み直しや
  プロンプトのエンコードが走らない(VRAM の少ない PC 向け)。
- CCAGeneratorRoutes : route 番号 → ROUTE_COUNT 個の BOOLEAN(Flow Selector の置き換え)。

ローダー類はコアノード(UNETLoader など)をそのまま呼ぶので、読み込み動作は元のノードと同じ。
"""
import hashlib
import json
import math
import os
import re
import struct

import torch

import comfy.lora
import comfy.lora_convert
import comfy.samplers
import comfy.utils
import folder_paths
import nodes as comfy_nodes

from .i18n import tr
from .prefix import expand_prefix
from .specs import (
    ALL_WIDGETS, IMAGE_WIDGETS, LABELS, MODEL_TYPES, NONE, ROUTE_COUNT, TASKS_ALL, TYPE_INFO,
    VRAM_AUTO, VRAM_BALANCED, VRAM_FAST, VRAM_FULL, VRAM_LOW, VRAM_MODES,
    EDIT_FORMAT_AUTO, EDIT_FORMATS, HIRES_METHODS, REF_SIZE_AUTO, REF_SIZE_OLD, REF_SIZE_SAME, REF_SIZES,
    SIZE_MODE_KEEP, SIZE_MODE_SCALE, SIZE_MODES, RESIZE_CROP, RESIZE_FILL, RESIZE_JUST, RESIZE_KEEP, RESIZE_MODES,
    full_mask_if_empty, hires_supported, max_images, needs_image, ref_max_edge_enabled, resize_supported,
    scale_supported, size_step, uses_mask,
)

SAMPLERS = comfy.samplers.KSampler.SAMPLERS
SCHEDULERS = comfy.samplers.KSampler.SCHEDULERS
CATEGORY = "cca_generator"
INTERNAL_CATEGORY = "cca_generator/internal"


# ---------------------------------------------------------------------------
# 選択肢
# ---------------------------------------------------------------------------
def _files(folder):
    try:
        return list(folder_paths.get_filename_list(folder))
    except Exception:
        return []


def _opts(spec, fallback):
    """INPUT_TYPES のコンボ定義(旧: [..] / 新: ("COMBO", {"options": [..]}))から選択肢を取り出す。"""
    try:
        head = spec[0]
        if isinstance(head, (list, tuple)):
            return list(head)
        if head == "COMBO" and len(spec) > 1 and "options" in spec[1]:
            return list(spec[1]["options"])
    except Exception:
        pass
    return list(fallback)


def _core_combo(node_name, key, fallback, section="required"):
    try:
        types = comfy_nodes.NODE_CLASS_MAPPINGS[node_name].INPUT_TYPES()
        return _opts(types[section][key], fallback)
    except Exception:
        return list(fallback)


def _image_files():
    """画像の選択肢: output フォルダの画像と、設定で追加したフォルダの画像(input と「最近入れた画像」は出さない)。ギャラリーの分はパネル側で先頭に足す"""
    out = []
    try:
        from . import media_dirs
        if media_dirs.shows("images", "output"):
            d = folder_paths.get_output_directory()
            out += [f"{n} [output]" for n in media_dirs._scan(d, "images")]
        out += [f for f in media_dirs.list_images() if f not in out]  # 設定の「画像を読み込む場所」で追加したフォルダ
    except Exception:
        pass
    return out


SN_CORE_PREFIX = "Core | "  # 「Core | ファイル名」= models/checkpoints の SenseNova(Comfy-Org 版)を ComfyUI 本体のノードで使う(自己修正は公式と同じ)


class SNCore:
    """ComfyUI 本体のノードで動かす SenseNova-U1.6 の部品(MODEL・CLIP・VAE)。処理ノード CCASenseNova が受け取る"""

    def __init__(self, model, clip, vae):
        self.model, self.clip, self.vae = model, clip, vae
        self._cca_sn_passes = 0


_SN_CORE_CACHE = {}


def _sn_keep_loras(u1, loras):
    try:
        setattr(u1, "_cca_sn_loras", list(loras))
    except Exception:  # noqa: BLE001
        pass


def sn_core_from_handle(u1):
    """追加ノード方式で読み込んだモデルのまま自己修正を頼まれたとき: 追加ノード側の自己修正(interleave_gen)は
    ライブラリの不具合で画像を作れないので、models/checkpoints にある SenseNova(Comfy-Org 版)を使い、
    公式ワークフローと同じ方式にする。無ければ None"""
    cks = [f for f in _sn_core_files() if "sensenova" in f.lower()]
    if not cks:
        return None
    loras = []
    have = set(_files("loras"))
    for l in getattr(u1, "_cca_sn_loras", None) or []:
        name = l["name"]
        if name not in have:  # 追加ノード用の名前(SenseNova-U1.6-8B-MoT-LoRA-8step-v1.0)は本体用のファイルに読み替える
            name = "sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors" if "8step" in name and "sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors" in have else name
        loras.append((name, float(l["strength"])))
    key = (cks[0], tuple(loras))
    core = _SN_CORE_CACHE.get(key)
    if core is None:
        _SN_CORE_CACHE.clear()
        model, clip, vae = _sn_load_ckpt(cks[0], "SenseNova-U1.6")
        for name, st in loras:
            if name not in have:
                raise ValueError(tr("[SenseNova-U1.6] 自己修正(公式の方式)に使う LoRA {name} が models/loras にありません。"
                                    "Comfy-Org/SenseNova-U1(https://huggingface.co/Comfy-Org/SenseNova-U1/tree/main)の sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors を models/loras に入れてください。", name=name))
            model = _call("LoraLoaderModelOnly", model=model, lora_name=name, strength_model=st)[0]
        core = _SN_CORE_CACHE[key] = SNCore(model, clip, vae)
    core._cca_sn_passes = int(getattr(u1, "_cca_sn_passes", 0) or 0)
    core._cca_ckpt = cks[0]
    return core


def _sn_load_ckpt(ckpt, mt):
    """models/checkpoints のファイルは CheckpointLoaderSimple、models/diffusion_models に入れたファイルは同じ読み込み(フルパス)"""
    if ckpt in _files("checkpoints"):
        return _call("CheckpointLoaderSimple", ckpt_name=ckpt)[:3]
    _require_file(ckpt, "diffusion_models", LABELS["unet_name"], mt)
    import comfy.sd
    path = folder_paths.get_full_path("diffusion_models", ckpt)
    out = comfy.sd.load_checkpoint_guess_config(path, output_vae=True, output_clip=True,
                                                embedding_directory=folder_paths.get_folder_paths("embeddings"))
    return out[0], out[1], out[2]


def _load_sn_core(model_type, info, p, ckpt):
    """公式ワークフロー(CheckpointLoaderSimple → LoraLoaderModelOnly)と同じ読み込み"""
    mt = info["name"]
    model, clip, vae = _sn_load_ckpt(ckpt, mt)
    loras = _active_loras(p.get("loras"))
    if info["is_turbo"]:
        have = set(_files("loras"))
        name = p.get("turbo_lora_name")
        if name not in have:  # 本体用の名前(Comfy-Org/SenseNova-U1)も探す
            name = next((n for n in ("sensenova_u1.6_8b_mot_8step_lora_bf16.safetensors",) if n in have), name)
        _require_file(name, "loras", LABELS["turbo_lora_name"], mt, field="turbo_lora_name")
        loras = loras + [{"name": name, "strength": p["turbo_lora_strength"]}]
    for i, l in enumerate(loras, 1):
        _require_file(l["name"], "loras", f"LoRA {i}", mt)
        model = _call("LoraLoaderModelOnly", model=model, lora_name=l["name"], strength_model=float(l["strength"]))[0]
    core = SNCore(model, clip, vae)
    _sn_passes(core, p)
    return core, core, None, None, None


def _sn_core_files():
    """他のモデルと同じ一覧: モデルフォルダの設定で足した場所も含む checkpoints と diffusion_models の全ファイル(名前では絞らない)。
    自動で選ぶときだけ、SenseNova らしい名前・int8 を先にする"""
    fs = list(dict.fromkeys(list(_files("checkpoints")) + list(_files("diffusion_models"))))
    return sorted(fs, key=lambda f: (not re.search(r"sensenova", f.lower()), "int8" not in f.lower(), f))


def _sn_models():
    from .specs import SN_DEFAULT, SN_LIGHT
    vals = _core_combo("SenseNovaU1ModelLoader", "model_weights", [])
    out = [SN_DEFAULT] + SN_LIGHT
    try:
        from . import hf_fetch
        local = hf_fetch.folder_models()  # モデルフォルダの設定で足した場所の GGUF
    except Exception:  # noqa: BLE001
        local = []
    for v in list(vals) + local + [SN_CORE_PREFIX + f for f in sorted(_sn_core_files())]:
        if v not in out:
            out.append(v)
    return out


def choice_lists():
    vaes = _core_combo("VAELoader", "vae_name", _files("vae"))
    return dict(
        unets=[NONE] + _files("diffusion_models"),
        ckpts=[NONE] + _files("checkpoints"),
        clips=[NONE] + _files("text_encoders"),
        vaes=[NONE] + vaes,
        loras=[NONE] + _files("loras"),
        # Edit LoRA は models/loras に加えて models/model_patches(MOSS Edit の配布形式の置き場所)も探す
        edit_loras=[NONE] + _files("loras") + [f for f in _files("model_patches")
                                               if f.lower().endswith(".safetensors") and f not in _files("loras")],
        upscalers=list(HIRES_METHODS) + _files("upscale_models"),
        # LTX-2.5 の潜在アップスケーラー(models/latent_upscale_models)
        latent_upscalers=[NONE] + _files("latent_upscale_models"),
        bg_models=_files("background_removal"),
        # TRELLIS.2 の画像エンコーダー(DINOv3)
        clip_visions=[NONE] + _files("clip_vision"),
        # SenseNova-U1.6: 追加ノードの読み込み方で選べるモデル(入っていなければ U1.6 だけ)
        sn_models=_sn_models(),
        inpaint_models=_files("inpaint"),
        images=[NONE] + _image_files(),
        clip_types=_core_combo("CLIPLoader", "type", ["stable_diffusion"]),
        clip_devices=_core_combo("CLIPLoader", "device", ["default", "cpu"], section="optional"),
        dtypes=_core_combo("UNETLoader", "weight_dtype", ["default"]),
    )


# ---------------------------------------------------------------------------
# コアノードの呼び出し
# ---------------------------------------------------------------------------
def _call(node_name, **kwargs):
    cls = comfy_nodes.NODE_CLASS_MAPPINGS[node_name]
    inst = cls()
    result = getattr(inst, cls.FUNCTION)(**kwargs)
    if hasattr(result, "result"):  # V3 ノードの NodeOutput
        result = result.result
    return result


def _on(name):
    return bool(name) and name != NONE


FOLDER_LABEL = {
    "checkpoints": "models/checkpoints", "diffusion_models": "models/diffusion_models",
    "text_encoders": "models/text_encoders", "vae": "models/vae", "loras": "models/loras",
    "latent_upscale_models": "models/latent_upscale_models",
    "clip_vision": "models/clip_vision", "background_removal": "models/background_removal",
}

# 追加ノードが必要な種別の案内(Kandinsky 6)
NODE_INSTALL_HELP = {
    "Kandinsky6Sampler": (
        "Kandinsky 6 を使うには追加ノード「kandinsky6」が必要です。\n"
        "ComfyUI Manager の「Custom Nodes Manager」で kandinsky6(作者 kandinskylab)を検索してインストールし、"
        "ComfyUI を再起動してください。"),
    "SenseNovaU1ModelLoader": (
        "SenseNova-U1.6 を使うには追加ノード「ComfyUI-SenseNova-U1」(作者 OpenSenseNova)が必要です。\n"
        "ComfyUI Manager の「Custom Nodes Manager」で ComfyUI-SenseNova-U1 を検索してインストールし、ComfyUI を再起動してください。"
        "モデルは初めて使うときに自動でダウンロードされます。"),
    "Trellis2Conditioning": (
        "TRELLIS.2 は ComfyUI 本体のノードを使います。ComfyUI を新しい版に更新してください。"),
    # 第42版: 声・音楽
    "AILab_Qwen3TTSCustomVoice": (
        "Qwen3-TTS を使うには追加ノード「ComfyUI-QwenTTS」(作者 1038lab)が必要です。\n"
        "ComfyUI Manager の「Custom Nodes Manager」で ComfyUI-QwenTTS を検索してインストールし、ComfyUI を再起動してください。"
        "モデルは初めて使うときに自動でダウンロードされます。"),
    "LatentSyncNode": (
        "LatentSync 1.6 を使うには追加ノード「ComfyUI-LatentSyncWrapper」(作者 ShmuelRonen)が必要です。\n"
        "ComfyUI Manager の「Custom Nodes Manager」で LatentSyncWrapper を検索してインストールし、ComfyUI を再起動してください。"
        "モデル(ByteDance/LatentSync-1.6)は初めて使うときに自動でダウンロードされます。"),
    "FL_HeartMuLa_Sampler": (
        "HeartMuLa を使うには追加ノード「ComfyUI_FL-HeartMuLa」(作者 filliptm)が必要です。\n"
        "ComfyUI Manager の「Custom Nodes Manager」で FL-HeartMuLa を検索してインストールし、ComfyUI を再起動してください。"
        "モデルは初めて使うときに自動でダウンロードされます(models/heartmula)。"),
    "TextEncodeAceStepAudio1.5": (
        "ACE-Step 1.5 は ComfyUI 本体のノードを使います。この ComfyUI には無いので、ComfyUI を新しくしてください"
        "(ComfyUI Manager の「Update ComfyUI」など)。"),
}


def find_node(name):
    """ComfyUI に登録されたノードのクラス(無ければ None)"""
    return comfy_nodes.NODE_CLASS_MAPPINGS.get(name) if name else None


# 同じ役目の、追加ノードの古い版のノード(SenseNova: 0.2.0 までは Local Loader だけ)
NODE_ALIASES = {"SenseNovaU1ModelLoader": ("SenseNovaU1LocalLoader",)}


def node_installed(node_name):
    return not node_name or any(find_node(n) is not None for n in (node_name, *NODE_ALIASES.get(node_name, ())))


def call_node(name, **vals):
    """V3 ノードを、ノードの既定値に渡したい値を重ねて実行する(追加ノードの版で入力が違っても動くように)。
    ノードに無い入力は渡さない"""
    import inspect
    cls = find_node(name)
    if cls is None:
        raise ValueError(tr("追加ノード {need} が必要です。", need=name))
    params = inspect.signature(cls.execute).parameters
    kw = {}
    try:
        types = cls.INPUT_TYPES()
    except Exception:  # noqa: BLE001
        types = {}
    for sec in ("required", "optional"):
        for k, spec in (types.get(sec) or {}).items():
            if k not in params or k in vals:
                continue
            opt = spec[1] if isinstance(spec, (list, tuple)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
            if "default" in opt:
                kw[k] = opt["default"]
            elif isinstance(spec, (list, tuple)) and spec and isinstance(spec[0], (list, tuple)) and spec[0]:
                kw[k] = spec[0][0]
            elif opt.get("options"):
                kw[k] = opt["options"][0]
    kw.update({k: v for k, v in vals.items() if k in params})
    r = cls.execute(**kw)
    return r.result if hasattr(r, "result") else r


def missing_node_text(need):
    """追加ノードが無いときの案内。フォルダはあるのに使えないときは、そのことも書く"""
    text = tr(NODE_INSTALL_HELP.get(need) or "追加ノード {need} が必要です。", need=need)
    try:
        from .addons import ADDONS
        folder = (ADDONS.get(need) or {}).get("folder")
        found = [os.path.join(d, n) for d in folder_paths.get_folder_paths("custom_nodes") if os.path.isdir(d)
                 for n in os.listdir(d) if folder and n.lower() == folder.lower()]
        if found:
            text = tr("追加ノードのフォルダはありますが({path})、ノード {need} を読み込めていません。"
                      "ComfyUI の起動ログで、このフォルダの行とその前後に出ている警告・エラーを確かめてください"
                      "(追加ノードが使うパッケージが足りないと、こうなります)。", path=found[0], need=need)
    except Exception:  # noqa: BLE001
        pass
    return text


def require_node(model_type):
    need = TYPE_INFO[model_type].get("needs_node")
    if need and not node_installed(need):
        raise ValueError(f"[{model_type}] " + missing_node_text(need))


def _guide_text(model_type, field):
    try:
        from . import model_guide
        t = model_guide.missing_help(model_type, TYPE_INFO.get(model_type), field, tr)
    except Exception:
        t = ""
    return ("\n\n" + t) if t else ""


def _require_file(name, folder, label, model_type, field=None):
    label = label.replace("((none)でオフ)", "").strip()
    if not _on(name):
        raise ValueError(tr('[{model_type}] {label} が未選択です。パネルでファイルを選んでください。', model_type=model_type, label=tr(label)))
    if folder == "vae" and name in _core_combo("VAELoader", "vae_name", []):
        return  # pixel_space / taesd など
    if folder_paths.get_full_path(folder, name) is None:
        try:
            where = "\n".join("  " + d for d in folder_paths.get_folder_paths(folder))
        except Exception:
            where = "  ComfyUI/" + FOLDER_LABEL.get(folder, folder)
        try:  # パネルの「入れる場所」と同じ一覧(追加したフォルダ・ファイルの数つき)
            from . import model_dirs
            ps = (model_dirs.info().get(folder) or {}).get("paths") or []
            if ps:
                where = "\n".join(f"  {x['path']}" + (f"  ({tr('{n} 個', n=x['count'])})" if x.get("count") is not None else "") for x in ps)
        except Exception:
            pass
        where += "\n" + tr("入れたら一番上の 🔄 を押してください。")
        raise ValueError(
            tr('[{model_type}] {label} のファイルが見つかりません: {name}\n入れる場所({label}):\n{where}', model_type=model_type, label=tr(label), name=name, where=where) + _guide_text(model_type, field))
    check_not_broken(name, folder_paths.get_full_path(folder, name), label, model_type)


# 配布元のファイル自体が途中までしか入っていないもの → 同じ配布ページにある、代わりに使うファイル
KNOWN_BROKEN = {
    # fal/flux-2-klein-4B-object-remove-lora: 中身の見出しは 76,039,072 バイト分あるのに、ファイルは 58,441,728 バイト
    "flux-object-remove-lora.safetensors": "kDEkt5q7tDLKOpQJIVMPx_pytorch_lora_weights_comfy_converted.safetensors",
}
_problem_cache = {}


def file_problem(path):
    """.safetensors が途中で切れている・見出しが読めないとき {"size": 実際のバイト数, "need": 本来のバイト数 or None}。
    問題が無い・調べられない(.safetensors 以外など)ときは None。見出し(先頭の数 KB〜数 MB)だけを読む"""
    if not path or not str(path).lower().endswith(".safetensors"):
        return None
    try:
        st = os.stat(path)
    except OSError:
        return None
    key = (str(path), st.st_size, st.st_mtime_ns)
    if key in _problem_cache:
        return _problem_cache[key]
    res = None
    try:
        with open(path, "rb") as f:
            head = f.read(8)
            n = struct.unpack("<Q", head)[0] if len(head) == 8 else 0
            if n < 2 or 8 + n > st.st_size:
                res = {"size": st.st_size, "need": None}
            else:
                hdr = json.loads(f.read(n).decode("utf-8"))
                end = max((int(v["data_offsets"][1]) for k, v in hdr.items()
                           if k != "__metadata__" and isinstance(v, dict) and "data_offsets" in v), default=0)
                if 8 + n + end > st.st_size:
                    res = {"size": st.st_size, "need": 8 + n + end}
    except OSError:
        res = None
    except (ValueError, KeyError, TypeError, IndexError, UnicodeDecodeError):
        res = {"size": st.st_size, "need": None}
    _problem_cache[key] = res
    return res


def _mb(n):
    return f"{n / 1048576:.1f} MB"


def broken_message(name, path, prob, label, model_type):
    base = os.path.basename(str(name).replace("\\", "/"))
    if prob.get("need"):
        msg = tr('[{model_type}] {label} のファイルが壊れています(途中で切れています): {name}\n大きさ {size}(本来は {need})。ダウンロードかコピーが途中で止まった可能性があります。もう一度ダウンロードしてください。\n{path}',
                 model_type=model_type, label=tr(label), name=name, size=_mb(prob["size"]), need=_mb(prob["need"]), path=path)
    else:
        msg = tr('[{model_type}] {label} のファイルが壊れています(中身が読めません): {name}\nもう一度ダウンロードしてください。\n{path}',
                 model_type=model_type, label=tr(label), name=name, path=path)
    better = KNOWN_BROKEN.get(base.lower())
    if better:
        msg += "\n" + tr('このファイルは配布元の時点で途中までしか入っていません。同じ配布ページの {better} を入れて、そちらを選んでください。', better=better)
    return msg


def check_not_broken(name, path, label, model_type):
    prob = file_problem(path)
    if prob:
        raise ValueError(broken_message(name, path, prob, label.replace("((none)でオフ)", "").strip(), model_type))


def _lora_path(name, folders):
    for folder in folders:
        try:
            path = folder_paths.get_full_path(folder, name)
        except Exception:
            path = None
        if path:
            return path
    return None


def _read_lora(path):
    try:
        sd, meta = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
    except TypeError:
        sd, meta = comfy.utils.load_torch_file(path, safe_load=True), None
    return sd, (meta or {})


def _moss_edit_patch_to_lora(sd, meta):
    """MOSS Edit の配布形式(adapter_config 埋め込み・キーが <target>.lora_A)を ComfyUI の LoRA 形式に変換する。
    ComfyUI-Moss-Image-Edit(Chenkin-x)と同じ変換。この形式は標準の LoRA ローダーでは 1 つも当たらない。"""
    try:
        cfg = json.loads(meta.get("adapter_config", "{}"))
    except Exception:
        return None
    if cfg.get("format") != "moss-edit-lora":
        return None
    lora = {}
    for target, spec in cfg.get("modules", {}).items():
        prefix = "diffusion_model." + target
        if target + ".lora_A" not in sd or target + ".lora_B" not in sd:
            raise ValueError(tr('MOSS Edit パッチの中身が設定と一致しません: {target}', target=target))
        lora[prefix + ".lora_A.weight"] = sd[target + ".lora_A"]
        lora[prefix + ".lora_B.weight"] = sd[target + ".lora_B"]
        lora[prefix + ".alpha"] = torch.tensor(float(spec["alpha"]))
    return lora


def lora_format(name, folders=("loras",)):
    """"moss-edit"(chinoll 版の配布形式そのまま)/ "chinoll"(chinoll 版を ComfyUI 用に変換したもの・公式 rank64)
    / "ai-toolkit"(MOSS-Image-Edit-HQ の armV3・armV5・armV7 など)/ "standard" / None(見つからない)"""
    return lora_format_info(name, folders)[0]


def lora_format_info(name, folders=("loras",)):
    """(形式, 判定の理由)"""
    path = _lora_path(name, folders) if _on(name) else None
    if not path:
        return None, "ファイルが見つかりません"
    meta = {}
    try:
        from safetensors import safe_open
        with safe_open(path, framework="pt", device="cpu") as f:
            meta = f.metadata() or {}
    except Exception:
        meta = {}
    base = os.path.basename(str(name)).lower()
    hq = bool(re.search(r"arm_?v\d|edit[_-]?hq|hq[_-]?edit|moss[_-]?image[_-]?edit[_-]?hq", base))
    try:
        packed = json.loads(meta.get("adapter_config", "{}") or "{}").get("format") == "moss-edit-lora"
    except Exception:
        packed = False
    if packed and hq:
        # HQ リポジトリ直下の armV*-moss-edit-lora は chinoll 形式に詰め直したもの。学習は ai-toolkit(参照画像を
        # テキストエンコーダーにも見せる)なので ai-toolkit で読む(ComfyUI-Moss-Image-Edit-Native の検証でも HQ は画像なしだと失敗する)
        return "ai-toolkit-packed", "MOSS-Image-Edit-HQ を chinoll 形式に詰め直したファイル。学習は ai-toolkit なので ai-toolkit で読みます"
    if packed:
        return "moss-edit", "chinoll 版の配布形式(adapter_config)"
    if any("ai-toolkit" in str(v).lower() or "ai_toolkit" in str(v).lower() for v in meta.values()):
        return "ai-toolkit", "ai-toolkit で学習(ファイル内の記録)"
    if hq:
        return "ai-toolkit", "MOSS-Image-Edit-HQ 系(armV3・V5・V7 など)のファイル名"
    if re.search(r"chinoll|moss[_-]?image[_-]?edit[_-]?lora|^moss[_-]?image[_-]?edit\.safetensors$|adapter_model", base):
        return "chinoll", "chinoll 版(公式 rank64 など)のファイル名"
    return "standard", "形式の記録なし"


def apply_lora(model, clip, name, strength_model, strength_clip, label, model_type,
               folders=("loras",)):
    """LoRA を掛ける。1 つも当たらない(モデルと LoRA の種類が合わない・形式が違う)ときはエラーにする。"""
    strength_model = float(strength_model)
    strength_clip = float(strength_clip) if clip is not None else 0.0
    if not _on(name) or (strength_model == 0.0 and strength_clip == 0.0):
        return model, clip
    path = _lora_path(name, folders)
    if path is None:
        _require_file(name, folders[0], label, model_type)
    check_not_broken(name, path, label, model_type)
    sd, meta = _read_lora(path)
    converted = _moss_edit_patch_to_lora(sd, meta)
    if converted is not None:
        sd = converted
        clip, strength_clip = None, 0.0
    key_map = comfy.lora.model_lora_keys_unet(model.model, {})
    if clip is not None:
        key_map = comfy.lora.model_lora_keys_clip(clip.cond_stage_model, key_map)
    sd = comfy.lora_convert.convert_lora(sd)
    loaded = comfy.lora.load_lora(sd, key_map, log_missing=False)
    new_model, new_clip = model, clip
    applied = set()
    if strength_model != 0.0:
        new_model = model.clone()
        applied |= set(new_model.add_patches(loaded, strength_model))
    if clip is not None and strength_clip != 0.0:
        new_clip = clip.clone()
        applied |= set(new_clip.add_patches(loaded, strength_clip))
    if not applied:
        raise ValueError(
            tr('[{model_type}] {label}「{name}」をこのモデルに掛けられませんでした(一致する重みが 0 個)。\nモデルの種類と LoRA が合っていないか、ComfyUI の LoRA ローダーが読めない形式です。', model_type=model_type, label=tr(label), name=name))
    if converted is not None and len(applied) < len(loaded):
        raise ValueError(tr('[{model_type}] {label}「{name}」の一部の重みを掛けられませんでした。ComfyUI を更新してください。', model_type=model_type, label=tr(label), name=name))
    return new_model, new_clip


def _lora_only(model, name, strength, label, model_type, folders=("loras",)):
    return apply_lora(model, None, name, strength, 0.0, label, model_type, folders)[0]


def parse_loras(value):
    """LoRA 一覧(JSON 文字列)を [{"name","strength","clip","target","on"}] に整える。"""
    if isinstance(value, list):
        items = value
    else:
        text = str(value or "").strip()
        if not text:
            return []
        try:
            items = json.loads(text)
        except Exception as e:
            raise ValueError(tr('LoRA 一覧の形式が正しくありません: {e}', e=e)) from e
    if not isinstance(items, list):
        raise ValueError(tr('LoRA 一覧の形式が正しくありません(リストではありません)'))
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or NONE)
        try:
            strength = float(it.get("strength", 1.0))
            clip = float(it.get("clip", strength))
        except (TypeError, ValueError):
            strength, clip = 1.0, 1.0
        target = it.get("target") if it.get("target") in ("both", "high", "low") else "both"
        out.append(dict(name=name, strength=strength, clip=clip, target=target,
                        on=bool(it.get("on", True))))
    return out


def _active_loras(value):
    return [l for l in parse_loras(value) if l["on"] and _on(l["name"])]


def _type_info(model_type, task):
    info = TYPE_INFO.get(model_type)
    if info is None:
        raise ValueError(tr('未対応のモデル種別です: {model_type}', model_type=model_type))
    if task not in info["tasks"]:
        raise ValueError(
            tr('[{model_type}] はタスク {task} に対応していません(対応: {tasks})。', model_type=model_type, task=task, tasks=', '.join(info['tasks'])))
    return info


# SenseNova の追加ノードが使うパッケージ sensenova-u1(公式ノードの requirements.txt と同じ版)と、それが使うライブラリ。
# torch・torchvision・pillow などは ComfyUI のものをそのまま使う(sensenova-u1 の指定どおりに入れると torch が入れ替わるため)
SN_PKG = "sensenova-u1 @ https://github.com/OpenSenseNova/SenseNova-U1/archive/refs/tags/comfyui-v0.3.0.tar.gz"
SN_DEPS = {"accelerate": "accelerate>=1.1,<2", "sentencepiece": "sentencepiece", "httpx": "httpx>=0.27,<1",
           "safetensors": "safetensors>=0.4.3,<1", "huggingface_hub": "huggingface-hub>=0.34,<2"}
PIP_NAMES = {"PIL": "pillow", "cv2": "opencv-python", "yaml": "pyyaml", "sklearn": "scikit-learn", "huggingface_hub": "huggingface-hub"}


def _ver(name):
    try:
        from importlib.metadata import version
        return tuple(int(x) for x in re.findall(r"\d+", version(name))[:3])
    except Exception:  # noqa: BLE001
        return None


def sn_pe_clip_for(name, task):
    """PE のテキストエンコーダーは、テキスト→画像用(pe_t2i)と画像→画像用(pe_i2i)の 2 つ。選んだ方がタスクと違い、
    もう一方のファイルが入っているときは、タスクに合う方を使う(欄は 1 つのまま)"""
    name = str(name or "")
    want, other = ("pe_i2i", "pe_t2i") if task == "I2I" else ("pe_t2i", "pe_i2i")
    if other in name:
        alt = name.replace(other, want)
        if alt in set(_files("text_encoders")):
            return alt
    return name


def _sn_passes(u1, p):
    """自己修正の最大回数(0〜5)を、読み込んだモデルに持たせる(処理ノード CCASenseNova が読む)"""
    try:
        n = max(0, min(5, int(p.get("sn_passes") or 0)))
    except (TypeError, ValueError):
        n = 0
    try:
        setattr(u1, "_cca_sn_passes", n)
    except Exception:  # noqa: BLE001  付けられなければ自己修正なし
        pass
    pe = None  # PE(テキストエンコーダーでプロンプトを書き直す)。ON のときだけテキストエンコーダーの名前を持たせる
    if p.get("sn_pe"):
        mt = p.get("model_type")
        name = sn_pe_clip_for(p.get("clip_name"), p.get("task"))
        _require_file(name, "text_encoders", LABELS["clip_name"], mt, field="clip_name")
        pe = str(name)
    try:
        setattr(u1, "_cca_sn_pe", pe)
    except Exception:  # noqa: BLE001
        pass


def _sn_pkg():
    """入っている追加ノードの requirements.txt に書かれた sensenova-u1(追加ノードの版に合うもの)"""
    import inspect
    try:
        cls = find_node("SenseNovaU1ModelLoader") or find_node("SenseNovaU1LocalLoader")
        req = os.path.join(os.path.dirname(inspect.getfile(cls)), "requirements.txt")
        for line in open(req, encoding="utf-8"):
            line = line.strip()
            if line.lower().startswith("sensenova-u1"):
                return line
    except Exception:  # noqa: BLE001
        pass
    return SN_PKG


def _sn_ready(model_type, gguf):
    """SenseNova の追加ノードが使うパッケージを、実際に読み込んで確かめる(公式ノードはどの失敗も「パッケージが必要」としか出さないため)。
    足りないものは、この ComfyUI に入れるコマンドを出す(torch などは入れ替えない)"""
    import importlib
    import importlib.util
    from . import addons
    if os.environ.get("SENSENOVA_U1_SRC"):
        return  # 開発用に元のソースを使う設定(追加ノードに任せる)
    py = addons._q(addons.environment()["python"])
    head = tr("[{model_type}] 追加ノード ComfyUI-SenseNova-U1 が使うパッケージが足りません。"
              "ComfyUI を止めてから、次のコマンドで入れて、ComfyUI を起動し直してください(torch などは今のまま変わりません):",
              model_type=model_type)
    cmds = []
    if importlib.util.find_spec("sensenova_u1") is None:
        cmds.append(f'{py} -m pip install --no-deps "{_sn_pkg()}"')
    deps = [spec for mod, spec in SN_DEPS.items() if importlib.util.find_spec(mod) is None]
    tv, torch_v = _ver("transformers"), _ver("torch") or (0,)
    # transformers 5 は torch 2.10 以降を前提にしている所がある(古い torch では読めない)ので、torch に合わせる
    tf_spec = "transformers>=4.57.1,<6" if torch_v >= (2, 10) else "transformers>=4.57.1,<5"
    if tv is None or tv < (4, 57, 1):
        deps.append(tf_spec)
    if gguf:
        deps += [spec for mod, spec in (("gguf", "gguf>=0.10.0"), ("diffusers", "diffusers>=0.30.0")) if importlib.util.find_spec(mod) is None]
    if deps:
        cmds.append(f"{py} -m pip install " + " ".join(f'"{d}"' for d in deps))
    if cmds:
        raise ValueError(head + "\n" + "\n".join(cmds))
    # そろっているのに読めないとき: 本当の理由を出す
    try:
        for m in ("sensenova_u1", "sensenova_u1.utils", "sensenova_u1.models.neo_unify.utils"):
            importlib.import_module(m)
    except Exception as e:  # noqa: BLE001
        miss = (getattr(e, "name", "") or "").split(".")[0] if isinstance(e, ModuleNotFoundError) else ""
        if miss:
            raise ValueError(head + "\n" + f"{py} -m pip install {PIP_NAMES.get(miss, miss)}") from e
        # torch に無いものを読みに行って失敗した: 原因のライブラリを探し、今の torch に合う版を入れるコマンドを出す
        pkg = ""
        try:
            import traceback
            for fr in reversed(traceback.extract_tb(e.__traceback__)):
                f = fr.filename.replace("\\", "/")
                if "site-packages/" in f:
                    name = f.split("site-packages/", 1)[1].split("/", 1)[0]
                    if name not in ("torch", "importlib"):
                        pkg = name
                        break
        except Exception:  # noqa: BLE001
            pass
        tver = ".".join(map(str, torch_v))
        fix = {"torchao": f"{py} -m pip install torchao==0.15.0 --no-deps",
               "transformers": f'{py} -m pip install "{tf_spec}"'}.get(pkg)
        if fix:
            raise ValueError(tr("[{model_type}] 今の torch({torch})に合わない版の {pkg} が入っているため、sensenova-u1 を読み込めません: {err}\n"
                                "ComfyUI を止めてから、次のコマンドで torch に合う版にして、ComfyUI を起動し直してください:\n{cmd}",
                                model_type=model_type, pkg=pkg, torch=tver, err=f"{type(e).__name__}: {e}", cmd=fix)) from e
        if pkg:
            raise ValueError(tr("[{model_type}] {pkg} が今の torch({torch})に合わないため、sensenova-u1 を読み込めません: {err}\n"
                                "{pkg} を今の torch に合う版にしてください(ほかの追加ノードが新しい版を入れた可能性があります)。",
                                model_type=model_type, pkg=pkg, torch=tver, err=f"{type(e).__name__}: {e}")) from e
        raise ValueError(tr("[{model_type}] 追加ノード ComfyUI-SenseNova-U1 が使うパッケージ sensenova-u1 を読み込めませんでした: {err}",
                            model_type=model_type, err=f"{type(e).__name__}: {e}")) from e
    if find_node("SenseNovaU1ModelLoader") is not None:
        try:
            import inspect
            from sensenova_u1.utils import load_model_and_tokenizer
            ok = "model_resources" in inspect.signature(load_model_and_tokenizer).parameters
        except Exception:  # noqa: BLE001
            ok = True
        if not ok:
            raise ValueError(tr("[{model_type}] 入っている sensenova-u1 が古く、追加ノード ComfyUI-SenseNova-U1 に合いません。"
                                "ComfyUI を止めてから、次のコマンドで追加ノードに合う版にして、ComfyUI を起動し直してください(torch などは今のまま変わりません):\n{cmd}",
                                model_type=model_type, cmd=f'{py} -m pip install --no-deps --force-reinstall "{_sn_pkg()}"'))


_VRAM_BASE = {}  # ComfyUI 側の元の設定(「自動」で戻す用)


def apply_vram_mode(mode):
    """SenseNova-U1.6 以外のモデル用: VRAM の補い方を ComfyUI のメモリ管理に反映する。
    (SenseNova-U1.6 は追加ノード自身の local_pipeline が層の転送を行うので、下の _sn_vram_kw で追加ノードに渡す)
    自動     : ComfyUI の起動時の設定のまま
    full     : モデル全体を GPU に置く
    fast     : 載る分は GPU に置き、足りない層だけ CPU から非同期で送る
    balanced : GPU に余裕を残し、層の転送と計算を並行して進める
    low      : GPU の使用量を最小にし、層を同期転送で順に送る(いちばん遅いがいちばん省メモリ)
    ComfyUI のバージョンで項目が無いときは、その部分だけ何もしない。"""
    try:
        import comfy.model_management as mm
    except Exception:  # noqa: BLE001
        return
    if not _VRAM_BASE:
        _VRAM_BASE.update(state=getattr(mm, "vram_state", None), streams=getattr(mm, "NUM_STREAMS", None),
                          reserve=getattr(mm, "EXTRA_RESERVED_VRAM", None))
    st = getattr(mm, "VRAMState", None)
    base = _VRAM_BASE
    state, streams, reserve = base.get("state"), base.get("streams"), base.get("reserve")
    gb = 1024 * 1024 * 1024
    if mode == VRAM_FULL and st:
        state = st.HIGH_VRAM
    elif mode == VRAM_FAST and st:
        state, streams = st.NORMAL_VRAM, max(1, streams or 0)
    elif mode == VRAM_BALANCED and st:
        state, streams, reserve = st.LOW_VRAM, max(1, streams or 0), max(reserve or 0, gb)
    elif mode == VRAM_LOW and st:
        state, streams, reserve = st.LOW_VRAM, 0, max(reserve or 0, 2 * gb)
    for k, v in (("vram_state", state), ("NUM_STREAMS", streams), ("EXTRA_RESERVED_VRAM", reserve)):
        if v is not None and hasattr(mm, k):
            setattr(mm, k, v)
    if base.get("last", VRAM_AUTO) != mode:  # 設定が変わったときだけ、読み込み済みのモデルを置き直す
        base["last"] = mode
        try:
            mm.unload_all_models()
        except Exception:  # noqa: BLE001
            pass


# NOTICE (Apache-2.0 §4): 下の VRAM モードの扱いは、OpenSenseNova/ComfyUI-SenseNova-U1 の local_pipeline.py の vram_mode(Apache-2.0。LICENSE-SenseNova-U1)の仕様に合わせて書いたものです(変更あり)。
SN_VRAM_MODES = (VRAM_FULL, VRAM_FAST, VRAM_BALANCED, VRAM_LOW)


def _sn_vram_kw(node_name, p):
    """SenseNova-U1.6 の読み込みノードの vram_mode(追加ノードの local_pipeline と同じ 4 つ)に渡す値。
    full     : 全モデルを GPU に置く(offload なし)
    fast     : 非同期転送で速度重視(層を先読みして転送。生成に使う層は予算内で GPU に残す)
    balanced : 転送と計算を並行(非同期で先読み)
    low      : 同期転送で VRAM 使用量を抑える(いちばん遅い)
    「自動」のときは何も渡さず、追加ノードの既定のままにする。追加ノードの版に vram_mode が無い・値が違うときも渡さない"""
    mode = str(p.get("vram_mode") or VRAM_AUTO)
    if mode not in SN_VRAM_MODES:
        return {}
    try:
        spec = ((find_node(node_name).INPUT_TYPES().get("required") or {}).get("vram_mode"))
        opts = spec[0] if isinstance(spec, (list, tuple)) and spec and isinstance(spec[0], (list, tuple)) else None
        if opts is None and isinstance(spec, (list, tuple)) and len(spec) > 1 and isinstance(spec[1], dict):
            opts = spec[1].get("options")
        if opts is not None and mode not in opts:
            print(f"[CCA Generator] 追加ノードの vram_mode に「{mode}」が無いため、既定のままにします(選べる値: {list(opts)})")
            return {}
        if spec is None and "vram_mode" not in ((find_node(node_name).INPUT_TYPES().get("optional")) or {}):
            return {}
    except Exception:  # noqa: BLE001  調べられないときは、そのまま渡す(ノードに無い入力は call_node が捨てる)
        pass
    print(f"[CCA Generator] SenseNova-U1.6 の VRAM モード: {mode}")
    return {"vram_mode": mode}


def load_models(model_type, task, p):
    """(model, model_low, clip, vae, audio_vae)"""
    info = _type_info(model_type, task)
    if info["loader"] != "sn" or str(p.get("unet_name") or "").startswith(SN_CORE_PREFIX):  # SenseNova(追加ノード方式)は追加ノード自身が VRAM を扱う。ComfyUI のメモリ管理は触らない
        apply_vram_mode(p.get("vram_mode") or VRAM_AUTO)
    mt = info["name"]
    loader = info["loader"]

    if loader == "sn" and str(p.get("unet_name") or "").startswith(SN_CORE_PREFIX):
        return _load_sn_core(model_type, info, p, str(p["unet_name"])[len(SN_CORE_PREFIX):].strip())

    if loader == "sn":
        # SenseNova-U1.6: 追加ノードの読み込み方(モデルの名前は、その選択肢のまま渡す)。
        # 追加ノードが読み込める LoRA は 1 つだけ(Turbo は Turbo LoRA = 8 ステップの LoRA)。GGUF は LoRA を読めない。
        # 読めない組み合わせは、models/checkpoints に Comfy-Org 版があればそちら(Core)で読み込む(LoRA はいくつでも・GGUF 選択時も使える)
        loras = _active_loras(p.get("loras"))
        n_loras = len(loras) + (1 if info["is_turbo"] else 0)
        if n_loras and (n_loras > 1 or str(p["unet_name"]).lower().endswith(".gguf")):
            ck = next((f for f in _sn_core_files() if "sensenova" in f.lower()), None)
            if ck:
                print(f"[CCA Generator] SenseNova-U1.6: 追加ノードでは読めない LoRA の組み合わせなので、Core 方式(models/checkpoints/{ck})で読み込みます")
                return _load_sn_core(model_type, info, p, ck)
        require_node(model_type)
        if info["is_turbo"]:
            _require_file(p["turbo_lora_name"], "loras", LABELS["turbo_lora_name"], mt, field="turbo_lora_name")
            loras = [{"name": p["turbo_lora_name"], "strength": p["turbo_lora_strength"]}] + loras
        for i, l in enumerate(loras, 1):
            _require_file(l["name"], "loras", f"LoRA {i}", mt)
        kw = {"lora_name": loras[0]["name"], "lora_strength": float(loras[0]["strength"])} if loras else {}
        from . import hf_fetch
        weights = hf_fetch.link_folder(str(p["unet_name"]))
        gguf = weights.lower().endswith(".gguf")
        from . import hf_fetch  # 「HF | …」は先にダウンロード(進み具合をパネルに出す)
        if find_node("SenseNovaU1ModelLoader") is None:
            # 追加ノード 0.2.0 まで: 古い読み込みノード(Hugging Face の名前か、手で入れたフォルダ。LoRA・GGUF は読めない)
            local = weights.startswith(hf_fetch.LOCAL_PREFIX)
            path = os.path.join(hf_fetch.sensenova_dir(), weights[len(hf_fetch.LOCAL_PREFIX):].strip()) if local else ""
            what = ("Turbo(8 ステップの LoRA)" if info["is_turbo"] else "LoRA") if loras else "GGUF の版" if gguf else \
                "このモデル" if (local and not os.path.isdir(path)) or (not local and weights.count("/") > 1) else ""
            if what:
                raise ValueError(tr('[{model_type}] {what}は、追加ノード ComfyUI-SenseNova-U1 の 0.3.0 以降で使えます(今入っているのは古い版です)。ComfyUI Manager などで追加ノードを更新して、ComfyUI を起動し直してください。', model_type=mt, what=tr(what)))
            _sn_ready(mt, False)
            if local:
                model_path = path
            else:
                hf_fetch.prepare(weights, mt)
                model_path = weights[len(hf_fetch.HF_PREFIX):].strip()
            u1 = call_node("SenseNovaU1LocalLoader", model_path=model_path, gguf_checkpoint="", **_sn_vram_kw("SenseNovaU1LocalLoader", p))[0]
            _sn_passes(u1, p)
            _sn_keep_loras(u1, loras)
            return u1, u1, None, None, None
        _sn_ready(mt, gguf)
        weights = hf_fetch.prepare(weights, mt)
        u1 = call_node("SenseNovaU1ModelLoader", model_weights=weights, **kw, **_sn_vram_kw("SenseNovaU1ModelLoader", p))[0]
        _sn_passes(u1, p)
        _sn_keep_loras(u1, loras)
        return u1, u1, None, None, None

    if loader == "ckpt":
        _require_file(p["ckpt_name"], "checkpoints", LABELS["ckpt_name"], mt, field="ckpt_name")
        loras = _active_loras(p.get("loras"))
        for i, l in enumerate(loras, 1):
            _require_file(l["name"], "loras", f"LoRA {i}", mt)
        model, clip, vae = _call("CheckpointLoaderSimple", ckpt_name=p["ckpt_name"])[:3]
        for i, l in enumerate(loras, 1):
            model, clip = apply_lora(model, clip, l["name"], l["strength"], l["clip"], f"LoRA {i}", mt)
        return model, model, clip, vae, vae

    require_node(model_type)
    _require_file(p["clip_name"], "text_encoders", LABELS["clip_name"], mt, field="clip_name")
    if loader == "k6":
        _require_file(p.get("clip_name_2"), "text_encoders", LABELS["clip_name_2"], mt, field="clip_name_2")
    _require_file(p["vae_name"], "vae", LABELS["vae_name"], mt, field="vae_name")
    if info["loader"] == "wan14":
        _require_file(p["wan_high_unet"], "diffusion_models", LABELS["wan_high_unet"], mt, field="wan_high_unet")
        _require_file(p["wan_low_unet"], "diffusion_models", LABELS["wan_low_unet"], mt, field="wan_low_unet")
    else:
        _require_file(p["unet_name"], "diffusion_models", LABELS["unet_name"], mt, field="unet_name")
    if info["audio_vae"]:
        _require_file(p["audio_vae_name"], "vae", LABELS["audio_vae_name"], mt, field="audio_vae_name")
    loras = _active_loras(p.get("loras"))
    for i, l in enumerate(loras, 1):
        _require_file(l["name"], "loras", f"LoRA {i}", mt)

    if loader == "k6":
        # Kandinsky 6: Qwen2.5-VL + CLIP-L(種類 kandinsky5)。音声 VAE は追加ノードの読み込み方で
        clip = _call("DualCLIPLoader", clip_name1=p["clip_name"], clip_name2=p["clip_name_2"],
                     type="kandinsky5", device=p["clip_device"])[0]
    else:
        clip = _call("CLIPLoader", clip_name=p["clip_name"], type=p["clip_type"],
                     device=p["clip_device"])[0]
    vae = _call("VAELoader", vae_name=p["vae_name"])[0]
    if loader == "k6":
        audio_vae = k6_audio_vae(mt, p["unet_name"])
    else:
        audio_vae = _call("VAELoader", vae_name=p["audio_vae_name"])[0] if info["audio_vae"] else vae

    if loader == "wan14":
        high = _call("UNETLoader", unet_name=p["wan_high_unet"], weight_dtype=p["unet_dtype"])[0]
        low = _call("UNETLoader", unet_name=p["wan_low_unet"], weight_dtype=p["unet_dtype"])[0]
        if info["is_turbo"]:
            high = _lora_only(high, p["turbo_lora_name"], p["turbo_lora_strength"],
                              LABELS["turbo_lora_name"], mt)
            low = _lora_only(low, p["turbo_lora_low_name"], p["turbo_lora_strength"],
                             LABELS["turbo_lora_low_name"], mt)
        for i, l in enumerate(loras, 1):
            if l["target"] in ("both", "high"):
                high = _lora_only(high, l["name"], l["strength"], f"LoRA {i}", mt)
            if l["target"] in ("both", "low"):
                low = _lora_only(low, l["name"], l["strength"], f"LoRA {i}", mt)
        return high, low, clip, vae, audio_vae

    model = _call("UNETLoader", unet_name=p["unet_name"], weight_dtype=p["unet_dtype"])[0]
    # 元のワークフローと同じ順序: UNet → Turbo LoRA → LoRA → (MOSS I2I のみ) Edit LoRA
    if info["is_turbo"]:
        model = _lora_only(model, p["turbo_lora_name"], p["turbo_lora_strength"],
                           LABELS["turbo_lora_name"], mt)
    for i, l in enumerate(loras, 1):
        model = _lora_only(model, l["name"], l["strength"], f"LoRA {i}", mt)
    if info["base"] == "MOSS" and task == "I2I":
        model = _lora_only(model, p["edit_lora_name"], p["edit_lora_strength"],
                           LABELS["edit_lora_name"], mt, folders=("loras", "model_patches"))
    if info["base"] == "MiniMax-H3-Image" and info["is_turbo"]:
        model = minimax_image_turbo_shift(model)
    return model, model, clip, vae, audio_vae


def k6_audio_vae(model_type, unet_name=""):
    """Kandinsky 6 の音声 VAE(MMAudio の v1-44.pth + BigVGAN)。配布元の値で読む:
    蒸留版(Pro distill / Lite distill)は scaling 0.417、非蒸留版は 0.5302"""
    cls = comfy_nodes.NODE_CLASS_MAPPINGS["Kandinsky6AudioVAELoader"]
    req = cls.INPUT_TYPES()["required"]
    tods = [t for t in _opts(req["tod_vae"], []) if t]
    dirs = [d for d in _opts(req["bigvgan_dir"], []) if d]
    tod = next((t for t in tods if "v1-44" in t.lower()), tods[0] if tods else None)
    big = next((d for d in dirs if "bigvgan" in d.lower()), dirs[0] if dirs else None)
    # 追加ノードは、ファイルが無くても既定の名前(v1-44.pth / bigvgan_vocoder)を一覧に出すので、実際にあるか確かめる
    audio_dir = os.path.join(folder_paths.models_dir, "audio_vae")
    tod_path = (folder_paths.get_full_path("kandinsky6_audio_vae", tod) if tod else None) or (
        os.path.join(audio_dir, tod) if tod else "")
    big_path = os.path.join(audio_dir, big) if big else ""
    if not tod or not big or not os.path.isfile(tod_path) or not os.path.isdir(big_path):
        raise ValueError(
            tr('[{model_type}] Kandinsky 6 の音声 VAE が見つかりません。ComfyUI/models/audio_vae に次の 2 つを置いてください:\n  v1-44.pth(hkchengrex/MMAudio の ext_weights)\n  bigvgan_vocoder/bigvgan_generator.pt と config.json(nvidia/bigvgan_v2_44khz_128band_512x)\nkandinsky6 のワークフローの「Download models」でもまとめて入れられます。', model_type=model_type))
    mode = _opts(req["mode"], ["44k"])[0]
    scaling = 0.417 if "distill" in str(unet_name).lower() else 0.5302
    return _call("Kandinsky6AudioVAELoader", tod_vae=tod, bigvgan_dir=big, mode=mode, scaling_factor=scaling)[0]


def load_latent_upscale(model_type, task, p):
    """LTX-2.5 の潜在アップスケーラー(使わない種別は None)"""
    info = _type_info(model_type, task)
    if not info["latent_upscale"]:
        return None
    name = p.get("latent_upscale_name")
    _require_file(name, "latent_upscale_models", LABELS["latent_upscale_name"], info["name"])
    return _call("LatentUpscaleModelLoader", model_name=name)[0]


def minimax_image_turbo_shift(model):
    """MiniMax-H3-Image Turbo(pDMD 2 ステップ): 配布元の手順どおりシフト 12(音声 3)にする。
    MiniMax-H3-Image の既定(通常の 6 ステップ)にはシフトが無いため、Turbo のときだけ掛ける"""
    from comfy_extras.nodes_minimax_h3 import MiniMaxH3SigmaShift
    out = MiniMaxH3SigmaShift.execute(model=model, shift_video=12.0, shift_audio=3.0)
    return out.result[0] if hasattr(out, "result") else out[0]


def resolve_edit_format(edit_format, edit_lora_name):
    """Edit 形式。「自動」は Edit LoRA から決める:
    chinoll 版(配布形式・変換版・公式 rank64)は Moss-Image-Edit、それ以外(HQ 系 armV* など ai-toolkit 製)は ai-toolkit。
    分からないときは ai-toolkit(ComfyUI の MOSS 参照画像の既定と同じ。編集 LoRA の多くは ai-toolkit 製)。"""
    return edit_format_info(edit_format, edit_lora_name)["format"]


def edit_format_info(edit_format, edit_lora_name):
    if edit_format in EDIT_FORMATS:
        return {"format": edit_format, "auto": False, "reason": "手動で指定"}
    kind, reason = lora_format_info(edit_lora_name, ("loras", "model_patches"))
    fmt = "Moss-Image-Edit" if kind in ("moss-edit", "chinoll") else "ai-toolkit"
    if kind in (None, "standard"):
        reason += " → ai-toolkit とみなしました(違う場合は手動で選んでください)"
    return {"format": fmt, "auto": True, "reason": reason, "kind": kind}


def _blank_image():
    return (torch.zeros((1, 64, 64, 3), dtype=torch.float32),
            torch.zeros((1, 64, 64), dtype=torch.float32))


def _image_exists(name):
    try:
        return os.path.isfile(folder_paths.get_annotated_filepath(name))
    except Exception:
        return False


def ref_edge(ref_size, edit_format=None):
    """参照画像の大きさ(選択肢 or 数値)→ 長辺 px。0 = 出力と同じ。
    自動: Edit 形式が chinoll 版(Moss-Image-Edit)なら長辺 512(配布元ワークフローの reference_max_edge)、
    それ以外(ai-toolkit)は出力と同じ。"""
    ref_size = REF_SIZE_OLD.get(ref_size, ref_size)
    if ref_size in REF_SIZES:
        v = REF_SIZES[ref_size]
    else:
        try:
            v = max(0, int(ref_size))
        except (TypeError, ValueError):
            v = -1
    if v < 0:
        # 自動 = 出力と同じ(ComfyUI 公式の MOSS 編集と同じく ImageScaleToTotalPixels 1MP)。
        # Moss-Image-Edit 形式は参照画像を VAE だけで読むので、小さくすると画像を読み取れなくなる(第15版まで長辺 512 にしていた)
        return 0
    return v


def image_size(name):
    """input フォルダの画像の幅・高さ(LoadImage と同じく EXIF の向きを反映)。無ければ None"""
    if not _on(name) or not _image_exists(name):
        return None
    try:
        from PIL import Image, ImageOps
        with Image.open(folder_paths.get_annotated_filepath(name)) as im:
            im = ImageOps.exif_transpose(im)
            return int(im.size[0]), int(im.size[1])
    except Exception:
        return None


def scaled_size(model_type, w, h, scale):
    """画像1 × 倍率(Forge の Resize by)。辺は種別ごとの単位(画像 16 / 動画・MiniMax 32)の倍数に丸める"""
    step = size_step(model_type)
    s = max(0.01, float(scale))
    return (max(step, round(w * s / step) * step), max(step, round(h * s / step) * step))


def by_scale(model_type, task, size_mode):
    return size_mode == SIZE_MODE_SCALE and scale_supported(model_type, task)


def by_resize(model_type, task, size_mode, resize_mode):
    """画像→画像の「サイズ指定」で、幅・高さに合わせる変え方が選ばれているか(今まで通り以外)"""
    return (not by_scale(model_type, task, size_mode) and resize_supported(model_type, task)
            and resize_mode in RESIZE_MODES and resize_mode != RESIZE_KEEP)


def fit_size(model_type, width, height):
    step = size_step(model_type)
    return max(step, round(int(width) / step) * step), max(step, round(int(height) / step) * step)


def resize_by_mode(image, mask, w, h, mode):
    """Forge の Resize mode と同じ: そのまま拡大縮小 / 切り抜いて拡大縮小 / 余白を埋めて拡大縮小(端の色で埋める)"""
    if mode == RESIZE_JUST:
        return _resize(image, w, h), _resize_mask(mask, w, h)
    if mode == RESIZE_CROP:
        img = comfy.utils.common_upscale(image.movedim(-1, 1), w, h, "lanczos", "center").movedim(1, -1)
        m = comfy.utils.common_upscale(mask.unsqueeze(1), w, h, "bilinear", "center").squeeze(1)
        return img, m
    # 余白を埋めて拡大縮小: 収まる大きさに縮めて、足りない所は端の色で埋める(埋めた所はマスク 1 = 描き直す)
    ih, iw = image.shape[1], image.shape[2]
    s = min(w / iw, h / ih)
    fw, fh = max(1, min(w, round(iw * s))), max(1, min(h, round(ih * s)))
    img = _resize(image, fw, fh).movedim(-1, 1)
    m = _resize_mask(mask, fw, fh).unsqueeze(1)
    left, top = (w - fw) // 2, (h - fh) // 2
    pad = (left, w - fw - left, top, h - fh - top)
    img = torch.nn.functional.pad(img, pad, mode="replicate").movedim(1, -1)
    m = torch.nn.functional.pad(m, pad, mode="constant", value=1.0).squeeze(1)
    return img, m


def _resize(image, w, h):
    if (image.shape[1], image.shape[2]) == (h, w):
        return image
    return comfy.utils.common_upscale(image.movedim(-1, 1), int(w), int(h), "lanczos", "disabled").movedim(1, -1)


def _resize_mask(mask, w, h):
    if (mask.shape[1], mask.shape[2]) == (h, w):
        return mask
    return comfy.utils.common_upscale(mask.unsqueeze(1), int(w), int(h), "bilinear", "disabled").squeeze(1)


# マスクを描いた画像→画像の、元の画像と塗った所(最後に、塗っていない所へ元の画像を貼り戻す。CCAHiresFix で使う)。
# 同じ実行の中で、画像を読む部品が入れて、最後の部品が使う(実行は 1 つずつなので、ほかの実行と混ざらない)
_PASTE = {"img": None, "mask": None, "model_type": None}


def _paste_back(out, model_type, task):
    """塗っていない所に元の画像を戻す(境目は少し広げてぼかす)。大きさが違えば合わせる"""
    p = _PASTE
    if p["img"] is None or task != "I2I" or p["model_type"] != model_type or not uses_mask(model_type, task):
        return out
    h, w = out.shape[1], out.shape[2]
    org = _resize(p["img"][:, :, :, :3], w, h).to(out.device, out.dtype)
    m = _resize_mask(p["mask"], w, h).to(out.device, out.dtype).unsqueeze(1)
    r = max(1, int(round(min(w, h) * 0.006)))
    m = torch.nn.functional.max_pool2d(m, 2 * r + 1, stride=1, padding=r)  # 塗った所を少し広げる
    k = 2 * r + 1
    m = torch.nn.functional.avg_pool2d(torch.nn.functional.pad(m, (r, r, r, r), mode="replicate"), k, stride=1)  # 境目をぼかす
    m = m.clamp(0, 1).squeeze(1).unsqueeze(-1)
    if org.shape[0] != out.shape[0]:
        org = org[:1].expand(out.shape[0], -1, -1, -1)
    return out[:, :, :, :3] * m + org * (1 - m)


def load_images(model_type, task, image, image_2, ref_size=REF_SIZE_AUTO, edit_format=None,
                size_mode=SIZE_MODE_KEEP, size_scale=1.0, width=None, height=None, resize_mode=RESIZE_KEEP):
    """(image_1, mask_1, image_2, ref_image_1)。
    入力画像2が無いときは None(受け側は「画像なし」として扱う)。
    ref_image_1 は MOSS Edit に渡す入力画像1の参照(参照画像の大きさ = ref_size)。
    倍率指定(画像1 × 倍率)の画像→画像では、入力画像1とマスクをその大きさにしてから渡す。"""
    _type_info(model_type, task)
    img1, mask1 = _blank_image()
    img2 = None
    if needs_image(task):
        if not _on(image):
            raise ValueError(tr('[{model_type}] {task} には入力画像1が必要です。パネルで画像を選んでください。', model_type=model_type, task=task))
        if not _image_exists(image):
            raise ValueError(tr('[{model_type}] 入力画像1が見つかりません: {image}', model_type=model_type, image=image))
        img1, mask1 = _call("LoadImage", image=image)[:2]
        painted = uses_mask(model_type, task) and 0.0 < float(mask1.max()) and float(mask1.min()) < 1.0  # マスクを描いた
        if full_mask_if_empty(model_type, task) and float(mask1.max()) <= 0.0:
            # マスクが描かれていない → 画像全体を作り直す(参照画像をもとに編集)
            mask1 = torch.ones((1, img1.shape[1], img1.shape[2]), dtype=torch.float32)
        if max_images(model_type, task) >= 2 and _on(image_2):
            if not _image_exists(image_2):
                raise ValueError(tr('[{model_type}] 入力画像2が見つかりません: {image_2}', model_type=model_type, image_2=image_2))
            img2 = _call("LoadImage", image=image_2)[0]
        if task == "I2I" and by_scale(model_type, task, size_mode):
            w, h = scaled_size(model_type, img1.shape[2], img1.shape[1], size_scale)
            img1, mask1 = _resize(img1, w, h), _resize_mask(mask1, w, h)
        elif by_resize(model_type, task, size_mode, resize_mode) and width and height:
            w, h = fit_size(model_type, width, height)
            img1, mask1 = resize_by_mode(img1, mask1, w, h, resize_mode)
    if needs_image(task):
        _PASTE.update(img=img1 if painted else None, mask=mask1 if painted else None, model_type=model_type)
    else:
        _PASTE.update(img=None, mask=None, model_type=None)
    scaled = task == "I2I" and (by_scale(model_type, task, size_mode)
                                or (by_resize(model_type, task, size_mode, resize_mode) and bool(width and height)))
    ref1 = img1
    if ref_max_edge_enabled(model_type, task):
        if edit_format not in EDIT_FORMATS:
            edit_format = None
        edge = ref_edge(ref_size, edit_format)
        if edge > 0:
            ref1 = _limit_edge(img1, edge)
            if img2 is not None:
                img2 = _limit_edge(img2, edge)
        else:
            # 出力とまったく同じ大きさにする(今まで通り = ImageScaleToTotalPixels 1MP・16 の倍数 / 倍率指定 = 画像1 × 倍率)
            mp = (img1.shape[1] * img1.shape[2]) / (1024 * 1024) if scaled else 1.0
            ref1 = img1 if scaled else _total_pixels(img1)
            if img2 is not None:
                img2 = _total_pixels(img2, megapixels=mp)
    return img1, mask1, img2, ref1


def load_image_3(model_type, task, image_3):
    """入力画像3(MiniMax H3 画像→動画の途中のフレーム)。使わないときは None"""
    if max_images(model_type, task) < 3 or not _on(image_3):
        return None
    if not _image_exists(image_3):
        raise ValueError(tr('[{model_type}] 入力画像3が見つかりません: {image_3}', model_type=model_type, image_3=image_3))
    return _call("LoadImage", image=image_3)[0]


# 参照画像の一覧を使う種別(処理ノードに画像の一覧で渡す)
REF_LIST_FAMILIES = ("FLUX.2 Klein", "FLUX.3 Klein", "LTX-2.5", "Kandinsky 6", "SenseNova-U1.6")


def load_ref_images(model_type, task, img1, names):
    """参照画像の一覧(CCA_IMAGES): [入力画像1(サイズ変更後), 入力画像2, 3, …]。
    空いている欄は詰める(パネルでも外したときに後ろを詰めるので、番号は画面と同じになる)。使わない種別は空"""
    info = _type_info(model_type, task)
    if info["family"] not in REF_LIST_FAMILIES or not needs_image(task):
        return []
    refs = [img1]
    for k, name in enumerate(names[1:max_images(model_type, task)], 2):
        if not _on(name):
            continue
        if not _image_exists(name):
            raise ValueError(tr('[{model_type}] 入力画像{k}が見つかりません: {name}', model_type=model_type, k=k, name=name))
        refs.append(_call("LoadImage", image=name)[0])
    return refs


def _total_pixels(image, megapixels=1.0, steps=16):
    """ComfyUI の ImageScaleToTotalPixels(lanczos, 1MP, resolution_steps 16)と同じ計算(拡大・縮小どちらも)"""
    h, w = image.shape[1], image.shape[2]
    scale = math.sqrt(megapixels * 1024 * 1024 / (w * h))
    nw = round(w * scale / steps) * steps
    nh = round(h * scale / steps) * steps
    if (nh, nw) == (h, w):
        return image
    return comfy.utils.common_upscale(image.movedim(-1, 1), int(nw), int(nh), "lanczos", "disabled").movedim(1, -1)


def _limit_edge(image, max_edge, steps=16):
    """長辺を max_edge 以下に縮小し(拡大はしない)、辺を steps の倍数に揃える(MOSS Edit の reference_max_edge と同じ)。"""
    h, w = image.shape[1], image.shape[2]
    scale = min(1.0, max_edge / max(h, w))
    nh = max(steps, round(h * scale / steps) * steps)
    nw = max(steps, round(w * scale / steps) * steps)
    if (nh, nw) == (h, w):
        return image
    return comfy.utils.common_upscale(image.movedim(-1, 1), nw, nh, "lanczos", "disabled").movedim(1, -1)


def _hash_images(*names):
    m = hashlib.sha256()
    for name in names:
        if _on(name):
            try:
                with open(folder_paths.get_annotated_filepath(name), "rb") as f:
                    m.update(f.read())
            except Exception:
                m.update(str(name).encode("utf-8"))
    return m.hexdigest()


def sampling_values(model_type, task, steps, cfg, sampler_name, scheduler, denoise, width,
                    height, auto_image_size, size_mode=SIZE_MODE_KEEP, size_scale=1.0, image=None,
                    video_length=81, video_fps=16.0, resize_mode=RESIZE_KEEP, video_shift=8.0):
    """倍率指定(画像1 × 倍率)のときは、幅・高さを画像1の大きさ × 倍率にする(サイズ自動は使わない)。"""
    _type_info(model_type, task)
    steps = int(steps)
    scaled = False
    if by_scale(model_type, task, size_mode):
        size = image_size(image)
        if size is None:
            raise ValueError(tr('[{model_type}] 倍率指定には入力画像1が必要です。画像を選ぶか「サイズ指定」に切り替えてください。', model_type=model_type))
        width, height = scaled_size(model_type, size[0], size[1], size_scale)
        auto_image_size = False
        scaled = True
    elif by_resize(model_type, task, size_mode, resize_mode):
        width, height = fit_size(model_type, width, height)
        scaled = True
    return (int(width), int(height), steps, float(cfg), sampler_name, scheduler, float(denoise),
            bool(auto_image_size), max(1, steps // 2), scaled, max(1, int(video_length)),
            max(1.0, float(video_fps)), max(0.01, float(video_shift)))


def route_of(model_type, task):
    info = _type_info(model_type, task)
    if info["kind"] in ("audio", "3d"):  # 第42版: 声・音楽(と 3D)はワークフローを使わない(生成パネルの「生成」で作る)
        raise ValueError(f"{model_type} は生成パネルの「生成」ボタンで作ります(ComfyUI のキューのボタンでは作れません)")
    return int(info["routes"][task])


# ---------------------------------------------------------------------------
# パネルの出力と、分割先(内部ノード)の対応
# ---------------------------------------------------------------------------
OUTPUTS = [
    ("positive", "STRING"), ("negative", "STRING"), ("width", "INT"), ("height", "INT"),
    ("image_1", "IMAGE"), ("mask_1", "MASK"), ("image_2", "IMAGE"),
    ("seed", "INT"), ("steps", "INT"), ("cfg", "FLOAT"),
    ("sampler_name", SAMPLERS), ("scheduler", SCHEDULERS), ("denoise", "FLOAT"),
    ("model", "MODEL"), ("model_low", "MODEL"), ("clip", "CLIP"), ("vae", "VAE"),
    ("audio_vae", "VAE"), ("auto_image_size", "BOOLEAN"), ("image_prefix", "STRING"),
    ("video_prefix", "STRING"), ("split_step", "INT"), ("route", "INT"),
    # 第4版で追加(既存の出力番号を変えないよう末尾に足す)
    ("ref_image_1", "IMAGE"), ("edit_format", list(EDIT_FORMATS)), ("hires", "CCA_HIRES"),
    # 第6版で追加
    ("image_3", "IMAGE"), ("mid_frame_pos", "INT"), ("size_by_scale", "BOOLEAN"),
    ("video_length", "INT"), ("video_fps", "FLOAT"),
    ("video_shift", "FLOAT"),
    # 第9版で追加: 参照画像の一覧(FLUX.2/3 Klein・LTX-2.5・Kandinsky 6)と LTX-2.5 の潜在アップスケーラー
    ("ref_images", "CCA_IMAGES"), ("latent_upscale", "LATENT_UPSCALE_MODEL"),
]
OUTPUT_TYPE = {n: t for n, t in OUTPUTS}

MODEL_KEYS = [
    "model_type", "task", "unet_name", "unet_dtype", "ckpt_name", "clip_name", "clip_type",
    "clip_device", "vae_name", "audio_vae_name", "wan_high_unet", "wan_low_unet",
    "loras", "turbo_lora_name",
    "turbo_lora_strength", "turbo_lora_low_name", "edit_lora_name", "edit_lora_strength",
    "edit_format", "clip_name_2", "latent_upscale_name", "sn_passes", "sn_pe", "vram_mode",
]
HIRES_KEYS = ["hires_enable", "hires_upscaler", "hires_scale", "hires_steps", "hires_denoise",
              "hires_cfg"]
SAMPLING_KEYS = ["model_type", "task", "steps", "cfg", "sampler_name", "scheduler", "denoise",
                 "width", "height", "auto_image_size", "size_mode", "size_scale", "image",
                 "video_length", "video_fps", "resize_mode", "video_shift"]
IMAGE_KEYS = ["model_type", "task", "image", "image_2", "image_3", "ref_size", "edit_format",
              "edit_lora_name", "size_mode", "size_scale", "mid_frame_pos", "width", "height", "resize_mode",
              ] + IMAGE_WIDGETS[3:]

INPUT_KIND = {
    "turbo_lora_strength": "FLOAT",
    "edit_lora_strength": "FLOAT", "cfg": "FLOAT", "denoise": "FLOAT",
    "seed": "INT", "steps": "INT", "width": "INT", "height": "INT", "sn_passes": "INT", "sn_pe": "BOOLEAN",
    "auto_image_size": "BOOLEAN", "ref_size": "STRING", "size_scale": "FLOAT", "mid_frame_pos": "INT",
    "video_length": "INT", "video_fps": "FLOAT", "video_shift": "FLOAT",
    "hires_enable": "BOOLEAN", "hires_scale": "FLOAT", "hires_steps": "INT",
    "hires_denoise": "FLOAT", "hires_cfg": "FLOAT",
}


class _Part:
    """分割先の内部ノード。値はパネルが検証済みなので、ここでは範囲・選択肢の検証をしない。"""
    CATEGORY = INTERNAL_CATEGORY
    FUNCTION = "run"
    DESCRIPTION = "CCA Generator Panel の内部ノード(キュー投入時に自動で使われます)。"
    PART_INPUTS = []
    PART_OUTPUTS = []

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {k: (INPUT_KIND.get(k, "STRING"), {}) for k in cls.PART_INPUTS}}

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True


def _part(name, inputs, outputs):
    def deco(cls):
        cls.PART_NAME = name
        cls.PART_INPUTS = inputs
        cls.PART_OUTPUTS = outputs
        cls.RETURN_TYPES = tuple(OUTPUT_TYPE[o] for o in outputs)
        cls.RETURN_NAMES = tuple(outputs)
        return cls
    return deco


@_part("models", MODEL_KEYS, ["model", "model_low", "clip", "vae", "audio_vae", "edit_format", "latent_upscale"])
class CCAGenModels(_Part):
    def run(self, model_type, task, **p):
        return (*load_models(model_type, task, p),
                resolve_edit_format(p.get("edit_format"), p.get("edit_lora_name")),
                load_latent_upscale(model_type, task, p))


@_part("prompt", ["positive", "negative"], ["positive", "negative"])
class CCAGenPrompt(_Part):
    """positive は枠(レイアウト)を組み込んだ後の文字列(split.py が組み込む)。
    positive_text(書いたままのプロンプト)と layout_boxes は生成情報の表示用。
    第29版: ワイルドカード(__名前__)は split.py が置き換えてから渡す。wildcard_template は置き換える前の文(生成情報の表示用)"""
    @classmethod
    def INPUT_TYPES(cls):
        t = super().INPUT_TYPES()
        t["optional"] = {"positive_text": ("STRING", {}), "layout_boxes": ("STRING", {}),
                         "wildcard_template": ("STRING", {}), "negw_settings": ("STRING", {}), "regional_settings": ("STRING", {})}
        return t

    def run(self, positive, negative, positive_text=None, layout_boxes=None, wildcard_template=None, negw_settings=None,
            regional_settings=None):
        return (positive, negative)


@_part("seed", ["seed"], ["seed"])
class CCAGenSeed(_Part):
    def run(self, seed):
        return (int(seed),)


@_part("sampling", SAMPLING_KEYS,
       ["width", "height", "steps", "cfg", "sampler_name", "scheduler", "denoise",
        "auto_image_size", "split_step", "size_by_scale", "video_length", "video_fps", "video_shift"])
class CCAGenSampling(_Part):
    def run(self, **kw):
        return sampling_values(**kw)


@_part("route", ["model_type", "task"], ["route"])
class CCAGenRoute(_Part):
    def run(self, model_type, task):
        return (route_of(model_type, task),)


def image_values(model_type, task, image, image_2, image_3=NONE, ref_size=REF_SIZE_AUTO,
                 edit_format=EDIT_FORMAT_AUTO, edit_lora_name=NONE, size_mode=SIZE_MODE_KEEP,
                 size_scale=1.0, mid_frame_pos=50, width=None, height=None, resize_mode=RESIZE_KEEP, **more):
    fmt = None
    if ref_max_edge_enabled(model_type, task):
        fmt = resolve_edit_format(edit_format, edit_lora_name)
    img1, mask1, img2, ref1 = load_images(model_type, task, image, image_2, ref_size, fmt,
                                          size_mode, size_scale, width, height, resize_mode)
    names = [image, image_2, image_3] + [more.get(k, NONE) for k in IMAGE_WIDGETS[3:]]
    refs = load_ref_images(model_type, task, img1, names)
    return (img1, mask1, img2, ref1, load_image_3(model_type, task, image_3),
            max(0, min(100, int(mid_frame_pos))), refs)


@_part("images", IMAGE_KEYS, ["image_1", "mask_1", "image_2", "ref_image_1", "image_3", "mid_frame_pos",
                              "ref_images"])
class CCAGenImages(_Part):
    @classmethod
    def IS_CHANGED(cls, image=None, image_2=None, image_3=None, **kwargs):
        # マスクを描いた画像→画像は毎回読み直す(前の結果を使い回すと、最後に塗っていない所へ元の画像を貼り戻す準備がされないため)
        if kwargs.get("task") == "I2I" and _on(image) and "cca_masks/" in str(image).replace("\\", "/"):
            return float("nan")
        return _hash_images(image, image_2, image_3, *[kwargs.get(k) for k in IMAGE_WIDGETS[3:]])

    def run(self, **kw):
        return image_values(**kw)


def hires_values(model_type, task, hires_enable, hires_upscaler, hires_scale, hires_steps,
                 hires_denoise, hires_cfg):
    on = bool(hires_enable) and hires_supported(model_type, task)
    return {"enabled": on, "model_type": model_type, "task": task, "upscaler": str(hires_upscaler),
            "scale": float(hires_scale), "steps": int(hires_steps), "denoise": float(hires_denoise),
            "cfg": float(hires_cfg)}


@_part("hires", ["model_type", "task"] + HIRES_KEYS, ["hires"])
class CCAGenHires(_Part):
    def run(self, **kw):
        return (hires_values(**kw),)


@_part("output", ["image_output_prefix", "video_output_prefix"], ["image_prefix", "video_prefix"])
class CCAGenOutput(_Part):
    @classmethod
    def IS_CHANGED(cls, image_output_prefix="", video_output_prefix="", **kwargs):
        # 日付が変わったら(時刻を含む書式なら毎回)作り直す
        return expand_prefix(image_output_prefix) + "|" + expand_prefix(video_output_prefix)

    def run(self, image_output_prefix, video_output_prefix):
        return (expand_prefix(image_output_prefix), expand_prefix(video_output_prefix))


PARTS = [CCAGenModels, CCAGenPrompt, CCAGenSeed, CCAGenSampling, CCAGenRoute, CCAGenImages,
         CCAGenOutput, CCAGenHires]
# パネルの出力番号 -> (分割先クラス, 分割先の出力番号)
OUTPUT_MAP = {}
for _i, (_name, _t) in enumerate(OUTPUTS):
    for _cls in PARTS:
        if _name in _cls.PART_OUTPUTS:
            OUTPUT_MAP[_i] = (_cls, _cls.PART_OUTPUTS.index(_name))
            break
assert len(OUTPUT_MAP) == len(OUTPUTS), "パネルの出力に分割先が無いものがあります"


# ---------------------------------------------------------------------------
# パネル
# ---------------------------------------------------------------------------
class CCAGeneratorPanel:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("モデル種別を選ぶだけで、対応する処理(サブグラフ)に必要なモデル・設定・画像を"
                   "まとめて渡す操作パネル。")
    RETURN_TYPES = tuple(t for _, t in OUTPUTS)
    RETURN_NAMES = tuple(n for n, _ in OUTPUTS)

    @classmethod
    def INPUT_TYPES(cls):
        c = choice_lists()
        lora_strength = ("FLOAT", {"default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01})
        return {
            "required": {
                "model_type": (MODEL_TYPES, {"default": MODEL_TYPES[0]}),
                "task": (TASKS_ALL, {"default": "T2I"}),
                "positive": ("STRING", {"multiline": True, "default": "", "dynamicPrompts": True}),
                "negative": ("STRING", {"multiline": True, "default": "", "dynamicPrompts": True}),
                "unet_name": (c["unets"], {"default": NONE}),
                "unet_dtype": (c["dtypes"], {"default": c["dtypes"][0]}),
                "ckpt_name": (c["ckpts"], {"default": NONE}),
                "clip_name": (c["clips"], {"default": NONE}),
                "clip_type": (c["clip_types"], {"default": c["clip_types"][0]}),
                "clip_device": (c["clip_devices"], {"default": c["clip_devices"][0]}),
                "vae_name": (c["vaes"], {"default": NONE}),
                "audio_vae_name": (c["vaes"], {"default": NONE}),
                "wan_high_unet": (c["unets"], {"default": NONE}),
                "wan_low_unet": (c["unets"], {"default": NONE}),
                # LoRA の一覧(JSON)。web/cca_generator.js が表形式の入力欄を出す
                "loras": ("STRING", {"default": "[]", "multiline": False}),
                "turbo_lora_name": (c["loras"], {"default": NONE}),
                "turbo_lora_strength": lora_strength,
                "turbo_lora_low_name": (c["loras"], {"default": NONE}),
                "edit_lora_name": (c["edit_loras"], {"default": NONE}),
                "edit_lora_strength": lora_strength,
                # MOSS Edit: Edit 形式(自動 = Edit LoRA の中身から判定)と参照画像の長辺
                "edit_format": ([EDIT_FORMAT_AUTO] + list(EDIT_FORMATS), {"default": EDIT_FORMAT_AUTO}),
                "ref_size": (list(REF_SIZES), {"default": REF_SIZE_AUTO}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF,
                                 "control_after_generate": True}),
                "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 100.0,
                                  "step": 0.1, "round": 0.01}),
                "sampler_name": (SAMPLERS, {"default": "euler"}),
                "scheduler": (SCHEDULERS, {"default": "simple"}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "width": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 16, "max": 16384, "step": 8}),
                "auto_image_size": ("BOOLEAN", {"default": True}),
                # 出力サイズ: サイズ指定(今まで通り)/ 画像1 × 倍率(Forge の Resize by)
                "size_mode": (SIZE_MODES, {"default": SIZE_MODE_KEEP}),
                "size_scale": ("FLOAT", {"default": 1.0, "min": 0.05, "max": 8.0, "step": 0.05}),
                # 画像→画像の「サイズ指定」での変え方(今まで通り / そのまま / 切り抜き / 余白を埋める)
                "resize_mode": (RESIZE_MODES, {"default": RESIZE_KEEP}),
                # 動画の長さ(フレーム数)と fps
                "video_length": ("INT", {"default": 81, "min": 1, "max": 3600}),
                "video_fps": ("FLOAT", {"default": 16.0, "min": 1.0, "max": 120.0, "step": 1.0}),
                # Wan のシフト(ModelSamplingSD3)。通常 8、Wan2.2 14B Turbo は 5
                "video_shift": ("FLOAT", {"default": 8.0, "min": 0.1, "max": 100.0, "step": 0.1}),
                # Hires. fix(テキスト→画像のみ)
                "hires_enable": ("BOOLEAN", {"default": False}),
                "hires_upscaler": (c["upscalers"], {"default": c["upscalers"][0]}),
                "hires_scale": ("FLOAT", {"default": 1.5, "min": 1.0, "max": 4.0, "step": 0.05}),
                "hires_steps": ("INT", {"default": 0, "min": 0, "max": 1000}),
                "hires_denoise": ("FLOAT", {"default": 0.45, "min": 0.0, "max": 1.0, "step": 0.01}),
                "hires_cfg": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.1}),
                # 入力画像1は標準のアップロード/プレビュー/マスクエディタを使う
                "image": (c["images"], {"default": NONE, "image_upload": True}),
                # 入力画像2のアップロードボタンとプレビューは web/cca_generator.js が追加する
                "image_2": (c["images"], {"default": NONE}),
                # 入力画像3(MiniMax H3 画像→動画の途中のフレーム)と、その位置(動画の長さに対する %)
                "image_3": (c["images"], {"default": NONE}),
                "mid_frame_pos": ("INT", {"default": 50, "min": 0, "max": 100}),
                "image_output_prefix": ("STRING", {
                    "default": "comfyui/%date:yyyy%-%date:M%-%date:d%/image"}),
                "video_output_prefix": ("STRING", {
                    "default": "comfyui/%date:yyyy%-%date:M%-%date:d%/video"}),
                # 第9版で追加(保存済みの値の並びを変えないよう末尾に足す)
                # Kandinsky 6 の 2 本目のテキストエンコーダー(CLIP-L)/ LTX-2.5 の潜在アップスケーラー
                "clip_name_2": (c["clips"], {"default": NONE}),
                "latent_upscale_name": (c["latent_upscalers"], {"default": NONE}),
                # 入力画像4〜10(FLUX.2 Klein は 4 枚、FLUX.3 Klein は 10 枚まで)
                **{k: (c["images"], {"default": NONE}) for k in IMAGE_WIDGETS[3:]},
                # 第10版で追加: 枠(バウンディングボックス)で指定した配置(JSON。web/cca_layout.js の編集画面で作る)
                "layout_boxes": ("STRING", {"default": "", "multiline": False}),
                # 第42版で追加: 音楽・音声の設定(JSON。生成パネルの「音楽・音声の設定」で編集する)と音声の保存先
                "audio_opts": ("STRING", {"default": "{}", "multiline": False}),
                "audio_output_prefix": ("STRING", {"default": "comfyui/%date:yyyy%-%date:M%-%date:d%/audio"}),
                # マイナス重み 相当 / 領域プロンプト 相当(regional.py。対応する種別・T2I だけ使う)
                "negw_enable": ("BOOLEAN", {"default": True}),
                "negw_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 3.0, "step": 0.05}),
                "regional_enable": ("BOOLEAN", {"default": False}),
                "regional_mode": (["横分割", "縦分割", "グリッド", "枠で指定"], {"default": "横分割"}),
                "regional_ratio": ("STRING", {"default": "1,1", "multiline": False}),
                "regional_common": ("BOOLEAN", {"default": False}),
                "regional_prompts": ("STRING", {"default": "", "multiline": True}),
                "regional_negatives": ("STRING", {"default": "", "multiline": True}),
                "regional_crop": (["領域の範囲だけを見て描く", "前半は領域の範囲だけ、後半は全体を見て描く", "画像全体を見て描き、領域でつなぐ"], {"default": "領域の範囲だけを見て描く"}),
                "regional_switch": ("INT", {"default": 100, "min": 0, "max": 100, "step": 1}),
                "layout_native": ("BOOLEAN", {"default": False}),
                # マイナスプロンプト・範囲別指定の共通設定(おすすめ設定 / 処理方法 / 各種数値)
                "negw_preset": (["おすすめ", "自分の設定"], {"default": "おすすめ"}),
                "negw_method": (["自動(モデルに合わせる)", "Value に負の重みを掛ける(UNet 系だけ)", "予測の差を引く"],
                                {"default": "自動(モデルに合わせる)"}),
                "negw_turbo_gain": ("FLOAT", {"default": 3.0, "min": 0.0, "max": 10.0, "step": 0.1}),
                "regional_feather": ("FLOAT", {"default": 3.0, "min": 0.5, "max": 32.0, "step": 0.5}),
                "regional_margin": ("INT", {"default": 8, "min": 0, "max": 64, "step": 1}),
                "regional_preset": (["おすすめ", "自分の設定"], {"default": "おすすめ"}),
                # SenseNova-U1.6 の自己修正(最大回数。0 で使わない)。既存の並びを変えないよう末尾
                "sn_passes": ("INT", {"default": 0, "min": 0, "max": 5, "step": 1}),
                # SenseNova-U1.6 画像→画像の PE(テキストエンコーダーでプロンプトを書き直す)。clip_name を使う
                "sn_pe": ("BOOLEAN", {"default": False}),
                # VRAM の補い方(足りない分を CPU のメモリで補う)。既存の並びを変えないよう末尾
                "vram_mode": (list(VRAM_MODES), {"default": VRAM_AUTO}),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, unet_name, ckpt_name, clip_name, vae_name, audio_vae_name,
                        wan_high_unet, wan_low_unet, turbo_lora_name,
                        turbo_lora_low_name, edit_lora_name, image, image_2, hires_upscaler,
                        image_3=None, ref_size=None, clip_name_2=None, latent_upscale_name=None,
                        image_4=None, image_5=None, image_6=None, image_7=None, image_8=None,
                        image_9=None, image_10=None, **_adv):
        # 使わないファイル項目が未設定・欠損でも弾かない(使う項目は実行時に確認して分かりやすく伝える)
        return True

    @classmethod
    def IS_CHANGED(cls, image=None, image_2=None, image_output_prefix="",
                   video_output_prefix="", image_3=None, **kwargs):
        # 通常は split.py で内部ノードに分割されるため、これは分割されなかった場合のみ使われる
        return (_hash_images(image, image_2, image_3, *[kwargs.get(k) for k in IMAGE_WIDGETS[3:]])
                + expand_prefix(image_output_prefix) + expand_prefix(video_output_prefix))

    def run(self, **kw):
        """分割されなかった場合(API から直接など)の一括実行。"""
        mt, task = kw["model_type"], kw["task"]
        model, model_low, clip, vae, audio_vae = load_models(
            mt, task, {k: kw[k] for k in MODEL_KEYS if k not in ("model_type", "task")})
        img1, mask1, img2, ref1, img3, mid, refs = image_values(**{k: kw[k] for k in IMAGE_KEYS if k in kw})
        width, height, steps, cfg, sampler, scheduler, denoise, auto, split, scaled, vlen, vfps, vshift = sampling_values(
            **{k: kw[k] for k in SAMPLING_KEYS if k in kw})
        from .layout import apply_layout
        positive = apply_layout(mt, task, kw["positive"], kw.get("layout_boxes", ""), width, height)
        return (
            positive, kw["negative"], width, height, img1, mask1, img2,
            int(kw["seed"]), steps, cfg, sampler, scheduler, denoise,
            model, model_low, clip, vae, audio_vae, auto,
            expand_prefix(kw["image_output_prefix"]), expand_prefix(kw["video_output_prefix"]),
            split, route_of(mt, task),
            ref1, resolve_edit_format(kw.get("edit_format"), kw.get("edit_lora_name")),
            hires_values(mt, task, **{k: kw[k] for k in HIRES_KEYS}),
            img3, mid, scaled, vlen, vfps, vshift,
            refs, load_latent_upscale(mt, task, kw),
        )


# ---------------------------------------------------------------------------
# Hires. fix(Forge と同じく、生成した画像を拡大してから少しだけ描き直す)
# ---------------------------------------------------------------------------
class CCAHiresFix:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = "パネルの Hires. fix 設定が有効なときだけ、画像を拡大して 2 回目のサンプリングを行います。無効なら素通し。"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        lazy = {"lazy": True, "forceInput": True}
        return {"required": {
            "image": ("IMAGE",),
            "hires": ("CCA_HIRES",),
            "model": ("MODEL", {"lazy": True}),
            "clip": ("CLIP", {"lazy": True}),
            "vae": ("VAE", {"lazy": True}),
            "positive": ("STRING", lazy),
            "negative": ("STRING", lazy),
            "seed": ("INT", lazy),
            "steps": ("INT", lazy),
            "cfg": ("FLOAT", lazy),
            "sampler_name": (SAMPLERS, lazy),
            "scheduler": (SCHEDULERS, lazy),
        }}

    def check_lazy_status(self, image, hires, **kw):
        if not (hires or {}).get("enabled"):
            return []
        return [k for k in ("model", "clip", "vae", "positive", "negative", "seed", "steps", "cfg",
                            "sampler_name", "scheduler") if kw.get(k) is None]

    def run(self, image, hires, model=None, clip=None, vae=None, positive="", negative="", seed=0,
            steps=20, cfg=1.0, sampler_name="euler", scheduler="simple"):
        # マスクを描いた画像→画像は、最後に塗っていない所へ元の画像を貼り戻す(高解像度化で全体が変わらないように)
        mt, tk = (hires or {}).get("model_type"), (hires or {}).get("task")
        if not (hires or {}).get("enabled"):
            return (_paste_back(image, mt, tk),)
        return (_paste_back(self._hires(image, hires, model, clip, vae, positive, negative, seed, steps, cfg, sampler_name, scheduler), mt, tk),)

    def _hires(self, image, hires, model, clip, vae, positive, negative, seed, steps, cfg, sampler_name, scheduler):
        info = TYPE_INFO[hires["model_type"]]
        h, w = image.shape[1], image.shape[2]
        scale = max(1.0, float(hires["scale"]))
        tw = max(16, round(w * scale / 16) * 16)
        th = max(16, round(h * scale / 16) * 16)
        up = hires["upscaler"]
        if up in HIRES_METHODS:
            img = comfy.utils.common_upscale(image.movedim(-1, 1), tw, th, HIRES_METHODS[up], "disabled").movedim(1, -1)
        else:
            if folder_paths.get_full_path("upscale_models", up) is None:
                raise ValueError(tr('Hires. fix のアップスケーラーが見つかりません: {up}(models/upscale_models)', up=up))
            um = _call("UpscaleModelLoader", model_name=up)[0]
            img = _call("ImageUpscaleWithModel", upscale_model=um, image=image)[0]
            img = comfy.utils.common_upscale(img.movedim(-1, 1), tw, th, "lanczos", "disabled").movedim(1, -1)
        latent = _call("VAEEncode", pixels=img[:, :, :, :3], vae=vae)[0]
        pos = _call("CLIPTextEncode", clip=clip, text=positive)[0]
        if info["negative"] and str(negative or "").strip():
            neg = _call("CLIPTextEncode", clip=clip, text=negative)[0]
        else:
            neg = _call("ConditioningZeroOut", conditioning=pos)[0]
        m = model
        if info["base"] == "Qwen Image":  # 元の T2I サブグラフと同じ ModelSamplingAuraFlow
            m = _call("ModelSamplingAuraFlow", model=m, shift=3.1)[0]
        steps_h = int(hires["steps"]) or int(steps)
        cfg_h = float(hires["cfg"]) or float(cfg)
        out = comfy_nodes.common_ksampler(m, int(seed), steps_h, cfg_h, sampler_name, scheduler, pos, neg,
                                          latent, denoise=float(hires["denoise"]))[0]
        return (_call("VAEDecode", samples=out, vae=vae)[0],)


# ---------------------------------------------------------------------------
# 出力サイズの切り替え(MOSS / Qwen Image の画像→画像)
# 今まで通り = 処理の中の「ImageScaleToTotalPixels」の出力をそのまま使う(元の動作のまま)
# 倍率指定   = パネルで画像1 × 倍率にした画像をそのまま使う
# ---------------------------------------------------------------------------
class CCAEditLatent:
    """MOSS の画像→画像の生成の始まり。マスクを描いていなければ元の画像をそのまま VAEEncode(全体を編集。
    ノイズ除去強度が 1 未満なら元の画像を残す)、描いていれば VAEEncodeForInpaint(塗った所だけ作り直す)。"""
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = ("MOSS の画像→画像: マスクが無ければ元の画像をそのまま潜在にし(全体を編集)、"
                   "マスクがあれば塗った所だけ作り直す(VAE Encode (for Inpainting) と同じ)。")
    RETURN_TYPES = ("LATENT",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"pixels": ("IMAGE",), "vae": ("VAE",), "mask": ("MASK",),
                             "grow_mask_by": ("INT", {"default": 6, "min": 0, "max": 64, "step": 1})}}

    def run(self, pixels, vae, mask, grow_mask_by=6):
        if mask is None or float(mask.max()) <= 0.0:
            return ({"samples": vae.encode(pixels[:, :, :, :3])},)
        return _call("VAEEncodeForInpaint", vae=vae, pixels=pixels, mask=mask, grow_mask_by=grow_mask_by)


class CCASizeSelect:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = "パネルで「倍率指定」のときだけ、画像1 × 倍率の画像に差し替えます。「サイズ指定」なら素通し。"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",),
            "by_scale_image": ("IMAGE",),
            "size_by_scale": ("BOOLEAN", {"default": False, "forceInput": True}),
        }}

    def run(self, image, by_scale_image, size_by_scale):
        return (by_scale_image if size_by_scale else image,)


# ---------------------------------------------------------------------------
# 途中のフレーム(MiniMax H3 画像→動画)。画像が無ければ素通し
# ---------------------------------------------------------------------------
class CCAMidFrameGuide:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = "入力画像3を、動画の指定した位置(%)のフレームとして固定します(MiniMax H3)。画像が無ければ何もしません。"
    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("positive",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "positive": ("CONDITIONING",),
            "latent": ("LATENT",),
            "vae": ("VAE",),
            "position": ("INT", {"default": 50, "min": 0, "max": 100}),
        }, "optional": {"image": ("IMAGE",)}}

    def run(self, positive, latent, vae, position, image=None):
        if image is None:
            return (positive,)
        from comfy_extras import nodes_minimax_h3 as h3
        video = latent["samples"].tensors[0]
        frames = sum(h3.FRAME_PER_TOKEN[k % 5] for k in range(video.shape[2]))
        idx = max(0, min(frames - 1, round((frames - 1) * int(position) / 100)))
        out = h3.MiniMaxH3AddGuide.execute(positive=positive, latent=latent, frame_idx=idx, vae=vae,
                                          image=image[:1])
        return (out.result[0] if hasattr(out, "result") else out[0],)


# ---------------------------------------------------------------------------
# ルート (route 番号 → 23 個の BOOLEAN)
# ---------------------------------------------------------------------------
class CCAGeneratorRoutes:
    CATEGORY = CATEGORY
    FUNCTION = "run"
    DESCRIPTION = "パネルの route 番号を、各処理のスイッチ用の ON/OFF に変換します。"
    RETURN_TYPES = ("BOOLEAN",) * ROUTE_COUNT
    RETURN_NAMES = tuple(f"route_{i:02d}" for i in range(ROUTE_COUNT))

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"route": ("INT", {"default": 0, "min": 0, "max": ROUTE_COUNT - 1,
                                               "forceInput": True})},
                "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"}}

    def run(self, route, prompt=None, unique_id=None):
        r = int(route)
        # 選んだ種別の処理が、このワークフローに無い(前の版で保存したワークフロー)。そのままだと代わりの黒い画像になる
        if isinstance(prompt, dict) and unique_id is not None and not _route_used(prompt, str(unique_id), r):
            raise ValueError(tr("このワークフローには、選んだ種別の処理(ルート {route})がありません。前の版で保存したワークフローです。"
                                "同梱の cca_generator_workflow.json を開き直してください(パネルの設定・プリセットはそのまま残ります)。", route=r))
        return tuple(i == r for i in range(ROUTE_COUNT))


def _route_used(prompt, uid, route):
    """ルートの出力(route 番目)を使っているノードがあるか"""
    for node in prompt.values():
        for v in (node.get("inputs") or {}).values():
            if isinstance(v, list) and len(v) == 2 and str(v[0]) == uid and str(v[1]) == str(route):
                return True
    return False

