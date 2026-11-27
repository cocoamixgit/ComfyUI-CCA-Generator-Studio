"""追加ノード(Kandinsky 6 の kandinsky6)の入れ方の案内と、生成したファイルのフォルダを開く処理。

入れ方は、使っている ComfyUI の状態(ComfyUI Manager が有効か・StabilityMatrix か・ポータブル版か)を見て、
その人に合う方法から順に出す。コマンドやフォルダは、この ComfyUI の実際の場所で組み立てる。
"""
import importlib.util
import os
import subprocess
import sys

import folder_paths

from .i18n import tr
from . import model_dirs

# 追加ノードの情報(配布元の説明: https://github.com/kandinskylab/kandinsky-6/tree/main/comfyui)
ADDONS = {
    "Kandinsky6Sampler": {
        "name": "kandinsky6", "author": "kandinskylab", "title": "Kandinsky 6",
        "repo": "https://github.com/kandinskylab/kandinsky-6",
        "zip": "https://github.com/kandinskylab/kandinsky-6/archive/refs/heads/main.zip",
        "zip_folder": "kandinsky-6-main/comfyui", "folder": "kandinsky6",
        "readme": "https://github.com/kandinskylab/kandinsky-6/tree/main/comfyui",
    },
    "SenseNovaU1ModelLoader": {
        "name": "ComfyUI-SenseNova-U1", "author": "OpenSenseNova", "title": "SenseNova-U1.6",
        "repo": "https://github.com/OpenSenseNova/ComfyUI-SenseNova-U1",
        "zip": "https://github.com/OpenSenseNova/ComfyUI-SenseNova-U1/archive/refs/heads/main.zip",
        "zip_folder": "ComfyUI-SenseNova-U1-main", "folder": "ComfyUI-SenseNova-U1",
        "readme": "https://github.com/OpenSenseNova/ComfyUI-SenseNova-U1",
    },
    # 第42版: 声・音楽
    "AILab_Qwen3TTSCustomVoice": {
        "name": "ComfyUI-QwenTTS", "author": "1038lab", "title": "Qwen3-TTS", "extra_pkgs": "qwen-tts",
        "repo": "https://github.com/1038lab/ComfyUI-QwenTTS",
        "zip": "https://github.com/1038lab/ComfyUI-QwenTTS/archive/refs/heads/main.zip",
        "zip_folder": "ComfyUI-QwenTTS-main", "folder": "ComfyUI-QwenTTS",
        "readme": "https://github.com/1038lab/ComfyUI-QwenTTS",
    },
    "LatentSyncNode": {
        "name": "ComfyUI-LatentSyncWrapper", "author": "ShmuelRonen", "title": "LatentSync 1.6",
        "repo": "https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper",
        "zip": "https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper/archive/refs/heads/main.zip",
        "zip_folder": "ComfyUI-LatentSyncWrapper-main", "folder": "ComfyUI-LatentSyncWrapper",
        "readme": "https://github.com/ShmuelRonen/ComfyUI-LatentSyncWrapper",
    },
    "FL_HeartMuLa_Sampler": {
        "name": "ComfyUI_FL-HeartMuLa", "author": "filliptm", "title": "HeartMuLa",
        "repo": "https://github.com/filliptm/ComfyUI_FL-HeartMuLa",
        "zip": "https://github.com/filliptm/ComfyUI_FL-HeartMuLa/archive/refs/heads/master.zip",
        "zip_folder": "ComfyUI_FL-HeartMuLa-master", "folder": "ComfyUI_FL-HeartMuLa",
        "readme": "https://github.com/filliptm/ComfyUI_FL-HeartMuLa",
    },
}


def _comfy_dir():
    return os.path.dirname(os.path.abspath(folder_paths.__file__))


def _custom_nodes_dir():
    try:
        return folder_paths.get_folder_paths("custom_nodes")[0]
    except Exception:  # noqa: BLE001
        return os.path.join(_comfy_dir(), "custom_nodes")


