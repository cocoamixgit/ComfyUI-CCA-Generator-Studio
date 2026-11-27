"""言語パック(サーバー側)。

locales/<言語>/cca_panel.json の "strings" は「日本語の文 → その言語の文」。元の文は日本語。
- パネル(web/cca_i18n.js)は画面の文字を訳す
- ここの tr() は、サーバーから出すメッセージ(生成時のエラーなど)を訳す
- 言語はパネルで選んだもの(「自動」なら ComfyUI の言語設定)。パネルが開いたときに知らせてくる
同じフォルダの nodeDefs.json は ComfyUI 本体の仕組みで、ノード名・説明の訳に使われる。
"""
import json
import os
import re
import threading

LOCALES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "locales")
PACK_FILE = "cca_panel.json"
CHOICE_FILE = "language.json"
JA = {"code": "ja", "name": "日本語"}

_lock = threading.Lock()
_cache = {}  # code → (mtime, data)
_state = {"lang": None, "choice": None}
_PH = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _pack_path(code):
    return os.path.join(LOCALES, code, PACK_FILE)


def _valid(code):
    return isinstance(code, str) and re.fullmatch(r"[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?", code or "") is not None


def load(code):
    """言語パック(無ければ空)。ファイルを書き換えたら読み直す。"""
    if not _valid(code):
        return {}
    path = _pack_path(code)
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    with _lock:
        hit = _cache.get(code)
        if hit and hit[0] == mtime:
            return hit[1]
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            data = {}
    except Exception as e:  # noqa: BLE001
        print(f"[CCA Generator] 言語パックを読めませんでした ({path}): {e}")
        data = {}
    with _lock:
        _cache[code] = (mtime, data)
    return data


def strings(code):
    s = load(code).get("strings")
    return s if isinstance(s, dict) else {}


def packs():
    """選べる言語: 日本語(元の文)+ locales/<言語>/cca_panel.json があるもの"""
    out = [dict(JA)]
    try:
        names = sorted(os.listdir(LOCALES))
    except OSError:
        names = []
    for code in names:
        if code == "ja" or not _valid(code) or not os.path.isfile(_pack_path(code)):
            continue
        meta = load(code).get("_meta") or {}
        out.append({"code": code, "name": str(meta.get("name") or code)})
    return out


def _saved():
    from . import store  # store も tr を使うので、ここで読む
    d = store._read(CHOICE_FILE, {})
    return d if isinstance(d, dict) else {}


def resolve(choice, comfy):
    """選んだ言語("auto" なら ComfyUI の言語)→ 使う言語"""
    codes = [p["code"] for p in packs()]
    if choice and choice != "auto" and choice in codes:
        return choice
    loc = str(comfy or "").replace("_", "-")
    for c in (loc, loc.split("-")[0].lower()):
        if c in codes:
            return c
    if loc.split("-")[0].lower() == "ja" or not loc:
        return "ja"
    return "en" if "en" in codes else "ja"


def info(comfy=None, choice=None):
    """パネルに渡す: 選んだもの・使う言語・選べる言語・訳"""
    saved = _saved()
    if choice is None:
        choice = saved.get("choice", "auto")
    if comfy is None:
        comfy = saved.get("comfy", "")
    lang = resolve(choice, comfy)
    if (saved.get("choice"), saved.get("lang"), saved.get("comfy")) != (choice, lang, comfy):
        try:
            from . import store
            store._write(CHOICE_FILE, {"choice": choice, "lang": lang, "comfy": comfy})
        except Exception as e:  # noqa: BLE001
            print(f"[CCA Generator] 言語の設定を保存できませんでした: {e}")
    _state["lang"], _state["choice"] = lang, choice
    return {"choice": choice, "lang": lang, "packs": packs(), "strings": strings(lang)}


def current():
    if _state["lang"] is None:
        saved = _saved()
        _state["lang"] = resolve(saved.get("choice", "auto"), saved.get("comfy", ""))
    return _state["lang"]


def _fill(text, kw):
    if not kw:
        return text
    return _PH.sub(lambda m: str(kw[m.group(1)]) if m.group(1) in kw else m.group(0), text)


def tr(text, **kw):
    """サーバーから出す文を今の言語にする。{name} に kw の値を入れる(訳が無ければ日本語のまま)。"""
    code = current()
    out = text
    if code != "ja" or os.path.isfile(_pack_path("ja")):
        t = strings(code).get(text)
        if isinstance(t, str) and t:
            out = t
    return _fill(out, kw)
