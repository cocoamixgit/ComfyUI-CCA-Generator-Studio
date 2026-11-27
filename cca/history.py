"""動画編集・画像編集の一時保存(作業の途中を残して、あとで開き直す)。

保存先: <ComfyUI>/user/default/cca_generator/edit_history/<video|image>/<id>/
  meta.json   名前・自動か手動か・元のファイル名・日時・中身の概要
  data.json   編集の中身(動画: プロジェクト / 画像: 文字のレイヤーなど)
  thumb.jpg   一覧に出す小さな絵(無くてもよい)
  img.png     画像編集(第23版まで): 今の画像(文字はまだ描き込んでいない)
  orig.png    画像編集(第23版まで): 開いたときの画像(「戻すブラシ」で使う)
  L<id>.png / L<id>_o.png  画像編集(第24版から): レイヤーの画像ごとに、今の画素と開いたときの画素

自動保存は、編集画面を開いている間 1 つの項目を上書きしていく(閉じたとき・数分ごと)。
自動保存は新しい方から MAX_AUTO 件だけ残す。名前を付けた(手動の)ものは消すまで残す。
"""
import json
import os
import re
import shutil
import threading
import time
import uuid

from .i18n import tr
from .store import _base_dir

KINDS = ("video", "image")
FILES = ("thumb.jpg", "img.png", "orig.png")
LAYER_RE = re.compile(r"^L\d{1,9}(_o)?\.png$")
MAX_LAYER_FILES = 400
MAX_AUTO = 10
MAX_NAME = 80
MAX_DATA = 8 * 1024 * 1024
ID_RE = re.compile(r"^[0-9A-Za-z_-]{6,64}$")
_lock = threading.Lock()


def root(kind):
    if kind not in KINDS:
        raise ValueError(tr("一時保存の種類が不正です"))
    d = os.path.join(_base_dir(), "edit_history", kind)
    os.makedirs(d, exist_ok=True)
    return d


def _dir(kind, hid):
    if not ID_RE.match(str(hid or "")):
        raise ValueError(tr("一時保存が見つかりません"))
    return os.path.join(root(kind), hid)


def new_id():
    return time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]


def _read_meta(d):
    try:
        with open(os.path.join(d, "meta.json"), "r", encoding="utf-8") as f:
            m = json.load(f)
        return m if isinstance(m, dict) else None
    except Exception:
        return None


