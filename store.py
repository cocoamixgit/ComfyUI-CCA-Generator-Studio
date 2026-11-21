"""前回設定とプロンプトプリセットをサーバー側の JSON に保存する。

保存先: <ComfyUI>/user/default/cca_generator/
  state_v2.json        種別ごとの前回設定(旧版の state.json は読まない)
  prompt_presets.json  プロンプトプリセット(Positive / Negative のセット)
  prompt_presets_hidden.json  一覧から消したおすすめプリセット(★)の記録 {"hidden": ["<基礎モデル>|<タスク>|<名前>", ...]}
"""
import json
import os
import threading

import folder_paths

from .i18n import tr
from .specs import MODEL_TYPES, TASK_KEYS, TASKS_ALL, TYPE_KEYS

_lock = threading.Lock()
STATE_FILE = "state_v2.json"
PRESET_FILE = "prompt_presets.json"
AUDIO_PRESET_FILE = "audio_presets.json"  # 第42版: 声・音楽のプリセット(画像・動画とは別)
HIDDEN_FILE = "prompt_presets_hidden.json"
MAX_PRESET_NAME = 80
MAX_PRESETS = 500
ALLOWED_KEYS = set(TYPE_KEYS) | set(TASK_KEYS)


def _base_dir():
    try:
        base = folder_paths.get_user_directory()
    except Exception:
        base = os.path.join(getattr(folder_paths, "base_path", os.getcwd()), "user")
    d = os.path.join(base, "default", "cca_generator")
    os.makedirs(d, exist_ok=True)
    return d


def _read(name, default):
    path = os.path.join(_base_dir(), name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, type(default)) else default
    except FileNotFoundError:
        return default
    except Exception:
        try:
            os.replace(path, path + ".broken")  # 壊れたファイルは退避して空から始める
        except Exception:
            pass
        return default


