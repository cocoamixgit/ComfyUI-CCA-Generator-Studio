"""Civitai から LoRA を探して取得する(LoRA エクスプローラの Civitai タブ用)。

- 探す: Civitai の公開 API(GET /api/v1/models)。ログインしなくても使える
- ログイン: Civitai には外部アプリ向けのパスワードログインが無いので、API キーで認証する
  (civitai.com のアカウント設定 → API Keys で作る)。キーは ComfyUI の user/default/cca_generator/civitai.json に保存する
- 取得: /api/download/models/{バージョンID}。models/loras/civitai/ に保存する(隣にプレビュー画像も保存する)
"""
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

import folder_paths

from . import store

BASE = "https://civitai.com"
KEY_FILE = "civitai.json"
UA = "CCA-Generator/1.0 (ComfyUI custom node)"
SORTS = ("Most Downloaded", "Highest Rated", "Most Liked", "Newest", "Most Collected")
MODEL_EXT = (".safetensors", ".pt", ".pth", ".ckpt", ".bin")
SUBDIR = "civitai"
LIMIT = 100

_jobs = {}
_lock = threading.Lock()


class CivitaiError(Exception):
    pass


# ---------------- ログイン(API キー) ----------------
def _saved():
    v = store._read(KEY_FILE, {})
    return v if isinstance(v, dict) else {}


def get_key():
    return str(_saved().get("key") or "")


def status():
    v = _saved()
    return {"loggedIn": bool(v.get("key")), "username": str(v.get("username") or "")}


def _http_error(e):
    if e.code == 401:
        return "API キーが正しくないか、期限が切れています"
    if e.code == 403:
        return "アクセスが許可されていません(ログインが必要なモデルの可能性があります)"
    if e.code == 429:
        return "リクエストが多すぎます。少し待ってから、もう一度試してください"
    return f"Civitai がエラーを返しました(HTTP {e.code})"


def _api_json(path, params=None, key=""):
    url = BASE + path + (("?" + urllib.parse.urlencode(params, doseq=True)) if params else "")
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise CivitaiError(_http_error(e)) from e
    except urllib.error.URLError as e:
        raise CivitaiError(f"Civitai に接続できませんでした: {e.reason}") from e
    except (ValueError, UnicodeDecodeError) as e:
        raise CivitaiError("Civitai の返事を読み取れませんでした") from e


def login(key):
    """API キーを確かめて(GET /api/v1/me)、保存する。ユーザー名を返す"""
    key = str(key or "").strip()
    if not key or len(key) > 200 or re.search(r"\s", key):
        raise CivitaiError("API キーを入れてください")
    me = _api_json("/api/v1/me", key=key)
    name = str((me or {}).get("username") or (me or {}).get("name") or "")
    store._write(KEY_FILE, {"key": key, "username": name})
    return name


def logout():
    store._write(KEY_FILE, {})


# ---------------- 探す ----------------
def _local_index():
    idx = {}
    for n in folder_paths.get_filename_list("loras") or []:
        idx.setdefault(os.path.basename(n).lower(), []).append(n)
    return idx


def _local_name(idx, file_name, size_kb):
    """同じファイル名で、大きさもほぼ同じものが LoRA フォルダにあれば、その名前(取得済み)"""
    for n in idx.get(os.path.basename(str(file_name or "")).lower(), []):
        full = folder_paths.get_full_path("loras", n)
        try:
            if full and (not size_kb or abs(os.path.getsize(full) - float(size_kb) * 1024) <= float(size_kb) * 1024 * 0.01 + 1024):
                return n
        except (OSError, ValueError):
            pass
    return None


def search(q="", sort="Newest", nsfw=False, cursor="", bases=()):
    params = {"types": "LORA", "limit": LIMIT, "sort": sort if sort in SORTS else SORTS[0], "nsfw": "true" if nsfw else "false"}
    if q:
        params["query"] = q
    if cursor:
        params["cursor"] = cursor
    if bases:  # 関係のあるベースモデルだけ。名前が合わなくてエラーになったときは、絞らずに探す
        try:
            data = _api_json("/api/v1/models", {**params, "baseModels": list(bases)}, get_key())
        except CivitaiError:
            data = _api_json("/api/v1/models", params, get_key())
    else:
        data = _api_json("/api/v1/models", params, get_key())
    idx = _local_index()
    items = []
    for m in data.get("items") or []:
        versions = []
        for v in m.get("modelVersions") or []:
            files = [f for f in (v.get("files") or []) if str(f.get("name", "")).lower().endswith(MODEL_EXT)]
            f = next((x for x in files if x.get("primary")), files[0] if files else None)
            if not f or not v.get("id"):
                continue
            img = next((i.get("url") for i in (v.get("images") or []) if i.get("url") and (i.get("type") or "image") == "image"), None)
            versions.append({
                "id": v["id"], "name": v.get("name") or "", "base": v.get("baseModel") or "",
                "words": [str(w) for w in (v.get("trainedWords") or [])][:30],
                "file": f.get("name"), "sizeKB": f.get("sizeKB"), "image": img,
                "local": _local_name(idx, f.get("name"), f.get("sizeKB")),
            })
        if versions:
            items.append({"id": m.get("id"), "name": m.get("name") or "", "creator": (m.get("creator") or {}).get("username") or "",
                          "downloads": (m.get("stats") or {}).get("downloadCount") or 0, "nsfw": bool(m.get("nsfw")), "versions": versions})
    return {"items": items, "next": (data.get("metadata") or {}).get("nextCursor") or ""}


