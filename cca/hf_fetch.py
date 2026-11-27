"""Hugging Face のモデルを、追加ノードが使う前にダウンロードする(SenseNova-U1.6 の「HF | …」)。

- 「HF | 作者/リポジトリ」(ファイルが何個にも分かれているもの): 追加ノード ComfyUI-SenseNova-U1 と同じ場所
  (Hugging Face のキャッシュ)に全部を入れる。追加ノードはそれをそのまま使う
- 「HF | 作者/リポジトリ/ファイル名.gguf」(軽い版): その 1 ファイルと設定の小さいファイルだけを
  models/sensenova/リポジトリ名 に入れ、追加ノードには「Local | リポジトリ名/ファイル名」として渡す
  (追加ノードに HF の名前で渡すと、全部の版(合わせて約 50 GB)をダウンロードしてしまうため)

進み具合はパネルに送る(cca_generator.download)。ダウンロード済みならネットにはつながない。
"""
import json
import os
import shutil
import threading
import time
from pathlib import Path

from .i18n import tr

EVENT = "cca_generator.download"
HF_PREFIX = "HF | "
LOCAL_PREFIX = "Local | "
FOLDER_PREFIX = "Folder | "  # 「Folder | フルパス」= モデルフォルダの設定で足した場所にある SenseNova の GGUF
WEIGHT_EXTS = (".gguf", ".safetensors", ".sft", ".bin", ".pt", ".pth", ".ckpt", ".h5", ".msgpack", ".onnx")


def _send(data):
    try:
        from server import PromptServer
        PromptServer.instance.send_sync(EVENT, data)
    except Exception:  # noqa: BLE001  パネルに出せなくてもダウンロードは続ける
        pass


def _complete(folder):
    """重みのファイルが全部そろっているか(分かれているものは index に書かれた全部)"""
    p = Path(folder)
    idx = p / "model.safetensors.index.json"
    if idx.is_file():
        try:
            names = set(json.loads(idx.read_text(encoding="utf-8"))["weight_map"].values())
        except Exception:  # noqa: BLE001
            return False
        return bool(names) and all((p / n).is_file() for n in names)
    return (p / "model.safetensors").is_file()


def _cached(repo):
    try:
        from huggingface_hub import snapshot_download
        path = snapshot_download(repo, local_files_only=True)
        return path if _complete(path) else None
    except Exception:  # noqa: BLE001
        return None


def _fail(model_type, repo, err):
    return tr("[{model_type}] Hugging Face から {repo} をダウンロードできませんでした: {err}\n"
              "ネットにつながっているかを確かめて、もう一度生成してください(途中まで入ったファイルは続きから入ります)。"
              "手でダウンロードするときは「📋 モデルの選び方・ライセンス」の手順で models/sensenova に入れ、「Local | …」を選びます。",
              model_type=model_type, repo=repo, err=f"{type(err).__name__}: {err}")


def _space(model_type, repo, where, need):
    try:
        Path(where).mkdir(parents=True, exist_ok=True)
        free = shutil.disk_usage(where).free
    except OSError:
        return
    if free < need:
        raise ValueError(tr("[{model_type}] 空き容量が足りません。{repo} にはあと {need} GB 必要ですが、空きは {free} GB です({where})。",
                            model_type=model_type, repo=repo, need=round(need / 1e9, 1), free=round(free / 1e9, 1), where=str(where)))


def _download(model_type, repo, files, watch, **kw):
    """files = [(名前, 大きさ)] を 1 つずつ入れる。watch の下の .incomplete の大きさで進み具合を送る"""
    from huggingface_hub import hf_hub_download
    import comfy.model_management as mm
    total = sum(s for _, s in files) or 1
    done = 0
    for i, (name, size) in enumerate(files):
        box = {}

        def run(name=name):
            try:
                box["path"] = hf_hub_download(repo, name, **kw)
            except BaseException as e:  # noqa: BLE001
                box["err"] = e
        t = threading.Thread(target=run, daemon=True)
        t.start()
        last = 0.0
        while t.is_alive():
            t.join(0.5)
            part = 0
            try:  # いま入れているファイルの途中の大きさ
                inc = sorted(Path(watch).rglob("*.incomplete"), key=lambda f: f.stat().st_mtime) if Path(watch).is_dir() else []
                part = min(size, inc[-1].stat().st_size) if inc else 0
            except OSError:
                pass
            now = time.time()
            if now - last >= 0.5:
                last = now
                _send({"repo": repo, "file": name, "index": i + 1, "count": len(files), "done": done + part, "total": total})
            mm.throw_exception_if_processing_interrupted()  # 中止(いま入れているファイルは裏で入れ終える。次は続きから)
        if "err" in box:
            raise ValueError(_fail(model_type, repo, box["err"])) from box["err"]
        done += size
    _send({"repo": repo, "done": total, "total": total, "count": len(files), "finished": True})


def _files_of(model_type, repo):
    try:
        from huggingface_hub import HfApi
        info = HfApi().model_info(repo, files_metadata=True)
    except Exception as e:  # noqa: BLE001
        raise ValueError(_fail(model_type, repo, e)) from e
    return [(s.rfilename, int(getattr(s, "size", 0) or 0)) for s in (info.siblings or []) if s.rfilename != ".gitattributes"]


