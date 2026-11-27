"""第43版: RVC の声の変換(ボイスチェンジ)。

rvc/ は RVC-Project/Retrieval-based-Voice-Conversion-WebUI(MIT License)の推論の部分を同梱したもの(rvc/LICENSE)。
追加ノードは要らない(PyTorch・transformers・scipy・torchaudio は ComfyUI に入っている)。
- 声のモデル: models/rvc/ の .pth(学習で書き出したもの)と、あれば同じ名前の .index
- HuBERT(models/rvc/hubert_base/)と RMVPE(models/rvc/rmvpe.pt)は、初めて使うときに
  Hugging Face の lj1995/VoiceConversionWebUI(MIT License)から自動でダウンロードする
"""
import os
import threading

import folder_paths

KIND = "rvc"
NONE = "(none)"
_lock = threading.Lock()
_cache = {}


def ensure_folder():
    if KIND not in folder_paths.folder_names_and_paths:
        folder_paths.folder_names_and_paths[KIND] = ([os.path.join(folder_paths.models_dir, KIND)], {".pth", ".index"})


ensure_folder()


def _root():
    paths = folder_paths.get_folder_paths(KIND)
    return paths[0] if paths else os.path.join(folder_paths.models_dir, KIND)


def voice_models():
    """声のモデル(.pth)。HuBERT・RMVPE と、学習途中のファイル(G_*.pth・D_*.pth)は出さない"""
    out = []
    for f in folder_paths.get_filename_list(KIND):
        n = os.path.basename(f)
        if not n.lower().endswith(".pth") or f.replace("\\", "/").startswith("hubert_base/") or n.startswith(("G_", "D_")):
            continue
        out.append(f)
    return out


def index_files():
    return [f for f in folder_paths.get_filename_list(KIND) if f.lower().endswith(".index")]


def guess_index(model):
    """モデルと同じ名前(または名前を含む)の .index。無ければ空"""
    stem = os.path.splitext(os.path.basename(model or ""))[0].lower()
    if not stem:
        return ""
    idx = index_files()
    for f in idx:
        if os.path.splitext(os.path.basename(f))[0].lower() == stem:
            return f
    for f in idx:
        if stem in os.path.basename(f).lower():
            return f
    return ""


def _device():
    import comfy.model_management as mm
    return mm.get_torch_device()


def _assets(device):
    from ..rvc.infer import ensure_assets, load_hubert
    from ..rvc.rmvpe import RMVPE
    key = ("assets", str(device))
    if key not in _cache:
        hub, rm = ensure_assets(_root())
        _cache[key] = (load_hubert(hub, device), RMVPE(rm, device=device))
    return _cache[key]


def _voice(path, device):
    from ..rvc.infer import load_voice
    key = ("voice", path, os.path.getmtime(path), str(device))
    if key not in _cache:
        for k in [k for k in _cache if k[0] == "voice"]:
            _cache.pop(k)
        _cache[key] = load_voice(path, device)
    return _cache[key]


def unload():
    _cache.clear()
    try:
        import comfy.model_management as mm
        mm.soft_empty_cache()
    except Exception:  # noqa: BLE001
        pass


def convert_audio(audio, model, index="", pitch=0, index_rate=0.75, protect=0.33, rms_mix=0.25, speaker=0, unload_after=False):
    """ComfyUI の AUDIO({"waveform": [B, C, T], "sample_rate"})→ 変換した AUDIO(モデルの速さ・モノラル)"""
    import torch
    import torchaudio
    from ..rvc.infer import Converter, load_index
    path = folder_paths.get_full_path(KIND, model) if model and model != NONE else None
    if not path or not os.path.isfile(path):
        raise ValueError(f"RVC の声のモデルが見つかりません: {model}(models/rvc に .pth を入れてください)")
    ipath = folder_paths.get_full_path(KIND, index) if index and index != NONE else None
    wav, sr = audio["waveform"], int(audio["sample_rate"])
    device = _device()
    outs = []
    with _lock:
        hubert, rmvpe = _assets(device)
        net_g, tgt_sr, if_f0, version, n_spk = _voice(path, device)
        idx, big = load_index(ipath) if index_rate > 0 else (None, None)
        conv = Converter(hubert, rmvpe, device)
        for b in range(wav.shape[0]):
            x = wav[b].float().mean(0)  # モノラルに
            x16 = torchaudio.functional.resample(x, sr, 16000) if sr != 16000 else x
            x16 = x16.cpu().numpy()
            peak = float(abs(x16).max()) / 0.95 if x16.size else 0
            if peak > 1:
                x16 = x16 / peak
            y = conv.convert(net_g, tgt_sr, if_f0, version, x16, sid=max(0, min(int(speaker), n_spk - 1)), up_key=int(pitch),
                             index=idx, big=big, index_rate=float(index_rate), rms_mix_rate=float(rms_mix), protect=float(protect))
            outs.append(torch.from_numpy(y))
        if unload_after:
            unload()
    n = max(t.shape[0] for t in outs)
    out = torch.zeros(len(outs), 1, n)
    for i, t in enumerate(outs):
        out[i, 0, :t.shape[0]] = t
    return {"waveform": out, "sample_rate": tgt_sr}


class CCARVCConvert:
    CATEGORY = "CCA Generator"
    FUNCTION = "run"
    RETURN_TYPES = ("AUDIO",)
    DESCRIPTION = ("RVC で声を変える(ボイスチェンジ)。models/rvc の声のモデル(.pth)を使う。HuBERT と RMVPE は初めて使うときに自動でダウンロードする。"
                   "RVC(RVC-Project、MIT License)の推論を同梱。")

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO",),
            "model": (voice_models() or [NONE],),
            "index": ([NONE] + index_files(),),
            "pitch": ("INT", {"default": 0, "min": -24, "max": 24, "tooltip": "声の高さ(半音)。男性 → 女性は +12 くらい、女性 → 男性は -12 くらい"}),
            "index_rate": ("FLOAT", {"default": 0.75, "min": 0.0, "max": 1.0, "step": 0.01}),
            "protect": ("FLOAT", {"default": 0.33, "min": 0.0, "max": 0.5, "step": 0.01}),
            "rms_mix": ("FLOAT", {"default": 0.25, "min": 0.0, "max": 1.0, "step": 0.01}),
            "speaker": ("INT", {"default": 0, "min": 0, "max": 255}),
            "unload_after": ("BOOLEAN", {"default": False}),
        }}

    @classmethod
    def VALIDATE_INPUTS(cls, model, index, **kw):
        return True  # 一覧は実行のときに読み直す(パネルから後で入れたファイルも使えるように)

    def run(self, audio, model, index, pitch, index_rate, protect, rms_mix, speaker, unload_after):
        return (convert_audio(audio, model, index, pitch, index_rate, protect, rms_mix, speaker, unload_after),)


NODES = {"CCARVCConvert": (CCARVCConvert, "CCA RVC で声を変える")}
