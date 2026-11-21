"""全設定の書き出し / 読み込み(第25版)。

書き出すファイル(JSON):
  {"format": "cca_generator.settings", "format_version": 1, "app_version": 25, "exported": "<日時>",
   "server": {<種類>: {<ファイル名>: <中身>}},     ← この関数が作る(サーバーの user/default/cca_generator の中)
   "browser": {<種類>: {<キー>: <値の文字列>}}}   ← ブラウザ側(web/cca_settings.js)が足す

版が上がっても崩れないように:
  - 保存しているものは SERVER_ITEMS の一覧だけで決める(設定のファイルを足したら、ここに書くだけで書き出しの対象になる)
  - 知らない種類・知らないファイルは読み込まずに知らせる(新しい版で書き出したものを古い版で読んだとき)
  - format_version が古ければ MIGRATIONS で今の形に直してから読む
  - 「足す」は今ある物をそのまま残し、無い物だけ足す(同じ名前は上書きしない)。「置き換える」はその種類を読み込んだ物にする
一時保存の履歴・透かしの画像・ハッシュの覚え書き(model_hashes.json)は大きい / 作り直せるので入れない。

第28版: Stable Diffusion WebUI Forge / A1111 のスタイル(styles.csv)も読み込める。forge_styles が
プロンプトのプリセットだけを入れた上の形にするので、読み込み(足す / 置き換える)は設定ファイルと同じ道を通る。
"""
import csv
import datetime
import io
import os
import re
import threading

from . import store
from .i18n import tr

FORMAT = "cca_generator.settings"
FORMAT_VERSION = 1
APP_VERSION = 1
_lock = threading.Lock()

# 種類 → [(ファイル名, 合わせ方)]
SERVER_ITEMS = {
    "panel": [("state_v2.json", "state"),                        # 前回の設定(モデル種別・タスクごと)
              ("tile_settings.json", "prefs")],                  # 第31版: 複数画像タイル生成の前回の設定(生成回数も)
    "presets": [("prompt_presets.json", "dict"),                 # プロンプトのプリセット
                ("audio_presets.json", "dict"),                  # 第42版: 声・音楽のプリセット
                ("prompt_presets_hidden.json", "hidden")],       # 消したおすすめ(★)
    "styles": [("text_styles.json", "styles")],                  # 文字の書式のテンプレート
    "wildcards": [("wildcards.json", "styles")],                 # 第29版: ワイルドカード(形は書式と同じ user / hidden)
    "folders": [("model_dirs.json", "lists")],                   # モデルフォルダ設定
}
# 古い形式 → 今の形式(format_version ごと)。今は 1 だけ
MIGRATIONS = {}


def _merge(kind, cur, new):
    """足す: cur(今の物)を優先し、new(読み込んだ物)からは無い物だけ足す"""
    if kind == "dict":
        out = dict(new)
        out.update(cur)
        return out
    if kind == "hidden":
        hid = list(cur.get("hidden", [])) if isinstance(cur.get("hidden"), list) else []
        for x in new.get("hidden", []) if isinstance(new.get("hidden"), list) else []:
            if isinstance(x, str) and x not in hid:
                hid.append(x)
        return {**cur, "hidden": hid}
    if kind == "state":
        out = dict(cur)
        for k, v in new.items():
            if isinstance(v, dict) and isinstance(out.get(k), dict):
                out[k] = {**v, **out[k]}
            elif k not in out or not out[k]:
                out[k] = v
        return out
    if kind == "styles":
        user = dict(new.get("user") or {}) if isinstance(new.get("user"), dict) else {}
        if isinstance(cur.get("user"), dict):
            user.update(cur["user"])
        hid = _merge("hidden", cur, new)["hidden"]
        return {**{k: v for k, v in new.items() if k not in ("user", "hidden")}, **cur, "user": user, "hidden": hid}
    if kind == "prefs":
        return {**new, **cur}
    if kind == "lists":
        out = {k: list(v) for k, v in cur.items() if isinstance(v, list)}
        for k, v in new.items():
            if not isinstance(v, list):
                continue
            lst = out.setdefault(k, [])
            for x in v:
                if isinstance(x, str) and x not in lst:
                    lst.append(x)
        return out
    return new


def export_all():
    server = {}
    with _lock:
        for cat, files in SERVER_ITEMS.items():
            server[cat] = {name: store._read(name, {}) for name, _ in files}
    return {"format": FORMAT, "format_version": FORMAT_VERSION, "app_version": APP_VERSION,
            "exported": datetime.datetime.now().isoformat(timespec="seconds"), "server": server}


def check(data):
    """読み込めるか確かめて、(今の形に直したデータ, 知らせ) を返す"""
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise ValueError(tr('CCA Generator の設定ファイルではありません'))
    ver = data.get("format_version")
    if not isinstance(ver, int) or ver < 1:
        raise ValueError(tr('設定ファイルの版が読めません'))
    notes = []
    while ver < FORMAT_VERSION:
        data = MIGRATIONS[ver](data)
        ver += 1
    if ver > FORMAT_VERSION:
        notes.append("newer")
    return data, notes