def _ensure_repo(repo, model_type):
    """repo の全部のファイルを Hugging Face のキャッシュに入れる(入っていれば何もしない)"""
    if _cached(repo):
        return
    from huggingface_hub import constants
    files = _files_of(model_type, repo)
    blobs = Path(constants.HF_HUB_CACHE) / ("models--" + repo.replace("/", "--")) / "blobs"
    have = sum(f.stat().st_size for f in blobs.iterdir() if f.is_file()) if blobs.is_dir() else 0
    _space(model_type, repo, constants.HF_HUB_CACHE, sum(s for _, s in files) - have)
    _download(model_type, repo, files, blobs)


def sensenova_dir():
    try:
        import folder_paths
        paths = folder_paths.get_folder_paths("sensenova")
        if paths:
            return paths[0]
        return os.path.join(folder_paths.models_dir, "sensenova")
    except Exception:  # noqa: BLE001
        return os.path.join("models", "sensenova")


def _ensure_one(repo, pick, model_type):
    """repo の pick(重みの 1 ファイル)と、重み以外の小さいファイルを models/sensenova/リポジトリ名 に入れる"""
    name = repo.split("/")[-1]
    dest = Path(sensenova_dir()) / name
    if (dest / pick).is_file() and (dest / "config.json").is_file():
        return f"{name}/{pick}"
    files = [(f, s) for f, s in _files_of(model_type, repo) if f == pick or not f.lower().endswith(WEIGHT_EXTS)]
    if not any(f == pick for f, _ in files):
        raise ValueError(tr("[{model_type}] {repo} に {file} がありません。", model_type=model_type, repo=repo, file=pick))
    need = sum(s for f, s in files if not (dest / f).is_file())
    _space(model_type, repo, dest, need)
    _download(model_type, repo, [(f, s) for f, s in files if not (dest / f).is_file()], dest, local_dir=str(dest))
    return f"{name}/{pick}"


def _hub_cache():
    """Hugging Face のキャッシュの場所(ライブラリを読み込まずに、同じ決め方で)"""
    for k in ("HF_HUB_CACHE", "HUGGINGFACE_HUB_CACHE"):
        if os.environ.get(k):
            return Path(os.environ[k])
    home = os.environ.get("HF_HOME") or os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"), "huggingface")
    return Path(home) / "hub"


def downloaded(choice):
    """「HF | …」がダウンロード済みか(True / False)。「HF | …」でなければ None。フォルダを見るだけ(ネットにはつながない)"""
    choice = str(choice or "").strip()
    if not choice.startswith(HF_PREFIX):
        return None
    parts = choice[len(HF_PREFIX):].strip().split("/")
    if len(parts) > 2:
        dest = Path(sensenova_dir()) / parts[1]
        return (dest / "/".join(parts[2:])).is_file() and (dest / "config.json").is_file()
    repo = _hub_cache() / ("models--" + "--".join(parts))
    try:
        ref = (repo / "refs" / "main").read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return _complete(repo / "snapshots" / ref)


def prepare(choice, model_type):
    """追加ノードに渡すモデルの選択肢。「HF | …」は先にダウンロードしておく"""
    choice = str(choice or "").strip()
    if not choice.startswith(HF_PREFIX):
        return choice
    parts = choice[len(HF_PREFIX):].strip().split("/")
    if len(parts) > 2:  # 作者/リポジトリ/ファイル(軽い版の 1 ファイル)
        return LOCAL_PREFIX + _ensure_one("/".join(parts[:2]), "/".join(parts[2:]), model_type)
    _ensure_repo("/".join(parts), model_type)
    return choice


def folder_models():
    """モデルフォルダの設定(チェックポイント・拡散モデル)で足した場所にある SenseNova の GGUF(folder_paths の一覧には .gguf が出ないため)"""
    out = []
    try:
        from . import model_dirs
        d = model_dirs.load()
        roots = list(dict.fromkeys(d.get("checkpoints", []) + d.get("diffusion_models", [])))
    except Exception:  # noqa: BLE001
        return out
    for root in roots:
        n = 0
        for dp, _dirs, files in os.walk(root, followlinks=True):
            for f in files:
                n += 1
                full = os.path.join(dp, f)
                if f.lower().endswith(".gguf") and "sensenova" in full.lower():
                    out.append(FOLDER_PREFIX + full)
            if n > 20000:
                break
    return out


def link_folder(choice):
    """「Folder | …」を、追加ノードが読める「Local | …」にする(その GGUF があるフォルダを models/sensenova にリンクする。設定ファイルは GGUF と同じフォルダに置く)"""
    choice = str(choice or "").strip()
    if not choice.startswith(FOLDER_PREFIX):
        return choice
    path = choice[len(FOLDER_PREFIX):]
    src = os.path.dirname(path)
    name = "cca_" + os.path.basename(src)
    root = Path(sensenova_dir())
    root.mkdir(parents=True, exist_ok=True)
    link = root / name
    if not link.exists():
        try:
            os.symlink(src, link, target_is_directory=True)
        except OSError:
            if os.name != "nt":
                raise
            import subprocess
            subprocess.run(["cmd", "/c", "mklink", "/J", str(link), src], check=True, capture_output=True)
    return f"{LOCAL_PREFIX}{name}/{os.path.basename(path)}"