def _write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def _write_bytes(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _size(d):
    n = 0
    for name in os.listdir(d):
        try:
            n += os.path.getsize(os.path.join(d, name))
        except OSError:
            pass
    return n


def _entry(kind, d):
    m = _read_meta(d)
    if not m:
        return None
    hid = os.path.basename(d)
    return {"id": hid, "kind": kind, "name": str(m.get("name") or ""), "auto": bool(m.get("auto")),
            "title": str(m.get("title") or ""), "info": m.get("info") if isinstance(m.get("info"), dict) else {},
            "created": float(m.get("created") or 0), "updated": float(m.get("updated") or 0),
            "thumb": os.path.isfile(os.path.join(d, "thumb.jpg")), "bytes": _size(d)}


def list_entries(kind):
    base = root(kind)
    out = []
    for name in os.listdir(base):
        d = os.path.join(base, name)
        if ID_RE.match(name) and os.path.isdir(d):
            e = _entry(kind, d)
            if e:
                out.append(e)
    out.sort(key=lambda e: e["updated"], reverse=True)
    return out


def _prune(kind):
    autos = [e for e in list_entries(kind) if e["auto"]]
    for e in autos[MAX_AUTO:]:
        shutil.rmtree(os.path.join(root(kind), e["id"]), ignore_errors=True)


def _is_png(b):
    return isinstance(b, (bytes, bytearray)) and b[:8] == b"\x89PNG\r\n\x1a\n"


def _is_jpg(b):
    return isinstance(b, (bytes, bytearray)) and b[:3] == b"\xff\xd8\xff"


def save(kind, data, name="", auto=False, hid="", title="", info=None, thumb=None, img=None, orig=None, files=None):
    """保存して、保存した項目を返す。

    auto: 自動保存。hid の項目があればそれを上書きする(名前を付けて残した項目は上書きせず、新しく作る)。
    """
    text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    if len(text.encode("utf-8")) > MAX_DATA:
        raise ValueError(tr("一時保存の中身が大きすぎます"))
    json.loads(text)  # 壊れた JSON は保存しない
    files = {k: v for k, v in (files or {}).items() if v is not None}
    if len(files) > MAX_LAYER_FILES or any(not LAYER_RE.match(k) or not _is_png(v) for k, v in files.items()):
        raise ValueError(tr("PNG の画像ではありません"))
    if kind == "image":
        if not files and not _is_png(img):
            raise ValueError(tr("PNG の画像ではありません"))
        if orig is not None and not _is_png(orig):
            raise ValueError(tr("PNG の画像ではありません"))
    if thumb is not None and not (_is_jpg(thumb) or _is_png(thumb)):
        thumb = None
    now = time.time()
    with _lock:
        base = root(kind)
        old = None
        if auto and hid and ID_RE.match(hid):
            d = os.path.join(base, hid)
            old = _read_meta(d) if os.path.isdir(d) else None
            if old is not None and not old.get("auto"):
                old, hid = None, ""  # 名前を付けて残したものは上書きしない
        if not hid or not ID_RE.match(hid) or (not auto):
            hid = new_id()
            old = None
        d = os.path.join(base, hid)
        os.makedirs(d, exist_ok=True)
        _write_json(os.path.join(d, "data.json"), json.loads(text))
        if thumb is not None:
            _write_bytes(os.path.join(d, "thumb.jpg"), thumb)
        if img is not None:
            _write_bytes(os.path.join(d, "img.png"), img)
        if orig is not None:
            _write_bytes(os.path.join(d, "orig.png"), orig)
        if files:
            # レイヤーの画像: 前の保存の分は消してから書く(消した物が残らないように)
            for f in os.listdir(d):
                if LAYER_RE.match(f) and f not in files:
                    os.remove(os.path.join(d, f))
            for k, v in files.items():
                _write_bytes(os.path.join(d, k), v)
        nm = str(name or "").strip()[:MAX_NAME]
        meta = {"name": nm or (old or {}).get("name") or "", "auto": bool(auto), "title": str(title or "")[:200],
                "info": info if isinstance(info, dict) else {}, "created": (old or {}).get("created") or now, "updated": now}
        _write_json(os.path.join(d, "meta.json"), meta)
        if auto:
            _prune(kind)
        return _entry(kind, d)


def _missing_files(p):
    """プロジェクトで使っている動画・画像・音声のうち、もう無いもの"""
    from .videoedit import full_path
    vals = [c.get("src") for c in (p.get("clips") or [])]
    vals += [o.get("src") for o in (p.get("overlays") or []) if o.get("kind") in ("image", "video")]
    vals += [a.get("src") for a in (p.get("audios") or [])]
    out = []
    for v in vals:
        if not v or v in out:
            continue
        try:
            full_path(v)
        except Exception:
            out.append(v)
    return out


def get(kind, hid):
    d = _dir(kind, hid)
    e = _entry(kind, d) if os.path.isdir(d) else None
    if not e:
        raise ValueError(tr("一時保存が見つかりません"))
    with open(os.path.join(d, "data.json"), "r", encoding="utf-8") as f:
        data = json.load(f)
    out = {**e, "data": data}
    if kind == "video" and isinstance(data, dict):
        out["missing"] = _missing_files(data)
    if kind == "image":
        out["files"] = [n for n in ("img.png", "orig.png") if os.path.isfile(os.path.join(d, n))] \
            + sorted(n for n in os.listdir(d) if LAYER_RE.match(n))
    return out


def file_path(kind, hid, name):
    if name not in FILES and not LAYER_RE.match(str(name or "")):
        raise ValueError(tr("一時保存が見つかりません"))
    path = os.path.join(_dir(kind, hid), name)
    if not os.path.isfile(path):
        raise ValueError(tr("一時保存が見つかりません"))
    return path


def rename(kind, hid, name):
    """名前を変える。名前を付けた自動保存は、手動の一時保存として消えずに残る"""
    d = _dir(kind, hid)
    with _lock:
        m = _read_meta(d)
        if m is None:
            raise ValueError(tr("一時保存が見つかりません"))
        m["name"] = str(name or "").strip()[:MAX_NAME]
        m["auto"] = False
        _write_json(os.path.join(d, "meta.json"), m)
    return _entry(kind, d)


def open_dir(kind):
    """この種類の一時保存のフォルダを開く(エクスプローラーなど)"""
    from .model_dirs import _launch
    d = root(kind)
    _launch(d)
    return d


def delete(kind, hid):
    d = _dir(kind, hid)
    with _lock:
        if not os.path.isdir(d):
            return False
        shutil.rmtree(d, ignore_errors=True)
    return True
