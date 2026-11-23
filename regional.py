"""マイナス重み 相当 / 領域プロンプト 相当の機能(独自実装。外部の AGPL コードは使っていません)。

仕組みは公開されている機能の説明だけを参考にし、ComfyUI の標準 API(モデルの複製・
モデル関数ラッパー・attn2 パッチ)で組み立てています。キュー投入時に split.py が
CCAGenAdv ノードをモデルの出力の後ろに挟みます。無効なときは何も挟まない(今まで通り)。

マイナス重み 相当: プロンプト中の (単語:-1.0) を取り出し、その概念のテキスト埋め込みをクロスアテンションの
  文脈に足して、Value に負の重みを掛ける(UNet 系: SD1.5 / SDXL / Illustrious)。
  DiT 系(Anima / MOSS / Krea2 / FLUX.2 / FLUX.3)は Value だけを書き換えられないため、埋め込みの符号を反転して足す
  実験的な方式。モデルごとの検証が必要です。
領域プロンプト 相当: 枠(四角・円・三角)で指定した領域ごとの条件でノイズ予測を計算し、マスクで合成する(Latent 方式)。
  枠の外は通常のプロンプトで生成する。
"""
import json
import math
import logging
import re

import torch

import nodes as comfy_nodes

ADV_BASES = ("Anima", "MOSS", "Krea2", "Illustrious", "FLUX.3", "FLUX.2", "SDXL", "SD1.5")
UNET_BASES = ("Illustrious", "SDXL", "SD1.5")
TURBO_GAIN = 3.0  # 通常版 MOSS の既定 CFG(T2I)。CFG が無い Turbo の打ち消しに掛ける倍率
# --- 共通の設定(全モデルで同じ項目。モデルごとの「おすすめ」はこの値の組) ---
PRESET_REC, PRESET_CUSTOM = "おすすめ", "自分の設定"
METHOD_AUTO = "自動(モデルに合わせる)"
METHOD_VALUE = "Value に負の重みを掛ける(UNet 系だけ)"
METHOD_DIFF = "予測の差を引く"
FEATHER_DEFAULT, MARGIN_DEFAULT = 3.0, 8
# おすすめ設定として選べる項目(マイナスプロンプトと範囲別指定は、それぞれ別のおすすめ設定を持つ)
NEGW_PRESET_KEYS = ("negw_method", "negw_strength", "negw_turbo_gain")
REGIONAL_PRESET_KEYS = ("regional_common", "regional_switch", "regional_feather", "regional_margin")
PRESET_KEYS = {"negw": NEGW_PRESET_KEYS, "regional": REGIONAL_PRESET_KEYS}
# 生成情報(履歴・PNGinfo)に入れて、あとから戻せる項目(オンオフ + 数値。おすすめ設定の選択は入れず、実際の値だけ。マイナスプロンプトと範囲別指定は別々)
NEGW_META_KEYS = ("negw_enable",) + NEGW_PRESET_KEYS
REGIONAL_META_KEYS = ("regional_enable", "layout_native") + REGIONAL_PRESET_KEYS


def _f(v, d):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(d)


def adv_presets():
    """モデルの種別ごとの「おすすめ」(今までの既定の動きをそのまま再現する値の組)。{種別: {"negw": {...}, "regional": {...}}}"""
    from .specs import TYPE_INFO
    return {mt: {"negw": {"negw_method": METHOD_VALUE if is_unet(mt) else METHOD_DIFF, "negw_strength": 1.0,
                          "negw_turbo_gain": TURBO_GAIN},
                 "regional": {"regional_common": False, "regional_switch": 100,
                              "regional_feather": FEATHER_DEFAULT, "regional_margin": MARGIN_DEFAULT}}
            for mt in TYPE_INFO if adv_supported(mt, "T2I")}


_NEG = re.compile(r"\(([^()]*?):\s*(-\d+(?:\.\d+)?|-\.\d+)\s*\)")


def adv_supported(model_type, task):
    if task != "T2I":
        return False
    mt = str(model_type or "")
    return any(mt == b or mt.startswith(b + " ") for b in ADV_BASES)