def _manager_state():
    """"on"(使える)/ "off"(入っているが --enable-manager で起動していない)/ "none"(入っていない)"""
    legacy = False
    for d in folder_paths.get_folder_paths("custom_nodes"):
        try:
            legacy = legacy or any("comfyui-manager" in n.lower() and os.path.isdir(os.path.join(d, n))
                                   for n in os.listdir(d))
        except OSError:
            pass
    try:
        from comfy.cli_args import args
        enabled = bool(getattr(args, "enable_manager", False))
    except Exception:  # noqa: BLE001
        enabled = False
    pkg = importlib.util.find_spec("comfyui_manager") is not None
    if legacy or (enabled and pkg):
        return "on"
    return "off" if pkg else "none"


def _q(p):
    return f'"{p}"' if " " in str(p) or sys.platform.startswith("win") else str(p)


def environment():
    comfy = _comfy_dir()
    low = comfy.replace("\\", "/").lower()
    parent = os.path.dirname(comfy)
    bats = [b for b in ("run_nvidia_gpu.bat", "run_cpu.bat", "run_amd_gpu.bat") if os.path.isfile(os.path.join(parent, b))]
    req = os.path.join(comfy, "manager_requirements.txt")
    py = os.path.normpath(sys.executable)
    return {
        "manager": _manager_state(),
        "stability_matrix": "stabilitymatrix" in low or "/data/packages/" in low,
        "portable": "python_embeded" in py.lower() or bool(bats),
        "launch_bats": [os.path.join(parent, b) for b in bats],
        "python": py, "comfy_dir": comfy, "custom_nodes": _custom_nodes_dir(),
        "manager_pip": f"{_q(py)} -m pip install -r {_q(req)}" if os.path.isfile(req) else "",
    }


def addon_help(node_name):
    a = ADDONS.get(node_name)
    if not a:
        raise ValueError(tr('案内の無い追加ノードです'))
    env = environment()
    folder = os.path.join(env["custom_nodes"], a["folder"])
    return {**a, "env": env, "installed": node_name in __import__("nodes").NODE_CLASS_MAPPINGS,
            "target": folder,
            "pip": f'{_q(env["python"])} -m pip install -r {_q(os.path.join(folder, "requirements.txt"))}',
            "pip_extra": f'{_q(env["python"])} -m pip install {a["extra_pkgs"]}' if a.get("extra_pkgs") else ""}


# ---------------------------------------------------------------------------
# 生成したファイル(output / temp)のフォルダを開く
# ---------------------------------------------------------------------------
def output_file(filename, subfolder="", type_="output"):
    """ComfyUI の output / temp / input の中のファイルだけを、実際のパスにする(外は開かない)"""
    if type_ not in ("output", "temp", "input"):
        raise ValueError(tr('種類が不正です'))
    base = folder_paths.get_directory_by_type(type_)
    if not base or not filename or os.path.basename(filename) != filename:
        raise ValueError(tr('ファイル名が不正です'))
    path = os.path.abspath(os.path.join(base, subfolder or "", filename))
    real_base = os.path.realpath(base)
    if os.path.commonpath([os.path.realpath(path), real_base]) != real_base:
        raise ValueError(tr('このファイルの場所は開けません'))
    if not os.path.isfile(path):
        raise ValueError(tr('ファイルが見つかりません(移動・削除された可能性があります): {path}', path=path))
    return path


def _reveal(path):
    """フォルダを開き、できる OS ではファイルを選んだ状態にする(テストではここを差し替える)"""
    if sys.platform.startswith("win"):
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])  # noqa: S603,S607
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path])  # noqa: S603,S607
    else:
        model_dirs._launch(os.path.dirname(path))


def open_output(filename, subfolder="", type_="output"):
    path = output_file(filename, subfolder, type_)
    _reveal(path)
    return path