def _write(name, data):
    path = os.path.join(_base_dir(), name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _empty_state():
    return {"last": {}, "last_task": {}, "types": {}, "tasks": {}}


def _state():
    state = _read(STATE_FILE, _empty_state())
    for k, v in _empty_state().items():
        if not isinstance(state.get(k), dict):
            state[k] = v
    return state


def load_all():
    with _lock:
        return {"state": _state(), "presets": _read(PRESET_FILE, {}), "hidden": _hidden(),
                "audio_presets": _read(AUDIO_PRESET_FILE, {})}


def _hidden():
    data = _read(HIDDEN_FILE, {})
    return [x for x in data.get("hidden", []) if isinstance(x, str)]


def hide_builtin(preset_id):
    """おすすめプリセット(★)を一覧から消す。preset_id は「基礎モデル|タスク|名前」"""
    preset_id = str(preset_id or "").strip()
    if preset_id.count("|") < 2:
        raise ValueError(tr('プリセットの指定が不正です'))
    with _lock:
        hidden = _hidden()
        if preset_id not in hidden:
            hidden.append(preset_id)
            _write(HIDDEN_FILE, {"hidden": hidden})


def unhide_builtin(base, task):
    """その基礎モデル・タスクで消したおすすめプリセットを元に戻す。戻した件数を返す"""
    prefix = f"{base}|{task}|"
    with _lock:
        hidden = _hidden()
        keep = [x for x in hidden if not x.startswith(prefix)]
        if len(keep) != len(hidden):
            _write(HIDDEN_FILE, {"hidden": keep})
        return len(hidden) - len(keep)


def _pick(values):
    if not isinstance(values, dict):
        return {}
    return {k: v for k, v in values.items()
            if k in ALLOWED_KEYS and isinstance(v, (str, int, float, bool))}


def save_state(payload):
    mt, task = payload.get("model_type"), payload.get("task")
    if mt not in MODEL_TYPES or task not in TASKS_ALL:
        raise ValueError(tr('model_type / task が不正です'))
    with _lock:
        state = _state()
        state["types"][mt] = _pick(payload.get("type_values"))
        state["tasks"][f"{mt}::{task}"] = _pick(payload.get("task_values"))
        state["last_task"][mt] = task
        state["last"] = {"model_type": mt, "task": task}
        _write(STATE_FILE, state)


def reset_state(model_type=None):
    with _lock:
        state = _state()
        if model_type:
            state["types"].pop(model_type, None)
            for k in [k for k in state["tasks"] if k.startswith(model_type + "::")]:
                state["tasks"].pop(k)
        else:
            state = _empty_state()
        _write(STATE_FILE, state)


def _preset_file(group):
    return AUDIO_PRESET_FILE if group == "audio" else PRESET_FILE


def save_preset(name, positive, negative, group=""):
    """group = "audio" なら声・音楽のプリセット(別のファイル)"""
    name = (name or "").strip()[:MAX_PRESET_NAME]
    if not name:
        raise ValueError(tr('プリセット名が空です'))
    with _lock:
        presets = _read(_preset_file(group), {})
        if name not in presets and len(presets) >= MAX_PRESETS:
            raise ValueError(tr('プリセット数の上限です'))
        presets[name] = {"positive": str(positive or ""), "negative": str(negative or "")}
        _write(_preset_file(group), presets)
    return name


def delete_preset(name, group=""):
    with _lock:
        presets = _read(_preset_file(group), {})
        existed = presets.pop(name, None) is not None
        if existed:
            _write(_preset_file(group), presets)
    return existed


# ---------------------------------------------------------------- 第31版: 複数画像タイル生成の前回の設定(生成回数も)
TILE_FILE = "tile_settings.json"
TILE_MAX_TEXT = 4000


def tile_settings():
    return _read(TILE_FILE, {})


def _clean_prefs(values, nest):
    out = {}
    for k, v in list(values.items())[:100]:
        if not isinstance(k, str) or len(k) > 40:
            continue
        if isinstance(v, bool) or isinstance(v, (int, float)):
            out[k] = v
        elif isinstance(v, str):
            out[k] = v[:TILE_MAX_TEXT]
        elif isinstance(v, dict) and nest:
            out[k] = _clean_prefs(v, False)
    return out


def save_tile_settings(values):
    """画面の設定をそのまま覚える(文字・数・真偽だけ。長い文字は切る)。
    第34版: 画像用の設定の中に、動画用の設定を video として 1 段だけ入れられる"""
    if not isinstance(values, dict):
        raise ValueError(tr('設定の形が不正です'))
    out = _clean_prefs(values, True)
    with _lock:
        _write(TILE_FILE, out)
    return out


# ---------------------------------------------------------------- 文字の書式のテンプレート(動画編集)
STYLE_FILE = "text_styles.json"
STYLE_KEYS = ("font", "size", "color", "stroke", "strokeWidth", "strokeDx", "strokeDy", "strokeAlpha",
              "bg", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", "bgRadius", "strokeBlur")


def _clean_style(style):
    out = {}
    for k in STYLE_KEYS:
        if k in (style or {}):
            v = style[k]
            if k in ("font", "color", "stroke", "bg"):
                out[k] = str(v)[:512]
            else:
                try:
                    out[k] = float(v)
                except (TypeError, ValueError):
                    pass
    return out


def text_styles():
    data = _read(STYLE_FILE, {})
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    hidden = [str(x) for x in data.get("hidden", []) if isinstance(x, str)]
    return user, hidden


def save_text_style(name, style):
    name = (name or "").strip()[:MAX_PRESET_NAME]
    if not name:
        raise ValueError(tr('テンプレートの名前が空です'))
    with _lock:
        data = _read(STYLE_FILE, {})
        user = data.get("user") if isinstance(data.get("user"), dict) else {}
        if name not in user and len(user) >= MAX_PRESETS:
            raise ValueError(tr('テンプレートの数の上限です'))
        user[name] = _clean_style(style)
        data["user"] = user
        _write(STYLE_FILE, data)
    return name


def delete_text_style(name):
    with _lock:
        data = _read(STYLE_FILE, {})
        user = data.get("user") if isinstance(data.get("user"), dict) else {}
        existed = user.pop(name, None) is not None
        if existed:
            data["user"] = user
            _write(STYLE_FILE, data)
    return existed


def hide_text_style(name, hide=True):
    """おすすめ(★)を隠す / 全部戻す(name なし)"""
    with _lock:
        data = _read(STYLE_FILE, {})
        hidden = [x for x in data.get("hidden", []) if isinstance(x, str)]
        if hide and name and name not in hidden:
            hidden.append(name)
        elif not hide:
            hidden = [x for x in hidden if name and x != name] if name else []
        data["hidden"] = hidden
        _write(STYLE_FILE, data)
    return hidden
