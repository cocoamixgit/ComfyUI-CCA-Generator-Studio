"""モデルを探すフォルダの追加(ComfyUI 標準の models/ 以外)。

追加したフォルダは ComfyUI 全体のモデル一覧にも加わる(extra_model_paths.yaml と同じ仕組み)。
設定は <ComfyUI>/user/default/cca_generator/model_dirs.json に保存し、起動時に読み込む。
"""
import json
import os
import subprocess
import sys
import threading

import folder_paths

from .i18n import tr
from .store import _base_dir

FILE = "model_dirs.json"
KINDS = {
    "checkpoints": "チェックポイント",
    "diffusion_models": "拡散モデル",
    "text_encoders": "テキストエンコーダー",
    "vae": "VAE",
    "loras": "LoRA",
    "upscale_models": "拡大モデル(Hires. fix 用)",
    "model_patches": "Edit LoRA(別の置き場所)",
    "background_removal": "背景を消すモデル",
    "inpaint": "オブジェクト除去モデル(LaMa)",
    "rvc": "RVC の声のモデル",
    "latent_upscale_models": "潜在アップスケーラー(LTX-2.5)",
}
# 種類ごとの説明(画面の ⓘ に出す。何を入れるフォルダか)
KIND_HELP = {
    "checkpoints": "SD1.5・SDXL・Illustrious のモデルファイルを入れます。",
    "diffusion_models": "MOSS・Qwen Image・Anima・Krea2・FLUX.2/3 Klein・Wan2.2・LTX-2.5・Kandinsky 6 のモデル本体を入れます。"
                        "Kandinsky 6 はフォルダごと(Kandinsky-6.0-…/transformer/…)入れます。",
    "text_encoders": "プロンプトを読み取るモデル(qwen3.5、umt5 など)を入れます。",
    "vae": "VAE のファイル(flux2-vae、qwen_image_vae、wan の vae など)を入れます。",
    "loras": "LoRA・Turbo LoRA・MOSS の Edit LoRA を入れます。",
    "upscale_models": "Hires. fix の「アップスケーラー」で、拡大モデル(4x-UltraSharp など)を使うときだけ入れます。"
                      "Lanczos などで拡大するなら使いません。",
    "model_patches": "MOSS の Edit LoRA は、LoRA のフォルダの代わりにここへ入れても選べます。"
                     "LoRA のフォルダに入れているなら使いません。",
    "background_removal": "画像の合成で「背景を自動で消す」に使うモデル(birefnet.safetensors)を入れます。",
    "inpaint": "画像編集の「オブジェクト除去」の軽い方法(LaMa)に使うモデル(big-lama.pt)を入れます。"
               "ComfyUI の inpaint 系の追加ノードと同じ場所です。",
    "rvc": "RVC(ボイスチェンジ)の声のモデル(.pth)と、あれば .index を入れます。HuBERT・RMVPE は初めて使うときに自動でここへダウンロードされます。",
    "latent_upscale_models": "LTX-2.5 の動画を 2 倍にするモデル(ltx-2.5-latent-spatial-upscaler-x2)を入れます。"
                             "LTX-2.5 を使わないなら要りません。",
}
MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".gguf", ".sft")
COUNT_LIMIT = 20000
# StabilityMatrix の共有モデルフォルダ(Data/Models/<名前>)の名前 → ComfyUI の種類
SM_NAMES = {
    "checkpoints": ["StableDiffusion", "Checkpoints"],
    "loras": ["Lora", "Loras", "LyCORIS"],
    "vae": ["VAE"],
    "text_encoders": ["TextEncoders", "CLIP"],
    "diffusion_models": ["DiffusionModels", "Unet"],
    "upscale_models": ["ESRGAN", "RealESRGAN", "SwinIR", "UpscaleModels"],
    "model_patches": ["ModelPatches"],
}
_lock = threading.Lock()


def _ensure_extra_kinds():
    """ComfyUI 本体に無い種類(inpaint)も、フォルダとして使えるようにする"""
    if "inpaint" not in folder_paths.folder_names_and_paths:
        folder_paths.folder_names_and_paths["inpaint"] = (
            [os.path.join(folder_paths.models_dir, "inpaint")], set(folder_paths.supported_pt_extensions))


_ensure_extra_kinds()


def _path():
    return os.path.join(_base_dir(), FILE)


def load():
    try:
        with open(_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {k: [p for p in data.get(k, []) if isinstance(p, str)] for k in KINDS}


def _save(data):
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _path())


def _invalidate(kind):
    try:
        folder_paths.filename_list_cache.pop(kind, None)
    except Exception:
        pass


