"""色・明るさの補正(動画編集の書き出し)。画面の web/cca_adjust.js と同じ順・同じ式。

adj のキー: exposure 露光量・bright 明るさ・contrast コントラスト・high ハイライト・shadow シャドウ・white 白レベル・black 黒レベル(bcolor 黒の色)・
light ライティング・hdr HDR(トーンマッピング)・detail ディテール・clarity 鮮明度・dehaze かすみ除去・sharp シャープ・denoise ノイズ低減・
temp 色温度・tint 色かぶり・sat 彩度・vib 自然な彩度・hue 色相(度)・sgrade / hgrade(scolor / hcolor)カラーグレーディング・glow ふんわり・
vignette 周辺の明るさ・grain 粒子。色相以外は -1〜1(hdr・denoise・sgrade・hgrade・glow・grain は 0〜1)。
ぼかしなどの大きさは絵の短い辺に対しての割合。
HDR は、明るさの対数をガイデッドフィルター(ふちを残してならす)でベースとディテールに分け、ベースだけを縮めるトーンマッピング。
"""
import math

import numpy as np
from PIL import Image, ImageFilter

KEYS = ("exposure", "bright", "contrast", "high", "shadow", "white", "black", "light", "hdr", "detail", "clarity", "dehaze", "sharp", "denoise",
        "temp", "tint", "sat", "vib", "hue", "sgrade", "hgrade", "glow", "vignette", "grain")
COLORS = {"bcolor": "#ffffff", "scolor": "#1f6fd8", "hcolor": "#ff9a3c"}
BLUR_K = {"sharp": 0.0012, "clarity": 0.015, "light": 0.05, "glow": 0.02}