def import_all(data, mode="merge", cats=None):
    """server の部分を読み込む。mode: merge(足す)/ replace(置き換える)。cats: 読み込む種類(None ですべて)。
    戻り値: {"done": [種類], "skipped": [知らない種類・ファイル], "notes": [...]}"""
    data, notes = check(data)
    if mode not in ("merge", "replace"):
        raise ValueError(tr('読み込み方が不正です'))
    server = data.get("server") if isinstance(data.get("server"), dict) else {}
    done, skipped = [], []
    kept = 0
    with _lock:
        for cat, files in server.items():
            if cat not in SERVER_ITEMS:
                skipped.append(cat)
                continue
            if cats is not None and cat not in cats:
                continue
            if not isinstance(files, dict):
                continue
            known = dict(SERVER_ITEMS[cat])
            for name, content in files.items():
                if name not in known:
                    skipped.append(f"{cat}/{name}")
                    continue
                if not isinstance(content, dict):
                    continue
                cur = store._read(name, {})
                if mode == "merge" and known[name] == "dict":
                    kept += sum(1 for k in content if k in cur)  # 同じ名前は今の物のまま(足すとき)
                elif mode == "merge" and known[name] == "styles" and isinstance(content.get("user"), dict):
                    cu = cur.get("user") if isinstance(cur.get("user"), dict) else {}
                    kept += sum(1 for k in content["user"] if k in cu)
                store._write(name, content if mode == "replace" else _merge(known[name], cur, content))
            done.append(cat)
    if "folders" in done:
        try:
            from . import model_dirs
            model_dirs.apply_all()  # 足したフォルダを登録(外したフォルダは ComfyUI の再起動で外れる)
        except Exception:  # noqa: BLE001
            pass
    return {"done": done, "skipped": skipped, "notes": notes, "kept": kept}


# ---------------------------------------------------------------- 第28版: Forge / A1111 のスタイル(styles.csv)
FORGE_MAX_BYTES = 20 * 1024 * 1024


def _decode(raw):
    """UTF-8(BOM 付きも)→ Shift_JIS(日本語の Windows で保存したとき)の順に読む"""
    for enc in ("utf-8-sig", "cp932"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", errors="replace")


def _drop_prompt_tag(t):
    """Forge の {prompt}(使う人のプロンプトが入る所)を外し、前後の区切り(, や空白)を整える。
    この画面のプリセットは、今のプロンプトの後ろに足す使い方なので"""
    t = t.replace("{prompt}", "")
    t = re.sub(r",[ \t]*(?:,[ \t]*)+", ", ", t)  # 「a, , b」→「a, b」
    t = re.sub(r"^[\s,]+", "", t)
    t = re.sub(r"[\s,]+$", "", t)
    return t


def forge_styles(raw):
    """styles.csv(1 行目が name,prompt,negative_prompt …の見出し。中身に改行や , があれば " で囲む)を読み、
    プロンプトのプリセットだけを入れた設定ファイルの形にする。戻り値: (data, info)"""
    if not isinstance(raw, (bytes, bytearray)) or not raw:
        raise ValueError(tr('ファイルが空です'))
    if len(raw) > FORGE_MAX_BYTES:
        raise ValueError(tr('ファイルが大きすぎます'))
    text = _decode(bytes(raw)).replace("\r\n", "\n").replace("\r", "\n")
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error as e:
        raise ValueError(tr('Forge のスタイル(styles.csv)として読めませんでした') + f" ({e})") from e
    head = [h.strip().lower() for h in rows[0]] if rows else []
    if "name" not in head or "prompt" not in head:
        raise ValueError(tr('Forge のスタイル(styles.csv)として読めませんでした') + " (name, prompt, negative_prompt)")
    ci = head.index("name")
    cp = head.index("prompt")
    cn = head.index("negative_prompt") if "negative_prompt" in head else (head.index("negative") if "negative" in head else -1)
    presets, info = {}, {"rows": 0, "count": 0, "prompt_tag": 0, "dup": 0, "empty": 0, "over": 0, "cut_name": 0}
    for r in rows[1:]:
        if not any(c.strip() for c in r):
            continue
        info["rows"] += 1
        cell = lambda i: (r[i] if 0 <= i < len(r) else "")  # noqa: E731
        name = " ".join(cell(ci).split())
        pos, neg = cell(cp).strip(), cell(cn).strip()
        tag = "{prompt}" in pos or "{prompt}" in neg
        if tag:
            pos, neg = _drop_prompt_tag(pos), _drop_prompt_tag(neg)
        if not name or not (pos or neg):
            info["empty"] += 1  # 名前が無い・中身が無い(A1111 の「None」・{prompt} だけのスタイルなど)
            continue
        if tag:
            info["prompt_tag"] += 1
        if len(name) > store.MAX_PRESET_NAME:
            name = name[:store.MAX_PRESET_NAME]
            info["cut_name"] += 1
        if name in presets:
            info["dup"] += 1  # 同じ名前は最初の物
            continue
        if len(presets) >= store.MAX_PRESETS:
            info["over"] += 1
            continue
        presets[name] = {"positive": pos, "negative": neg}
    if not presets:
        raise ValueError(tr('読み込めるスタイルがありませんでした'))
    info["count"] = len(presets)
    data = {"format": FORMAT, "format_version": FORMAT_VERSION, "app_version": APP_VERSION, "exported": "",
            "source": "forge_styles", "server": {"presets": {"prompt_presets.json": presets}}}
    return data, info


def base_dir():
    return os.path.abspath(store._base_dir())