def invalidate_all():
    """ComfyUI のファイル一覧キャッシュを捨てる(後から作ったフォルダ・置いたファイルを確実に拾う)。"""
    for kind in list(KINDS) + ["unet", "clip"]:
        _invalidate(folder_paths.map_legacy(kind) if hasattr(folder_paths, "map_legacy") else kind)


def normalize(path):
    p = str(path or "").strip().strip('"').strip("'")
    if not p:
        raise ValueError(tr('フォルダのパスが空です'))
    return os.path.normpath(os.path.abspath(os.path.expanduser(p)))


def apply_all():
    """起動時: 保存済みのフォルダを ComfyUI に登録する。"""
    for kind, paths in load().items():
        for p in paths:
            if os.path.isdir(p):
                folder_paths.add_model_folder_path(kind, p)
        _invalidate(kind)


def add(kind, path):
    if kind not in KINDS:
        raise ValueError(tr('種類が不正です'))
    p = normalize(path)
    if not os.path.isdir(p):
        raise ValueError(tr('フォルダが見つかりません: {p}', p=p))
    with _lock:
        data = load()
        if p not in data[kind]:
            data[kind].append(p)
            _save(data)
    folder_paths.add_model_folder_path(kind, p)
    _invalidate(kind)
    return p


def remove(kind, path):
    if kind not in KINDS:
        raise ValueError(tr('種類が不正です'))
    p = normalize(path)
    with _lock:
        data = load()
        if p not in data[kind]:
            raise ValueError(tr('このパネルで追加したフォルダだけ外せます'))
        data[kind].remove(p)
        _save(data)
    try:
        paths = folder_paths.folder_names_and_paths[kind][0]
        if p in paths:
            paths.remove(p)
    except Exception:
        pass
    _invalidate(kind)


def _source(path, custom_paths):
    if path in custom_paths:
        return "custom"
    base = os.path.normcase(os.path.normpath(getattr(folder_paths, "base_path", "") or ""))
    p = os.path.normcase(os.path.normpath(path))
    if base and (p == base or p.startswith(base + os.sep)):
        return "default"
    return "extra"  # extra_model_paths.yaml や起動オプションで追加されたもの(StabilityMatrix など)


def count_models(path, limit=COUNT_LIMIT):
    """フォルダの中(下のフォルダも含む)のモデルファイルの数。(数, 上限で打ち切ったか)"""
    n = seen = 0
    try:
        for _root, _dirs, files in os.walk(path, followlinks=True):
            for f in files:
                seen += 1
                if f.lower().endswith(MODEL_EXTS):
                    n += 1
                if seen >= limit:
                    return n, True
    except Exception:
        pass
    return n, False


def info(counts=True):
    """存在するフォルダだけを、実体のパス(リンクの先)で返す。実体が同じものは 1 つにまとめ、ファイルの多い順。
    path: 実体のパス / registered: ComfyUI に登録されているパス(リンク側)/ custom: このパネルで追加したもの
    source: default(ComfyUI 標準)/ custom(このパネルで追加)/ extra(ComfyUI の設定で追加)"""
    custom = load()
    out = {}
    for kind, label in KINDS.items():
        try:
            paths = folder_paths.get_folder_paths(kind)
        except Exception:
            paths = []
        items, seen = [], {}
        for p in paths:
            if not os.path.isdir(p):
                continue
            real = os.path.realpath(p)
            key = os.path.normcase(real)
            if key in seen:
                it = seen[key]
                it["custom"] = it["custom"] or p in custom[kind]
                if p in custom[kind]:
                    it["registered"] = p
                continue
            it = {"path": real, "registered": p, "custom": p in custom[kind], "source": _source(p, custom[kind]),
                  "real": real if os.path.normcase(real) != os.path.normcase(os.path.abspath(p)) else ""}
            if counts:
                it["count"], it["more"] = count_models(real)
            seen[key] = it
            items.append(it)
        if counts:
            items.sort(key=lambda x: -x.get("count", 0))
        out[kind] = {"label": label, "help": KIND_HELP.get(kind, ""), "paths": items}
    return out


def _read_json(path):
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _sm_data_dir():
    """ComfyUI が StabilityMatrix の <Data>/Packages/<名前> にあるときの <Data>(ドライブは問わない)"""
    here = os.path.abspath(getattr(folder_paths, "base_path", "") or os.getcwd())
    for _ in range(6):
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
        if os.path.isdir(os.path.join(here, "Packages")) and (
                os.path.isfile(os.path.join(here, "settings.json")) or os.path.isdir(os.path.join(here, "Models"))):
            return here
    return None


