"""パネル・画像編集・動画編集・画像の合成で入れた画像・動画を、生成パネルの保存先(output の中)に保存する。

input フォルダは使わない。保存先は「画像の保存先」「動画の保存先」(%date% などを置き換えたもののフォルダの部分)。
最近入れたものは user/default/cca_generator/uploads.json に覚え、画像の選択肢(入力画像1 など)に足す。
"""
import hashlib
import os
import re
import threading

import folder_paths

from .i18n import tr
from .prefix import prefix_folder
from .store import _read, _write

RECENT_FILE = "uploads.json"
MAX_RECENT = 300
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff")
MEDIA_EXTS = IMAGE_EXTS + (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac")
SUB_RE = re.compile(r"^[0-9A-Za-z_-]{1,40}$")
_lock = threading.Lock()


def _safe_name(name):
    base = os.path.basename(str(name or "").replace("\\", "/")) or "image.png"
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", base).strip().strip(".") or "image.png"
    stem, ext = os.path.splitext(base)
    return (stem[:120] or "image") + ext.lower()


def _digest(data):
    return hashlib.sha256(data).hexdigest()


def target_dir(prefix, sub=""):
    """(output の中の相対フォルダ, 実際のフォルダ)"""
    rel = prefix_folder(prefix)
    if sub:
        if not SUB_RE.match(sub):
            raise ValueError(tr("保存先のフォルダが不正です"))
        rel = f"{rel}/{sub}" if rel else sub
    base = os.path.abspath(folder_paths.get_output_directory())
    folder = os.path.abspath(os.path.join(base, rel))
    if os.path.commonpath([folder, base]) != base:
        raise ValueError(tr("保存先のフォルダが不正です"))
    return rel, folder


def save_upload(data, filename, prefix, sub=""):
    """保存して {filename, subfolder, type, value, path} を返す。同じ名前で同じ中身なら、それをそのまま使う"""
    if not data:
        raise ValueError(tr("ファイルが空です"))
    name = _safe_name(filename)
    if not name.lower().endswith(MEDIA_EXTS):
        raise ValueError(tr("画像・動画・音声のファイルではありません: {name}", name=name))
    rel, folder = target_dir(prefix, sub)
    with _lock:
        os.makedirs(folder, exist_ok=True)
        stem, ext = os.path.splitext(name)
        fname, n, h = name, 1, None
        while os.path.exists(os.path.join(folder, fname)):
            if h is None:
                h = _digest(data)
            try:
                with open(os.path.join(folder, fname), "rb") as f:
                    if _digest(f.read()) == h:
                        break  # 同じファイルをもう一度入れた
            except OSError:
                pass
            fname = f"{stem} ({n}){ext}"
            n += 1
        path = os.path.join(folder, fname)
        if not os.path.exists(path):
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        value = f"{rel}/{fname} [output]" if rel else f"{fname} [output]"
        recent = [v for v in _read(RECENT_FILE, {}).get("items", []) if isinstance(v, str) and v != value]
        _write(RECENT_FILE, {"items": [value] + recent[:MAX_RECENT - 1]})
    return {"filename": fname, "subfolder": rel, "type": "output", "value": value, "path": path}


def remember(value):
    """保存した画像(画像編集の保存など)を「最近の画像」に入れる。入力画像のプルダウンの選択肢に出る"""
    if not isinstance(value, str) or not value:
        return
    with _lock:
        recent = [v for v in _read(RECENT_FILE, {}).get("items", []) if isinstance(v, str) and v != value]
        _write(RECENT_FILE, {"items": [value] + recent[:MAX_RECENT - 1]})


def recent_images():
    """最近入れた画像(まだあるもの)。新しい順"""
    out = []
    for v in _read(RECENT_FILE, {}).get("items", []):
        if not isinstance(v, str) or not v.lower().split(" [")[0].endswith(IMAGE_EXTS):
            continue
        try:
            if os.path.isfile(folder_paths.get_annotated_filepath(v)):
                out.append(v)
        except Exception:  # noqa: BLE001
            pass
    return out
