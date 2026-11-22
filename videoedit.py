"""動画編集(web/cca_videoedit.js)のサーバー側。PyAV(ComfyUI に入っている)と Pillow だけで書き出す。

編集の内容(プロジェクト)は JSON:
  {"size": [幅, 高さ], "fps": 24, "bg": "black" | "white" | "transparent", "format": "mp4" | "webm" | "webp" | "gif",
   "export": {"fps": 書き出す fps(0 = 同じ), "loop": 0, "quality": 85, "lossless": false},
   "clips": [{"src", "in", "out", "crop", "speed", "x", "y", "s", "rot", "opacity", "kf", "kfEase", "tin", "tout", "key"}, …],
   "overlays": [{"kind": "text" | "image" | "video", "start", "end", "x", "y", "w", "h", "rot", "opacity", "kf", "tin", "tout",
                 "key", "speed", 文字: "text", "font", "size", "color", "stroke", "strokeWidth", "strokeDx", "strokeDy",
                 "strokeAlpha", "bg", "bgAlpha", "bgPadX", "bgPadY", "bgOffX", "bgOffY", 動画: "in", "audio", "volume"}, …],
   "audios": [{"src", "start", "in", "out", "speed", "volume", "mute", "keepPitch", "fadeIn", "fadeOut"}, …]}
- kf: キーフレーム [{"t": そのレイヤーの始まりからの秒, "x", "y", …}]。kfEase: "smooth"(なめらか)/ "linear"
- tin / tout: 入る・出るときのトランジション {"type", "dur", "flipH", "flipV", "rev", "dir"}(TRANSITIONS。第20版の動き MOTION_IN は dir: top / bottom / left / right)
- 第22版: kind "mosaic"(モザイク {"mosaic": "pixel" | "blur" | "fill", "block": 粗さ(短い辺に対して), "shape": "rect" | "ellipse", "color"})。
  位置・大きさ・回転・動きは画像と同じ。下の段を描いた画面のその場所を加工する
- loop: ずっと続ける動き {"type", "speed", "amt", "dir", "pin"}(LOOPS)。第21版: edge(ふちのぼかし {"mode": "feather" | "blur", "size", "amt"})・
  トランジションの blur(ぼかしも重ねる)と type "blur"・ループの "focus"・文字の strokeBlur(縁 = 影のぼかし。文字の大きさに対して)。文字: wrap(折り返し幅・画面の幅に対して)・wrapped(画面で折り返した文)・bgRadius(背景の角の丸み 0〜1)
- key: 背景を透明にする {"mode": "chroma"(色で抜く)| "ai"(BiRefNet)| "alpha"(元の透明度), "color", "tol", "soft", "despill"}
- audios が無いとき(第18版までの形)は、つなげる動画の音を音量(volume)で使う。音が全部無音なら、音の無いファイルにする
- 出力: 最初の動画と同じフォルダに「元の名前_edit.<形式>」(あれば _edit_1 …)
"""
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from fractions import Fraction

import av
import numpy as np
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFilter, ImageFont

import folder_paths

from .i18n import tr
from .imgedit import EDIT_SUFFIX, parse_value
from .prefix import prefix_folder