def _yaml_roots():
    """ComfyUI フォルダの extra_model_paths.yaml の各セクションの base_path(ComfyUI が起動時に読む設定)"""
    path = os.path.join(os.path.abspath(getattr(folder_paths, "base_path", "") or os.getcwd()), "extra_model_paths.yaml")
    out = {}
    if not os.path.isfile(path):
        return out, None
    try:
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            conf = yaml.safe_load(f) or {}
    except Exception:
        return out, path
    for key, sec in (conf.items() if isinstance(conf, dict) else []):
        if isinstance(sec, dict) and sec.get("base_path"):
            bp = os.path.expandvars(os.path.expanduser(str(sec["base_path"])))
            if not os.path.isabs(bp):
                bp = os.path.join(os.path.dirname(path), bp)
            out[str(key)] = os.path.normpath(bp)
    return out, path


def _same(a, b):
    try:
        return os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b))
    except Exception:
        return False


def _scan_sm_root(models):
    try:
        subdirs = {d.lower(): d for d in os.listdir(models) if os.path.isdir(os.path.join(models, d))}
    except Exception:
        subdirs = {}
    registered = {}
    for k in SM_NAMES:
        try:
            registered[k] = {os.path.normcase(os.path.realpath(p)) for p in folder_paths.get_folder_paths(k)}
        except Exception:
            registered[k] = set()
    found, missing = {}, {}
    for kind, names in SM_NAMES.items():
        for n in names:
            d = subdirs.get(n.lower())
            if not d:
                continue
            full = os.path.join(models, d)
            found.setdefault(kind, []).append(full)
            if os.path.normcase(os.path.realpath(full)) not in registered[kind]:
                missing.setdefault(kind, []).append(full)
    return found, missing


def _registered_sm_roots():
    """ComfyUI に登録されているフォルダの実体のうち、名前が StabilityMatrix のモデルフォルダ名のものの親フォルダ。
    例: 実体 F:\\StabilityMatrix\\Data\\Models\\TextEncoders → F:\\StabilityMatrix\\Data\\Models"""
    names = {n.lower() for ns in SM_NAMES.values() for n in ns}
    comfy_models = os.path.join(getattr(folder_paths, "base_path", "") or os.getcwd(), "models")
    roots = []
    for kind in SM_NAMES:
        try:
            paths = folder_paths.get_folder_paths(kind)
        except Exception:
            paths = []
        for p in paths:
            if not os.path.isdir(p):
                continue
            real = os.path.realpath(p)
            if os.path.basename(os.path.normpath(real)).lower() in names:
                parent = os.path.dirname(os.path.normpath(real))
                if _same(parent, comfy_models):  # ComfyUI 自身の models は除く
                    continue
                if not any(_same(parent, r) for r in roots):
                    roots.append(parent)
    return roots


def find_stability_matrix():
    """StabilityMatrix のモデルフォルダを探す。決め打ちの場所ではなく、次の順に実際の設定を見る:
    1. ComfyUI の extra_model_paths.yaml の stability_matrix: base_path(ComfyUI が実際に読んでいる場所)
    2. StabilityMatrix の settings.json の ModelDirectoryOverride(「モデルフォルダの場所」を別ドライブ等に変えたとき)
    3. <Data>/Models(StabilityMatrix の標準)
    見つかった場所ごとに、ComfyUI がまだ読んでいないフォルダ(missing)を返す。"""
    data_dir = _sm_data_dir()
    yaml_roots, yaml_file = _yaml_roots()
    override = None
    settings_file = None
    if data_dir:
        settings_file = os.path.join(data_dir, "settings.json")
        override = _read_json(settings_file).get("ModelDirectoryOverride") or None
    linked = _registered_sm_roots()
    if not data_dir and "stability_matrix" not in yaml_roots and not linked:
        return None
    candidates = []
    if "stability_matrix" in yaml_roots:
        candidates.append((yaml_roots["stability_matrix"], "yaml"))
    if override:
        candidates.append((os.path.normpath(override), "settings"))
    if data_dir:
        candidates.append((os.path.join(data_dir, "Models"), "default"))
    for r in linked:
        candidates.append((r, "linked"))
    roots = []
    for path, source in candidates:
        if any(_same(path, r["root"]) for r in roots):
            continue
        exists = os.path.isdir(path)
        found, missing = _scan_sm_root(path) if exists else ({}, {})
        real = os.path.realpath(path) if exists else path
        roots.append({"root": path, "real": real, "source": source, "exists": exists, "found": found,
                      "missing": missing,
                      # 画面に出す: まだ読み込まれていないフォルダ(実体のパスとファイル数)
                      "missing_detail": [{"kind": k, "label": KINDS.get(k, k), "path": os.path.realpath(x),
                                          "count": count_models(x)[0]}
                                         for k, xs in missing.items() for x in xs]})
    # StabilityMatrix がモデルフォルダを別の場所にしているのに、標準の Data/Models も残っている → 標準のほうは使われていない
    in_use = roots[0]["root"] if roots else None
    for r in roots:
        r["in_use"] = _same(r["root"], in_use) if in_use else False
        r["unused_default"] = r["source"] == "default" and bool(override) and not _same(r["root"], override)
    mismatch = bool(override and "stability_matrix" in yaml_roots and not _same(override, yaml_roots["stability_matrix"]))
    first = next((r for r in roots if r["exists"] and not r["unused_default"]), roots[0] if roots else None)
    return {
        "data_dir": data_dir, "settings_file": settings_file if settings_file and os.path.isfile(settings_file) else None,
        "settings_override": override, "yaml_file": yaml_file, "yaml_root": yaml_roots.get("stability_matrix"),
        "mismatch": mismatch, "roots": roots,
        # 以前の版の画面との互換
        "root": first["root"] if first else None, "found": first["found"] if first else {},
        "missing": first["missing"] if first else {},
    }


