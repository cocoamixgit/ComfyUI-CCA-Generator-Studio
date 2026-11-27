"""LoRA の詳細(ⓘ)。.safetensors の先頭に書かれている説明(メタデータ)と、隣の同名 .json のメモを読んで返す。

safetensors の形式: 先頭 8 バイト = 見出しの長さ(little-endian)、続けて JSON の見出し。その中の "__metadata__" に学習時の情報が入る。
中身(重み)は読まない。
"""
import json
import os
import struct

HEADER_MAX = 64 * 1024 * 1024  # 見出しの上限(これより大きいものは読まない)
_KEYS = (  # (メタデータのキー, 表示名)。表示名は日本語で、画面側で訳す
    ("modelspec.title", "名前"), ("ss_output_name", "出力名"), ("modelspec.architecture", "種類"),
    ("ss_base_model_version", "ベースモデル"), ("ss_sd_model_name", "学習に使ったモデル"),
    ("ss_network_module", "ネットワーク"), ("ss_network_dim", "次元(dim)"), ("ss_network_alpha", "alpha"),
    ("ss_resolution", "解像度"), ("ss_num_train_images", "学習画像の数"), ("ss_epoch", "エポック"),
    ("modelspec.author", "作者"), ("modelspec.date", "日付"),
)


def _clip(v, n=1200):
    s = str(v)
    return s if len(s) <= n else s[:n] + "…"


def _read_header(path):
    with open(path, "rb") as f:
        raw = f.read(8)
        if len(raw) < 8:
            return {}
        (n,) = struct.unpack("<Q", raw)
        if n <= 0 or n > HEADER_MAX:
            return {}
        data = f.read(n)
    meta = (json.loads(data.decode("utf-8")) or {}).get("__metadata__") or {}
    return meta if isinstance(meta, dict) else {}


def _top_tags(meta, limit=40):
    """学習に使ったタグの回数(ss_tag_frequency)を、多い順にまとめる"""
    try:
        freq = json.loads(meta.get("ss_tag_frequency") or "{}")
    except (TypeError, ValueError):
        return []
    total = {}
    for tags in freq.values():
        if isinstance(tags, dict):
            for t, c in tags.items():
                try:
                    total[str(t).strip()] = total.get(str(t).strip(), 0) + int(c)
                except (TypeError, ValueError):
                    pass
    return [[t, c] for t, c in sorted(total.items(), key=lambda x: -x[1])[:limit] if t]


def _sidecar(path):
    """隣の <名前>.json(説明・トリガーワード・メモ)。無ければ空"""
    p = os.path.splitext(path)[0] + ".json"
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(d, dict):
        return {}
    out = {}
    for src, dst in (("activation text", "words"), ("sd version", "base"), ("description", "description"), ("notes", "notes"),
                     ("preferred weight", "weight")):
        v = d.get(src)
        if v not in (None, "", 0):
            out[dst] = _clip(v, 4000)
    return out


def info(path):
    st = os.stat(path)
    out = {"size": st.st_size, "mtime": int(st.st_mtime), "meta": [], "tags": [], **_sidecar(path)}
    if path.lower().endswith(".safetensors"):
        try:
            meta = _read_header(path)
        except (OSError, ValueError, struct.error):
            meta = {}
        out["meta"] = [[label, _clip(meta[k], 300)] for k, label in _KEYS if meta.get(k) not in (None, "")]
        out["tags"] = _top_tags(meta)
        if meta.get("modelspec.description") and "description" not in out:
            out["description"] = _clip(meta["modelspec.description"], 4000)
    return out