def _f(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def adj_on(a):
    return isinstance(a, dict) and any(abs(_f(a.get(k))) > 1e-4 for k in KEYS)


def _rgb01(hex_, d):
    for s in (str(hex_ or ""), d):
        s = s.lstrip("#")
        if len(s) >= 6:
            try:
                return np.array([int(s[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)
            except ValueError:
                pass
    return np.ones(3, dtype=np.float32)


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _lum(c):
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def _toL(v):
    return np.power(np.maximum(v, 0.0), 2.2)


def _toS(v):
    return np.power(np.maximum(v, 0.0), 1 / 2.2)


def _blur(im, sigma):
    """RGB をぼかした 0〜1 の配列。大きなぼかしは縮めてからぼかして戻す(画面と同じやり方)"""
    W, H = im.size
    f = sigma / 4 if sigma >= 8 else 1.0
    sw, sh = max(1, int(round(W / f))), max(1, int(round(H / f)))
    sm = im.resize((sw, sh), Image.BOX) if f > 1 else im
    sm = sm.filter(ImageFilter.GaussianBlur(sigma / f))
    if f > 1:
        sm = sm.resize((W, H), Image.BILINEAR)
    return np.asarray(sm, dtype=np.float32)[..., :3] / 255.0


# ---- 平均・縮小・拡大・ガイデッドフィルター(画面と同じ計算)
def _box1(a, r, axis):
    n = a.shape[axis]
    c = np.cumsum(a, axis=axis, dtype=np.float64)
    shp = list(a.shape)
    shp[axis] = 1
    c = np.concatenate([np.zeros(shp), c], axis=axis)
    idx = np.arange(n)
    lo, hi = np.clip(idx - r, 0, n), np.clip(idx + r + 1, 0, n)
    s = np.take(c, hi, axis=axis) - np.take(c, lo, axis=axis)
    cs = [1] * a.ndim
    cs[axis] = n
    return (s / (hi - lo).reshape(cs)).astype(np.float32)


def _box(a, r):
    """半径 r の箱の平均(はしは、絵の中にある分だけで平均。横 → 縦)"""
    return _box1(_box1(a, r, 1), r, 0)


def _down(a, f):
    H, W = a.shape
    h, w = -(-H // f), -(-W // f)
    pad = np.zeros((h * f, w * f), np.float64)
    cnt = np.zeros_like(pad)
    pad[:H, :W] = a
    cnt[:H, :W] = 1
    return (pad.reshape(h, f, w, f).sum(axis=(1, 3)) / cnt.reshape(h, f, w, f).sum(axis=(1, 3))).astype(np.float32)


def _up(s, W, H, f):
    h, w = s.shape
    u = np.clip((np.arange(W) + 0.5) / f - 0.5, 0, w - 1)
    i0 = np.floor(u).astype(np.int64)
    i1 = np.minimum(i0 + 1, w - 1)
    fx = (u - i0).astype(np.float32)
    v = np.clip((np.arange(H) + 0.5) / f - 0.5, 0, h - 1)
    j0 = np.floor(v).astype(np.int64)
    j1 = np.minimum(j0 + 1, h - 1)
    fy = (v - j0).astype(np.float32)[:, None]
    a = s[j0][:, i0] + (s[j0][:, i1] - s[j0][:, i0]) * fx
    b = s[j1][:, i0] + (s[j1][:, i1] - s[j1][:, i0]) * fx
    return a + (b - a) * fy


def _guided(I, rk, eps, max_side=512):
    """ふちを残してならす(ガイデッドフィルター。I 自身を手がかりに)。返り値 (ならした値, 縮めたときの値)"""
    H, W = I.shape
    f = max(1, math.ceil(max(W, H) / max_side))
    s = _down(I, f)
    h, w = s.shape
    r = max(1, int(round(rk * min(w, h))))
    mI, mII = _box(s, r), _box(s * s, r)
    v = np.maximum(0.0, mII - mI * mI)
    A = v / (v + eps)
    B = mI - A * mI
    mA, mB = _box(A, r), _box(B, r)
    return _up(mA, W, H, f) * I + _up(mB, W, H, f), mA * s + mB


def _pct(a, q):
    s = np.sort(a.ravel())
    return float(s[min(len(s) - 1, max(0, int(math.floor(q * (len(s) - 1)))))])


def _hash2(W, H):
    """画素の位置から決まる乱数 0〜1(画面と同じ値)"""
    x = np.arange(W, dtype=np.uint64)[None, :]
    y = np.arange(H, dtype=np.uint64)[:, None]
    M = np.uint64(0xFFFFFFFF)
    h = (x * np.uint64(374761393) + y * np.uint64(668265263)) & M
    h = ((h ^ (h >> np.uint64(13))) * np.uint64(1274126177)) & M
    h = h ^ (h >> np.uint64(16))
    return h.astype(np.float64) / 4294967296.0


def _setL(c, L, L2):
    """明るさ L を L2 に(色の濃さを保つように比で掛ける。真っ黒に近い所は足す)"""
    L, L2 = L[..., None], L2[..., None]
    return np.where(L > 1e-3, c * (L2 / np.maximum(L, 1e-3)), c + (L2 - L))


def lerp_adj(a, b, p):
    """キーフレームの間の補正(p: 0〜1。数は直線で、色は RGB を混ぜる)。画面の lerpAdj と同じ"""
    a, b = a or {}, b or {}
    out = {}
    for k in KEYS:
        v = _f(a.get(k)) + (_f(b.get(k)) - _f(a.get(k))) * p
        if abs(v) > 1e-4:
            out[k] = round(v * 1000) / 1000
    for k, d in COLORS.items():
        if not a.get(k) and not b.get(k):
            continue
        x, y = _rgb01(a.get(k), d), _rgb01(b.get(k), d)
        out[k] = "#" + "".join(f"{int(round((x[i] + (y[i] - x[i]) * p) * 255)):02x}" for i in range(3))
    return out


def adj_at(item, t_local, ease=None):
    """時刻 t_local の補正。補正の入ったキーフレームがあれば、その間をなめらかにつなぐ(画面の adjAt と同じ)。
    補正を使わない設定(adjOff)なら None"""
    if item.get("adjOff"):
        return None
    ks = sorted([k for k in (item.get("kf") or []) if isinstance(k, dict) and isinstance(k.get("adj"), dict)], key=lambda k: _f(k.get("t")))
    if not ks:
        return item.get("adj")
    if t_local <= _f(ks[0].get("t")):
        return ks[0]["adj"]
    if t_local >= _f(ks[-1].get("t")):
        return ks[-1]["adj"]
    i = max(j for j in range(len(ks)) if _f(ks[j].get("t")) <= t_local)
    a, b = ks[i], ks[i + 1]
    p = min(1.0, max(0.0, (t_local - _f(a.get("t"))) / max(1e-6, _f(b.get("t")) - _f(a.get("t")))))
    if (item.get("kfEase") or "smooth") == "smooth":
        p = p * p * (3 - 2 * p)
    return lerp_adj(a["adj"], b["adj"], p)


def adj_kf_on(item):
    return any(isinstance(k, dict) and isinstance(k.get("adj"), dict) for k in (item.get("kf") or []))


def sel_on(s):
    """範囲を選ぶ(画面の selOn と同じ)。s = {on, col, color, thr, soft, path, pmode, act}"""
    return isinstance(s, dict) and bool(s.get("on")) and (bool(s.get("col")) or (len(s.get("path") or []) >= 3 and s.get("pmode") in ("in", "out")))


def sel_mask(rgba, s):
    """選んだ所(0〜1)。色(しきい値以内)とパス(中 / 外)の両方に入る所を、ぼかす(画面の selMaskCanvas と同じ。ぼかしは絵の外を 0 として)"""
    from PIL import ImageDraw
    a = np.asarray(rgba, dtype=np.float32)
    Hh, Ww = a.shape[:2]
    if s.get("col"):
        c = np.array(_rgb01(s.get("color"), "#ff0000"), dtype=np.float32) * 255
        t = min(1.0, max(0.0, _f(s.get("thr"), 0.2))) * 441.673
        m = ((((a[..., :3] - c) ** 2).sum(-1) <= t * t) & (a[..., 3] > 0)).astype(np.float32)
    else:
        m = np.ones((Hh, Ww), np.float32)
    pts = s.get("path") or []
    if s.get("pmode") in ("in", "out") and len(pts) >= 3:
        pm = Image.new("L", (Ww, Hh), 0)
        ImageDraw.Draw(pm).polygon([(_f(p[0]) * Ww, _f(p[1]) * Hh) for p in pts], fill=255)
        pmv = np.asarray(pm, dtype=np.float32) / 255.0
        m *= pmv if s.get("pmode") == "in" else 1.0 - pmv
    sg = min(0.2, max(0.0, _f(s.get("soft"), 0.0))) * min(Ww, Hh)
    if sg > 0.3:
        pad = int(math.ceil(sg * 3))
        big = Image.new("L", (Ww + 2 * pad, Hh + 2 * pad), 0)
        big.paste(Image.fromarray(np.clip(m * 255, 0, 255).astype(np.uint8), "L"), (pad, pad))
        m = np.asarray(big.filter(ImageFilter.GaussianBlur(sg)), dtype=np.float32)[pad:pad + Hh, pad:pad + Ww] / 255.0
    return m


def adjust_image(im, a, sel=None):
    """PIL の絵(RGB / RGBA)に補正を掛けた絵(同じ mode)。補正が無ければそのまま。
    sel: 範囲を選ぶ(選んだ所だけ補正する・選んだ所を消す)"""
    if not sel_on(sel):
        return _adjust_whole(im, a)
    cut = sel.get("act") == "cut"
    if not adj_on(a) and not cut:
        return im
    mode = im.mode
    rgba = im.convert("RGBA")
    m = sel_mask(rgba, sel)
    out = np.asarray(_adjust_whole(rgba, a), dtype=np.float32).copy()
    if cut:
        out[..., 3] *= 1.0 - m  # 選んだ所を消す(ほかは補正だけ)
    else:
        org = np.asarray(rgba, dtype=np.float32)
        out[..., :3] = org[..., :3] * (1.0 - m[..., None]) + out[..., :3] * m[..., None]
    res = Image.fromarray(np.clip(np.round(out), 0, 255).astype(np.uint8), "RGBA")
    return res if mode == "RGBA" else res.convert(mode)


def _adjust_whole(im, a):
    """絵全体に補正を掛ける"""
    if not adj_on(a):
        return im
    mode = im.mode
    rgba = im.convert("RGBA")
    W, H = rgba.size
    m = min(W, H)
    P = {k: _f(a.get(k)) for k in KEYS}
    arr = np.asarray(rgba, dtype=np.float32) / 255.0
    c = arr[..., :3].copy()
    rgb_im = rgba.convert("RGB")
    # 1. ノイズ低減
    if P["denoise"] > 1e-4:
        eps = (0.02 + 0.08 * P["denoise"]) ** 2
        rk = max(1, int(round(0.003 * m))) / m
        for ch in range(3):
            q, _ = _guided(c[..., ch], rk, eps, 10 ** 9)
            c[..., ch] += P["denoise"] * (q - c[..., ch])
    # 2. シャープ
    if abs(P["sharp"]) > 1e-4:
        bs = _blur(rgb_im, max(0.6, BLUR_K["sharp"] * m))
        k = P["sharp"] * 1.5 if P["sharp"] > 0 else P["sharp"]
        c = c + k * (c - bs)
    # 3. かすみ除去
    if P["dehaze"]:
        dark, mx = c.min(axis=-1), c.max(axis=-1)
        q, _ = _guided(dark, 0.03, 0.01)
        A = min(1.0, max(0.6, _pct(_down(mx, max(1, math.ceil(max(W, H) / 512))), 0.999)))
        if P["dehaze"] > 0:
            t = np.maximum(0.25, 1 - 0.95 * P["dehaze"] * np.clip(q, 0, 1) / A)[..., None]
            c = (c - A) / t + A
        else:
            c = c + (-P["dehaze"] * 0.45) * (A - c)
    # 4. 露光量
    if P["exposure"]:
        c = _toS(_toL(c) * 2 ** (2 * P["exposure"]))
    # 5. HDR(トーンマッピング)・ディテール
    if P["hdr"] > 1e-4 or P["detail"]:
        lin = _toL(c)
        Ll = _lum(lin)
        l = np.log2(Ll + 1e-4)
        base, small = _guided(l, 0.025, 0.12)
        anchor = _pct(small, 0.97)
        k = 0.65 * P["hdr"]
        sc = 1 - 0.45 * k  # 持ち上げた所の色が濃くなりすぎないように、色の比を sc 乗
        L2 = np.maximum(0.0, np.power(2.0, anchor + (base - anchor) * (1 - k) + (l - base) * (1 + 1.2 * P["detail"])) - 1e-4)
        c = _toS(np.minimum(1.0, np.power(lin / np.maximum(Ll, 1e-6)[..., None], sc) * L2[..., None]))
    if abs(P["clarity"]) > 1e-4:
        Lc = _lum(_blur(rgb_im, BLUR_K["clarity"] * m))
        L = np.clip(_lum(c), 0, 1)
        c = _setL(c, L, L + P["clarity"] * 0.8 * (L - Lc) * (1 - (2 * L - 1) ** 2))
    if abs(P["light"]) > 1e-4:
        Lb = _lum(_blur(rgb_im, BLUR_K["light"] * m))
        L = np.clip(_lum(c), 0, 1)
        e = P["light"] * np.where(Lb < 0.5, 1.6, 0.6) * (0.5 - Lb)
        c = _setL(c, L, np.minimum(1.0, L * np.power(2.0, e)))
    if P["bright"]:
        c = np.power(np.maximum(c, 0.0), 2.0 ** -P["bright"])
    if P["high"] or P["shadow"]:
        L = np.clip(_lum(c), 0, 1)
        dL = np.zeros_like(L)
        if P["high"]:
            wh = _ss(0.45, 1.0, L)
            dL += P["high"] * 0.35 * wh * (1 - L) if P["high"] > 0 else P["high"] * 0.45 * wh * L
        if P["shadow"]:
            ws = 1 - _ss(0.0, 0.55, L)
            dL += P["shadow"] * 0.5 * ws * (1 - L) if P["shadow"] > 0 else P["shadow"] * 0.5 * ws * L
        c = _setL(c, L, L + dL)
    if P["white"] > 0:
        c = c / (1 - P["white"] * 0.15)
    elif P["white"] < 0:
        c = c * (1 + P["white"] * 0.15)
    if P["contrast"]:
        k = P["contrast"]
        if k > 0:
            u = np.clip(c, 0, 1)
            c = c + k * (u * u * (3 - 2 * u) - c) * 1.5
        else:
            c = c + k * (c - 0.5) * 0.7
    if P["black"] < 0:
        t = -P["black"] * 0.12
        c = (c - t) / (1 - t)
    elif P["black"] > 0:
        t = P["black"] * 0.25
        c = c * (1 - t) + t * _rgb01(a.get("bcolor"), COLORS["bcolor"])
    if P["sat"] or P["vib"]:
        L = _lum(c)[..., None]
        f = 1 + P["sat"]
        if P["vib"]:
            cr = np.clip(c.max(axis=-1) - c.min(axis=-1), 0, 1)[..., None]
            f = f * (1 + P["vib"] * (1 - cr) * 1.2)
        c = L + (c - L) * f
    if P["hue"]:
        th = math.radians(P["hue"])
        ch, sh = math.cos(th), math.sin(th)
        r, g, b = c[..., 0], c[..., 1], c[..., 2]
        Y = 0.299 * r + 0.587 * g + 0.114 * b
        I0 = 0.596 * r - 0.274 * g - 0.322 * b
        Q0 = 0.211 * r - 0.523 * g + 0.312 * b
        I, Q = I0 * ch - Q0 * sh, I0 * sh + Q0 * ch
        c = np.stack([Y + 0.956 * I + 0.621 * Q, Y - 0.272 * I - 0.647 * Q, Y - 1.106 * I + 1.703 * Q], axis=-1)
    if P["temp"]:
        c = c * np.array([1 + P["temp"] * 0.18, 1 + P["temp"] * 0.03, 1 - P["temp"] * 0.18], dtype=np.float32)
    if P["tint"]:
        c = c * np.array([1 + P["tint"] * 0.04, 1 - P["tint"] * 0.15, 1 + P["tint"] * 0.04], dtype=np.float32)
    if P["sgrade"] > 1e-4 or P["hgrade"] > 1e-4:
        L = np.clip(_lum(c), 0, 1)
        ws = (P["sgrade"] * 0.5 * (1 - _ss(0.0, 0.6, L)))[..., None]
        wh = (P["hgrade"] * 0.5 * _ss(0.4, 1.0, L))[..., None]
        c = c + ws * (_rgb01(a.get("scolor"), COLORS["scolor"]) - 0.5) + wh * (_rgb01(a.get("hcolor"), COLORS["hcolor"]) - 0.5)
    if P["glow"] > 1e-4:
        bg = _blur(rgb_im, BLUR_K["glow"] * m)
        c = 1 - (1 - np.clip(c, 0, 1)) * (1 - P["glow"] * (0.6 * bg + 0.15))
    if P["vignette"]:
        vx = (np.arange(W, dtype=np.float32) + 0.5) / W - 0.5
        vy = (np.arange(H, dtype=np.float32) + 0.5) / H - 0.5
        mv = _ss(0.3, 1.0, np.sqrt(vx[None, :] ** 2 + vy[:, None] ** 2) / 0.7071)[..., None]
        if P["vignette"] < 0:
            c = c * (1 + P["vignette"] * 0.85 * mv)
        else:
            k = P["vignette"] * 0.6 * mv
            c = c + k * (1 - c)
    if P["grain"] > 1e-4:
        c = c + ((_hash2(W, H) - 0.5) * P["grain"] * 0.22).astype(np.float32)[..., None]
    arr[..., :3] = np.clip(c, 0, 1)
    out = Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8), "RGBA")
    return out if mode == "RGBA" else out.convert(mode)
