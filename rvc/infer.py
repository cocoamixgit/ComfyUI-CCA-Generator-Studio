# RVC の声の変換(推論だけ)。RVC-Project/Retrieval-based-Voice-Conversion-WebUI の infer/vc/pipeline.py・infer/vc/modules.py・
# infer/hubert.py(MIT License、同じフォルダの LICENSE)をもとに、このノードで使う形にまとめたもの(変更しています)。
# 声の高さの推定は RMVPE。学習で作る .index(似た特徴を探す表)は faiss が入っているときだけ使う(無ければ使わずに変換する)
import os
import traceback

import numpy as np
import torch
import torch.nn.functional as F
from scipy import signal

from .models import (SynthesizerTrnMs256NSFsid, SynthesizerTrnMs256NSFsid_nono, SynthesizerTrnMs768NSFsid,
                     SynthesizerTrnMs768NSFsid_nono)
from .rmvpe import RMVPE

SR = 16000       # HuBERT に渡す音の速さ
WINDOW = 160     # 1 コマの点の数
X_PAD, X_QUERY, X_CENTER, X_MAX = 1, 6, 38, 41  # 長い音を区切る間隔(秒)。RVC の既定(VRAM に余裕があるとき)と同じ
F0_MIN, F0_MAX = 50, 1100
_BH, _AH = signal.butter(N=5, Wn=48, btype="high", fs=SR)

# 自動でダウンロードするファイル(lj1995/VoiceConversionWebUI。MIT License)
HF_BASE = "https://huggingface.co/lj1995/VoiceConversionWebUI/resolve/main"
HUBERT_FILES = ["hubert_base/config.json", "hubert_base/preprocessor_config.json", "hubert_base/pytorch_model.bin"]
RMVPE_FILE = "rmvpe.pt"


def download(root, rel, log=print):
    """root/rel が無ければ HF_BASE/rel から入れる(途中のファイルは .part で書き、終わったら名前を変える)"""
    import urllib.request
    dst = os.path.join(root, *rel.split("/"))
    if os.path.isfile(dst) and os.path.getsize(dst) > 0:
        return dst
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    url = f"{HF_BASE}/{rel}?download=true"
    log(f"[CCA Generator] RVC: {rel} をダウンロードしています: {url}")
    tmp = dst + ".part"
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    os.replace(tmp, dst)
    return dst


def ensure_assets(root, log=print):
    for rel in HUBERT_FILES + [RMVPE_FILE]:
        download(root, rel, log)
    return os.path.join(root, "hubert_base"), os.path.join(root, RMVPE_FILE)


def load_hubert(path, device):
    from transformers import HubertModel

    class HubertModelWithFinalProj(HubertModel):
        def __init__(self, config):
            super().__init__(config)
            self.final_proj = torch.nn.Linear(config.hidden_size, config.classifier_proj_size)

    m = HubertModelWithFinalProj.from_pretrained(path, local_files_only=True, torch_dtype=torch.float32)
    return m.to(device).eval()


def hubert_features(model, x, version):
    """RVC v1 は 9 層目 + final_proj(256 次元)、v2 は最後の層(768 次元)"""
    if version == "v1":
        out = model(input_values=x, output_hidden_states=True, return_dict=True)
        return model.final_proj(out.hidden_states[9])
    return model(input_values=x, return_dict=True).last_hidden_state


def load_voice(path, device):
    """RVC の .pth(学習で書き出した声のモデル)→ (net_g, 出力の速さ, f0 を使うか, v1 / v2, 話者の数)"""
    cpt = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(cpt, dict) or "config" not in cpt or "weight" not in cpt:
        raise ValueError("RVC の声のモデル(.pth)ではありません(学習途中の G_*.pth・D_*.pth は使えません。書き出した小さい .pth を選びます)")
    config = list(cpt["config"])
    tgt_sr = int(config[-1])
    config[-3] = cpt["weight"]["emb_g.weight"].shape[0]
    if_f0 = int(cpt.get("f0", 1))
    version = cpt.get("version", "v1")
    cls = {("v1", 1): SynthesizerTrnMs256NSFsid, ("v1", 0): SynthesizerTrnMs256NSFsid_nono,
           ("v2", 1): SynthesizerTrnMs768NSFsid, ("v2", 0): SynthesizerTrnMs768NSFsid_nono}.get((version, if_f0), SynthesizerTrnMs256NSFsid)
    net_g = cls(*config, is_half=False)
    del net_g.enc_q
    net_g.load_state_dict(cpt["weight"], strict=False)
    net_g = net_g.eval().to(device).float()
    return net_g, tgt_sr, if_f0, version, int(config[-3])