# ---------------- 取得 ----------------
def _safe_name(name):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", os.path.basename(str(name or "")).strip().strip("."))
    return name[:180]


def _filename_from(disposition):
    if not disposition:
        return ""
    m = re.search(r"filename\*=(?:UTF-8'')?([^;]+)", disposition, re.I)
    if m:
        return urllib.parse.unquote(m.group(1).strip().strip('"'))
    m = re.search(r'filename="?([^";]+)"?', disposition, re.I)
    return m.group(1).strip() if m else ""


def _save_preview(url, dest):
    """LoRA の隣に、プレビュー画像を保存する(Forge の LoRA 一覧と同じ置き方。失敗しても LoRA の取得は成功にする)"""
    try:
        host = urllib.parse.urlparse(url).hostname or ""
        if not url.startswith("https://") or not (host == "civitai.com" or host.endswith(".civitai.com")):
            return
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
        ext = ext if ext in (".png", ".jpg", ".jpeg", ".webp") else ".jpg"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30) as r:
            data = r.read(8 * 1024 * 1024)
        with open(os.path.splitext(dest)[0] + ".preview" + ext, "wb") as f:
            f.write(data)
    except Exception:  # noqa: BLE001
        pass


def _save_note(dest, note):
    """トリガーワード・ベースモデル・名前を、LoRA の隣の .json に残す(ⓘ の詳細に出す。無ければ作らない)"""
    if not note:
        return
    d = {"activation text": ", ".join(note.get("words") or []), "sd version": note.get("base") or "", "description": note.get("title") or ""}
    d = {k: v for k, v in d.items() if v}
    if d:
        try:
            with open(os.path.splitext(dest)[0] + ".json", "w", encoding="utf-8") as f:
                json.dump(d, f, ensure_ascii=False, indent=1)
        except OSError:
            pass


def _download(job, version_id, key, image, note=None):
    st = _jobs[job]
    tmp = ""
    try:
        url = f"{BASE}/api/download/models/{version_id}" + (("?token=" + urllib.parse.quote(key)) if key else "")
        # キーは URL に付けて送る(ヘッダーで送ると、保存先の別サイトへのリダイレクトにも付いて行ってしまうため)
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            if "text/html" in (r.headers.get("Content-Type") or "").lower():
                raise CivitaiError("このモデルは、ログインが必要です。Civitai タブの上で、API キーでログインしてください。" if not key
                                   else "ダウンロードできませんでした(このモデルへのアクセス権がありません)")
            fname = _safe_name(_filename_from(r.headers.get("Content-Disposition"))) or f"civitai_{version_id}.safetensors"
            if not fname.lower().endswith(MODEL_EXT):
                raise CivitaiError(f"LoRA のファイルではありません({fname})。zip などは、Civitai のページから取得してください")
            root = folder_paths.get_folder_paths("loras")[0]
            folder = os.path.join(root, SUBDIR)
            os.makedirs(folder, exist_ok=True)
            dest = os.path.join(folder, fname)
            if os.path.exists(dest):  # 同じ名前の別のファイルがあるときは、バージョン ID を付けて別名にする
                stem, ext = os.path.splitext(fname)
                dest = os.path.join(folder, f"{stem}_{version_id}{ext}")
            st["name"] = os.path.basename(dest)
            st["total"] = int(r.headers.get("Content-Length") or 0)
            if not os.path.exists(dest):
                tmp = dest + ".part"
                with open(tmp, "wb") as f:
                    while True:
                        chunk = r.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
                        st["received"] += len(chunk)
                os.replace(tmp, dest)
                tmp = ""
                if image:
                    _save_preview(image, dest)
                _save_note(dest, note)
        from . import model_dirs
        model_dirs.invalidate_all()  # 新しいファイルを、ComfyUI の一覧に反映する
        st["name"] = os.path.relpath(dest, root)
        st["state"] = "done"
    except CivitaiError as e:
        st["state"], st["error"] = "error", str(e)
    except urllib.error.HTTPError as e:
        st["state"], st["error"] = "error", _http_error(e)
    except urllib.error.URLError as e:
        st["state"], st["error"] = "error", f"Civitai に接続できませんでした: {e.reason}"
    except Exception as e:  # noqa: BLE001
        st["state"], st["error"] = "error", f"{type(e).__name__}: {e}"
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass


def start_download(version_id, image="", words=None, base="", title=""):
    version_id = int(version_id)
    job = uuid.uuid4().hex[:12]
    with _lock:
        for k in [k for k, v in _jobs.items() if v["state"] != "running"][:-20]:  # 古い記録は捨てる
            _jobs.pop(k, None)
        _jobs[job] = {"state": "running", "received": 0, "total": 0, "name": "", "error": ""}
    threading.Thread(target=_download, args=(job, version_id, get_key(), str(image or ""),
                                                {"words": [str(w)[:200] for w in (words or [])][:30] if isinstance(words, list) else [], "base": str(base or "")[:80], "title": str(title or "")[:200]}),
                     daemon=True).start()
    return job


def progress(job):
    st = _jobs.get(str(job))
    if st is None:
        raise CivitaiError("ダウンロードの記録が見つかりません")
    return dict(st)