def add_stability_matrix(root=None):
    sm = find_stability_matrix()
    if not sm:
        raise ValueError(tr('StabilityMatrix のモデルフォルダが見つかりませんでした'))
    targets = [r for r in sm["roots"] if r["exists"] and (root is None and not r["unused_default"] or root is not None and _same(r["root"], root))]
    if root is None:
        targets = targets[:1]
    if not targets:
        raise ValueError(tr('そのフォルダは StabilityMatrix のモデルフォルダとして見つかりませんでした'))
    added = []
    for r in targets:
        for kind, paths in r["missing"].items():
            for p in paths:
                added.append(add(kind, p))
    return added


def known_folder(path):
    """開いてよいフォルダか(ComfyUI が使っているモデル/入力フォルダと、その実体のみ)。"""
    p = normalize(path)
    allowed = set()
    for kind in KINDS:
        try:
            for x in folder_paths.get_folder_paths(kind):
                allowed.add(os.path.normcase(os.path.normpath(x)))
                allowed.add(os.path.normcase(os.path.realpath(x)))
        except Exception:
            pass
    inp = folder_paths.get_input_directory()
    allowed.update({os.path.normcase(os.path.normpath(inp)), os.path.normcase(os.path.realpath(inp))})
    # 追加ノードを手で入れるときに開く custom_nodes フォルダ
    try:
        for x in folder_paths.get_folder_paths("custom_nodes"):
            allowed.update({os.path.normcase(os.path.normpath(x)), os.path.normcase(os.path.realpath(x))})
    except Exception:
        pass
    # 動画編集で使うフォントを入れるフォルダ
    fd = _font_dir()
    if fd:
        allowed.update({os.path.normcase(os.path.normpath(fd)), os.path.normcase(os.path.realpath(fd))})
    return p if os.path.normcase(p) in allowed else None


def _font_dir():
    try:
        from .videoedit import user_font_dir
        return user_font_dir()
    except Exception:
        return ""


def _under(a, b):
    a = os.path.normcase(os.path.realpath(a))
    b = os.path.normcase(os.path.realpath(b))
    return a == b or a.startswith(b.rstrip(os.sep) + os.sep)


def _launch(target):
    """エクスプローラー等でフォルダを開く(テストではここを差し替える)"""
    if sys.platform.startswith("win"):
        # 開けなかったときは、別の方法で開いたことにせずエラーにする(画面に開けなかった理由を出す)
        try:
            os.startfile(os.path.normpath(target))  # noqa: S606  エクスプローラーで開く
        except OSError as e:
            raise ValueError(tr('エクスプローラーで開けませんでした({err}): {target}', err=e.strerror or e, target=target)) from e
    elif sys.platform == "darwin":
        subprocess.Popen(["open", target])
    else:
        subprocess.Popen(["xdg-open", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def open_folder(path):
    """リンク(ジャンクション・シンボリックリンク)のフォルダは、実体(リンクの先)を開く。"""
    p = known_folder(path)
    if not p:
        raise ValueError(tr('このフォルダは開けません'))
    real = os.path.realpath(p)
    target = real if os.path.isdir(real) else p
    if not os.path.isdir(target):
        if _under(target, os.path.join(getattr(folder_paths, "base_path", "") or os.getcwd(), "models")) \
                or (_font_dir() and _under(target, _font_dir())):
            os.makedirs(target, exist_ok=True)  # ComfyUI の models の中とフォントのフォルダだけは作ってから開く
        else:
            raise ValueError(tr('フォルダがありません: {target}', target=target))
    _launch(target)
    return target