def is_unet(model_type):
    mt = str(model_type or "")
    return any(mt == b for b in UNET_BASES)


def extract_negw(text):
    """(単語:-1.0) を取り出す。戻り値 = (負の重みの部分を除いた文, [(単語, 重みの大きさ)])"""
    terms = []

    def take(m):
        word = m.group(1).strip()
        if word:
            terms.append((word, abs(float(m.group(2)))))
        return ""
    out = _NEG.sub(take, str(text or ""))
    out = re.sub(r"\s*,(\s*,)+", ",", out)
    out = re.sub(r"^\s*,\s*|\s*,\s*$", "", out)
    return out, terms


def strip_boxes(value):
    """枠(layout_boxes の JSON)の説明・文字に書いた (単語:-1.0) も取り出す → (JSON, 取り出した語)"""
    try:
        data = json.loads(value) if isinstance(value, str) and value.strip() else None
    except ValueError:
        return value, []
    if not isinstance(data, dict) or not isinstance(data.get("boxes"), list):
        return value, []
    terms = []
    for b in data["boxes"]:
        if isinstance(b, dict):
            for k in ("desc", "text"):
                if isinstance(b.get(k), str):
                    b[k], t = extract_negw(b[k])
                    terms += t
    return json.dumps(data, ensure_ascii=False), terms


def _build_config(inputs, model_type, task, positive, negative, boxes=""):
    """パネルの設定 → CCAGenAdv の設定(JSON 文字列)と、負の重みを除いた Positive。無効なら (None, positive)

    範囲別指定は「枠」だけで指定する。「範囲別指定を使う」にチェックがあるときだけ、枠を領域として使う
    (チェックが無ければ枠があっても領域にしない。専用の枠があるモデル = MOSS / FLUX.3 は、従来どおり枠をレイアウトとして使う)。
    枠の外(どの枠にも入っていない部分)は、通常のプロンプトで生成する。"""
    if not adv_supported(model_type, task):
        return None, positive, boxes
    cfg, pos = {}, positive
    if inputs.get("negw_enable"):
        pos, terms = extract_negw(positive)
        boxes, bterms = strip_boxes(boxes)
        terms += bterms
        if terms:
            cfg["negw"] = {"text": ", ".join(t for t, _ in terms),
                             "weight": sum(w for _, w in terms) / len(terms) * float(inputs.get("negw_strength", 1.0)),
                             "base": pos, "neg": str(negative or ""),
                             "unet": is_unet(model_type) and str(inputs.get("negw_method") or "").strip() != METHOD_DIFF,
                             "gain": max(0.0, _f(inputs.get("negw_turbo_gain"), TURBO_GAIN))}
    from .layout import parse_boxes
    boxes_obj = [b for b in (parse_boxes(boxes) if boxes else []) if b["desc"]]
    if inputs.get("regional_enable"):
        if not boxes_obj:
            print("[CCA Generator] 範囲別指定: 何か書いた枠がありません"
                  "(「▭ 枠で配置を指定する」で範囲を描き、枠ごとに描きたいものを書いてください)")
        else:
            from .specs import layout_kind
            cfg["regional"] = {
                "rects": [(b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]) for b in boxes_obj],
                "shapes": [{"shape": b["shape"], "fx": b["fx"], "fy": b["fy"], "rot": b.get("rot", 0)} for b in boxes_obj],
                "prompts": [b["desc"] for b in boxes_obj],
                "negatives": [],
                "switch": max(0.0, min(100.0, float(inputs.get("regional_switch", 100) or 0))) / 100.0,
                "feather": max(0.5, _f(inputs.get("regional_feather"), FEATHER_DEFAULT)),
                "margin": max(0, int(_f(inputs.get("regional_margin"), MARGIN_DEFAULT))),
                "common": bool(inputs.get("regional_common", False)),  # 既定は付けない(通常のプロンプトは枠の外を担当)
                "pos": pos, "neg": str(negative or ""),
            }
    return (json.dumps(cfg) if cfg else None), pos, boxes


