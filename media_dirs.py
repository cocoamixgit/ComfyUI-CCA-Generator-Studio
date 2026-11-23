"""画像・動画を読み込む場所の追加(ComfyUI 標準の input 以外)。

追加したフォルダは media_dirs.json(model_dirs.json と同じ形)に保存する。
画像は、input/cca_links の下にフォルダへのリンク(Windows はジャンクション)を作って、
ComfyUI の画像ノードが直接読める名前(cca_links/<名前>/<ファイル>)で入力画像のプルダウンに出す。コピーはしない。
"""
import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
import threading

import folder_paths

from .i18n import current, tr
from .store import _base_dir

FILE = "media_dirs.json"
LINK_DIR = "cca_links"
KINDS = {"images": "画像を読み込む場所", "videos": "動画を読み込む場所"}
KIND_HELP = {
    "images": "入力画像のプルダウンに出す画像(png・jpg・webp など)のフォルダです。標準のフォルダ(input・output)も外せます(最低 1 個は残ります)。追加したフォルダの画像は、フォルダ名ごとにまとまって表示されます。",
    "videos": "動画(mp4・webm・mov など)のフォルダです。標準のフォルダ(input・output)も外せます(最低 1 個は残ります)。リップシンクの動画や動画編集の動画の選択肢に、フォルダ名ごとにまとまって表示されます。",
}
EXTS = {
    "images": (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"),
    "videos": (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"),
}
_lock = threading.Lock()


def _path():
    return os.path.join(_base_dir(), FILE)


def _raw():
    """{"images": [...], "videos": [...], "hidden": {"images": [...], "videos": [...]}}(hidden = 外した標準の場所)"""
    try:
        with open(_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:  # noqa: BLE001
        data = {}
    if not isinstance(data, dict):
        data = {}
    hid = data.get("hidden") if isinstance(data.get("hidden"), dict) else {}
    out = {k: [p for p in data.get(k, []) if isinstance(p, str)] for k in KINDS}
    out["hidden"] = {k: [p for p in hid.get(k, []) if isinstance(p, str)] for k in KINDS}
    opt = data.get("options") if isinstance(data.get("options"), dict) else {}
    out["options"] = {"recursive": bool(opt.get("recursive", False)), "history_top": bool(opt.get("history_top", True))}
    return out


def options():
    """{recursive: サブフォルダも探す(既定 False), history_top: 生成履歴のファイルを一番上に足す(既定 True)}"""
    return _raw()["options"]


def set_option(name, value):
    if name not in ("recursive", "history_top"):
        raise ValueError(tr("action が不正です"))
    with _lock:
        data = _raw()
        data["options"][name] = bool(value)
        _save(data)


def _scan(p, kind):
    """フォルダ内のファイル名(サブフォルダを含める設定なら、p からの相対パス)"""
    exts = EXTS[kind]
    if not options()["recursive"]:
        return sorted(f.name for f in os.scandir(p) if f.is_file() and f.name.lower().endswith(exts))
    out = []
    for root, _, files in os.walk(p):
        for f in files:
            if f.lower().endswith(exts):
                out.append(os.path.relpath(os.path.join(root, f), p).replace("\\", "/"))
    return sorted(out)


def history_files(kind):
    """ComfyUI の生成履歴にある出力ファイル(新しい順)。\"サブフォルダ/ファイル [output]\" の形"""
    out = []
    try:
        from server import PromptServer
        hist = PromptServer.instance.prompt_queue.get_history()
        for _, h in reversed(list(hist.items())):
            for node_out in (h.get("outputs") or {}).values():
                for v in node_out.values():
                    if not isinstance(v, list):
                        continue
                    for it in v:
                        if isinstance(it, dict) and it.get("type") == "output" and str(it.get("filename", "")).lower().endswith(EXTS[kind]):
                            rel = "/".join(x for x in (it.get("subfolder"), it["filename"]) if x)
                            if f"{rel} [output]" not in out:
                                out.append(f"{rel} [output]")
    except Exception:  # noqa: BLE001
        pass
    return out


def load():
    raw = _raw()
    return {k: raw[k] for k in KINDS}


def _same(a, b):
    return os.path.normcase(os.path.normpath(a)) == os.path.normcase(os.path.normpath(b))


def _shown_standard(kind, raw=None):
    raw = raw or _raw()
    return [p for p in _standard(kind) if not any(_same(p, h) for h in raw["hidden"][kind])]


def shows(kind, which):
    """標準の場所(which = "input" か "output")を、この種類の一覧に出しているか(外していなければ True)"""
    d = folder_paths.get_input_directory() if which == "input" else folder_paths.get_output_directory()
    return any(_same(d, p) for p in _shown_standard(kind))


def _save(data):
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _path())


def normalize(path):
    p = str(path or "").strip().strip('"').strip("'")
    if not p:
        raise ValueError(tr("フォルダのパスが空です"))
    return os.path.normpath(os.path.abspath(os.path.expanduser(p)))


def _standard(kind):
    """標準の場所(外せない。最低 1 個)"""
    return [os.path.normpath(p) for p in (folder_paths.get_input_directory(), folder_paths.get_output_directory())]


def all_paths():
    data = load()
    return [p for k in KINDS for p in _standard(k) + data[k]]


def add(kind, path):
    if kind not in KINDS:
        raise ValueError(tr("種類が不正です"))
    p = normalize(path)
    if not os.path.isdir(p):
        raise ValueError(tr("フォルダが見つかりません: {p}", p=p))
    with _lock:
        data = _raw()
        std = next((s for s in _standard(kind) if _same(s, p)), None)
        if std:  # 外していた標準の場所を戻す
            if std in _shown_standard(kind, data):
                raise ValueError(tr("このフォルダはすでにあります"))
            data["hidden"][kind] = [h for h in data["hidden"][kind] if not _same(h, std)]
            _save(data)
            return std
        if p in data[kind]:
            raise ValueError(tr("このフォルダはすでにあります"))
        data[kind].append(p)
        _save(data)
    ensure_link(p)  # 画像・動画とも、input の中のリンク経由で ComfyUI のノードに渡す
    return p


def remove(kind, path):
    if kind not in KINDS:
        raise ValueError(tr("種類が不正です"))
    p = normalize(path)
    with _lock:
        data = _raw()
        std = next((s for s in _shown_standard(kind, data) if _same(s, p)), None)
        if std is None and p not in data[kind]:
            raise ValueError(tr("一覧にないフォルダです"))
        if len(_shown_standard(kind, data)) + len(data[kind]) <= 1:
            raise ValueError(tr("最低 1 個は残す必要があります"))
        if std is not None:  # 標準の場所は、外した記録を残す(あとから追加で戻せる)
            data["hidden"][kind].append(std)
        else:
            data[kind].remove(p)
        _save(data)
    if std is None and not any(p in data[k] for k in KINDS):
        _drop_link(p)


def _alias(p):
    base = re.sub(r'[<>:"/\\|?*\x00-\x1f\s]', "_", os.path.basename(p) or "folder")[:40]
    return f"{base}_{hashlib.sha1(os.path.normcase(p).encode('utf-8')).hexdigest()[:6]}"


def _link_path(p):
    return os.path.join(folder_paths.get_input_directory(), LINK_DIR, _alias(p))


def ensure_link(p):
    """input/cca_links/<名前> → フォルダ のリンクを作る(あれば何もしない)。リンクの相対名を返す"""
    link = _link_path(p)
    if not os.path.lexists(link):
        os.makedirs(os.path.dirname(link), exist_ok=True)
        if sys.platform.startswith("win"):
            r = subprocess.run(["cmd", "/c", "mklink", "/J", link, p], capture_output=True)
            if r.returncode != 0:
                raise ValueError(tr("フォルダへのリンクを作れませんでした: {p}", p=p))
        else:
            os.symlink(p, link, target_is_directory=True)
    return f"{LINK_DIR}/{_alias(p)}"


def _drop_link(p):
    link = _link_path(p)
    try:
        if os.path.islink(link):
            os.unlink(link)
        elif os.path.lexists(link):
            os.rmdir(link)  # ジャンクションは中身ごと消さず、リンクだけ外れる
    except OSError:
        pass


def list_images():
    """追加したフォルダの画像(入力画像のプルダウン用)。cca_links/<名前>/<ファイル> の形"""
    return list_files("images")


def list_files(kind, suffix=""):
    """追加したフォルダのファイル。cca_links/<名前>/<ファイル><suffix> の形(動画は " [input]" を付ける)"""
    out = []
    for p in load()[kind]:
        if not os.path.isdir(p):
            continue
        try:
            rel = ensure_link(p)
            names = _scan(p, kind)
        except Exception:  # noqa: BLE001
            continue
        out += [f"{rel}/{n}{suffix}" for n in names]
    return out


def _count(p, kind):
    try:
        return len(_scan(p, kind))
    except Exception:  # noqa: BLE001
        return 0


def info():
    """model_dirs.info() と同じ形: {kind: {label, help, paths: [{path, registered, custom, source, count}]}}"""
    raw = _raw()
    out = {}
    for kind, label in KINDS.items():
        items = []
        entries = [(x, False) for x in _shown_standard(kind, raw)] + [(x, True) for x in raw[kind]]
        for p, custom in entries:
            if os.path.isdir(p):
                # custom = 「外す」を出すか(標準の場所も外せる。最後の 1 個だけは外せない)
                items.append({"path": p, "registered": p, "custom": len(entries) > 1,
                              "source": "custom" if custom else "default", "real": "", "count": _count(p, kind), "more": False})
        out[kind] = {"label": label, "help": KIND_HELP[kind], "paths": items}
    return out


# Windows 標準の「フォルダーの選択」画面(エクスプローラーと同じ形式)。いまの前面のウィンドウ(ブラウザ)の持ち物として開くので、後ろに隠れない
_WIN_PICKER_CS = r"""
using System; using System.Runtime.InteropServices;
public class CCAFolderPicker {
  [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")] class FileOpenDialogRCW {}
  [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint c, IntPtr f); void SetFileTypeIndex(uint i); void GetFileTypeIndex(out uint i);
    void Advise(IntPtr p, out uint c); void Unadvise(uint c); void SetOptions(uint o); void GetOptions(out uint o);
    void SetDefaultFolder(IShellItem s); void SetFolder(IShellItem s); void GetFolder(out IShellItem s);
    void GetCurrentSelection(out IShellItem s);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string n); void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string t); void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string t);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string t); void GetResult(out IShellItem s);
    void AddPlace(IShellItem s, int a); void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string e);
    void Close(int hr); void SetClientGuid(ref Guid g); void ClearClientData(); void SetFilter(IntPtr f);
  }
  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv); void GetParent(out IShellItem p);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string n); void GetAttributes(uint m, out uint a);
    void Compare(IShellItem s, uint h, out int o);
  }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] static extern ushort SetThreadUILanguage(ushort lang);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItem item);
  public static string Pick(string title, string initial) {
    var owner = GetForegroundWindow();
    ushort lid;  // 画面の言語(日本語なら 1041)。その言語の表示リソースが入っていれば、ボタンなども同じ言語で出る
    if (ushort.TryParse(Environment.GetEnvironmentVariable("CCA_LANGID"), out lid) && lid != 0) SetThreadUILanguage(lid);
    var d = (IFileDialog)new FileOpenDialogRCW();
    uint o; d.GetOptions(out o); d.SetOptions(o | 0x20 | 0x40 | 0x800); // フォルダ選択・ファイルシステムのみ・存在するパスのみ
    if (!string.IsNullOrEmpty(title)) d.SetTitle(title);
    string okl = Environment.GetEnvironmentVariable("CCA_OK"), nl = Environment.GetEnvironmentVariable("CCA_NAMELABEL");
    if (!string.IsNullOrEmpty(okl)) d.SetOkButtonLabel(okl);
    if (!string.IsNullOrEmpty(nl)) d.SetFileNameLabel(nl);
    try {
      if (!string.IsNullOrEmpty(initial) && System.IO.Directory.Exists(initial)) {
        Guid iid = new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"); IShellItem si;
        SHCreateItemFromParsingName(initial, IntPtr.Zero, ref iid, out si); d.SetFolder(si);
      }
    } catch (Exception) { }
    if (d.Show(owner) != 0) return "";  // 取り消し
    IShellItem r; d.GetResult(out r); string p; r.GetDisplayName(0x80058000, out p); return p;
  }
}
"""


def _pick_blocking(initial, title=""):
    env = dict(os.environ)
    kw = {}
    title = title or tr("追加するフォルダを選んでください")
    if sys.platform.startswith("win"):
        import base64
        env["CCA_INITIAL"], env["CCA_TITLE"] = initial or "", title
        env["CCA_OK"], env["CCA_NAMELABEL"] = tr("フォルダーの選択"), tr("フォルダー:")
        env["CCA_LANGID"] = {"ja": "1041"}.get(current(), "0")  # 日本語のときだけ、画面の言語を日本語にする
        ps = ("$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
              "Add-Type -TypeDefinition @'\n" + _WIN_PICKER_CS + "\n'@\n"
              "[CCAFolderPicker]::Pick($env:CCA_TITLE,$env:CCA_INITIAL)")
        cmd = ["powershell", "-NoProfile", "-STA", "-EncodedCommand", base64.b64encode(ps.encode("utf-16-le")).decode()]
        kw["creationflags"] = 0x08000000  # 黒い窓を出さない
    elif sys.platform == "darwin":
        cmd = ["osascript", "-e", 'POSIX path of (choose folder with prompt "%s")' % (title or "Folder")]
    else:
        code = ("import tkinter as tk\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw();r.attributes('-topmost',True)\n"
                "print(filedialog.askdirectory(initialdir=%r) or '')" % (initial or os.path.expanduser("~")))
        cmd = [sys.executable, "-c", code]
    r = subprocess.run(cmd, capture_output=True, timeout=600, env=env, **kw)
    out = r.stdout.decode("utf-8", "replace").strip()
    if r.returncode != 0 and not out:
        if sys.platform == "darwin":
            return ""  # 取り消し
        raise ValueError(tr("フォルダを選ぶ画面を開けませんでした。パスを直接入力してください"))
    return out


async def pick_folder(initial="", title=""):
    """フォルダを選ぶ画面(ComfyUI を動かしているパソコンで開く)。選んだパス(取り消しは空)を返す"""
    return await asyncio.get_running_loop().run_in_executor(None, _pick_blocking, initial, title)