AUDIO_RATE = 48000
MAX_SIDE = 4096
VIDEO_EXTS = (".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".gif")
IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus")

# 日本語も書けるフォント(見つかった最初のもの)。user/default/cca_generator/fonts に置いたものが優先
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\meiryob.ttc", r"C:\Windows\Fonts\meiryo.ttc", r"C:\Windows\Fonts\YuGothB.ttc",
    r"C:\Windows\Fonts\YuGothM.ttc", r"C:\Windows\Fonts\BIZ-UDGothicB.ttc", r"C:\Windows\Fonts\msgothic.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc", "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc", "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf", "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def user_font_dir():
    try:
        base = folder_paths.get_user_directory()
    except Exception:  # noqa: BLE001
        base = os.path.join(getattr(folder_paths, "base_path", os.getcwd()), "user")
    return os.path.join(base, "default", "cca_generator", "fonts")


def find_font():
    """文字の標準のフォント。フォントのフォルダ(のすぐ下)に置いたものが優先。Google Fonts から入れたもの(google の中)は標準にしない"""
    d = user_font_dir()
    if os.path.isdir(d):
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(FONT_EXTS) and os.path.isfile(os.path.join(d, f)):
                return os.path.join(d, f)
    for p in FONT_CANDIDATES:
        if os.path.isfile(p):
            return p
    # この PC に日本語のフォントが無いときは、Google Fonts から入れたもの(日本語が書けるもの)
    g = os.path.join(d, GOOGLE_DIR)
    if os.path.isdir(g):
        for f in sorted(os.listdir(g)):
            p = os.path.join(g, f)
            if f.lower().endswith(FONT_EXTS) and os.path.isfile(p):
                try:
                    if _has_ja(ImageFont.truetype(p, 24)):
                        return p
                except Exception:  # noqa: BLE001
                    pass
    return None


# ---------------------------------------------------------------- フォントを選ぶ(文字ごと)
FONT_EXTS = (".ttf", ".ttc", ".otf")
GOOGLE_DIR = "google"  # Google Fonts から入れたフォントは fonts/google に置く


def system_font_dirs():
    if sys.platform.startswith("win"):
        dirs = [os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")]
        if os.environ.get("LOCALAPPDATA"):
            dirs.append(os.path.join(os.environ["LOCALAPPDATA"], "Microsoft", "Windows", "Fonts"))
    elif sys.platform == "darwin":
        dirs = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", os.path.expanduser("~/Library/Fonts")]
    else:
        dirs = ["/usr/share/fonts", "/usr/local/share/fonts", os.path.expanduser("~/.fonts"), os.path.expanduser("~/.local/share/fonts")]
    return [d for d in dirs if os.path.isdir(d)]


def _font_files():
    out = []
    for src, d in [("user", user_font_dir())] + [("system", x) for x in system_font_dirs()]:
        if not os.path.isdir(d):
            continue
        for root, _, files in os.walk(d):
            for f in files:
                if f.lower().endswith(FONT_EXTS):
                    p = os.path.join(root, f)
                    try:
                        out.append((src, p, os.path.getmtime(p)))
                    except OSError:
                        pass
    return out


def _glyph(font, ch):
    im = Image.new("L", (56, 56))
    ImageDraw.Draw(im).text((4, 4), ch, font=font, fill=255)
    return im.tobytes()


def _has_ja(font):
    """「あ」の形が、無い文字(□)と違えば日本語が書ける"""
    try:
        a = _glyph(font, "あ")
        return any(a) and a != _glyph(font, "\U0010FFFD")
    except Exception:  # noqa: BLE001
        return False


_WEIGHTS = [("thin", 100), ("hairline", 100), ("extralight", 200), ("ultralight", 200), ("light", 300), ("medium", 500),
            ("semibold", 600), ("demibold", 600), ("extrabold", 800), ("ultrabold", 800), ("heavy", 900), ("black", 900), ("bold", 700)]


def _weight(style):
    s = re.sub(r"[\s_-]", "", str(style or "").lower())
    for k, w in _WEIGHTS:
        if k in s:
            return w
    return 400


_fonts = {"sig": None, "list": []}


def font_list(refresh=False):
    """選べるフォント [{key, family, style, weight, italic, file, source: "user" | "google" | "system", ja}]。
    key は「ファイルのパス」(.ttc の 2 つ目からは「パス#番号」)。ファイルが変わらなければ前回の結果を使う"""
    files = _font_files()
    sig = tuple((p, m) for _, p, m in files)
    if not refresh and _fonts["sig"] == sig:
        return _fonts["list"]
    gdir = os.path.join(user_font_dir(), GOOGLE_DIR)
    out = []
    for src, p, _ in files:
        n = 16 if p.lower().endswith(".ttc") else 1
        for idx in range(n):
            try:
                f = ImageFont.truetype(p, 24, index=idx)
                fam, style = f.getname()
            except Exception:  # noqa: BLE001
                break
            source = "google" if src == "user" and os.path.commonpath([os.path.abspath(p), os.path.abspath(gdir)]) == os.path.abspath(gdir) else src
            out.append({"key": f"{p}#{idx}" if idx else p, "family": fam or os.path.splitext(os.path.basename(p))[0],
                        "style": style or "Regular", "weight": _weight(style), "italic": bool(re.search(r"italic|oblique", str(style), re.I)),
                        "file": os.path.basename(p), "source": source, "ja": _has_ja(f)})
    order = {"user": 0, "google": 1, "system": 2}
    out.sort(key=lambda x: (order[x["source"]], not x["ja"], x["family"].lower(), x["weight"], x["style"]))
    _fonts["sig"], _fonts["list"] = sig, out
    return out


def font_entry(key):
    """選べるフォントの中にある key だけを使う(それ以外のファイルは読まない)"""
    if not key:
        return None
    return next((f for f in font_list() if f["key"] == key), None)


def font_path_index(key):
    p, _, i = str(key).partition("#")
    return p, int(i or 0)


def load_font(key, px, default_path):
    """文字ごとのフォント(無ければ標準)"""
    if key and font_entry(key):
        p, idx = font_path_index(key)
        try:
            return ImageFont.truetype(p, px, index=idx)
        except Exception:  # noqa: BLE001
            pass
    try:
        return ImageFont.truetype(default_path, px) if default_path else ImageFont.load_default(px)
    except Exception:  # noqa: BLE001
        return ImageFont.load_default()


# ---- Google Fonts(オープンなライセンスのフォント。fonts.google.com)
GF_UA = "Wget/1.21"  # 古いブラウザとして聞くと、分割されていない .ttf の場所を返す
GF_META = "https://fonts.google.com/metadata/fonts"
# つながらないときに出す一覧(日本語のフォントと、よく使われる英字のフォント)
GF_FALLBACK = ["Noto Sans JP", "Noto Serif JP", "M PLUS Rounded 1c", "M PLUS 1p", "Zen Maru Gothic", "Zen Kaku Gothic New",
               "Kosugi Maru", "Sawarabi Gothic", "Sawarabi Mincho", "Shippori Mincho", "BIZ UDPGothic", "BIZ UDPMincho",
               "Kiwi Maru", "Klee One", "Dela Gothic One", "RocknRoll One", "Reggae One", "Rampart One", "Train One",
               "Mochiy Pop One", "Hachi Maru Pop", "Yusei Magic", "Yomogi", "DotGothic16", "Potta One", "Stick",
               "Kaisei Decol", "Yuji Syuku", "Zen Kurenaido", "Roboto", "Montserrat", "Oswald", "Bebas Neue", "Anton",
               "Lobster", "Pacifico", "Playfair Display", "Permanent Marker", "Bangers"]


def _http(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": GF_UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (Google Fonts だけ)
        return r.read()


def _meta_cache_path():
    return os.path.join(os.path.dirname(user_font_dir()), "google_fonts.json")


def google_font_families(refresh=False):
    """[{family, category, ja, weights, popularity}]。日本語のフォントを先に、人気の順。1 週間は保存したものを使う"""
    cp = _meta_cache_path()
    data = None
    if not refresh and os.path.isfile(cp) and time.time() - os.path.getmtime(cp) < 7 * 86400:
        try:
            data = json.load(open(cp, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            data = None
    if data is None:
        try:
            raw = _http(GF_META).decode("utf-8")
            meta = json.loads(raw[raw.index("{"):])
            data = []
            for f in meta.get("familyMetadataList", []):
                ws = sorted({int(re.match(r"\d+", k).group()) for k in (f.get("fonts") or {}) if re.match(r"\d+$", k)})
                data.append({"family": f["family"], "category": f.get("category") or "", "ja": "japanese" in (f.get("subsets") or []),
                             "weights": ws or [400], "popularity": f.get("popularity") or 99999})
            os.makedirs(os.path.dirname(cp), exist_ok=True)
            with open(cp, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False)
        except Exception:  # noqa: BLE001
            jp = set(GF_FALLBACK[:29])
            return {"ok": False, "families": [{"family": f, "category": "", "ja": f in jp, "weights": [400, 700], "popularity": i}
                                              for i, f in enumerate(GF_FALLBACK)]}
    data.sort(key=lambda f: (not f["ja"], f["popularity"]))
    return {"ok": True, "families": data}


def _safe_name(s):
    return re.sub(r"[^A-Za-z0-9_-]+", "", str(s).replace(" ", "")) or "font"


def google_font_download(family, weights=(400, 700)):
    """Google Fonts のフォントを fonts/google に入れる。入れたファイルの [{key, family, style, weight}] を返す"""
    fam = str(family or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 \-]{0,63}", fam):
        raise ValueError(tr("フォントの名前が正しくありません: {name}", name=fam))
    q = urllib.parse.quote_plus(fam)
    found = {}
    for w in sorted({int(x) for x in weights}):
        try:
            css = _http(f"https://fonts.googleapis.com/css2?family={q}:wght@{w}").decode("utf-8")
        except urllib.error.HTTPError:
            continue  # その太さが無い
        for m in re.finditer(r"font-weight:\s*(\d+);.*?src:\s*url\((https://fonts\.gstatic\.com/[^)]+)\)", css, re.S):
            found.setdefault(int(m.group(1)), m.group(2))
    if not found:  # 太さを選べないフォント
        try:
            css = _http(f"https://fonts.googleapis.com/css2?family={q}").decode("utf-8")
        except urllib.error.HTTPError as e:
            raise ValueError(tr("Google Fonts に「{name}」が見つかりません", name=fam)) from e
        except OSError as e:
            raise ValueError(tr("Google Fonts につながりません: {error}", error=e)) from e
        for m in re.finditer(r"font-weight:\s*(\d+);.*?src:\s*url\((https://fonts\.gstatic\.com/[^)]+)\)", css, re.S):
            found.setdefault(int(m.group(1)), m.group(2))
    if not found:
        raise ValueError(tr("Google Fonts に「{name}」が見つかりません", name=fam))
    d = os.path.join(user_font_dir(), GOOGLE_DIR)
    os.makedirs(d, exist_ok=True)
    saved = []
    for w, url in sorted(found.items()):
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
        if ext not in FONT_EXTS:
            ext = ".ttf"
        path = os.path.join(d, f"{_safe_name(fam)}-{w}{ext}")
        data = _http(url, timeout=120)
        tmp = path + ".part"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
        saved.append(path)
    lst = font_list(refresh=True)
    return [f for f in lst if font_path_index(f["key"])[0] in saved]


# ---------------------------------------------------------------- ファイル
def full_path(value):
    v = str(value or "").strip()
    # 透かし(user/default/cca_generator/watermarks)。前の版の「cca_watermarks/名前 [input]」も、移したあとはこちらを見る
    if v.endswith(f" [{WM_TAG}]"):
        return _watermark_path(v[: -len(WM_TAG) - 3])
    typ, sub, name = parse_value(value)
    if typ == "input" and sub == WATERMARK_DIR and not os.path.isfile(os.path.join(folder_paths.get_input_directory(), sub, name)):
        return _watermark_path(name)
    base = folder_paths.get_directory_by_type(typ)
    if not base or not name:
        raise ValueError(tr("ファイルが見つかりません: {name}", name=value))
    path = os.path.abspath(os.path.join(base, sub, name))
    if os.path.commonpath([path, os.path.abspath(base)]) != os.path.abspath(base) or not os.path.isfile(path):
        raise ValueError(tr("ファイルが見つかりません: {name}", name=value))
    return path


def probe(value):
    """動画・音声の長さ(秒)・fps・大きさ・音の有無・透明度の有無。音声だけのファイルは video = False"""
    path = full_path(value)
    with av.open(path) as c:
        vs = next((s for s in c.streams.video), None)
        has_audio = any(True for _ in c.streams.audio)
        if vs is None:
            if not has_audio:
                raise ValueError(tr("動画ではありません: {name}", name=value))
            dur = c.duration / av.time_base if c.duration else 0.0
            if not dur:
                a = c.streams.audio[0]
                n = 0
                for f in c.decode(a):
                    n += f.samples
                dur = n / float(a.rate or AUDIO_RATE)
            return {"duration": round(float(dur), 4), "fps": 0, "width": 0, "height": 0, "audio": True, "video": False, "alpha": False}
        fps = float(vs.average_rate or vs.guessed_rate or 24)
        dur = None
        if vs.duration is not None and vs.time_base:
            dur = float(vs.duration * vs.time_base)
        if not dur and c.duration:
            dur = c.duration / av.time_base
        if not dur:
            n = 0
            for _ in c.decode(vs):
                n += 1
            dur = n / fps
        pf = vs.codec_context.pix_fmt or ""
        alpha = _has_alpha_tag(vs) or bool(re.search(r"^(yuva|rgba|argb|bgra|abgr|gbrap|ya)", pf))
        return {"duration": round(float(dur), 4), "fps": round(fps, 4), "width": vs.codec_context.width,
                "height": vs.codec_context.height, "audio": has_audio, "video": True, "alpha": alpha}


def media_list(limit=300):
    """選べる動画・画像: input の動画・画像と、output の動画(新しい順)"""
    out = {"videos": [], "images": [], "audios": []}
    seen = set()

    def walk(typ, exts, key, cap):
        base = folder_paths.get_directory_by_type(typ)
        if not base or not os.path.isdir(base):
            return
        items = []
        for root, _, files in os.walk(base):
            for f in files:
                if f.lower().endswith(exts):
                    p = os.path.join(root, f)
                    rel = os.path.relpath(p, base).replace("\\", "/")
                    try:
                        items.append((os.path.getmtime(p), f"{rel} [{typ}]"))
                    except OSError:
                        pass
        for _, v in sorted(items, reverse=True)[:cap]:
            if v not in seen:
                seen.add(v)
                out[key].append(v)

    walk("output", VIDEO_EXTS, "videos", limit)
    walk("input", VIDEO_EXTS, "videos", limit)
    walk("input", IMAGE_EXTS, "images", limit)
    walk("output", IMAGE_EXTS, "images", limit)
    walk("input", AUDIO_EXTS, "audios", limit)
    walk("output", AUDIO_EXTS, "audios", limit)
    return out


def target_for(value, ext=".mp4", prefix=None):
    """保存先: output に「元の名前_edit.mp4」(あれば _edit_1 …)。

    prefix(生成パネルの「動画の保存先」)があれば、そのフォルダ(%date% などを置き換えたもの)に保存する。
    無いとき: 元が output の中なら同じフォルダ、input の動画なら output の一番上(input には入れない)。temp は output の同じ名前のフォルダ。
    """
    typ, sub, name = parse_value(value)
    if prefix is not None:
        sub = prefix_folder(prefix)
    elif typ == "input":
        sub = ""
    typ = "output"
    base = folder_paths.get_directory_by_type(typ) or folder_paths.get_output_directory()
    folder = os.path.abspath(os.path.join(base, sub))
    if os.path.commonpath([folder, os.path.abspath(base)]) != os.path.abspath(base):
        raise ValueError(tr("保存先のフォルダが不正です"))
    stem = os.path.splitext(os.path.basename(name or ""))[0] or "video"
    stem = re.sub(r"[\\/:*?\"<>|]", "_", EDIT_SUFFIX.sub("", stem)) or "video"
    os.makedirs(folder, exist_ok=True)
    fname = f"{stem}_edit{ext}"
    n = 1
    while os.path.exists(os.path.join(folder, fname)):
        fname = f"{stem}_edit_{n}{ext}"
        n += 1
    return folder, fname, typ, sub


# ---------------------------------------------------------------- 読み込み(時刻順に 1 コマずつ)
class FrameReader:
    """動画のコマを時刻順に取り出す(start 秒から)。at(t) は t 秒(元の動画の時刻)のコマ(RGB / RGBA の配列)。
    透明度つきの VP9 / VP8(WebM)は、透明度を読める libvpx で読む"""

    def __init__(self, path, start=0.0, alpha=False):
        self.c = av.open(path)
        self.vs = self.c.streams.video[0]
        self.vs.thread_type = "AUTO"
        self.fmt = "rgba" if alpha else "rgb24"
        self.tb = float(self.vs.time_base or 1 / 1000)
        self.dec = None
        name = self.vs.codec_context.name
        if alpha and name in ("vp9", "vp8") and _has_alpha_tag(self.vs):
            try:
                self.dec = av.codec.CodecContext.create("libvpx-vp9" if name == "vp9" else "libvpx", "r")
            except Exception:  # noqa: BLE001
                self.dec = None
        if start > 0.05:
            try:
                self.c.seek(int(max(0.0, start - 0.5) / self.tb), stream=self.vs, any_frame=False, backward=True)
            except Exception:  # noqa: BLE001
                pass
        self.it = self._frames()
        self.cur = None   # (時刻, 配列)
        self.nxt = None
        self.done = False

    def _frames(self):
        if self.dec is None:
            yield from self.c.decode(self.vs)
            return
        for pkt in self.c.demux(self.vs):
            if pkt.size == 0 and pkt.pts is None:
                continue
            for f in self.dec.decode(pkt):
                if f.pts is None:
                    f.pts = pkt.pts
                yield f
        for f in self.dec.decode(None):
            yield f

    def _pull(self):
        if self.done:
            return None
        try:
            f = next(self.it)
        except (StopIteration, av.error.EOFError):
            self.done = True
            return None
        if self.dec is not None:
            t = f.pts * self.tb if f.pts is not None else (self.cur[0] + 1 / 24 if self.cur else 0.0)
        else:
            t = float(f.time) if f.time is not None else (self.cur[0] + 1 / 24 if self.cur else 0.0)
        return (t, f.to_ndarray(format=self.fmt))

    def at(self, t):
        if self.nxt is None and not self.done:
            self.nxt = self._pull()
        while self.nxt is not None and self.nxt[0] <= t + 1e-4:
            self.cur = self.nxt
            self.nxt = self._pull()
        if self.cur is None:
            self.cur = self.nxt
        return None if self.cur is None else self.cur[1]

    def close(self):
        try:
            self.c.close()
        except Exception:  # noqa: BLE001
            pass


def _has_alpha_tag(vs):
    md = {str(k).lower(): str(v) for k, v in (vs.metadata or {}).items()}
    return md.get("alpha_mode") == "1"


def video_has_alpha(path):
    """元の動画に透明度があるか(ProRes 4444・PNG・QuickTime アニメーション・透明度つき VP9 など)"""
    try:
        with av.open(path) as c:
            vs = c.streams.video[0]
            pf = vs.codec_context.pix_fmt or ""
            return _has_alpha_tag(vs) or bool(re.search(r"^(yuva|rgba|argb|bgra|abgr|gbrap|ya)", pf))
    except Exception:  # noqa: BLE001
        return False


def read_audio(path, start, dur, volume=1.0):
    """[2, n](float32・48kHz・ステレオ)。音が無ければ無音"""
    n = max(0, int(round(dur * AUDIO_RATE)))
    out = np.zeros((2, n), dtype=np.float32)
    if n == 0:
        return out
    try:
        c = av.open(path)
    except Exception:  # noqa: BLE001
        return out
    try:
        if not c.streams.audio:
            return out
        a = c.streams.audio[0]
        tb = float(a.time_base or 1 / AUDIO_RATE)
        if start > 0.05:
            try:
                c.seek(int(max(0.0, start - 0.5) / tb), stream=a, backward=True)
            except Exception:  # noqa: BLE001
                pass
        rs = av.AudioResampler(format="fltp", layout="stereo", rate=AUDIO_RATE)
        chunks, t0 = [], None
        for f in c.decode(a):
            for g in rs.resample(f):
                arr = g.to_ndarray()
                if t0 is None:
                    t0 = float(g.time) if g.time is not None else (float(f.time) if f.time is not None else 0.0)
                chunks.append(arr)
            if t0 is not None and t0 + sum(x.shape[1] for x in chunks) / AUDIO_RATE > start + dur + 0.2:
                break
        for g in rs.resample(None):
            chunks.append(g.to_ndarray())
        if not chunks:
            return out
        data = np.concatenate(chunks, axis=1)
        if data.shape[0] == 1:
            data = np.repeat(data, 2, axis=0)
        off = int(round((start - (t0 or 0.0)) * AUDIO_RATE))
        if off < 0:
            data = np.concatenate([np.zeros((2, -off), dtype=np.float32), data], axis=1)
            off = 0
        seg = data[:2, off:off + n]
        out[:, :seg.shape[1]] = seg * float(volume)
        return out
    finally:
        c.close()


# ---------------------------------------------------------------- 第26版: 音の大きさの一覧(タイムラインの波形・音量メーター)
PEAK_RATE = 50  # 1 秒に何個
_peaks_cache = {}


def audio_peaks(value):
    """{"rate": 1 秒あたりの数, "dur": 秒, "peak": [0〜1], "rms": [0〜1]}。音を 1 回読むだけ(長い音声でもまとめて持たない)。覚えておく"""
    path = full_path(value)
    st = os.stat(path)
    key = (path, st.st_size, int(st.st_mtime))
    if key in _peaks_cache:
        return _peaks_cache[key]
    rate = 16000
    bin_n = rate // PEAK_RATE
    peak, rms = [], []
    buf = np.zeros(0, dtype=np.float32)
    c = av.open(path)
    try:
        if not c.streams.audio:
            res = {"rate": PEAK_RATE, "dur": 0.0, "peak": [], "rms": []}
            _peaks_cache[key] = res
            return res
        a = c.streams.audio[0]
        rs = av.AudioResampler(format="flt", layout="mono", rate=rate)

        def take(arr):
            nonlocal buf
            buf = np.concatenate([buf, arr.reshape(-1)])
            k = buf.size // bin_n
            if k:
                blk = buf[:k * bin_n].reshape(k, bin_n)
                peak.extend(np.abs(blk).max(axis=1).tolist())
                rms.extend(np.sqrt((blk * blk).mean(axis=1)).tolist())
                buf = buf[k * bin_n:]
        for f in c.decode(a):
            for g in rs.resample(f):
                take(g.to_ndarray().astype(np.float32))
        for g in rs.resample(None):
            take(g.to_ndarray().astype(np.float32))
        if buf.size:
            peak.append(float(np.abs(buf).max()))
            rms.append(float(np.sqrt((buf * buf).mean())))
    finally:
        c.close()
    res = {"rate": PEAK_RATE, "dur": round(len(peak) / PEAK_RATE, 3),
           "peak": [round(min(1.0, x), 3) for x in peak], "rms": [round(min(1.0, x), 3) for x in rms]}
    if len(_peaks_cache) > 64:
        _peaks_cache.clear()
    _peaks_cache[key] = res
    return res


def stretch_audio(arr, speed, keep_pitch=True):
    """速さを変える(長さ ÷ speed)。keep_pitch なら音の高さを保つ(FFmpeg の atempo)、そうでなければ再生速度と一緒に高さも変わる"""
    speed = float(speed)
    if abs(speed - 1.0) < 1e-3 or arr.shape[1] == 0:
        return arr
    n_out = max(1, int(round(arr.shape[1] / speed)))
    if not keep_pitch:
        xs = np.linspace(0, arr.shape[1] - 1, n_out)
        return np.stack([np.interp(xs, np.arange(arr.shape[1]), ch) for ch in arr]).astype(np.float32)
    # atempo は 1 段で 0.5〜2 倍。範囲外は何段かに分ける
    factors, s = [], speed
    while s > 2.0:
        factors.append(2.0)
        s /= 2.0
    while s < 0.5:
        factors.append(0.5)
        s /= 0.5
    factors.append(s)
    g = av.filter.Graph()
    src = g.add_abuffer(format="fltp", sample_rate=AUDIO_RATE, layout="stereo", time_base=Fraction(1, AUDIO_RATE))
    last = src
    for f in factors:
        node = g.add("atempo", f"{f:.6f}")
        last.link_to(node)
        last = node
    fmt = g.add("aformat", "sample_fmts=fltp:channel_layouts=stereo")
    last.link_to(fmt)
    sink = g.add("abuffersink")
    fmt.link_to(sink)
    g.configure()
    chunks = []
    step = 4096
    for i in range(0, arr.shape[1], step):
        fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(arr[:, i:i + step]), format="fltp", layout="stereo")
        fr.sample_rate, fr.pts, fr.time_base = AUDIO_RATE, i, Fraction(1, AUDIO_RATE)
        g.push(fr)
        while True:
            try:
                chunks.append(g.pull().to_ndarray())
            except (av.error.BlockingIOError, av.error.EOFError):
                break
    g.push(None)
    while True:
        try:
            chunks.append(g.pull().to_ndarray())
        except (av.error.BlockingIOError, av.error.EOFError):
            break
    out = np.concatenate(chunks, axis=1) if chunks else np.zeros((2, 0), np.float32)
    if out.shape[1] < n_out:
        out = np.concatenate([out, np.zeros((2, n_out - out.shape[1]), np.float32)], axis=1)
    return out[:2, :n_out].astype(np.float32)


# ---------------------------------------------------------------- 動き(キーフレーム)・トランジション
DEFAULTS = {"x": 0.5, "y": 0.5, "s": 1.0, "w": 0.3, "h": 0.3, "size": 0.08, "rot": 0.0, "opacity": 1.0}
ANIM_KEYS = {"clip": ("x", "y", "s", "rot", "opacity"), "text": ("x", "y", "size", "rot", "opacity"),
             "media": ("x", "y", "w", "h", "rot", "opacity")}
# 第20版: 登場・退場の動き(大きさが決まってから位置・大きさ・回転・不透明度を動かす)。typing は文字を一文字ずつ
MOTION_IN = ("pop", "boing", "drop", "bungee", "rise", "tumble", "drift", "stagger", "flicker", "typing")
TRANSITIONS = ("fade", "dip_black", "dip_white", "wipe_h", "wipe_v", "slide_h", "slide_v", "split_h", "split_v",
               "iris_circle", "iris_box", "iris_diamond", "clock", "zoom", "spin") + MOTION_IN + ("blur",)
# 第21版: ぼかし(画面の高さに対しての割合)。トランジションの「ぼかし」と「ぼかしも重ねる」(blur: true)のはじめの強さ・ループの「ぼんやり」の強さ
BLUR_TRANS = 0.04
BLUR_LOOP = 0.03
# どこから入るか(省くとこの向き)
MOTION_DIR = {"drop": "top", "bungee": "top", "rise": "bottom", "tumble": "left", "drift": "left", "stagger": "left"}
DIR_VEC = {"top": (0, -1), "bottom": (0, 1), "left": (-1, 0), "right": (1, 0)}
# 第20版: ずっと続ける動き(ループ)。{"type", "speed"(倍), "amt"(強さ 1 = 100%), "dir"(spin: cw / ccw), "pin"(支点 c / t / b / l / r)}
LOOPS = ("sway", "pendulum", "hop", "float", "shake", "jiggle", "spin", "wave", "beat", "breathe", "blink", "flicker", "breeze", "focus")
LOOP_PIN = {"sway": "b", "pendulum": "t", "breeze": "b"}
PIN_VEC = {"c": (0.0, 0.0), "t": (0.0, -0.5), "b": (0.0, 0.5), "l": (-0.5, 0.0), "r": (0.5, 0.0)}


def _f(v, d):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def ease(p, mode="smooth"):
    p = min(1.0, max(0.0, p))
    return p * p * (3 - 2 * p) if mode == "smooth" else p


# 動きの速さの変え方(画面の JS と同じ式)
def out_back(q):
    return 1 + 2.70158 * (q - 1) ** 3 + 1.70158 * (q - 1) ** 2


def out_elastic(q):
    if q <= 0:
        return 0.0
    if q >= 1:
        return 1.0
    return 2 ** (-10 * q) * math.sin((10 * q - 0.75) * (2 * math.pi / 3)) + 1


def out_bounce(q):
    n1, d1 = 7.5625, 2.75
    if q < 1 / d1:
        return n1 * q * q
    if q < 2 / d1:
        q -= 1.5 / d1
        return n1 * q * q + 0.75
    if q < 2.5 / d1:
        q -= 2.25 / d1
        return n1 * q * q + 0.9375
    q -= 2.625 / d1
    return n1 * q * q + 0.984375


def hash01(n):
    """決まった乱数(0〜1)。JS と同じ値になる整数の計算"""
    n = int(n)
    return ((n * 1103515245 + 12345) & 0x7FFFFFFF) / 2147483647.0


def anim_state(item, keys, t_local):
    """t_local(そのレイヤーの始まりからの秒)での値。キーフレームがあれば前後のキーフレームの間をなめらかに(または一定の速さで)つなぐ"""
    st = {k: _f(item.get(k), DEFAULTS[k]) for k in keys}
    kf = sorted([k for k in (item.get("kf") or []) if isinstance(k, dict)], key=lambda k: _f(k.get("t"), 0))
    if not kf:
        return st
    mode = item.get("kfEase") or "smooth"
    if t_local <= _f(kf[0].get("t"), 0):
        a = b = kf[0]
        p = 0.0
    elif t_local >= _f(kf[-1].get("t"), 0):
        a = b = kf[-1]
        p = 0.0
    else:
        i = max(j for j in range(len(kf)) if _f(kf[j].get("t"), 0) <= t_local)
        a, b = kf[i], kf[i + 1]
        t0, t1 = _f(a.get("t"), 0), _f(b.get("t"), 0)
        p = ease((t_local - t0) / max(1e-6, t1 - t0), mode)
    for k in keys:
        va, vb = _f(a.get(k), st[k]), _f(b.get(k), st[k])
        st[k] = va + (vb - va) * p
    return st


def trans_progress(tr_in, tr_out, t_local, length):
    """(入るときの進み 0〜1, 出るときの残り 0〜1)。トランジションが無ければ 1"""
    def one(tr, v):
        if not isinstance(tr, dict) or tr.get("type") not in TRANSITIONS:
            return None
        d = max(0.01, _f(tr.get("dur"), 0.5))
        return min(1.0, max(0.0, v / d))
    return one(tr_in, t_local), one(tr_out, length - t_local)


def apply_trans_state(st, tr, p, key="clip"):
    """位置・大きさ・回転・不透明度で表すトランジション(スライド・ズーム・回転・フェード)を値に入れる。
    返り値: 色を混ぜる量と色(ディップ)"""
    if p is None or p >= 1.0:
        return None
    t = tr.get("type")
    q = ease(p, "smooth")
    flip_h, flip_v, rev = bool(tr.get("flipH")), bool(tr.get("flipV")), bool(tr.get("rev"))
    scale_keys = ("s",) if key == "clip" else ("size",) if key == "text" else ("w", "h")
    # ぼかし → 鮮明(出るときは 鮮明 → ぼかし)。ほかの効果にも「ぼかしも重ねる」で足せる
    if t == "blur" or tr.get("blur"):
        st["blur"] = st.get("blur", 0.0) + (1 - q) * BLUR_TRANS
    if t == "fade":
        st["opacity"] *= q
    elif t in ("slide_h", "slide_v"):
        # 画面の端のすぐ外から入ってくる(大きさが決まってから _slide で位置を決める)
        st.setdefault("_slide", []).append((t, q, flip_h if t == "slide_h" else flip_v))
    elif t in ("zoom", "spin"):
        f = (1 + 2 * (1 - q)) if rev else max(0.001, q)
        for k in scale_keys:
            st[k] *= f
        if t == "spin":
            st["rot"] += (1 - q) * 360 * (-1 if flip_h else 1)
        if rev:
            st["opacity"] *= q
    elif t in ("dip_black", "dip_white"):
        return (1 - q, (0, 0, 0) if t == "dip_black" else (255, 255, 255))
    elif t == "typing":
        if key == "text":
            st["_reveal"] = min(st.get("_reveal", 1.0), p)
        else:
            st["opacity"] *= p
    elif t in MOTION_IN:
        st.setdefault("_mo", []).append((t, p, tr.get("dir") if tr.get("dir") in DIR_VEC else MOTION_DIR.get(t, "left")))
    return None


def apply_motion(st, cx, cy, w, h, W, H):
    """登場・退場の動き(大きさが決まってから)。返り値 (cx, cy, w, h)。回転・不透明度は st に入れる"""
    for t, q, d in st.get("_mo", ()):
        vx, vy = DIR_VEC.get(d, (-1, 0))
        if vx < 0:
            ox, oy = -(cx + w / 2), 0.0
        elif vx > 0:
            ox, oy = W + w / 2 - cx, 0.0
        elif vy < 0:
            ox, oy = 0.0, -(cy + h / 2)
        else:
            ox, oy = 0.0, H + h / 2 - cy
        if t == "pop":
            f = max(0.001, out_back(q))
            w, h = w * f, h * f
            st["opacity"] *= min(1.0, q * 3)
        elif t == "boing":
            f = max(0.001, out_elastic(q))
            w, h = w * f, h * f
            st["opacity"] *= min(1.0, q * 4)
        elif t in ("drop", "bungee", "tumble"):
            e = out_bounce(q) if t == "drop" else out_elastic(q) if t == "bungee" else ease(q)
            cx, cy = cx + ox * (1 - e), cy + oy * (1 - e)
            if t == "tumble":
                st["rot"] += (-360 if (vx < 0 or vy < 0) else 360) * (1 - e)
        elif t == "rise":
            e = ease(q)
            dist = (h if vy else w) * 0.8
            cx, cy = cx + vx * dist * (1 - e), cy + vy * dist * (1 - e)
            st["opacity"] *= e
        elif t == "drift":
            e = ease(q)
            dist = 0.12 * (W if vx else H)
            cx, cy = cx + vx * dist * (1 - e), cy + vy * dist * (1 - e)
            st["opacity"] *= e
        elif t == "stagger":
            e = ease(q)
            dist = 0.25 * (W if vx else H)
            cx, cy = cx + vx * dist * (1 - e), cy + vy * dist * (1 - e)
            st["rot"] += math.sin(q * 4 * math.pi) * (1 - q) * 18
            st["opacity"] *= min(1.0, q * 3)
        elif t == "flicker":
            n = math.floor(q * 14)
            if not (q >= 1 or hash01(n + 1) < 0.2 + 0.8 * q):
                st["opacity"] *= 0.05
    return cx, cy, w, h


def apply_loop(st, lp, t, cx, cy, w, h):
    """ずっと続ける動き。支点(pin)のまわりに回す・大きさを変える。返り値 (cx, cy, w, h)"""
    if not isinstance(lp, dict) or lp.get("type") not in LOOPS:
        return cx, cy, w, h
    typ = lp["type"]
    f = min(10.0, max(0.05, _f(lp.get("speed"), 1.0)))
    a = min(3.0, max(0.0, _f(lp.get("amt"), 1.0)))
    tau = 2 * math.pi
    rot, sc, dx, dy, op = 0.0, 1.0, 0.0, 0.0, 1.0
    if typ == "sway":
        rot = math.sin(tau * 0.8 * f * t) * 10 * a
    elif typ == "pendulum":
        rot = math.sin(tau * 0.6 * f * t) * 28 * a
    elif typ == "hop":
        dy = -abs(math.sin(math.pi * 1.6 * f * t)) * 0.18 * h * a
    elif typ == "float":
        dy = math.sin(tau * 0.5 * f * t) * 0.08 * h * a
        dx = math.sin(tau * 0.25 * f * t) * 0.03 * w * a
    elif typ == "shake":
        n = math.floor(t * 24 * f)
        dx = (hash01(n * 2 + 1) - 0.5) * 0.06 * w * a
        dy = (hash01(n * 2 + 2) - 0.5) * 0.06 * h * a
    elif typ == "jiggle":
        rot = math.sin(tau * 3 * f * t) * 4 * a
        sc = 1 + math.sin(tau * 6 * f * t) * 0.02 * a
    elif typ == "spin":
        rot = 360 * 0.5 * f * t * (-1 if lp.get("dir") == "ccw" else 1)
    elif typ == "wave":
        dy = math.sin(tau * 0.7 * f * t) * 0.15 * h * a
        rot = math.cos(tau * 0.7 * f * t) * 7 * a
    elif typ == "beat":
        ph = (0.9 * f * t) % 1.0
        pulse = math.exp(-((ph - 0.1) / 0.06) ** 2) + 0.6 * math.exp(-((ph - 0.3) / 0.06) ** 2)
        sc = 1 + 0.12 * a * pulse
    elif typ == "breathe":
        sc = 1 + 0.06 * a * (0.5 - 0.5 * math.cos(tau * 0.3 * f * t))
    elif typ == "blink":
        op = 1 - min(1.0, 0.65 * a) * (0.5 - 0.5 * math.cos(tau * 1.2 * f * t))
    elif typ == "flicker":
        n = math.floor(t * 12 * f)
        op = 0.1 if hash01(n + 3) < 0.22 * a else 1.0
    elif typ == "breeze":
        rot = math.sin(tau * 0.9 * f * t) * 5 * a
        dx = math.sin(tau * 0.9 * f * t + 1) * 0.02 * w * a
    elif typ == "focus":
        st["blur"] = st.get("blur", 0.0) + BLUR_LOOP * a * (0.5 - 0.5 * math.cos(tau * 0.5 * f * t))
    px, py = PIN_VEC.get(lp.get("pin") or LOOP_PIN.get(typ, "c"), (0.0, 0.0))
    rx, ry = px * w, py * h
    b = math.radians(st["rot"])
    rwx, rwy = rx * math.cos(b) - ry * math.sin(b), rx * math.sin(b) + ry * math.cos(b)
    th = math.radians(rot)
    qx, qy = (rwx * math.cos(th) - rwy * math.sin(th)) * sc, (rwx * math.sin(th) + rwy * math.cos(th)) * sc
    st["rot"] += rot
    st["opacity"] *= op
    return cx + rwx - qx + dx, cy + rwy - qy + dy, w * sc, h * sc


def trans_mask(tr, p, w, h):
    """形で出す・消すトランジション(ワイプ・スプリット・アイリス・時計)の [h, w] の 0〜1。対象でなければ None"""
    if p is None or p >= 1.0 or not isinstance(tr, dict):
        return None
    t = tr.get("type")
    if t not in ("wipe_h", "wipe_v", "split_h", "split_v", "iris_circle", "iris_box", "iris_diamond", "clock"):
        return None
    flip_h, flip_v, rev = bool(tr.get("flipH")), bool(tr.get("flipV")), bool(tr.get("rev"))
    u = (np.arange(w, dtype=np.float32) + 0.5) / max(1, w)
    v = (np.arange(h, dtype=np.float32) + 0.5) / max(1, h)
    U, V = np.meshgrid(u, v)
    q = ease(p, "smooth")
    soft = 2.0 / max(8, min(w, h))  # 縁を少しなめらかに

    def ramp(d, edge):  # d < edge を 1 に
        return np.clip((edge - d) / soft + 0.5, 0.0, 1.0)

    if t == "wipe_h":
        d = (1 - U) if flip_h else U
        m = ramp(d, q)
    elif t == "wipe_v":
        d = (1 - V) if flip_v else V
        m = ramp(d, q)
    elif t in ("split_h", "split_v"):
        d = np.abs((U if t == "split_h" else V) - 0.5) * 2
        m = (1 - ramp(d, 1 - q)) if rev else ramp(d, q)
    elif t == "clock":
        ang = (np.arctan2(U - 0.5, -(V - 0.5)) / (2 * np.pi)) % 1.0
        d = (1 - ang) if flip_h else ang
        m = ramp(d, q)
    else:
        if t == "iris_circle":
            d = np.sqrt(((U - 0.5) * w) ** 2 + ((V - 0.5) * h) ** 2) / (0.5 * np.hypot(w, h))
        elif t == "iris_box":
            d = np.maximum(np.abs(U - 0.5), np.abs(V - 0.5)) * 2
        else:
            d = np.abs(U - 0.5) + np.abs(V - 0.5)
        m = (1 - ramp(d, 1 - q)) if rev else ramp(d, q)
    return m.astype(np.float32)


# ---------------------------------------------------------------- 背景を透明にする(色で抜く・AI・元の透明度)
_bg_model = {"name": None, "model": None}


def bg_model():
    names = list(folder_paths.get_filename_list("background_removal") or [])
    if not names:
        raise ValueError(tr("背景を AI で消すには、背景を消すモデル(birefnet.safetensors)が必要です。画像編集の「背景を自動で消す」と同じファイルです。"))
    name = next((n for n in names if "birefnet" in n.lower()), names[0])
    if _bg_model["name"] != name:
        from comfy.bg_removal_model import load
        _bg_model["model"] = load(folder_paths.get_full_path("background_removal", name))
        _bg_model["name"] = name
    return _bg_model["model"]


def key_alpha(rgb, key):
    """[h, w, 3] uint8 → 透明度 [h, w](0〜1)。key = {"mode": "chroma" | "ai", "color", "tol", "soft", "despill"}"""
    mode = (key or {}).get("mode")
    if mode == "chroma":
        kc = np.array(_rgb(key.get("color"), (0, 255, 0)), dtype=np.float32)
        d = np.linalg.norm(rgb.astype(np.float32) - kc, axis=-1) / 441.7
        tol, soft = _f(key.get("tol"), 0.3), max(0.001, _f(key.get("soft"), 0.1))
        return np.clip((d - tol) / soft, 0.0, 1.0)
    if mode == "ai":
        import torch
        with torch.inference_mode():  # 学習用の記録を残さない(残すとメモリーを大きく使う)
            m = bg_model().encode_image(torch.from_numpy(rgb.astype(np.float32) / 255.0)[None])
        a = m[0].float().cpu().numpy() if hasattr(m, "cpu") else np.asarray(m)[0]
        if a.shape != rgb.shape[:2]:
            a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((rgb.shape[1], rgb.shape[0]), Image.BILINEAR)) / 255.0
        thr = _f(key.get("thr"), 0.0)
        if thr > 0:
            a = np.clip((a - thr) / max(1e-3, 1 - thr), 0, 1)
        return a.astype(np.float32)
    return None


def despill(rgb, alpha, key):
    """抜いた色が縁に残るのを抑える(緑なら G を R・B の大きい方までに)"""
    kc = _rgb(key.get("color"), (0, 255, 0))
    ch = int(np.argmax(kc))
    if kc[ch] < 128:
        return rgb
    out = rgb.astype(np.float32)
    others = [i for i in range(3) if i != ch]
    lim = np.maximum(out[..., others[0]], out[..., others[1]])
    edge = alpha < 0.999
    out[..., ch] = np.where(edge, np.minimum(out[..., ch], lim), out[..., ch])
    return out.astype(np.uint8)


def to_rgba(frame, key=None, use_alpha=False):
    """コマ(配列)→ RGBA の画像。背景を透明にする設定があれば透明度を作る"""
    if not (key and key.get("mode") in ("chroma", "ai")):
        if frame.shape[2] == 4 and use_alpha:
            return Image.fromarray(np.ascontiguousarray(frame), "RGBA")
        return Image.fromarray(np.ascontiguousarray(frame[:, :, :3]), "RGB").convert("RGBA")
    rgb = np.ascontiguousarray(frame[:, :, :3])
    a = key_alpha(rgb, key)
    if key.get("mode") == "chroma" and key.get("despill", True):
        rgb = despill(rgb, a, key)
    if frame.shape[2] == 4 and use_alpha:
        a = a * (frame[:, :, 3].astype(np.float32) / 255.0)
    return Image.fromarray(np.dstack([rgb, (a * 255).astype(np.uint8)]), "RGBA")


# ---------------------------------------------------------------- 描く
def _rgb(c, default=(255, 255, 255)):
    try:
        return ImageColor.getrgb(str(c))[:3]
    except Exception:  # noqa: BLE001
        return default


def crop_arr(arr, crop):
    if not crop:
        return arr
    h, w = arr.shape[:2]
    x, y, cw, ch = [int(round(v)) for v in crop]
    x, y = max(0, min(w - 1, x)), max(0, min(h - 1, y))
    cw, ch = max(1, min(w - x, cw)), max(1, min(h - y, ch))
    return arr[y:y + ch, x:x + cw]


def fit_into(arr, W, H, crop=None):
    """切り抜き → 縦横比を保って W×H に収める(余りは黒)。第18版までの書き出しと同じ"""
    arr = crop_arr(arr, crop)
    h, w = arr.shape[:2]
    s = min(W / w, H / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    im = Image.fromarray(np.ascontiguousarray(arr[:, :, :3]))
    if (nw, nh) != (w, h):
        im = im.resize((nw, nh), Image.BILINEAR)
    canvas = Image.new("RGB", (W, H), (0, 0, 0))
    canvas.paste(im, ((W - nw) // 2, (H - nh) // 2))
    return canvas


def _box(o, W, H):
    w, h = max(1, int(round(float(o.get("w", 0.3)) * W))), max(1, int(round(float(o.get("h", 0.3)) * H)))
    x = int(round(float(o.get("x", 0.5)) * W - w / 2))
    y = int(round(float(o.get("y", 0.5)) * H - h / 2))
    return x, y, w, h


def _alpha(im, opacity):
    if opacity >= 0.999:
        return im
    a = im.getchannel("A").point(lambda v: int(v * opacity))
    im = im.copy()
    im.putalpha(a)
    return im


def _paste_clip(canvas, im, x, y):
    """画面からはみ出す所を切って重ねる"""
    W, H = canvas.size
    l, t = max(0, x), max(0, y)
    r, b = min(W, x + im.width), min(H, y + im.height)
    if r <= l or b <= t:
        return
    canvas.alpha_composite(im.crop((l - x, t - y, r - x, b - y)), (l, t))


def slide_pos(st, cx, cy, w, h, W, H):
    """スライド: 画面の端のすぐ外(左・上。反転なら右・下)から、本来の位置へ"""
    for t, q, flip in st.get("_slide", ()):
        if t == "slide_h":
            s0 = (W + w / 2) if flip else -w / 2
            cx = s0 + (cx - s0) * q
        else:
            s0 = (H + h / 2) if flip else -h / 2
            cy = s0 + (cy - s0) * q
    return cx, cy


def edge_mask(w, h, f):
    """ふちから f px で 0 → 1 になる板(横と縦を掛ける。画面の CSS の mask と同じ)"""
    x = np.arange(w, dtype=np.float32) + 0.5
    y = np.arange(h, dtype=np.float32) + 0.5
    mx = np.clip(np.minimum(x, w - x) / f, 0, 1)
    my = np.clip(np.minimum(y, h - y) / f, 0, 1)
    return np.outer(my, mx)


def apply_edge(im, edge):
    """ふちのぼかし。edge = {"mode": "feather"(ふちを透明に)| "blur"(まわりだけぼかす), "size": 幅(短い辺に対して 0〜0.5), "amt": 強さ}"""
    if not isinstance(edge, dict) or edge.get("mode") not in ("feather", "blur"):
        return im
    w, h = im.size
    size = min(0.5, max(0.0, _f(edge.get("size"), 0.15)))
    if size <= 0 or w < 2 or h < 2:
        return im
    m = edge_mask(w, h, max(1.0, size * min(w, h)))
    a = np.asarray(im, dtype=np.float32).copy()
    if edge["mode"] == "feather":
        a[..., 3] *= m
    else:
        r = edge_blur_px(edge, w, h)
        b = np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32)
        e = (1 - m)[..., None]
        a = a * (1 - e) + b * e
    return Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), "RGBA")


# ---------------------------------------------------------------- 図形マスク。画面(web/cca_shapes.js)と同じ形・同じぼかし方
REGULAR = {"rtri": "tri", "rpent": "pent", "rhex": "hex", "roct": "oct"}  # 正多角形 → もとの形(縦横を同じ割合で広げる)
CENTERED = ("tri", "pent", "hex", "oct", "star", "flower", "spark", "diamond")  # 真ん中 (0, 0) のまわりに作る形
SHAPE_KEYS = ("rect", "rrect", "ellipse", "tri", "diamond", "pent", "hex", "oct", "rtri", "rpent", "rhex", "roct", "star", "spark", "heart", "flower", "drop", "bubble", "tile", "dots")
MASK_DEF = {"fit": "square", "size": 1.0, "x": 0.0, "y": 0.0, "rot": 0.0, "radius": 0.25, "points": 5, "feather": 0.0,
            "spinSpeed": 0.25, "swing": 20.0, "pulseSpeed": 0.5, "pulseAmt": 0.2,
            "pitch": 0.25, "gap": 0.15, "odd": 1.0, "even": 1.0, "rodd": 1.0, "reven": 1.0, "stagger": False, "round": 0.0}
_BLUR_EDGE = 0.4772  # 標準偏差 f/2 でぼかしたとき、ふちから内へ f の所の値 - 0.5


def _cl(v, a, b):
    return max(a, min(b, v))


def _iround(v):
    return int(math.floor(v + 0.5))


def _poly_ring(n, a0, inner=0.0):
    m = n * 2 if inner else n
    out = []
    for i in range(m):
        a = a0 + i * math.pi * 2 / m
        r = inner if inner and i % 2 else 1.0
        out.append((math.cos(a) * r, math.sin(a) * r))
    return out


def _rrect_pts(x0, y0, x1, y1, r, tail=None):
    pts = []

    def arc(cx, cy, a0):
        for i in range(9):
            a = a0 + (i / 8) * (math.pi / 2)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    arc(x1 - r, y0 + r, -math.pi / 2)
    arc(x1 - r, y1 - r, 0)
    if tail:
        pts.extend(tail)
    arc(x0 + r, y1 - r, math.pi / 2)
    arc(x0 + r, y0 + r, math.pi)
    return pts


# 並べる形(タイル・水玉)。画面(web/cca_shapes.js の patternItems)と同じ並べ方
PATTERNS = ("tile", "dots")
PAT_DEF = {"pitch": 0.25, "gap": 0.15, "odd": 1.0, "even": 1.0, "rodd": 1.0, "reven": 1.0, "stagger": False, "round": 0.0, "alt": "col", "rules": []}


def _pat_pitch(c):
    return max(2.0, _cl(_f(c.get("pitch"), PAT_DEF["pitch"]), 0.02, 1.0) * min(c["w"], c["h"]))


def _pat_base(c):
    return _pat_pitch(c) * (1 - _cl(_f(c.get("gap"), PAT_DEF["gap"]), -1.0, 0.95))  # すき間がマイナスなら、間隔より大きく(重なる)


def pattern_items(c):
    """並べる 1 つずつの (真ん中 x, 真ん中 y, 大きさ)。c = {x, y, w, h(箱), pitch, gap, odd, even, alt, stagger}"""
    w, h = c["w"], c["h"]
    p, base = _pat_pitch(c), _pat_base(c)
    so, se = _cl(_f(c.get("odd"), 1.0), 0.0, 2.0), _cl(_f(c.get("even"), 1.0), 0.0, 2.0)
    ro, re_ = _cl(_f(c.get("rodd"), 1.0), 0.0, 2.0), _cl(_f(c.get("reven"), 1.0), 0.0, 2.0)
    if c.get("alt") == "row" and c.get("rodd") is None and c.get("reven") is None:  # 第40版の「横の行ごと」
        ro, re_, so, se = so, se, 1.0, 1.0
    rules = []  # [[w, x, y, z, 大きさ], …]: w 番目の段から x 段おき・左から y 番目から z つおきの物の大きさ(後の条件が優先)
    for R in (c.get("rules") or []):
        if isinstance(R, (list, tuple)) and len(R) >= 5:
            rules.append((_iround(_f(R[0], 1)) - 1, max(0, _iround(_f(R[1], 0))) + 1, _iround(_f(R[2], 1)) - 1, max(0, _iround(_f(R[3], 0))) + 1,
                          _cl(_f(R[4], 1.0), 0.0, 3.0)))
    nq, nr = max(1, _iround(w / p)), max(1, _iround(h / p))
    mx, my = c["x"] + w / 2, c["y"] + h / 2
    out = []
    for r in range(-2, nr + 2):  # 大きいとはしの外の物も入るので、1 つ外まで
        y = my + (r - (nr - 1) / 2) * p
        sx = p / 2 if c.get("stagger") and r & 1 else 0.0
        for q in range(-3, nq + 2):
            x = mx + (q - (nq - 1) / 2) * p + sx
            s = base * (se if (q + r) & 1 else so) if c.get("alt") == "check" else base * (se if q & 1 else so) * (re_ if r & 1 else ro)
            for r0, rs, q0, qs, k in rules:
                if (r - r0) % rs == 0 and (q - q0) % qs == 0:
                    s = base * k
            if s < 0.5 or x + s / 2 <= c["x"] or x - s / 2 >= c["x"] + w or y + s / 2 <= c["y"] or y - s / 2 >= c["y"] + h:
                continue
            out.append((x, y, s))
    return out


def feather_base(c):
    """ぼかす幅の元にする長さ(並べる形は 1 つの大きさ、ほかは箱の短い辺)"""
    return _pat_base(c) if c.get("shape") in PATTERNS else min(c["w"], c["h"])


_SHAPE_PTS = {}


def shape_pts(shape, points=5):
    """形の点(真ん中 0, 0・幅と高さ 1 の箱いっぱい)。四角・角丸・丸は使わない"""
    key = (shape, points)
    if key in _SHAPE_PTS:
        return _SHAPE_PTS[key]
    pts = _raw_pts(shape, points)
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pts = [((x - x0) / (x1 - x0) - 0.5, (y - y0) / (y1 - y0) - 0.5) for x, y in pts]
    _SHAPE_PTS[key] = pts
    return pts


_RAW_PTS = {}


def _raw_pts(shape, points=5):
    """生の点(多角形・星・花・きらめき・ひし形は真ん中 0, 0 のまわり)。画面の rawPts と同じ"""
    shape = REGULAR.get(shape, shape)
    key = (shape, points)
    if key in _RAW_PTS:
        return _RAW_PTS[key]
    N = 240
    ts = [i / N * math.pi * 2 for i in range(N)]

    def pw(v, p):
        return math.copysign(abs(v) ** p, v)
    if shape == "tri":
        pts = _poly_ring(3, -math.pi / 2)
    elif shape == "diamond":
        pts = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    elif shape == "pent":
        pts = _poly_ring(5, -math.pi / 2)
    elif shape == "hex":
        pts = _poly_ring(6, 0)
    elif shape == "oct":
        pts = _poly_ring(8, math.pi / 8)
    elif shape == "star":
        n = int(_cl(_iround(_f(points, 5)), 3, 12))
        pts = _poly_ring(n, -math.pi / 2, _cl(0.27 + n * 0.03, 0.3, 0.65))
    elif shape == "spark":
        pts = [(pw(math.cos(t), 3), pw(math.sin(t), 3)) for t in ts]
    elif shape == "heart":
        pts = [(16 * math.sin(t) ** 3, -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))) for t in ts]
    elif shape == "flower":
        pts = [(math.cos(t - math.pi / 2) * (0.6 + 0.4 * abs(math.cos(3 * t))), math.sin(t - math.pi / 2) * (0.6 + 0.4 * abs(math.cos(3 * t)))) for t in ts]
    elif shape == "drop":
        pts = [(math.sin(t) * math.sin(t / 2), -math.cos(t)) for t in ts]
    elif shape == "bubble":
        pts = _rrect_pts(-1, -1, 1, 0.5, 0.3, [(-0.1, 0.5), (-0.62, 1.05), (-0.42, 0.5)])
    else:
        pts = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    _RAW_PTS[key] = pts
    return pts


def place_pts(sh, x0, y0, bw, bh):
    """箱に置いた形の点。画面の placePts と同じ(正多角形・uniform は縦横を同じ割合で、center は形の真ん中を箱の真ん中に)"""
    shape = sh.get("shape")
    base = REGULAR.get(shape, shape)
    cx, cy = x0 + bw / 2, y0 + bh / 2
    uni = shape in REGULAR or bool(sh.get("uniform"))
    center = bool(sh.get("center")) and base in CENTERED
    if not uni and not center:
        return [(cx + px * bw, cy + py * bh) for px, py in shape_pts(base, sh.get("points", 5))]
    raw = _raw_pts(base, sh.get("points", 5))
    if center:
        ax = max(1e-9, max(abs(p[0]) for p in raw))
        ay = max(1e-9, max(abs(p[1]) for p in raw))
        kx, ky = bw / 2 / ax, bh / 2 / ay
        if uni:
            kx = ky = min(kx, ky)
        return [(cx + px * kx, cy + py * ky) for px, py in raw]
    xs, ys = [p[0] for p in raw], [p[1] for p in raw]
    k = min(bw / (max(xs) - min(xs)), bh / (max(ys) - min(ys)))
    mx, my = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    return [(cx + (px - mx) * k, cy + (py - my) * k) for px, py in raw]


def shape_mask_img(sh, w, h):
    """形の板(L・w×h)。sh = {shape, radius, points, feather(短い辺に対しての割合。並べる形は 1 つの大きさに対しての割合), 並べる形の pitch など}。
    ぼかすときは標準偏差 f/2 でぼかしてから、0.5 → 0・0.977 → 1 に広げる(ふちで 0、内側へ幅 f でほぼ 1)"""
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    f = _cl(_f(sh.get("feather"), 0.0), 0.0, 0.5) * feather_base(dict(sh, w=w, h=h))
    sd = f / 2
    pad = int(math.ceil(sd * 3)) + 2 if f >= 1 else 0
    cw, ch = w + pad * 2, h + pad * 2
    ss = 4 if max(cw, ch) <= 512 else 2 if max(cw, ch) <= 1536 else 1  # 細かく描いてから縮めて、ふちをなめらかに
    big = Image.new("L", (cw * ss, ch * ss), 0)
    d = ImageDraw.Draw(big)
    x0, y0, bw, bh = pad * ss, pad * ss, w * ss, h * ss
    shape = sh.get("shape")
    if shape == "rect":
        d.rectangle([x0, y0, x0 + bw - 1, y0 + bh - 1], fill=255)
    elif shape == "rrect":
        r = _cl(_f(sh.get("radius"), 0.25), 0.0, 1.0) * min(bw, bh) / 2
        d.rounded_rectangle([x0, y0, x0 + bw - 1, y0 + bh - 1], radius=r, fill=255)
    elif shape == "ellipse":
        d.ellipse([x0, y0, x0 + bw - 1, y0 + bh - 1], fill=255)
    elif shape == "path":
        poly = path_points(sh.get("pts"), bw, bh, sh.get("closed") is not False)
        if len(poly) >= 3:
            d.polygon([(x0 + px, y0 + py) for px, py in poly], fill=255)
    elif shape in PATTERNS:
        rr = _cl(_f(sh.get("round"), 0.0), 0.0, 1.0)
        ik = _cl(_f(sh.get("itemK"), 1.0), 0.0, 10.0)  # 1 つずつの伸び縮み・回転(タイル)
        ia = math.radians(_f(sh.get("itemRot"), 0.0))
        for px, py, sz in pattern_items(dict(sh, x=x0, y=y0, w=bw, h=bh)):
            sz *= ik
            h2 = sz / 2
            if sz < 0.5:
                continue
            box = [px - h2, py - h2, px + h2 - 1, py + h2 - 1]
            if shape == "dots":
                d.ellipse(box, fill=255)
            elif abs(ia) > 1e-6:
                ring = _rrect_pts(-h2, -h2, h2, h2, rr * h2) if rr > 0 else [(-h2, -h2), (h2, -h2), (h2, h2), (-h2, h2)]
                ca, sa = math.cos(ia), math.sin(ia)
                d.polygon([(px + x * ca - y * sa, py + x * sa + y * ca) for x, y in ring], fill=255)
            elif rr > 0:
                d.rounded_rectangle(box, radius=rr * h2, fill=255)
            else:
                d.rectangle(box, fill=255)
    else:
        d.polygon(place_pts(sh, x0, y0, bw, bh), fill=255)
    m = big.resize((cw, ch), Image.BOX) if ss > 1 else big
    if pad:
        m = m.filter(ImageFilter.GaussianBlur(sd))
        a = np.clip((np.asarray(m, dtype=np.float32) / 255 - 0.5) / _BLUR_EDGE, 0, 1)
        m = Image.fromarray((a * 255 + 0.5).astype(np.uint8), "L").crop((pad, pad, pad + w, pad + h))
    return m


def mask_box(mk, w, h, t):
    """レイヤーの中の時刻 t(秒)での、形の箱(真ん中・幅・高さ・回転(度))。画面の maskBox と同じ"""
    size = _cl(_f(mk.get("size"), 1.0), 0.05, 3.0)
    if mk.get("fit") == "fill":
        bw, bh = w * size, h * size
    else:
        bw = bh = min(w, h) * size
    ang = _f(mk.get("rot"), 0.0)
    sp = _f(mk.get("spinSpeed"), MASK_DEF["spinSpeed"])
    if mk.get("spin") == "spin":
        ang += 360 * sp * t
    elif mk.get("spin") == "swing":
        ang += _cl(_f(mk.get("swing"), MASK_DEF["swing"]), 0.0, 180.0) * math.sin(2 * math.pi * sp * t)
    k = 1.0
    if mk.get("pulse") == "pulse":
        k = max(0.01, 1 + _cl(_f(mk.get("pulseAmt"), MASK_DEF["pulseAmt"]), 0.0, 0.9) * math.sin(2 * math.pi * _f(mk.get("pulseSpeed"), MASK_DEF["pulseSpeed"]) * t))
    cx, cy = w / 2 + _cl(_f(mk.get("x"), 0.0), -1.0, 1.0) * w, h / 2 + _cl(_f(mk.get("y"), 0.0), -1.0, 1.0) * h
    if mk.get("shape") in PATTERNS:  # 並べる形は、回転・伸び縮みを 1 つずつに(並びは動かさない)
        return cx, cy, bw, bh, 0.0, ang, k
    return cx, cy, bw * k, bh * k, ang, 0.0, 1.0


_MASK_CACHE = {}


def _base_mask(mk, bw, bh, item_rot=0.0, item_k=1.0):
    """形・ぼかす幅・縦横比・大きさ(128 px ごと)が同じ間は作り直さない"""
    asp = round(bw / max(1e-6, bh), 2)
    L = min(2048, max(64, int(math.ceil(max(bw, bh) / 128)) * 128))
    w, h = (L, max(1, _iround(L / asp))) if asp >= 1 else (max(1, _iround(L * asp)), L)
    ir, ik = round(item_rot, 1), round(item_k, 3)
    key = (mk.get("shape"), _f(mk.get("radius"), 0.25), _f(mk.get("points"), 5), _f(mk.get("feather"), 0.0), mk.get("fit"),
           str(mk.get("pts")), mk.get("closed"), tuple(str(mk.get(k)) for k in PAT_DEF), w, h, ir, ik)
    m = _MASK_CACHE.get(key)
    if m is None:
        m = shape_mask_img(dict(mk, points=mk.get("points", 5), itemRot=ir, itemK=ik, center=True, uniform=mk.get("fit") != "fill"), w, h)
        if len(_MASK_CACHE) > 24:
            _MASK_CACHE.pop(next(iter(_MASK_CACHE)))
        _MASK_CACHE[key] = m
    return m


def shape_mask(mk, w, h, t):
    """図形マスク。レイヤー(w×h)の、時刻 t の形の中だけ 1 になる板(numpy・0〜1)。形が無ければ None"""
    if not isinstance(mk, dict) or not (mk.get("shape") in SHAPE_KEYS or (mk.get("shape") == "path" and len(mk.get("pts") or []) > 2)):
        return None
    w, h = int(round(w)), int(round(h))
    if w < 1 or h < 1:
        return None
    cx, cy, bw, bh, ang, item_rot, item_k = mask_box(mk, w, h, t)
    out = Image.new("L", (w, h), 0)
    if bw >= 0.5 and bh >= 0.5:
        im = _base_mask(mk, bw, bh, item_rot, item_k).resize((max(1, _iround(bw)), max(1, _iround(bh))), Image.BILINEAR)
        if abs(ang) > 0.01:
            im = im.rotate(-ang, resample=Image.BICUBIC, expand=True)
        out.paste(im, (_iround(cx - im.width / 2), _iround(cy - im.height / 2)))
    a = np.asarray(out, dtype=np.float32) / 255
    return 1 - a if mk.get("invert") else a  # invert: 形の中を消す


def path_points(pts, w, h, closed, steps=16):
    """パスの点(枠の中の割合 [x, y, 入るハンドル x, y, 出るハンドル x, y])を、w × h の折れ線にする(曲線は steps に分ける)。画面の tracePath と同じ形"""
    P = []
    for q in pts or []:
        q = list(q) + [None] * (6 - len(q))
        hi = (_f(q[2], 0) * w, _f(q[3], 0) * h) if q[2] is not None else None
        ho = (_f(q[4], 0) * w, _f(q[5], 0) * h) if q[4] is not None else None
        P.append((_f(q[0], 0) * w, _f(q[1], 0) * h, hi, ho))
    if not P:
        return []
    out = [(P[0][0], P[0][1])]

    def seg(a, b):
        if a[3] or b[2]:
            x0, y0 = a[0], a[1]
            x1, y1 = a[0] + (a[3] or (0, 0))[0], a[1] + (a[3] or (0, 0))[1]
            x2, y2 = b[0] + (b[2] or (0, 0))[0], b[1] + (b[2] or (0, 0))[1]
            for i in range(1, steps + 1):
                t = i / steps
                u = 1 - t
                out.append((u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * b[0],
                            u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * b[1]))
        else:
            out.append((b[0], b[1]))
    for i in range(1, len(P)):
        seg(P[i - 1], P[i])
    if closed and len(P) > 1:
        seg(P[-1], P[0])
    return out


def shape_image(o, w, h, H):
    """図形のレイヤーの絵(RGBA・w×h)。形は図形マスクと同じ板(タイル・水玉も)、パスは点をつないで塗る(閉じたとき)・線を描く(太さがあるとき)"""
    w, h = max(1, _iround(w)), max(1, _iround(h))
    rgb = _rgb(o.get("fill") or "#ffffff")
    fa = _cl(_f(o.get("fillA"), 1.0), 0.0, 1.0)
    if o.get("shape") == "path":
        ss = 4 if max(w, h) <= 512 else 2 if max(w, h) <= 1536 else 1
        m = Image.new("L", (w * ss, h * ss), 0)
        d = ImageDraw.Draw(m)
        closed = o.get("closed") is not False
        poly = path_points(o.get("pts"), w * ss, h * ss, closed)
        if closed and not o.get("noFill") and len(poly) >= 3:  # noFill: 線だけ
            d.polygon(poly, fill=255)
        sw = _cl(_f(o.get("strokeW"), 0.0), 0.0, 0.2) * H * ss
        if sw >= 0.5 * ss and len(poly) >= 2:
            d.line(poly + ([poly[0]] if closed else []), fill=255, width=max(1, _iround(sw)), joint="curve")
        a = m.resize((w, h), Image.BOX) if ss > 1 else m
    else:
        sh = {k: o.get(k) for k in ("shape", "radius", "points", *PAT_DEF)}
        sh["feather"] = 0
        sh["center"] = True  # 回すと図形の真ん中で回る(画面の drawShapeSrc と同じ)
        a = shape_mask_img(sh, w, h)
    out = Image.new("RGBA", (w, h), tuple(rgb) + (0,))
    out.putalpha(a.point(lambda v: int(v * fa + 0.5)))
    return out


def clip_bases(vis):
    """下のレイヤーで切り抜く。その時刻に見えているレイヤー(下から順)で、切り抜くレイヤー(画像・動画)の id → 下のレイヤー(すぐ下の、抜かない画像・動画・文字)と、
    形にだけ使う(見せない)下のレイヤーの id。画面(clipBases)と同じ"""
    bases, hide, last = {}, set(), None
    for o in vis:
        k = o.get("kind")
        if o.get("clip") in ("in", "out") and k in ("image", "video", "shape"):
            if last is not None:
                bases[id(o)] = last
                if o.get("clipHide") or o.get("clip") == "out":  # 除外するときは、抜く形に使うレイヤーは見せない
                    hide.add(id(last))
            continue
        if k in ("image", "video", "text", "shape"):
            last = o
    return bases, hide


def clip_composite(canvas, layer, base_alpha, mode):
    """切り抜くレイヤーの板に、下のレイヤーの透明度(in: そのまま / out: 反対)を掛けて重ねる"""
    a = np.asarray(layer, dtype=np.float32).copy()
    m = base_alpha if base_alpha is not None else np.zeros(a.shape[:2], dtype=np.float32)
    a[..., 3] *= (1 - m) if mode == "out" else m
    canvas.alpha_composite(Image.fromarray(np.clip(a + 0.5, 0, 255).astype(np.uint8), "RGBA"))


# ---------------------------------------------------------------- ふち取り。画面(web/cca_shapes.js の outlineCanvas)と同じ作り方
def _edt(bg, rmax, ax=1.0, ay=1.0):
    """bg(True = レイヤーの外)の各点から、いちばん近いレイヤーの点までの距離(横は ax・縦は ay で割った楕円の距離)"""
    try:
        from scipy.ndimage import distance_transform_edt
        return distance_transform_edt(bg, sampling=(1.0 / ay, 1.0 / ax))
    except ImportError:
        # scipy が無いときは、太さまでの近くだけを調べる
        fg = ~bg
        out = np.where(fg, 0.0, np.inf).astype(np.float32)
        R = int(math.ceil(rmax)) + 1
        H, W = fg.shape
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                d = math.hypot(dx / ax, dy / ay)
                if d == 0 or d > R:
                    continue
                sh = np.zeros_like(fg)
                sh[max(0, dy):H + min(0, dy), max(0, dx):W + min(0, dx)] = fg[max(0, -dy):H + min(0, -dy), max(0, -dx):W + min(0, -dx)]
                out = np.where(sh, np.minimum(out, d), out)
        return out


def outline_alpha(a, t, blur):
    """t: 太さ(数 = 上下左右同じ / (上, 下, 左, 右))。上下左右が違うときは、横の半径 (左 + 右) / 2・縦の半径 (上 + 下) / 2 の楕円を
    ((右 - 左) / 2, (下 - 上) / 2) ずらして広げる(画面の outlineCanvas と同じ)"""
    st, sb, sl, sr = (t, t, t, t) if isinstance(t, (int, float)) else (float(x) for x in t)
    st, sb, sl, sr = max(0.0, st), max(0.0, sb), max(0.0, sl), max(0.0, sr)
    tm = max(st, sb, sl, sr)
    ax, ay = max(0.5, (sl + sr) / 2), max(0.5, (st + sb) / 2)
    ox, oy, sm = _iround((sr - sl) / 2), _iround((sb - st) / 2), min(ax, ay)
    return _outline_alpha(a, tm, blur, ax, ay, ox, oy, sm)


def _outline_alpha(a, t, blur, ax, ay, ox, oy, sm):
    """a(0〜1 の透明度)の、0.5 以上の所(レイヤー)からの距離が t px までを縁にする(外のふちは 1px でなめらかに)。
    レイヤーの内側(まわり 8 つもレイヤーの所)には付けない(レイヤーのふちの画素の下には敷くので、縁との間にすき間ができない)。
    ぼかすときは縁だけをぼかす。戻り値: (まわりに pad 足した大きさの縁の透明度, pad)。縁が無ければ (None, pad)"""
    pad = int(math.ceil(t + blur * 3)) + 2
    A = np.pad(a.astype(np.float32), pad)
    fg = A >= 0.5
    if t < 0.05 or not fg.any():
        return None, pad
    inner = fg.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            inner[1:-1, 1:-1] &= fg[1 + dy:fg.shape[0] - 1 + dy, 1 + dx:fg.shape[1] - 1 + dx]
    dn = _edt(~fg, t + 1, ax, ay)
    sh = np.full(dn.shape, 1e10, dtype=np.float64)  # (ox, oy) ずらす
    Hh, Ww = dn.shape
    ys0, ys1, xs0, xs1 = max(0, oy), Hh + min(0, oy), max(0, ox), Ww + min(0, ox)
    sh[ys0:ys1, xs0:xs1] = dn[ys0 - oy:ys1 - oy, xs0 - ox:xs1 - ox]
    B = np.where(inner, 0.0, np.clip((1 - sh) * sm + 0.5, 0, 1))
    if blur > 0.3:
        B = np.asarray(Image.fromarray((B * 255 + 0.5).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32) / 255
    return B.astype(np.float32), pad


def with_outline(im, t, blur, rgb, alpha):
    """im(RGBA)の後ろに縁を付けた絵(上下左右に pad ずつ大きい。真ん中は同じ)"""
    B, pad = outline_alpha(np.asarray(im.getchannel("A"), dtype=np.float32) / 255, t, blur)
    if B is None:
        return im
    out = np.zeros(B.shape + (4,), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = rgb
    out[..., 3] = np.clip(B * alpha * 255 + 0.5, 0, 255).astype(np.uint8)
    o = Image.fromarray(out, "RGBA")
    o.alpha_composite(im, (pad, pad))
    return o


def outline_of(o, H):
    """レイヤーのふち取りの設定 (太さ px, ぼかし px, 色, 不透明度)。付けないなら None。太さ・ぼかしは画面の高さに対しての割合"""
    ol = o.get("ol")
    if o.get("kind") not in ("image", "video", "shape") or not isinstance(ol, dict) or not ol.get("on"):
        return None
    w = _f(ol.get("w"), 0.01)
    sides = tuple(_cl(_f(ol.get(k), w), 0.0, 0.2) * H for k in ("t", "b", "l", "r"))  # 上・下・左・右(無ければ w)
    if max(sides) < 0.05:
        return None
    return sides, _cl(_f(ol.get("blur"), 0.0), 0.0, 0.1) * H, _rgb(ol.get("color") or "#ffffff"), _cl(_f(ol.get("alpha"), 1.0), 0.0, 1.0)


def edge_blur_px(edge, w, h):
    """まわりだけぼかすときのぼかしの強さ(px)。強さ 1 で短い辺の 2.5%"""
    return max(0.5, min(3.0, max(0.0, _f(edge.get("amt"), 1.0))) * 0.025 * min(w, h))


def draw_item(canvas, img, cx, cy, w, h, rot=0.0, opacity=1.0, masks=(), dip=None, edge=None, blur=0.0, outline=None):
    """img(RGBA)を w×h にして、中心 (cx, cy) に、回転・不透明度・形のトランジション・色を混ぜて重ねる。
    edge: ふちのぼかし / blur: 全体のぼかし(px。トランジション・ループ) / outline: ふち取り (太さ px, ぼかし px, 色, 不透明度)"""
    w, h = int(round(w)), int(round(h))
    if w < 1 or h < 1 or opacity <= 0.001:
        return
    im = img if img.size == (w, h) else img.resize((w, h), Image.BILINEAR)
    if edge:
        im = apply_edge(im if im.mode == "RGBA" else im.convert("RGBA"), edge)
    ms = [m for m in masks if m is not None]
    if ms or dip:
        a = np.asarray(im, dtype=np.float32).copy()
        for m in ms:
            a[..., 3] *= m
        if dip:
            amt, col = dip
            a[..., :3] = a[..., :3] * (1 - amt) + np.array(col, dtype=np.float32) * amt
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")
    if outline:
        im = with_outline(im if im.mode == "RGBA" else im.convert("RGBA"), *outline)
    im = _alpha(im if im.mode == "RGBA" else im.convert("RGBA"), opacity)
    if blur > 0.3:
        # まわりに余白をとってからぼかす(ふちの外へも広がる)。中心は変わらない
        pad = int(math.ceil(blur * 3))
        big = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        big.paste(im, (pad, pad))
        im = big.filter(ImageFilter.GaussianBlur(blur))
    if abs(rot) > 0.01:
        im = im.rotate(-rot, resample=Image.BICUBIC, expand=True)
    _paste_clip(canvas, im, int(round(cx - im.width / 2)), int(round(cy - im.height / 2)))


_WRAP_TOKEN = re.compile(r"[ \t]+|[A-Za-z0-9'’\-.,:;!?%&@#/_()\[\]]+|.")


def wrap_lines(text, font, max_w):
    """改行のほかに、幅 max_w(px)を超えないように折り返す。英数字の単語は途中で切らない(長すぎる単語だけ文字で切る)"""
    out = []
    for para in str(text).split("\n"):
        if max_w <= 0:
            out.append(para)
            continue
        line = ""
        for tk in _WRAP_TOKEN.findall(para):
            if tk.isspace():
                if line:
                    line += tk
                continue
            if font.getlength(line + tk) <= max_w or not line.strip():
                if font.getlength(tk) > max_w:
                    for ch in tk:
                        if line.strip() and font.getlength(line + ch) > max_w:
                            out.append(line.rstrip())
                            line = ""
                        line += ch
                else:
                    line += tk
            else:
                out.append(line.rstrip())
                line = tk
                if font.getlength(tk) > max_w:
                    line = ""
                    for ch in tk:
                        if line and font.getlength(line + ch) > max_w:
                            out.append(line)
                            line = ""
                        line += ch
        out.append(line.rstrip())
    return out


def text_lines(o, font, W):
    """表示する行。画面(プレビュー)で折り返した結果(wrapped)があればそれを使う(見たとおりに書き出す)"""
    raw = str(o.get("text") or "")
    wrap = _f(o.get("wrap"), 0)
    if wrap > 0:
        wr = o.get("wrapped")
        if isinstance(wr, str) and wr.replace("\n", "").replace(" ", "") == raw.replace("\n", "").replace(" ", ""):
            return wr.split("\n")
        if W:
            return wrap_lines(raw, font, wrap * W)
    return raw.split("\n")


def text_image(o, H, font_path, size=None, reveal=None, W=None):
    """文字の画像(RGBA)。中心が文字の中心になるようにまわりを空ける。縁(ずらす・透明度 = 影にもなる)と背景(大きさ・位置・角の丸み)。
    wrap(画面の幅に対しての折り返し幅)・reveal(一文字ずつ出すときの進み 0〜1)"""
    text = str(o.get("text") or "")
    if not text.strip():
        return None
    px = max(6, int(round(_f(size if size is not None else o.get("size"), 0.08) * H)))
    font = load_font(o.get("font"), px, font_path)
    sw = max(0, int(round(_f(o.get("strokeWidth"), 0.08) * px)))
    sdx, sdy = _f(o.get("strokeDx"), 0) * px, _f(o.get("strokeDy"), 0) * px
    sa = min(1.0, max(0.0, _f(o.get("strokeAlpha"), 1.0)))
    sb = max(0.0, _f(o.get("strokeBlur"), 0)) * px  # 縁(影)のぼかし
    spacing = int(px * 0.2)
    lines = text_lines(o, font, W)
    try:
        asc, desc = font.getmetrics()
    except Exception:  # noqa: BLE001
        asc, desc = int(px * 0.88), int(px * 0.24)
    line_h = asc + desc + spacing
    widths = [font.getlength(l) for l in lines]
    align = str(o.get("align") or "center")  # 文字の寄せ(left / center / right)
    tw = max(widths + [1.0]) + 2 * sw
    th = len(lines) * line_h - spacing + 2 * sw
    ba = _f(o.get("bgAlpha"), 0)
    padx, pady = _f(o.get("bgPadX"), 0.3) * px, _f(o.get("bgPadY"), 0.3) * px
    bgx, bgy = _f(o.get("bgOffX"), 0) * px, _f(o.get("bgOffY"), 0) * px
    # 中心からの広がり(左右・上下とも同じだけ空ける)
    ex = tw / 2 + abs(sdx) + 2 + sb * 3
    ey = th / 2 + abs(sdy) + 2 + sb * 3
    if ba > 0:
        ex = max(ex, tw / 2 + padx + abs(bgx) + 2)
        ey = max(ey, th / 2 + pady + abs(bgy) + 2)
    IW, IH = int(np.ceil(ex * 2)), int(np.ceil(ey * 2))
    cx, cy = IW / 2, IH / 2
    layer = Image.new("RGBA", (IW, IH), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if ba > 0:
        box = (cx - tw / 2 - padx + bgx, cy - th / 2 - pady + bgy, cx + tw / 2 + padx + bgx, cy + th / 2 + pady + bgy)
        rad = min(1.0, max(0.0, _f(o.get("bgRadius"), 0))) * min(box[2] - box[0], box[3] - box[1]) / 2
        col = (*_rgb(o.get("bg"), (0, 0, 0)), int(255 * min(1, ba)))
        if rad >= 1:
            d.rounded_rectangle(box, radius=rad, fill=col)
        else:
            d.rectangle(box, fill=col)
    # 一文字ずつ出す: 先頭から k 文字だけ描く(位置は全部出したときと同じ)
    total = sum(len(l) for l in lines)
    k = total if reveal is None else int(math.floor(min(1.0, max(0.0, reveal)) * total + 1e-9))
    top = cy - th / 2 + sw
    shown = []
    for i, l in enumerate(lines):
        n = max(0, min(len(l), k))
        k -= len(l)
        if align == "left":
            lx = cx - tw / 2 + sw
        elif align == "right":
            lx = cx + tw / 2 - sw - widths[i]
        else:
            lx = cx - widths[i] / 2
        shown.append((lx, top + i * line_h + asc, l[:n]))
    fill = (*_rgb(o.get("color")), 255)
    stroke = _rgb(o.get("stroke"), (0, 0, 0))
    shadow = abs(sdx) > 0.5 or abs(sdy) > 0.5 or sb > 0.3
    if (sw > 0 or shadow) and (shadow or sa < 0.999):
        # 縁を別の層に描いてずらす・透かす・ぼかす(影になる。縁の太さが 0 でも、ずらすかぼかせば文字の形の影)。文字はその上に縁なしで
        sl = Image.new("RGBA", (IW, IH), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sl)
        for x, y, l in shown:
            if l:
                sd.text((x + sdx, y + sdy), l, font=font, fill=(*stroke, 255), anchor="ls", stroke_width=sw, stroke_fill=(*stroke, 255))
        if sb > 0.3:
            sl = sl.filter(ImageFilter.GaussianBlur(sb))
        layer.alpha_composite(_alpha(sl, sa))
        for x, y, l in shown:
            if l:
                d.text((x, y), l, font=font, fill=fill, anchor="ls")
    else:
        for x, y, l in shown:
            if l:
                d.text((x, y), l, font=font, fill=fill, anchor="ls", stroke_width=sw, stroke_fill=(*stroke, 255))
    return layer


def draw_text(canvas, o, W, H, font_path):
    """第18版までの描き方(回転・動き・トランジションなし)。テストと互換のため残す"""
    im = text_image(o, H, font_path)
    if im is not None:
        draw_item(canvas, im, _f(o.get("x"), 0.5) * W, _f(o.get("y"), 0.85) * H, im.width, im.height, 0, _f(o.get("opacity"), 1))


def paste_rgba(canvas, img, o, W, H):
    x, y, w, h = _box(o, W, H)
    draw_item(canvas, img.convert("RGBA"), x + w / 2, y + h / 2, w, h, 0, _f(o.get("opacity"), 1))


# ---------------------------------------------------------------- 文字の書式のおすすめ(★)
BUILTIN_TEXT_STYLES = [
    ("白文字・黒縁(標準)", {"color": "#ffffff", "stroke": "#000000", "strokeWidth": 0.08, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1, "bgAlpha": 0}),
    ("黄色・黒縁(バラエティ)", {"color": "#ffe600", "stroke": "#000000", "strokeWidth": 0.12, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1, "bgAlpha": 0}),
    ("白文字・右下に影", {"color": "#ffffff", "stroke": "#000000", "strokeWidth": 0.05, "strokeDx": 0.06, "strokeDy": 0.06, "strokeAlpha": 0.6, "strokeBlur": 0.04, "bgAlpha": 0}),
    ("黒文字・白縁", {"color": "#111111", "stroke": "#ffffff", "strokeWidth": 0.1, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1, "bgAlpha": 0}),
    ("字幕(半透明の黒帯)", {"color": "#ffffff", "stroke": "#000000", "strokeWidth": 0, "bg": "#000000", "bgAlpha": 0.55,
                     "bgPadX": 0.5, "bgPadY": 0.2, "bgOffX": 0, "bgOffY": 0, "bgRadius": 0.35}),
    ("ニュース風(青帯)", {"color": "#ffffff", "stroke": "#000000", "strokeWidth": 0, "bg": "#1450a0", "bgAlpha": 0.9,
                    "bgPadX": 0.6, "bgPadY": 0.25, "bgOffX": 0, "bgOffY": 0}),
    ("強調(赤・白縁)", {"color": "#ff2a2a", "stroke": "#ffffff", "strokeWidth": 0.12, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1, "bgAlpha": 0}),
    ("かわいい(白・ピンク縁)", {"color": "#ffffff", "stroke": "#ff6fb5", "strokeWidth": 0.14, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1, "bgAlpha": 0}),
    # ネオン: 白に近い芯と、ぼかした青い光(第23版で作り直し。前は縁をぼかさず薄い水色だったので、明るい背景で光って見えなかった)
    ("ネオン(水色・青い光)", {"color": "#e6ffff", "stroke": "#0a6cff", "strokeWidth": 0.15, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1,
                       "strokeBlur": 0.07, "bgAlpha": 0}),
    ("映画字幕(薄い黄・細い縁)", {"color": "#fff4b0", "stroke": "#000000", "strokeWidth": 0.04, "strokeDx": 0, "strokeDy": 0, "strokeAlpha": 1, "bgAlpha": 0}),
    ("見出し(白・大きな影)", {"color": "#ffffff", "stroke": "#000000", "strokeWidth": 0.1, "strokeDx": 0.05, "strokeDy": 0.08, "strokeAlpha": 0.85, "strokeBlur": 0.05,
                      "bgAlpha": 0, "size": 0.12}),
    ("テロップ(黒帯・黄色文字)", {"color": "#ffd800", "stroke": "#000000", "strokeWidth": 0, "bg": "#000000", "bgAlpha": 0.8,
                       "bgPadX": 0.6, "bgPadY": 0.25, "bgOffX": 0, "bgOffY": 0, "bgRadius": 1}),
]


def text_style_list():
    from . import store
    user, hidden = store.text_styles()
    return {"builtin": [{"name": n, "style": st} for n, st in BUILTIN_TEXT_STYLES if n not in hidden],
            "user": [{"name": n, "style": st} for n, st in user.items()], "hidden": hidden}


# ---------------------------------------------------------------- 透かし(user/default/cca_generator/watermarks)
# input は使わない。前の版の input/cca_watermarks にあるものは、初めて使うときにこちらへ移す
WATERMARK_DIR = "cca_watermarks"
WM_TAG = "cca_wm"


def watermark_dir():
    d = os.path.join(os.path.dirname(user_font_dir()), "watermarks")
    os.makedirs(d, exist_ok=True)
    old = os.path.join(folder_paths.get_input_directory(), WATERMARK_DIR)
    if os.path.isdir(old):
        import shutil
        for f in os.listdir(old):
            src, dst = os.path.join(old, f), os.path.join(d, f)
            if os.path.isfile(src) and not os.path.exists(dst):
                try:
                    shutil.move(src, dst)
                except OSError:
                    pass
        try:
            os.rmdir(old)  # 空になったら消す(ほかのファイルがあれば残す)
        except OSError:
            pass
    return d


def _watermark_path(name):
    d = watermark_dir()
    p = os.path.abspath(os.path.join(d, os.path.basename(str(name or "").replace("\\", "/"))))
    if os.path.dirname(p) != os.path.abspath(d) or not os.path.isfile(p):
        raise ValueError(tr("ファイルが見つかりません: {name}", name=name))
    return p


def watermark_value(name):
    return f"{name} [{WM_TAG}]"


def watermark_list():
    d = watermark_dir()
    items = []
    for f in os.listdir(d):
        if f.lower().endswith(IMAGE_EXTS) and os.path.isfile(os.path.join(d, f)):
            items.append((os.path.getmtime(os.path.join(d, f)), f))
    return [{"name": f, "value": watermark_value(f)} for _, f in sorted(items, reverse=True)]


def watermark_save(data, filename):
    """画像を透かしとして登録する(PNG にして保存。同じ名前があれば _1、_2 …)"""
    import io
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception as e:  # noqa: BLE001
        raise ValueError(tr("画像として読めませんでした: {error}", error=e)) from e
    stem = re.sub(r"[\\/:*?\"<>|]", "_", os.path.splitext(os.path.basename(filename or "watermark"))[0]).strip() or "watermark"
    d = watermark_dir()
    name, n = f"{stem}.png", 1
    while os.path.exists(os.path.join(d, name)):
        name = f"{stem}_{n}.png"
        n += 1
    im.convert("RGBA").save(os.path.join(d, name), "PNG")
    return {"name": name, "value": watermark_value(name)}


def watermark_delete(name):
    d = watermark_dir()
    p = os.path.abspath(os.path.join(d, os.path.basename(str(name or ""))))
    if os.path.dirname(p) != os.path.abspath(d) or not os.path.isfile(p):
        raise ValueError(tr("透かしが見つかりません: {name}", name=name))
    os.remove(p)
    return True


# ---------------------------------------------------------------- 書き出し
BG_COLORS = {"black": (0, 0, 0, 255), "white": (255, 255, 255, 255), "transparent": (0, 0, 0, 0)}
FORMATS = {"mp4": ".mp4", "webm": ".webm", "webp": ".webp", "gif": ".gif"}


def clip_len(c):
    return (c["out"] - c["in"]) / max(0.01, _f(c.get("speed"), 1.0))


def check_project(p):
    clips = [c for c in (p.get("clips") or []) if c.get("src")]
    overlays = [o for o in (p.get("overlays") or []) if _f(o.get("end"), 0) > _f(o.get("start"), 0)]
    if not clips and not overlays:
        raise ValueError(tr("つなげる動画がありません"))
    for c in clips:
        c["in"] = max(0.0, float(c.get("in", 0)))
        c["out"] = float(c.get("out", c["in"] + 1))
        c["speed"] = min(16.0, max(0.05, _f(c.get("speed"), 1.0)))
        if c["out"] - c["in"] < 0.04:
            raise ValueError(tr("短すぎる動画があります(0.04 秒以上にしてください)"))
    W, H = [int(v) for v in (p.get("size") or [0, 0])]
    W, H = max(16, min(MAX_SIDE, W - W % 2)), max(16, min(MAX_SIDE, H - H % 2))
    fps = max(1.0, min(120.0, float(p.get("fps") or 24)))
    return clips, W, H, fps


def audio_items(p, clips, starts, overlays):
    """書き出す音の一覧 [(パス, 元の始め, 元の長さ, 置く時刻, 速さ, 音量, 高さを保つ, フェードイン, フェードアウト)]"""
    out = []
    if isinstance(p.get("audios"), list):
        for a in p["audios"]:
            if not a.get("src") or a.get("mute") or _f(a.get("volume"), 1) <= 0:
                continue
            a_in, a_out = max(0.0, _f(a.get("in"), 0)), _f(a.get("out"), 0)
            if a_out - a_in < 0.01:
                continue
            out.append((full_path(a["src"]), a_in, a_out - a_in, max(0.0, _f(a.get("start"), 0)),
                        min(16.0, max(0.05, _f(a.get("speed"), 1))), _f(a.get("volume"), 1), a.get("keepPitch", True) is not False,
                        max(0.0, _f(a.get("fadeIn"), 0)), max(0.0, _f(a.get("fadeOut"), 0)), volume_keys(a.get("vkf"), a.get("vkEase"))))
    else:  # 第18版までの形: つなげる動画の音(音量)
        for c, s in zip(clips, starts):
            if _f(c.get("volume"), 1) > 0:
                out.append((full_path(c["src"]), c["in"], c["out"] - c["in"], s, c.get("speed", 1.0), _f(c.get("volume"), 1), True, 0, 0, None))
    for o in overlays:
        if o.get("kind") == "video" and o.get("audio") and _f(o.get("volume"), 1) > 0:
            sp = min(16.0, max(0.05, _f(o.get("speed"), 1)))
            d = (_f(o.get("end"), 0) - _f(o.get("start"), 0)) * sp
            out.append((full_path(o["src"]), _f(o.get("in"), 0), d, _f(o.get("start"), 0), sp, _f(o.get("volume"), 1), True, 0, 0, None))
    return out


def volume_keys(vkf, ease=None):
    """音量のキーフレーム [{t: 置いた所からの秒, v: 音量 0〜2}] → (時刻順の (t, v), なめらかか)。無ければ None"""
    if not isinstance(vkf, list):
        return None
    ks = sorted((max(0.0, _f(k.get("t"), 0)), min(4.0, max(0.0, _f(k.get("v"), 1)))) for k in vkf if isinstance(k, dict))
    return (ks, ease != "linear") if ks else None


def volume_env(ts, keys):
    """時刻 ts の音量。キーフレームの間は直線(なめらかなら ゆっくり始まり ゆっくり止まる)。前後は端の値"""
    ks, smooth = keys
    kt = np.array([k[0] for k in ks], dtype=np.float64)
    kv = np.array([k[1] for k in ks], dtype=np.float64)
    if len(ks) == 1:
        return np.full(ts.shape, kv[0], dtype=np.float32)
    i = np.clip(np.searchsorted(kt, ts, side="right") - 1, 0, len(ks) - 2)
    t0, t1 = kt[i], kt[i + 1]
    q = np.clip((ts - t0) / np.maximum(t1 - t0, 1e-6), 0.0, 1.0)
    if smooth:
        q = q * q * (3 - 2 * q)
    return (kv[i] + (kv[i + 1] - kv[i]) * q).astype(np.float32)


def mix_audio(items, total):
    n = int(round(total * AUDIO_RATE))
    mix = np.zeros((2, n), dtype=np.float32)
    for path, a_in, a_len, start, speed, vol, keep, fin, fout, keys in items:
        # キーフレームがあれば、音量はキーフレームの値(間はなめらかではなく直線でつなぐ)
        a = read_audio(path, a_in, a_len, 1.0 if keys else vol)
        a = stretch_audio(a, speed, keep)
        m = a.shape[1]
        if keys and m:
            env = volume_env(np.arange(m, dtype=np.float64) / AUDIO_RATE, keys)
            a = a * env[None, :]
        if fin > 0:
            k = min(m, int(fin * AUDIO_RATE))
            a[:, :k] *= np.linspace(0, 1, k, dtype=np.float32)
        if fout > 0:
            k = min(m, int(fout * AUDIO_RATE))
            a[:, m - k:] *= np.linspace(1, 0, k, dtype=np.float32)
        o0 = int(round(start * AUDIO_RATE))
        if o0 >= n:
            continue
        seg = a[:, :n - o0]
        mix[:, o0:o0 + seg.shape[1]] += seg
    np.clip(mix, -1.0, 1.0, out=mix)
    return mix


def _webp_alpha_flag(path):
    """FFmpeg の WebP(アニメーション)を直す。
    - 全部のコマが同じだと「透明度あり」の印を付けないことがある → 透明度があれば印を付ける
    - コマごとの印が「前のコマに重ねる・描いたあと消さない」なので、透明な所に前のコマが残る(残像)
      → 全部のコマを「重ねない(このコマで置きかえる)・描いたあと背景に戻す」にし、背景の色を透明にする"""
    try:
        with open(path, "rb") as f:
            data = bytearray(f.read())
    except OSError:
        return
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP" or data[12:16] != b"VP8X":
        return
    if b"ALPH" in data:
        data[20] |= 0x10
    pos = 12
    while pos + 8 <= len(data):
        tag = bytes(data[pos:pos + 4])
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        body = pos + 8
        if tag == b"ANIM" and size >= 6:
            data[body:body + 4] = b"\x00\x00\x00\x00"  # 背景の色: 透明
        elif tag == b"ANMF" and size >= 16:
            data[body + 15] |= 0x03  # bit1: 重ねない / bit0: 描いたあと背景に戻す
        pos = body + size + (size & 1)
    try:
        with open(path, "wb") as f:
            f.write(bytes(data))
    except OSError:
        pass


class _Writer:
    """mp4(H.264 + AAC)/ webm(VP9 透明度つき + Opus)/ webp(アニメーション・透明度つき)/ gif(透過)"""

    def __init__(self, path, fmt, W, H, fps, audio, opts):
        self.fmt, self.W, self.H, self.path = fmt, W, H, path
        self.rate = Fraction(int(round(fps))) if abs(fps - round(fps)) < 1e-3 else Fraction(int(round(fps * 1000)), 1000)
        self.gif = []
        self.fps = fps
        self.opts = opts
        self.out = None
        self.as_ = None
        if fmt == "gif":
            return
        if fmt == "webp":
            self.out = av.open(path, mode="w", format="webp", options={"loop": str(int(opts.get("loop", 0)))})
            # libwebp_anim は同じコマが続くと 1 コマにまとめ、そのとき透明度を落とすことがあるので、コマごとに符号化する libwebp を使う
            self.vs = self.out.add_stream("libwebp", rate=self.rate)
            lossless = bool(opts.get("lossless"))
            self.vs.pix_fmt = "bgra" if lossless else "yuva420p"
            self.vs.options = {"lossless": "1" if lossless else "0", "quality": str(int(opts.get("quality", 85)))}
        elif fmt == "webm":
            self.out = av.open(path, mode="w")
            self.vs = self.out.add_stream("libvpx-vp9", rate=self.rate)
            self.vs.pix_fmt = "yuva420p"
            self.vs.options = {"crf": "30", "b:v": "0", "auto-alt-ref": "0", "deadline": "good", "cpu-used": "4"}
            if audio is not None:
                self.as_ = self.out.add_stream("libopus", rate=AUDIO_RATE)
                self.as_.layout = "stereo"
        else:
            self.out = av.open(path, mode="w")
            self.vs = self.out.add_stream("libx264", rate=self.rate)
            self.vs.pix_fmt = "yuv420p"
            self.vs.options = {"crf": "18", "preset": "medium"}
            if audio is not None:
                self.as_ = self.out.add_stream("aac", rate=AUDIO_RATE)
                self.as_.layout = "stereo"
        self.vs.width, self.vs.height = W, H

    def frame(self, n, canvas):
        if self.fmt == "gif":
            a = np.asarray(canvas)
            rgb = Image.fromarray(np.ascontiguousarray(a[:, :, :3]), "RGB")
            p = rgb.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
            idx = np.asarray(p).copy()
            idx[a[:, :, 3] < 128] = 255
            pal = (p.getpalette() or [])[:765]
            pal += [0] * (768 - len(pal))
            q = Image.fromarray(idx.astype(np.uint8), "P")
            q.putpalette(pal)
            q.info["transparency"] = 255
            self.gif.append(q)
            return
        if self.fmt == "mp4":
            vf = av.VideoFrame.from_ndarray(np.asarray(canvas.convert("RGB")), format="rgb24")
        else:
            vf = av.VideoFrame.from_ndarray(np.asarray(canvas), format="rgba").reformat(format=self.vs.pix_fmt)
        vf.pts, vf.time_base = n, 1 / self.rate
        for pkt in self.vs.encode(vf):
            self.out.mux(pkt)

    def finish(self, mix):
        if self.fmt == "gif":
            if self.gif:
                ms = max(20, int(round(1000 / self.fps / 10)) * 10)
                self.gif[0].save(self.path, format="GIF", save_all=True, append_images=self.gif[1:], duration=ms,
                                 loop=int(self.opts.get("loop", 0)), disposal=2, transparency=255, optimize=False)
            return
        for pkt in self.vs.encode():
            self.out.mux(pkt)
        if self.as_ is not None and mix is not None:
            step = 960 if self.fmt == "webm" else 1024
            for i in range(0, mix.shape[1], step):
                chunk = np.ascontiguousarray(mix[:, i:i + step])
                if chunk.shape[1] < step and self.fmt == "webm":
                    chunk = np.concatenate([chunk, np.zeros((2, step - chunk.shape[1]), np.float32)], axis=1)
                af = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="stereo")
                af.sample_rate = AUDIO_RATE
                af.pts, af.time_base = i, Fraction(1, AUDIO_RATE)
                for pkt in self.as_.encode(af):
                    self.out.mux(pkt)
            for pkt in self.as_.encode():
                self.out.mux(pkt)
        self.out.close()
        if self.fmt == "webp":
            _webp_alpha_flag(self.path)

    def abort(self):
        try:
            if self.out is not None:
                self.out.close()
        except Exception:  # noqa: BLE001
            pass


def render(project, progress=None, interrupted=None):
    """書き出して {filename, subfolder, type, value, path, duration, format, audio} を返す"""
    p = json.loads(project) if isinstance(project, str) else dict(project)
    clips, W, H, fps = check_project(p)
    overlays = [o for o in (p.get("overlays") or []) if _f(o.get("end"), 0) > _f(o.get("start"), 0)]
    # 第26版: 段(row)の順に描く(下の段から。同じ段は並び順)
    overlays.sort(key=lambda o: _f(o.get("row"), 0))
    fmt = p.get("format") if p.get("format") in FORMATS else "mp4"
    bg = BG_COLORS.get(p.get("bg"), BG_COLORS["black"])
    if fmt == "mp4" and bg[3] == 0:
        bg = BG_COLORS["black"]  # mp4 は透明にできない
    opts = p.get("export") or {}
    out_fps = _f(opts.get("fps"), 0) or fps
    out_fps = max(1.0, min(fps if fmt != "gif" else min(fps, 50.0), out_fps))
    starts, t = [], 0.0
    for c in clips:
        starts.append(t)
        t += clip_len(c)
    total = t if clips else max(_f(o.get("end"), 0) for o in overlays)
    nframes = max(1, int(round(total * out_fps)))
    first = clips[0]["src"] if clips else next((o["src"] for o in overlays if o.get("src")), "video.png [output]")
    folder, fname, typ, sub = target_for(first, FORMATS[fmt], p.get("out_prefix"))
    path = os.path.join(folder, fname)
    font = find_font()
    # 画像は 1 回だけ読む(背景を透明にする設定があればそれも)
    imgs = {}
    for o in overlays:
        if o.get("kind") == "image":
            im = Image.open(full_path(o["src"]))
            arr = np.asarray(im.convert("RGBA"))
            imgs[id(o)] = to_rgba(arr, o.get("key"), use_alpha=True) if (o.get("key") or {}).get("mode") in ("chroma", "ai") \
                else Image.fromarray(np.ascontiguousarray(arr), "RGBA")
    alpha_src = {}
    for it in clips + [o for o in overlays if o.get("kind") == "video"]:
        alpha_src[id(it)] = (it.get("key") or {}).get("mode") == "alpha" or ((it.get("key") or {}).get("mode") is None and video_has_alpha(full_path(it["src"])))
    mix = None
    a_items = audio_items(p, clips, starts, overlays) if fmt in ("mp4", "webm") else []
    if a_items:
        mix = mix_audio(a_items, nframes / out_fps)
        if not np.any(mix):
            mix = None  # 全部無音なら音の無いファイルにする
    wr = _Writer(path, fmt, W, H, out_fps, mix, opts)
    readers, ov_readers = {}, {}
    try:
        ci = 0
        for n in range(nframes):
            if interrupted:
                interrupted()
            tt = (n + 0.5) / out_fps
            canvas = Image.new("RGBA", (W, H), bg)
            if clips:
                while ci < len(clips) - 1 and tt >= starts[ci + 1]:
                    if ci in readers:
                        readers.pop(ci).close()
                    ci += 1
                c = clips[ci]
                local = tt - starts[ci]
                if ci not in readers:
                    readers[ci] = FrameReader(full_path(c["src"]), c["in"], alpha=alpha_src[id(c)])
                frame = readers[ci].at(c["in"] + local * c["speed"])
                if frame is not None:
                    draw_clip(canvas, c, frame, local, clip_len(c), alpha_src[id(c)])
            vis = []
            for o in overlays:
                s0, s1 = _f(o.get("start"), 0), _f(o.get("end"), 0)
                if not (s0 <= tt < s1):
                    if o.get("kind") == "video" and id(o) in ov_readers and tt >= s1:
                        ov_readers.pop(id(o)).close()
                    continue
                vis.append(o)
            # 下のレイヤーで切り抜く: 下のレイヤーと切り抜くレイヤーは別の板に描いてから重ねる
            bases, hide = clip_bases(vis)
            need = {id(b) for b in bases.values()}
            alphas = {}
            for o in vis:
                s0, s1 = _f(o.get("start"), 0), _f(o.get("end"), 0)
                local = tt - s0
                b = bases.get(id(o))
                target = canvas if b is None and id(o) not in need else Image.new("RGBA", (W, H), (0, 0, 0, 0))
                k = o.get("kind")
                if k in ("text", "mosaic", "shape"):
                    draw_overlay(target, o, None, local, s1 - s0, font)
                elif k == "image":
                    draw_overlay(target, o, imgs[id(o)], local, s1 - s0, font)
                elif k == "video":
                    if id(o) not in ov_readers:
                        ov_readers[id(o)] = FrameReader(full_path(o["src"]), _f(o.get("in"), 0), alpha=True)
                    sp = min(16.0, max(0.05, _f(o.get("speed"), 1)))
                    f = ov_readers[id(o)].at(_f(o.get("in"), 0) + local * sp)
                    if f is not None:
                        draw_overlay(target, o, to_rgba(crop_arr(f, o.get("crop")), o.get("key"), use_alpha=alpha_src[id(o)]), local, s1 - s0, font)
                if b is not None:
                    clip_composite(canvas, target, alphas.get(id(b)), o.get("clip"))
                elif id(o) in need:
                    alphas[id(o)] = np.asarray(target.getchannel("A"), dtype=np.float32) / 255
                    if id(o) not in hide:
                        canvas.alpha_composite(target)
            wr.frame(n, canvas)
            if progress:
                progress(n + 1, nframes)
        wr.finish(mix)
    except BaseException:
        wr.abort()
        for r in list(readers.values()) + list(ov_readers.values()):
            r.close()
        try:
            os.remove(path)
        except OSError:
            pass
        raise
    for r in list(readers.values()) + list(ov_readers.values()):
        r.close()
    rel = f"{sub}/{fname}" if sub else fname
    return {"filename": fname, "subfolder": sub, "type": typ, "path": path, "value": f"{rel} [{typ}]",
            "duration": round(nframes / out_fps, 3), "width": W, "height": H, "format": fmt, "audio": mix is not None}


def _trans_all(o, local, length, key):
    st_in, st_out = trans_progress(o.get("tin"), o.get("tout"), local, length)
    return st_in, st_out


def draw_clip(canvas, c, frame, local, length, use_alpha):
    """つなげる動画を描く。枠に収めた大きさ × 大きさ(s)、位置・回転・不透明度・動き・トランジション・背景の透明化"""
    W, H = canvas.size
    arr = crop_arr(frame, c.get("crop"))
    im = to_rgba(arr, c.get("key"), use_alpha)
    st = anim_state(c, ANIM_KEYS["clip"], local)
    pin, pout = _trans_all(c, local, length, "clip")
    dip = apply_trans_state(st, c.get("tin"), pin, "clip") or apply_trans_state(st, c.get("tout"), pout, "clip")
    fit = min(W / im.width, H / im.height)
    w, h = im.width * fit * st["s"], im.height * fit * st["s"]
    cx, cy = slide_pos(st, st["x"] * W, st["y"] * H, w, h, W, H)
    cx, cy, w, h = apply_motion(st, cx, cy, w, h, W, H)
    cx, cy, w, h = apply_loop(st, c.get("loop"), local, cx, cy, w, h)
    masks = (trans_mask(c.get("tin"), pin, int(round(w)), int(round(h))), trans_mask(c.get("tout"), pout, int(round(w)), int(round(h))))
    draw_item(canvas, im, cx, cy, w, h, st["rot"], st["opacity"], masks, dip, edge=c.get("edge"), blur=st.get("blur", 0.0) * H)


# ---------------------------------------------------------------- 第22版: モザイク(置いた所の、下の段を描いた画面を加工する)
MOSAIC_MODES = ("pixel", "blur", "fill")


def mosaic_block_px(o, W, H):
    """モザイクの大きさ(px)。block は短い辺に対しての割合(既定 3%)"""
    return max(2, int(round(min(0.2, max(0.005, _f(o.get("block"), 0.03))) * min(W, H))))


def mosaic_image(canvas, o, cx, cy, w, h, rot):
    """モザイクの中身(RGBA・w×h)。今の画面(ここより下の段を描いたもの)の、置いた所(回した枠の中)を切り出して、
    pixel: ブロックごとの平均の色 / blur: ぼかす / fill: 塗りつぶす。shape が ellipse ならまるく"""
    W, H = canvas.size
    w, h = max(1, int(round(w))), max(1, int(round(h)))
    mode = o.get("mosaic") if o.get("mosaic") in MOSAIC_MODES else "pixel"
    if mode == "fill":
        img = Image.new("RGBA", (w, h), (*_rgb(o.get("color"), (0, 0, 0)), 255))
    else:
        blk = mosaic_block_px(o, W, H)
        # 切り出す大きさ: pixel はマス目ちょうど(枠の左上から blk ごと。端のマスも blk 分を平均)、
        # blur は枠のまわりも少し切り出してからぼかす(枠の縁が薄くならないように)
        if mode == "pixel":
            sw, sh = max(1, math.ceil(w / blk)), max(1, math.ceil(h / blk))
            rw, rh, m = sw * blk, sh * blk, 0
        else:
            m = int(math.ceil(blk * 3))
            rw, rh = w + 2 * m, h + 2 * m
        th = math.radians(rot)
        c, sn = math.cos(th), math.sin(th)
        # 切り出す範囲が画面の外に出るときは、画面の端の色をのばしておく(外が透明のまま混ざらないように)
        ex = abs(c) * rw / 2 + abs(sn) * rh / 2
        ey = abs(sn) * rw / 2 + abs(c) * rh / 2
        mcx, mcy = cx + (c * (rw - w) - sn * (rh - h)) / 2 - c * m + sn * m, cy + (sn * (rw - w) + c * (rh - h)) / 2 - sn * m - c * m
        over = max(0.0, ex - mcx, mcx + ex - W, ey - mcy, mcy + ey - H)
        src = canvas if canvas.mode == "RGBA" else canvas.convert("RGBA")
        pad = 0
        if over > 0:
            pad = int(min(math.ceil(over) + 2, max(W, H)))
            src = Image.fromarray(np.pad(np.asarray(src), ((pad, pad), (pad, pad), (0, 0)), mode="edge"), "RGBA")
        # 切り出した板の点 (u, v) → 画面の点(枠の回転に合わせる)。u, v は枠の左上から(m だけ外側から始まる)
        ox, oy = w / 2 + m, h / 2 + m
        data = (c, -sn, cx + pad - ox * c + oy * sn, sn, c, cy + pad - ox * sn - oy * c)
        # 透明な所の色が混ざって黒ずまないように、透明度を掛けた形(RGBa)で平均・ぼかしをする
        region = src.transform((rw, rh), Image.AFFINE, data, resample=Image.BILINEAR).convert("RGBa")
        if mode == "pixel":
            img = region.resize((sw, sh), Image.BOX).resize((rw, rh), Image.NEAREST).crop((0, 0, w, h))
        else:
            img = region.filter(ImageFilter.GaussianBlur(blk)).crop((m, m, m + w, m + h))
        img = img.convert("RGBA")
    if o.get("shape") == "ellipse":
        mk = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mk).ellipse((0, 0, w - 1, h - 1), fill=255)
        img.putalpha(ImageChops.multiply(img.getchannel("A"), mk))
    return img


def draw_overlay(canvas, o, img, local, length, font):
    W, H = canvas.size
    if o.get("kind") == "text":
        st = anim_state(o, ANIM_KEYS["text"], local)
        st.setdefault("size", _f(o.get("size"), 0.08))
    else:
        st = anim_state(o, ANIM_KEYS["media"], local)
    pin, pout = _trans_all(o, local, length, "text" if o.get("kind") == "text" else "media")
    key = "text" if o.get("kind") == "text" else "media"
    dip = apply_trans_state(st, o.get("tin"), pin, key) or apply_trans_state(st, o.get("tout"), pout, key)
    if o.get("kind") == "text":
        img = text_image(o, H, font, size=st["size"], reveal=st.get("_reveal"), W=W)
        if img is None:
            return
        w, h = img.width, img.height
    else:
        w, h = st["w"] * W, st["h"] * H
    cx, cy = slide_pos(st, st["x"] * W, st["y"] * H, w, h, W, H)
    cx, cy, w, h = apply_motion(st, cx, cy, w, h, W, H)
    cx, cy, w, h = apply_loop(st, o.get("loop"), local, cx, cy, w, h)
    masks = (trans_mask(o.get("tin"), pin, int(round(w)), int(round(h))), trans_mask(o.get("tout"), pout, int(round(w)), int(round(h))))
    if o.get("kind") in ("image", "video"):
        masks += (shape_mask(o.get("mask"), w, h, local),)  # 図形マスク
    if o.get("kind") == "shape":
        img = shape_image(o, w, h, H)  # 図形のレイヤー(その時刻の大きさで描く)
    edge = o.get("edge") if o.get("kind") != "text" else None
    if o.get("kind") == "mosaic":
        img = mosaic_image(canvas, o, cx, cy, w, h, st["rot"])
        if isinstance(edge, dict) and edge.get("mode") != "feather":
            edge = None  # モザイクは「ふちを透明に」だけ
    draw_item(canvas, img, cx, cy, w, h, st["rot"], st["opacity"], masks, dip, edge=edge, blur=st.get("blur", 0.0) * H, outline=outline_of(o, H))


class CCAVideoEdit:
    CATEGORY = "CCA Generator"
    FUNCTION = "run"
    OUTPUT_NODE = True
    DESCRIPTION = ("動画編集の書き出し。つなげる・切り取る(時間・画面)・文字・画像・動画を重ねる・動き・トランジション・速さ・"
                   "背景を透明にする・音声の段。MP4 / WebM / WebP / GIF(PyAV と Pillow だけで処理)。")
    RETURN_TYPES = ()

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"project": ("STRING", {"multiline": True, "default": "{}"})}}

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # 同じ内容でも押すたびに書き出す(ComfyUI が前の結果を使い回すと、消した前のファイルの場所を返してしまう)
        return float("nan")

    def run(self, project):
        import comfy.model_management as mm
        import comfy.utils
        pbar = [None]

        def progress(i, n):
            if pbar[0] is None:
                pbar[0] = comfy.utils.ProgressBar(n)
            pbar[0].update_absolute(i, n)

        info = render(project, progress=progress, interrupted=mm.throw_exception_if_processing_interrupted)
        return {"ui": {"cca_video": [info]}}


NODES = {"CCAVideoEdit": (CCAVideoEdit, "CCA 動画編集の書き出し")}