def load_index(path):
    """faiss の .index → (index, 全部の特徴)。faiss が無い・読めないときは (None, None)"""
    if not path or not os.path.isfile(path):
        return None, None
    try:
        import faiss
    except ImportError:
        print("[CCA Generator] RVC: faiss が入っていないので、.index は使わずに変換します(pip install faiss-cpu で使えます)")
        return None, None
    try:
        index = faiss.read_index(path)
        return index, index.reconstruct_n(0, index.ntotal)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return None, None


def change_rms(src, sr1, out, sr2, rate):
    """出力の音量の動きを、元の音の音量の動きに rate の割合で近づける(0.5 秒ごと)"""
    def rms(x, sr):
        hop = sr // 2
        fl = hop * 2
        xp = np.pad(x, (fl // 2, fl // 2), mode="constant")
        n = 1 + (len(xp) - fl) // hop
        fr = np.lib.stride_tricks.as_strided(xp, shape=(max(n, 1), fl), strides=(xp.strides[0] * hop, xp.strides[0]))
        return np.sqrt(np.mean(fr.astype(np.float64) ** 2, axis=1)).astype(np.float32)
    r1 = F.interpolate(torch.from_numpy(rms(src, sr1))[None, None], size=out.shape[0], mode="linear").squeeze()
    r2 = F.interpolate(torch.from_numpy(rms(out, sr2))[None, None], size=out.shape[0], mode="linear").squeeze()
    r2 = torch.clamp(r2, min=1e-6)
    return out * (torch.pow(r1, torch.tensor(1 - rate)) * torch.pow(r2, torch.tensor(rate - 1))).numpy()


class Converter:
    def __init__(self, hubert, rmvpe, device):
        self.hubert, self.rmvpe, self.device = hubert, rmvpe, device

    def get_f0(self, x, p_len, up_key):
        f0 = self.rmvpe.infer_from_audio(x, thred=0.03)
        try:  # 声の無い所は前後をつないで埋める
            uv = f0 == 0
            f0[uv] = np.interp(np.where(uv)[0], np.where(~uv)[0], f0[~uv])
        except Exception:  # noqa: BLE001
            pass
        f0 = f0 * pow(2, up_key / 12)
        f0bak = f0.copy()
        mel_min, mel_max = 1127 * np.log(1 + F0_MIN / 700), 1127 * np.log(1 + F0_MAX / 700)
        f0_mel = 1127 * np.log(1 + f0 / 700)
        f0_mel[f0_mel > 0] = (f0_mel[f0_mel > 0] - mel_min) * 254 / (mel_max - mel_min) + 1
        f0_mel[f0_mel <= 1] = 1
        f0_mel[f0_mel > 255] = 255
        return np.rint(f0_mel).astype(np.int32)[:p_len], f0bak[:p_len].astype(np.float32)

    def vc(self, net_g, sid, audio0, pitch, pitchf, index, big, index_rate, version, protect):
        feats = torch.from_numpy(audio0).float().view(1, -1).to(self.device)
        with torch.no_grad():
            feats = hubert_features(self.hubert, feats, version)
        use_protect = protect < 0.5 and pitch is not None
        if use_protect:
            feats0 = feats.clone()
        if index is not None and big is not None and index_rate > 0:
            npy = feats[0].cpu().numpy().astype("float32")
            score, ix = index.search(npy, k=8)
            weight = np.square(1 / np.maximum(score, 1e-12))
            weight /= weight.sum(axis=1, keepdims=True)
            npy = np.sum(big[ix] * np.expand_dims(weight, axis=2), axis=1)
            feats = torch.from_numpy(npy).unsqueeze(0).to(self.device) * index_rate + (1 - index_rate) * feats
        feats = F.interpolate(feats.permute(0, 2, 1), scale_factor=2).permute(0, 2, 1)
        if use_protect:
            feats0 = F.interpolate(feats0.permute(0, 2, 1), scale_factor=2).permute(0, 2, 1)
        p_len = audio0.shape[0] // WINDOW
        if feats.shape[1] < p_len:
            p_len = feats.shape[1]
        feats = feats[:, :p_len]
        if pitch is not None:
            pitch, pitchf = pitch[:, :p_len], pitchf[:, :p_len]
        if use_protect:  # 息・子音(声の高さが無い所)は元の特徴を残す
            pf = pitchf.clone()
            pf[pitchf > 0] = 1
            pf[pitchf < 1] = protect
            pf = pf.unsqueeze(-1)
            feats = feats * pf + feats0[:, :p_len] * (1 - pf)
        lengths = torch.tensor([p_len], device=self.device).long()
        with torch.no_grad():
            if pitch is not None:
                out = net_g.infer(feats, lengths, pitch, pitchf, sid)[0]
            else:
                out = net_g.infer(feats, lengths, sid)[0]
        return out[0, 0].data.cpu().float().numpy()

    def convert(self, net_g, tgt_sr, if_f0, version, audio16k, sid=0, up_key=0, index=None, big=None, index_rate=0.75,
                rms_mix_rate=0.25, protect=0.33):
        """16kHz・モノラルの float32 → tgt_sr の float32"""
        t_pad, t_pad_tgt = SR * X_PAD, tgt_sr * X_PAD
        t_pad2, t_query, t_center, t_max = t_pad * 2, SR * X_QUERY, SR * X_CENTER, SR * X_MAX
        audio = signal.filtfilt(_BH, _AH, audio16k).astype(np.float32)
        audio_pad = np.pad(audio, (WINDOW // 2, WINDOW // 2), mode="reflect")
        opt_ts = []
        if audio_pad.shape[0] > t_max:  # 長い音は、静かな所で区切って変換する
            audio_sum = np.zeros_like(audio)
            for i in range(WINDOW):
                audio_sum += np.abs(audio_pad[i:i - WINDOW])
            for t in range(t_center, audio.shape[0], t_center):
                seg = audio_sum[t - t_query:t + t_query]
                opt_ts.append(t - t_query + int(np.where(seg == seg.min())[0][0]))
        audio_pad = np.pad(audio, (t_pad, t_pad), mode="reflect")
        p_len = audio_pad.shape[0] // WINDOW
        sid_t = torch.tensor(sid, device=self.device).unsqueeze(0).long()
        pitch = pitchf = None
        if if_f0 == 1:
            pc, pfc = self.get_f0(audio_pad, p_len, up_key)
            pitch = torch.tensor(pc, device=self.device).unsqueeze(0).long()
            pitchf = torch.tensor(pfc, device=self.device).unsqueeze(0).float()
        outs, s, t = [], 0, None
        for t in opt_ts:
            t = t // WINDOW * WINDOW
            a, b = s // WINDOW, (t + t_pad2) // WINDOW
            outs.append(self.vc(net_g, sid_t, audio_pad[s:t + t_pad2 + WINDOW], None if pitch is None else pitch[:, a:b],
                                None if pitchf is None else pitchf[:, a:b], index, big, index_rate, version, protect)[t_pad_tgt:-t_pad_tgt])
            s = t
        a = 0 if t is None else t // WINDOW
        outs.append(self.vc(net_g, sid_t, audio_pad[0 if t is None else t:], None if pitch is None else pitch[:, a:],
                            None if pitchf is None else pitchf[:, a:], index, big, index_rate, version, protect)[t_pad_tgt:-t_pad_tgt])
        out = np.concatenate(outs)
        if rms_mix_rate != 1:
            out = change_rms(audio, SR, out, tgt_sr, rms_mix_rate)
        peak = np.abs(out).max() / 0.99 if out.size else 0
        if peak > 1:
            out = out / peak
        return out.astype(np.float32)
