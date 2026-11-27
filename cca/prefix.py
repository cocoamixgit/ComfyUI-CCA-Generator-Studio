"""保存先(filename_prefix)の書式を Python 側で展開する。

ComfyUI では %date:yyyy-MM-dd% などはブラウザ側(SaveImage のウィジェット)でしか置き換えられない。
パネルの出力から SaveImage につなぐとそのままサーバーに届き、Windows では ':' を含むフォルダ名になって
OSError になる。ここで先に置き換え、Windows で使えない文字も取り除く。
"""
import datetime
import re

_DATE_RE = re.compile(r"%date:([^%]+)%")
_TOKEN_RE = re.compile(r"yyyy|yy|MM|M|dd|d|hh|h|mm|m|ss|s")
_BAD_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def _format_date(fmt, now):
    def rep(m):
        t = m.group(0)
        return {
            "yyyy": f"{now.year:04d}", "yy": f"{now.year % 100:02d}",
            "MM": f"{now.month:02d}", "M": str(now.month),
            "dd": f"{now.day:02d}", "d": str(now.day),
            "hh": f"{now.hour:02d}", "h": str(now.hour),
            "mm": f"{now.minute:02d}", "m": str(now.minute),
            "ss": f"{now.second:02d}", "s": str(now.second),
        }[t]
    return _TOKEN_RE.sub(rep, fmt)


def expand_prefix(prefix, now=None):
    now = now or datetime.datetime.now()
    s = str(prefix or "").strip()
    s = _DATE_RE.sub(lambda m: _format_date(m.group(1), now), s)
    # 旧式の %year% などもここで置き換える(サーバー側でも置き換えられるが念のため)
    s = (s.replace("%year%", f"{now.year:04d}").replace("%month%", f"{now.month:02d}")
          .replace("%day%", f"{now.day:02d}").replace("%hour%", f"{now.hour:02d}")
          .replace("%minute%", f"{now.minute:02d}").replace("%second%", f"{now.second:02d}"))
    # 置き換えられない %ノード名.項目% は取り除く
    s = re.sub(r"%[^%/\\]*%", "", s)
    s = s.replace("\\", "/")
    parts = []
    for seg in s.split("/"):
        seg = _BAD_CHARS.sub("_", seg).strip().rstrip(".")
        if seg in ("", ".", ".."):
            continue
        parts.append(seg)
    return "/".join(parts) or "ComfyUI"


def prefix_folder(prefix, now=None):
    """保存先の書式のうち、フォルダの部分(output の中の相対パス)。"comfyui/%date:yyyy%/image" → "comfyui/2026" """
    s = expand_prefix(prefix, now)
    return s.rpartition("/")[0]


def uses_time(prefix):
    """秒・分まで含む書式なら毎回作り直す必要がある。"""
    return bool(re.search(r"%date:[^%]*[hms][^%]*%|%(hour|minute|second)%", str(prefix or "")))