# ---------------------------------------------------------------------------
def _encode(clip, text):
    """CLIPTextEncode と同じ方法で 1 つの文を条件にする → (埋め込み, 付属の辞書)
    (コアの CLIPTextEncode は版によって旧形式 / V3 形式なので、呼び出し方に依らない方法で行う)"""
    try:
        cls = comfy_nodes.NODE_CLASS_MAPPINGS["CLIPTextEncode"]
        res = getattr(cls(), cls.FUNCTION)(clip=clip, text=text)
        res = res.result if hasattr(res, "result") else res
        cond = res[0]
    except Exception:  # noqa: BLE001  直接エンコードする
        cond = clip.encode_from_tokens_scheduled(clip.tokenize(text))
    return cond[0][0], cond[0][1]


def _fit(t, length, zero):
    """トークン方向(dim 1)を length に揃える(zero=True なら 0 埋め、False なら繰り返し)"""
    n = t.shape[1]
    if n == length:
        return t
    if n > length:
        return t[:, :length]
    if zero:
        pad = torch.zeros((t.shape[0], length - n, *t.shape[2:]), dtype=t.dtype, device=t.device)
        return torch.cat([t, pad], dim=1)
    reps = -(-length // n)
    return torch.cat([t] * reps, dim=1)[:, :length]


def _poly(shape, fx, fy):
    """三角の頂点(0〜1 の枠の中。三角1 = 直角二等辺・直角は左上 / 三角2 = 直角は右上で 30°・60° / 三角3 = 正三角形・頂点は上)"""
    # 三角1 = 枠の角に 3 つ(直角三角形) / 三角2 = 角に 2 つ(2 辺が同じ) / 三角3 = 角に 1 つ(どの辺も違う)。枠の縦横比は自由
    pts = {"tri1": [(0, 0), (1, 0), (0, 1)], "tri2": [(0, 1), (1, 1), (0.5, 0)],
           "tri3": [(0, 1), (0.75, 0), (1, 0.45)]}.get(shape)
    if not pts:
        return None
    return [((1 - px) if fx else px, (1 - py) if fy else py) for px, py in pts]


def _rot_bbox(rect, rot, h, w):
    """回転した枠を含む範囲(0〜1 の割合)。回転は画素の上で行う"""
    rot = float(rot or 0)
    if not rot:
        return rect
    x0, y0, x1, y1 = rect
    cx, cy, hw, hh = (x0 + x1) / 2 * w, (y0 + y1) / 2 * h, (x1 - x0) / 2 * w, (y1 - y0) / 2 * h
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    xs = [cx + dx * c - dy * s for dx in (-hw, hw) for dy in (-hh, hh)]
    ys = [cy + dx * s + dy * c for dx in (-hw, hw) for dy in (-hh, hh)]
    return (max(0.0, min(xs) / w), max(0.0, min(ys) / h), min(1.0, max(xs) / w), min(1.0, max(ys) / h))


def _make_mask(rect, x, like, shape=None, feather=3.0):
    """領域のマスク。x の空間(最後の 2 次元)に合わせる。縁は少しぼかす(画像の端はぼかさない)。
    shape = {"shape": rect / circle / tri1 / tri2 / tri3, "fx", "fy"}(三角の反転)。
    Anima のような 5 次元(B,C,T,H,W)の潜在にも使える"""
    h, w = x.shape[-2], x.shape[-1]
    x0, y0, x1, y1 = rect
    kind = (shape or {}).get("shape", "rect")
    shp = (1, 1) + (1,) * (x.dim() - 4) + (h, w)
    rot = float((shape or {}).get("rot") or 0)
    if kind in ("circle", "tri1", "tri2", "tri3") or rot:
        ys = (torch.arange(h, dtype=torch.float32, device=like.device) + 0.5)[:, None].expand(h, w)
        xs = (torch.arange(w, dtype=torch.float32, device=like.device) + 0.5)[None, :].expand(h, w)
        bx0, bx1, by0, by1 = x0 * w, x1 * w, y0 * h, y1 * h
        if rot:  # 枠の中心まわりに回転した枠 = 回転を戻した座標で、回転していない枠として判定する
            c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
            mx, my = (bx0 + bx1) / 2, (by0 + by1) / 2
            xs, ys = mx + (xs - mx) * c + (ys - my) * s, my - (xs - mx) * s + (ys - my) * c
        if kind == "rect":
            d = torch.minimum(torch.minimum(xs - bx0, bx1 - xs), torch.minimum(ys - by0, by1 - ys))
            return ((d + 0.5) / feather).clamp(0, 1).to(like.dtype).reshape(shp)
        if kind == "circle":
            rx, ry = max((bx1 - bx0) / 2, 0.5), max((by1 - by0) / 2, 0.5)
            d = (((xs - (bx0 + bx1) / 2) / rx) ** 2 + ((ys - (by0 + by1) / 2) / ry) ** 2).sqrt()
            m = ((1 - d) * min(rx, ry) / feather).clamp(0, 1)
        else:
            pts = [(bx0 + px * (bx1 - bx0), by0 + py * (by1 - by0))
                   for px, py in _poly(kind, bool(shape.get("fx")), bool(shape.get("fy")))]
            cx, cy = sum(p[0] for p in pts) / 3, sum(p[1] for p in pts) / 3
            m = torch.ones_like(xs)
            for i in range(3):
                (ax, ay), (bx, by) = pts[i], pts[(i + 1) % 3]
                if (ax == bx and ax in (0.0, float(w))) or (ay == by and ay in (0.0, float(h))):
                    continue  # 画像の端に沿った辺はぼかさない
                ex, ey = bx - ax, by - ay
                ln = max((ex * ex + ey * ey) ** 0.5, 1e-6)
                sgn = 1.0 if ((cx - ax) * ey - (cy - ay) * ex) * (1.0) > 0 else -1.0
                dist = sgn * ((xs - ax) * ey - (ys - ay) * ex) / ln  # 辺から内側への距離(画素)
                m = torch.minimum(m, ((dist + 0.5) / feather).clamp(0, 1))
        return m.to(like.dtype).reshape(shp)

    def axis(n, a, b):
        i = torch.arange(n, dtype=torch.float32, device=like.device) + 0.5
        lo = ((i - a) / feather).clamp(0, 1) if a > 0.5 else torch.ones_like(i)
        hi = ((b - i) / feather).clamp(0, 1) if b < n - 0.5 else torch.ones_like(i)
        return lo * hi
    m = axis(h, y0 * h, y1 * h)[:, None] * axis(w, x0 * w, x1 * w)[None, :]
    return m.to(like.dtype).reshape(shp)


def build_config(inputs, model_type, task, positive, negative, boxes=""):
    """_build_config + 専用の枠の書き方があるモデル(MOSS / FLUX.3)は、「枠を配置の指定として使う」にチェックがあるときだけ、枠をプロンプトの配置に使う
    (範囲別指定を使うときは、枠は領域になり、配置の指定にもなる。どちらもオフなら、枠が残っていても何も起きない)"""
    cfg, pos, bx = _build_config(inputs, model_type, task, positive, negative, boxes)
    from .specs import layout_kind
    if layout_kind(model_type, task) in ("moss", "flux3") and not (inputs.get("regional_enable") or inputs.get("layout_native")):
        bx = ""  # 範囲別指定も「枠を配置の指定として使う」もオフなら、枠が残っていても何も起きない
    return cfg, pos, bx


def _crop_box(rect, h, w, mult=8, margin=8, minsz=16):
    """領域を含む切り出しの範囲(潜在の画素。端は 8 の倍数にそろえ、周りに少し余白を付ける)→ (y0, y1, x0, x1)"""
    def axis(a, b, total):
        lo, hi = int(a * total) - margin, -int(-b * total // 1) + margin
        lo, hi = max(0, lo // mult * mult), min(total, -(-hi // mult) * mult)
        if hi - lo < minsz:  # 小さい領域は広げる
            hi = min(total, lo + minsz)
            lo = max(0, hi - minsz)
        return lo, hi
    x0, x1 = axis(rect[0], rect[2], w)
    y0, y1 = axis(rect[1], rect[3], h)
    return y0, y1, x0, x1


# モデルが実際に使うのは、モデル側(extra_conds)で変換した後の条件。Anima は LLM アダプタを通した後の埋め込みなど、
# エンコーダーの出力そのままでは使えないモデルがあるので、必ずモデルの変換を通す
TEXT_KEYS = ("c_crossattn", "y", "attention_mask", "t5xxl_ids", "t5xxl_weights")
FIT_KEYS = ("c_crossattn", "attention_mask", "t5xxl_ids", "t5xxl_weights")


def _text_conds(base, x, enc):
    """(埋め込み, 付属の辞書) → モデルが実際に受け取る形の文の条件 {キー: テンソル(バッチ 1)}"""
    emb, extra = enc
    params = dict(extra or {})
    params.update(cross_attn=emb, device=x.device, noise=x, prompt_type="positive")
    params.setdefault("width", x.shape[-1] * 8)
    params.setdefault("height", x.shape[-2] * 8)
    try:
        out = base.extra_conds(**params)
        res = {}
        for k in TEXT_KEYS:
            v = out.get(k) if hasattr(out, "get") else None
            t = getattr(v, "cond", v)
            if torch.is_tensor(t):
                res[k] = t
        if "c_crossattn" in res:
            return res
    except Exception:  # noqa: BLE001  変換できなければエンコーダーの出力をそのまま使う(UNet 系ならこれで動く)
        logging.exception("[CCA Generator] 文の条件をモデルの形に変換できませんでした(エンコーダーの出力をそのまま使います)")
    res = {"c_crossattn": emb}
    if "attention_mask" in (extra or {}):
        res["attention_mask"] = extra["attention_mask"]
    return res


def _take(t, like, n):
    return t.to(device=like.device, dtype=like.dtype).expand(n, *t.shape[1:])


class CCAGenAdv:
    CATEGORY = "cca_generator/internal"
    FUNCTION = "run"
    DESCRIPTION = "マイナス重み 相当 / 領域プロンプト 相当の処理をモデルに組み込む内部ノード(キュー投入時に自動で使われます)。"
    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"model": ("MODEL",), "clip": ("CLIP",), "cfg": ("STRING", {"default": "{}"})}}

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def run(self, model, clip, cfg):
        c = json.loads(cfg or "{}")
        neg, reg = c.get("negw"), c.get("regional")
        if not neg and not reg:
            return (model,)
        m = model.clone()
        base = m.model
        state = {"failed": False, "mode": None}
        enc_neg = _encode(clip, neg["text"]) if neg else None
        w = float(neg["weight"]) if neg else 0.0
        gain_t = float(neg.get("gain", TURBO_GAIN)) if neg else TURBO_GAIN
        feather = float(reg.get("feather", FEATHER_DEFAULT)) if reg else FEATHER_DEFAULT
        margin = int(reg.get("margin", MARGIN_DEFAULT)) if reg else MARGIN_DEFAULT
        unet = bool(neg and neg["unet"])
        if unet:
            count = enc_neg[0].shape[1]

            def attn2(q, k, v, extra):
                cu = extra.get("cond_or_uncond")
                if not cu or v.shape[1] < count or v.shape[0] % len(cu):
                    return q, k, v
                v = v.clone()
                n = v.shape[0] // len(cu)
                for i, t in enumerate(cu):  # 条件側は -w、無条件側は 0(負の概念を足さない)
                    v[i * n:(i + 1) * n, -count:] *= (-w if t == 0 else 0.0)
                return q, k, v
            m.set_model_attn2_patch(attn2)
            state["mode"] = "unet"
        elif neg:
            # DiT 系: 「プロンプト」と「プロンプト + 打ち消したい語」の予測の差を、プロンプトの予測から引く
            # (その語を足したときに増える分だけを引くので、語以外の部分は壊れない。CFG が無い Turbo でも効く)
            state["mode"] = "sub"
            enc_pc = _encode(clip, ", ".join(t for t in (neg.get("base", ""), neg["text"]) if t))
            # CFG がある場合: 無条件側の文に打ち消したい語を足した予測との差を使う(語が文に含まれていても効く)
            enc_nu = _encode(clip, ", ".join(t for t in (neg.get("neg", ""), neg["text"]) if t))
        regions = []
        if reg:
            for i, rect in enumerate(reg["rects"]):
                seg = reg["prompts"][i] if i < len(reg["prompts"]) else ""
                text = ", ".join(s for s in ((reg["pos"] if reg["common"] else ""), seg) if s)
                if not text:
                    regions.append(None)
                    continue
                nseg = reg["negatives"][i] if i < len(reg["negatives"]) else ""
                ntext = ", ".join(s for s in (reg["neg"], nseg) if s) if nseg else None
                sub_neg = bool(neg) and not unet
                regions.append({"rect": rect, "shape": (reg.get("shapes") or [None] * (i + 1))[i],
                                "pos": _encode(clip, text),
                                "neg": _encode(clip, ntext) if ntext else None,
                                # マイナスプロンプトも使うとき、領域の中でも同じ打ち消しを行う
                                "nu": _encode(clip, ", ".join(t for t in (reg["neg"], nseg, neg["text"]) if t)) if sub_neg else None,
                                "pc": _encode(clip, ", ".join(t for t in (text, neg["text"]) if t)) if sub_neg else None})
        cache = {}
        pct_cfg = (reg or {}).get("switch", 1.0)
        try:
            pct_cfg = float(pct_cfg)
        except (TypeError, ValueError):
            pct_cfg = 1.0
        if pct_cfg > 1.0:  # 0〜100 の % のまま渡された場合も受け付ける
            pct_cfg /= 100.0
        pct_cfg = max(0.0, min(1.0, pct_cfg))

        def early_phase(t, to):
            """「枠の中に収める強さ」: 100% = ずっと枠の範囲だけを見て描く / 0% = 最初から全体を見て描く /
            間 = 全ステップのうち前半(その割合)だけ枠の範囲を見る。切り替えの位置は、生成中の実際のステップ列
            (sample_sigmas)から決める(他のノードで shift などを変えても合う)。取れなければモデルの sampling から取る。"""
            if pct_cfg >= 1.0:
                return True
            if pct_cfg <= 0.0:
                return False
            ts = float(t.flatten()[0])
            thr = None
            sig = (to or {}).get("sample_sigmas")
            try:
                if sig is not None and len(sig) > 1:
                    # 最後の 0 を除いたステップ列の、割合の位置のステップまでが「前半」
                    n = max(len(sig) - 1, 1)
                    idx = min(int(round(pct_cfg * n)) - 1, n - 1)
                    thr = None if idx < 0 else float(sig[idx])
                    if idx < 0:
                        return False
            except Exception:  # noqa: BLE001
                thr = None
            if thr is None:
                if "thr" not in state:
                    try:
                        state["thr"] = float(base.model_sampling.percent_to_sigma(pct_cfg))
                    except Exception:  # noqa: BLE001
                        state["thr"] = None
                        logging.warning("[CCA Generator] 枠の中に収める強さ: 切り替えの位置を取れないので、ずっと枠の範囲だけを見て描きます")
                thr = state["thr"]
                if thr is None:
                    return True
            return ts >= thr * (1.0 - 1e-4) - 1e-6

        def conds(x, key, enc):
            """文の条件をモデルの形に変換して覚えておく(毎ステップ変換しない)"""
            if key not in cache:
                cache[key] = _text_conds(base, x, enc)
            return cache[key]

        def with_neg(cc, cu, n, x):
            """UNet 系の打ち消し: 文脈の最後に負の概念の埋め込みを足す(Value は attn2 パッチで負の重みにする)"""
            ctx = cc["c_crossattn"]
            add = enc_neg[0].to(ctx.device, ctx.dtype).expand(ctx.shape[0], -1, -1)
            out = dict(cc)
            out["c_crossattn"] = torch.cat([ctx, add], 1)
            return out

        def swap(cc, cu, n, pos, negsrc):
            """条件側を pos、無条件側を negsrc(None なら元のまま)の文の条件に差し替えた c を作る"""
            rc = dict(cc)
            for key in TEXT_KEYS:
                ref = cc.get(key)
                if ref is None or not torch.is_tensor(ref):
                    continue
                parts = []
                for i, tp in enumerate(cu):
                    src = pos if tp == 0 else negsrc
                    parts.append(_take(src[key], ref, n) if src is not None and key in src
                                 else ref[i * n:(i + 1) * n])
                if key in FIT_KEYS and parts[0].dim() >= 2:
                    length = max(p.shape[1] for p in parts)
                    zero = key != "c_crossattn" or cc.get("attention_mask") is not None
                    parts = [_fit(p, length, zero) for p in parts]
                rc[key] = torch.cat(parts, 0)
            return rc

        def body(x, cc, cu, run, t, to, n, aug, tur):
            """aug=True: 無条件側の文に打ち消したい語を足して予測する(CFG あり。領域の中も同じ)。
            tur=True: CFG が無い Turbo 系。領域ごとに「領域の文」と「領域の文 + 語」の差を引く"""
            use_tok = state["mode"] == "unet"
            if aug:
                out = run(swap(cc, cu, n, None, conds(x, ("nu",), enc_nu)))
            else:
                out = run(with_neg(cc, cu, n, x) if use_tok else cc)
            base_out = out.clone() if (any(regions) and state["mode"] == "sub") else out
            if any(regions) and x.dim() >= 4:
                H, W = x.shape[-2], x.shape[-1]
                # 枠の中に収める強さ(設定の %): 100 = 最後まで領域の範囲だけを見て描く / 0 = 最初から画像全体を見て描く / 間 = 前半だけ領域の範囲
                early = early_phase(t, to) if t is not None else True
                for j, r in enumerate((r for r in regions if r)):
                    # その領域を切り出した小さい絵として、領域のプロンプトで予測する(物がその領域の中に収まる)
                    # 前半(配置が決まる段階)だけ切り出す。後半(細部を仕上げる段階)は全体の大きさで予測して、粗くならないようにする
                    y0, y1, x0, x1 = _crop_box(_rot_bbox(r["rect"], (r.get("shape") or {}).get("rot", 0), H, W), H, W, margin=margin) if early else (0, H, 0, W)
                    xc = x[..., y0:y1, x0:x1]
                    if aug and r.get("nu"):
                        negsrc = conds(xc, ("na", j, early), r["nu"])
                    else:
                        negsrc = conds(xc, ("n", j, early), r["neg"]) if r["neg"] else None

                    def region_run(enc, key):
                        sw = swap(cc, cu, n, conds(xc, (key, j, early), enc), negsrc)
                        rc = {k: (v[..., y0:y1, x0:x1] if torch.is_tensor(v) and v.dim() >= 4 and v.shape[-2:] == (H, W) else v)
                              for k, v in sw.items()}
                        return run(with_neg(rc, cu, n, xc) if use_tok else rc, xc)
                    out_c = region_run(r["pos"], "p")
                    if tur and r.get("pc"):
                        out_c2 = region_run(r["pc"], "pr")
                        for i, tp in enumerate(cu):
                            if tp == 0:
                                sl = slice(i * n, (i + 1) * n)
                                out_c[sl] = out_c[sl] - w * gain_t * (out_c2[sl] - out_c[sl])
                    full = out.clone()
                    full[..., y0:y1, x0:x1] = out_c
                    mask = _make_mask(r["rect"], x, out, r.get("shape"), feather)
                    out = out * (1 - mask) + full * mask
            return out, base_out

        def compute(x, cc, cu, run, t=None, to=None):
            n = x.shape[0] // len(cu)
            sub = state["mode"] == "sub"
            if sub and 1 in cu and 0 in cu:
                # CFG あり: 通常の予測と、無条件側に語を足した予測を作り、無条件側だけを w の割合で動かす
                out, _ = body(x, cc, cu, run, t, to, n, False, False)
                out_a, _ = body(x, cc, cu, run, t, to, n, True, False)
                for i, tp in enumerate(cu):
                    if tp == 1:
                        sl = slice(i * n, (i + 1) * n)
                        out[sl] = out[sl] + w * (out_a[sl] - out[sl])
                return out
            out, base_out = body(x, cc, cu, run, t, to, n, False, sub and 0 in cu)
            if sub and 0 in cu:
                pc = conds(x, ("pc",), enc_pc)
                out_pc = run(swap(cc, cu, n, pc, None))
                # CFG が無い Turbo 系(条件側だけ)は増幅が無いので、通常版 MOSS の既定 CFG と同じ倍率を掛けて効き方を揃える
                gain = gain_t
                mu = None
                if any(regions) and x.dim() >= 4:  # 領域の中は領域ごとに処理済み。ここは領域の外だけ
                    mu = torch.zeros_like(out_pc[:1, :1])
                    for r in (r for r in regions if r):
                        mu = torch.maximum(mu, _make_mask(r["rect"], x, out, r.get("shape"), feather).to(mu.dtype))
                    mu = 1 - mu
                for i, tp in enumerate(cu):
                    if tp == 0:
                        sl = slice(i * n, (i + 1) * n)
                        d = w * gain * (out_pc[sl] - base_out[sl])
                        out[sl] = out[sl] - (d if mu is None else d * mu)
            return out

        def guarded(x, cc, cu, run, t=None, to=None):
            if state["failed"] or not cu or cc.get("c_crossattn") is None or x.shape[0] % len(cu):
                return run(cc)
            try:
                return compute(x, cc, cu, run, t, to)
            except Exception:  # noqa: BLE001  このモデルでは組み込めない → 以降は何もしない(通常の生成)
                state["failed"] = True
                logging.exception("[CCA Generator] マイナスプロンプト / 領域別 の処理に失敗したので、通常の生成にします")
                return run(cc)

        installed = None
        try:  # 第1候補: キー付きのラッパー(ほかのノードがモデル関数のラッパーを上書きしても消えない)
            from comfy.patcher_extension import WrappersMP

            def apply_wrapper(executor, x, t, c_concat=None, c_crossattn=None, control=None,
                              transformer_options=None, *args, **kw):
                if args:
                    return executor(x, t, c_concat, c_crossattn, control, transformer_options, *args, **kw)
                cu = (transformer_options or {}).get("cond_or_uncond")
                cc = dict(kw, c_concat=c_concat, c_crossattn=c_crossattn, control=control)

                def run(c2, xx=None):
                    c2 = dict(c2)
                    return executor(x if xx is None else xx, t, c2.pop("c_concat", None), c2.pop("c_crossattn", None),
                                    c2.pop("control", None), transformer_options, **c2)
                return guarded(x, cc, cu, run, t, transformer_options)
            m.add_wrapper_with_key(WrappersMP.APPLY_MODEL, "cca_adv", apply_wrapper)
            installed = "APPLY_MODEL"
        except Exception:  # noqa: BLE001  古い ComfyUI: モデル関数のラッパーで行う
            prev = m.model_options.get("model_function_wrapper")

            def wrapper(apply_model, args):
                x, t, cc, cu = args["input"], args["timestep"], dict(args["c"]), args["cond_or_uncond"]

                def run(c2, xx=None):
                    xi = x if xx is None else xx
                    if prev is not None:
                        return prev(apply_model, {"input": xi, "timestep": t, "c": c2, "cond_or_uncond": cu})
                    return apply_model(xi, t, **c2)
                return guarded(x, cc, cu, run, t, cc.get("transformer_options"))
            m.set_model_unet_function_wrapper(wrapper)
            installed = "model_function_wrapper"
        return (m,)
