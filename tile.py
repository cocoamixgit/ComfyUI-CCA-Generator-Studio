"""第29版: 複数画像タイル生成 — 生成した画像を横 × 縦に並べ、1 枚(またはページごと)にまとめて保存する。

make(images, opts)
  images  並べる順の画像 [{filename, subfolder, type} または None(できなかった画像 = 空のマス)]
  opts
    cols            1 組の横に並べる数(1〜50。1 組の枚数より多ければその数にする)
    rows            1 ページの縦の数(paging = "split" のとき。1〜100)
    paging          "one"(何枚でも 1 枚に入れる)/ "split"(rows 行ごとに次のページ)
    scale           並べる大きさ(%。10〜100)
    gap, gap_color  画像の間の余白(px)と色(white / black / transparent / #rrggbb。transparent は PNG だけ)
    border          外側の枠 {top, right, bottom, left}(px)、border_color(色は余白と同じ)
    groups          組の数(文字の置き換えの言葉の数。images は組ごとに続けて並べる)。組は横に並べ、group_gap(px)あける
    labels          組の上に書く言葉(置き換えた言葉)。空なら書かない
    format          jpg / png / pdf(PDF はページごとに 1 ページ)
    quality         JPG・PDF の画質(1〜100)
    png_compress    PNG の圧縮(0〜9。大きいほどファイルは小さく、保存は遅い)
    name            ファイル名(「CCA_tile」)。保存先は 1 枚目の画像と同じフォルダ(output の中)
    info            タイルの設定(画面の設定をそのまま)。生成情報と一緒に画像(PNG・JPG・PDF)へ入れ、PNGinfo から戻せるようにする
戻り値: {"files": [{filename, subfolder, type}], "pages", "width", "height", "format", "count"}
"""
import base64
import io
import json
import math
import os
import re
import zlib

import folder_paths
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo

from .i18n import tr

MAX_IMAGES = 400
MAX_SIDE = 65000          # JPG の上限(65535)より少し小さく
MAX_PIXELS = 150_000_000  # 1 ページの画素数(メモリを使いすぎないように)
FORMATS = {"jpg": ".jpg", "png": ".png", "pdf": ".pdf"}
PDF_DPI = 150


def _int(v, lo, hi, d):
    try:
        x = int(round(float(v)))
    except (TypeError, ValueError):
        return d
    return max(lo, min(hi, x))


def color(v, alpha_ok):
    """色の指定 → RGBA。transparent は PNG のときだけ(ほかの形式は白)"""
    s = str(v or "").strip().lower()
    if s == "transparent":
        return (0, 0, 0, 0) if alpha_ok else (255, 255, 255, 255)
    if s == "black":
        return (0, 0, 0, 255)
    m = re.fullmatch(r"#([0-9a-f]{6})", s)
    if m:
        h = m.group(1)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    return (255, 255, 255, 255)


def image_path(item):
    """{filename, subfolder, type} → ファイルのパス(output / input / temp の中だけ)。見つからなければ None"""
    if not isinstance(item, dict) or not item.get("filename"):
        return None
    typ = item.get("type") or "output"
    if typ not in ("output", "input", "temp"):
        return None
    base = folder_paths.get_directory_by_type(typ)
    if not base:
        return None
    base = os.path.abspath(base)
    path = os.path.abspath(os.path.join(base, str(item.get("subfolder") or ""), os.path.basename(str(item["filename"]))))
    if os.path.commonpath([path, base]) != base or not os.path.isfile(path):
        return None
    return path


def _font(px):
    try:
        from .videoedit import find_font  # 日本語も書けるフォント(動画編集と同じ探し方)
        p = find_font()
        if p:
            return ImageFont.truetype(p, px)
    except Exception:  # noqa: BLE001
        pass
    try:
        return ImageFont.load_default(px)
    except Exception:  # noqa: BLE001
        return ImageFont.load_default()


def _wrap(draw, text, font, maxw, max_lines=4):
    """幅に収まるように折り返す(英語は単語ごと、日本語などは 1 文字ごと)。max_lines(4 行)を超えたら … で切る"""
    words = re.findall(r"\S+\s*|\s+", str(text).strip()) or [""]
    lines, cur = [], ""
    for w in words:
        if draw.textlength(cur + w, font=font) <= maxw or not cur.strip():
            cur += w
            while draw.textlength(cur.rstrip(), font=font) > maxw and len(cur.strip()) > 1:
                # 1 語で幅を超えるとき(日本語など)は文字で分ける
                cut = len(cur)
                while cut > 1 and draw.textlength(cur[:cut], font=font) > maxw:
                    cut -= 1
                lines.append(cur[:cut].rstrip())
                cur = cur[cut:]
            continue
        lines.append(cur.rstrip())
        cur = w.lstrip()
    if cur.strip():
        lines.append(cur.rstrip())
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > maxw:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines or [""]


def _text_color(bg):
    r, g, b, a = bg
    if a < 128:
        return (0, 0, 0, 255)
    return (0, 0, 0, 255) if (0.299 * r + 0.587 * g + 0.114 * b) > 140 else (255, 255, 255, 255)


def layout(n, opts):
    """(組の数, 1 組の枚数, 横の数, 全部の行数, 1 ページの行数)。組は文字の置き換えの言葉ごと(無ければ 1 組)"""
    groups = _int(opts.get("groups"), 1, 50, 1)
    per_group = max(1, math.ceil(n / groups))
    cols = min(_int(opts.get("cols"), 1, 50, 3), per_group)
    total = math.ceil(per_group / cols)
    per = _int(opts.get("rows"), 1, 100, total) if opts.get("paging") == "split" else total
    return groups, per_group, cols, total, max(1, min(per, total))


def compose(images, opts):
    """並べたページ(RGBA の画像)の一覧。
    groups > 1 のとき images は組ごとに続けて並べる(1 組目の全部 → 2 組目の全部 …)。
    1 組の中を横 cols 枚ずつ並べ、組は横に並べる(組の間は group_gap。無ければ余白の 3 倍・24px 以上)。
    labels は組ごとの見出し(組の上に書く)"""
    n = len(images)
    if not n:
        raise ValueError(tr('まとめる画像がありません'))
    if n > MAX_IMAGES:
        raise ValueError(tr('まとめられる画像は {n} 枚までです', n=MAX_IMAGES))
    fmt = opts.get("format") if opts.get("format") in FORMATS else "jpg"
    alpha = fmt == "png"
    groups, per_group, cols, total_rows, per = layout(n, opts)
    scale = _int(opts.get("scale"), 10, 100, 100) / 100
    gap = _int(opts.get("gap"), 0, 1000, 0)
    gapc = color(opts.get("gap_color"), alpha)
    ggap = _int(opts.get("group_gap"), 0, 5000, max(gap * 3, 24)) if groups > 1 else 0
    b = opts.get("border") if isinstance(opts.get("border"), dict) else {}
    bt, br, bb, bl = (_int(b.get(k), 0, 5000, 0) for k in ("top", "right", "bottom", "left"))
    bc = color(opts.get("border_color"), alpha)

    paths = [image_path(x) for x in images]
    sizes = []
    for p_ in paths:
        if not p_:
            sizes.append(None)
            continue
        try:
            with Image.open(p_) as im:
                sizes.append((max(1, round(im.width * scale)), max(1, round(im.height * scale))))
        except Exception:  # noqa: BLE001  読めない画像は空のマス
            sizes.append(None)
    ok = [x for x in sizes if x]
    if not ok:
        raise ValueError(tr('まとめる画像が見つかりませんでした'))
    cw, ch = max(x[0] for x in ok), max(x[1] for x in ok)
    gw = cols * cw + (cols - 1) * gap  # 1 組の幅

    # 組の上の言葉(置き換えた言葉)
    labels = [str(x or "") for x in (opts.get("labels") or [])][:groups] if isinstance(opts.get("labels"), list) else []
    band, font, wrapped, line_h, pad = 0, None, [], 0, 0
    if any(x.strip() for x in labels):
        px = max(14, min(120, round(gw * 0.045)))
        font = _font(px)
        pad = max(6, px // 2)
        d = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
        wrapped = [_wrap(d, x, font, max(20, gw - pad * 2)) for x in labels]
        line_h = round(px * 1.3)
        band = max(len(w) for w in wrapped) * line_h + pad * 2

    W = bl + br + groups * gw + (groups - 1) * ggap
    pages = []
    for start in range(0, total_rows, per):
        rows = min(per, total_rows - start)
        H = bt + bb + band + rows * ch + (rows - 1) * gap
        if W > MAX_SIDE or H > MAX_SIDE or W * H > MAX_PIXELS:
            raise ValueError(tr('まとめた画像が大きすぎます({w} × {h})。「縦の数ごとに次のページ」にするか、並べる大きさ(%)を小さくしてください',
                                w=W, h=H))
        page = Image.new("RGBA", (W, H), bc)
        y0 = bt + band
        page.paste(Image.new("RGBA", (W - bl - br, H - y0 - bb), gapc), (bl, y0))
        for g in range(groups):
            gx = bl + g * (gw + ggap)
            for r in range(rows):
                for c in range(cols):
                    k = (start + r) * cols + c
                    i = g * per_group + k
                    if k >= per_group or i >= n or not paths[i] or not sizes[i]:
                        continue
                    try:
                        with Image.open(paths[i]) as src:
                            im = src.convert("RGBA")
                    except Exception:  # noqa: BLE001
                        continue
                    if im.size != sizes[i]:
                        im = im.resize(sizes[i], Image.LANCZOS)
                    x = gx + c * (cw + gap) + (cw - im.width) // 2
                    y = y0 + r * (ch + gap) + (ch - im.height) // 2
                    page.alpha_composite(im, (x, y))
        if band:
            d = ImageDraw.Draw(page)
            fill = _text_color(bc)
            for g, lines in enumerate(wrapped):
                for k, t in enumerate(lines):
                    tw = d.textlength(t, font=font)
                    x = bl + g * (gw + ggap) + (gw - tw) / 2
                    y = bt + pad + k * line_h
                    d.text((x, y), t, font=font, fill=fill)
        pages.append(page)
    return pages


def _flat(page):
    """透明を白に(JPG・PDF)"""
    if page.mode != "RGBA":
        return page.convert("RGB")
    bg = Image.new("RGB", page.size, (255, 255, 255))
    bg.paste(page, mask=page.getchannel("A"))
    return bg


# ---------------------------------------------------------------- 生成情報(PNGinfo で戻せるように入れる)
def _source_meta(images):
    """1 枚目の画像(PNG)に入っている生成情報 {parameters, prompt, workflow}。無ければ空"""
    for x in images:
        p_ = image_path(x)
        if not p_:
            continue
        try:
            with Image.open(p_) as im:
                info = getattr(im, "text", None) or im.info
                got = {k: info[k] for k in ("parameters", "prompt", "workflow") if isinstance(info.get(k), str) and info[k]}
        except Exception:  # noqa: BLE001
            continue
        if got:
            return got
    return {}


def _tile_json(opts):
    info = opts.get("info")
    if not isinstance(info, dict):
        return ""
    s = json.dumps(info, ensure_ascii=False, separators=(",", ":"))
    return s if len(s) <= 20000 else ""


def build_meta(images, opts):
    """{parameters, prompt, workflow, tile}。parameters は A1111 の書き方の最後の行に「CCA Tile」(タイルの設定)を足す"""
    m = dict(_source_meta(images))
    tj = _tile_json(opts)
    if m.get("parameters") and tj:
        m["parameters"] = m["parameters"].rstrip() + ", CCA Tile: " + json.dumps(tj, ensure_ascii=False)
    m["tile"] = tj
    return m


def _exif(text):
    """JPEG の EXIF UserComment(A1111 と同じ書き方)。EXIF は 64KB までなので、大きいときは UTF-8 にして小さくする"""
    if not text:
        return None
    try:
        ex = Image.Exif()
        ifd = ex.get_ifd(0x8769)
        for body in (b"UNICODE\0" + text.encode("utf-16-be"), b"ASCII\0\0\0" + text.encode("utf-8")):
            ifd[0x9286] = body
            b = ex.tobytes()
            if len(b) < 65000:
                return b
    except Exception:  # noqa: BLE001  入れられなくても保存は続ける
        pass
    return None


def _tool_version():
    from .pnginfo import TOOL_VERSION  # 生成情報に入れるものと同じ版
    return TOOL_VERSION


def _pdf_keywords(text):
    """PDF の Keywords に ASCII だけで入れる(PNGinfo が読める): \"CCA1:\" + base64(zlib(JSON))"""
    if not text:
        return None
    raw = json.dumps({"parameters": text}, ensure_ascii=False).encode("utf-8")
    return "CCA1:" + base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def thumb(page, side=640):
    """PDF の 1 ページ目の小さな絵(結果の一覧に出す)。data URL"""
    im = _flat(page)
    im.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def _subfolder(images):
    for x in images:
        if isinstance(x, dict) and (x.get("type") or "output") == "output" and image_path(x):
            return str(x.get("subfolder") or "")
    return ""


def save(pages, images, opts):
    fmt = opts.get("format") if opts.get("format") in FORMATS else "jpg"
    name = re.sub(r"[\\/:*?\"<>|\s]+", "_", str(opts.get("name") or "").strip()) or "CCA_tile"
    sub = _subfolder(images)
    prefix = f"{sub}/{name}" if sub else name
    out_dir = folder_paths.get_output_directory()
    folder, fname, counter, subfolder, _ = folder_paths.get_save_image_path(prefix, out_dir, pages[0].width, pages[0].height)
    os.makedirs(folder, exist_ok=True)
    q = _int(opts.get("quality"), 1, 100, 90)
    files = []
    meta = build_meta(images, opts)
    if fmt == "pdf":
        rgb = [_flat(p) for p in pages]
        file = f"{fname}_{counter:05}_.pdf"
        kw = {"keywords": _pdf_keywords(meta.get("parameters"))} if meta.get("parameters") else {}
        rgb[0].save(os.path.join(folder, file), "PDF", save_all=True, append_images=rgb[1:], resolution=PDF_DPI,
                    quality=q, title=name, creator=f"CCA Generator v{_tool_version()}", **kw)
        files.append({"filename": file, "subfolder": subfolder, "type": "output"})
    else:
        many = len(pages) > 1
        for i, p in enumerate(pages):
            file = f"{fname}_{counter:05}_{f'p{i + 1:02}_' if many else ''}{FORMATS[fmt]}"
            path = os.path.join(folder, file)
            if fmt == "png":
                if p.getextrema()[3][0] == 255:
                    p = p.convert("RGB")  # 透明な所が無ければ RGB で(小さくなる)
                pi = PngInfo()
                for k in ("parameters", "prompt", "workflow"):
                    if meta.get(k):
                        pi.add_text(k, meta[k])
                if not meta.get("parameters") and meta.get("tile"):
                    pi.add_text("CCA Tile", meta["tile"])
                p.save(path, "PNG", pnginfo=pi, compress_level=_int(opts.get("png_compress"), 0, 9, 6))
            else:
                ex = _exif(meta.get("parameters"))
                _flat(p).save(path, "JPEG", quality=q, **({"exif": ex} if ex else {}))
            files.append({"filename": file, "subfolder": subfolder, "type": "output"})
    return files


def make(images, opts):
    if not isinstance(images, list):
        raise ValueError(tr('まとめる画像がありません'))
    opts = opts if isinstance(opts, dict) else {}
    pages = compose(images, opts)
    files = save(pages, images, opts)
    fmt = opts.get("format") if opts.get("format") in FORMATS else "jpg"
    res = {"files": files, "pages": len(pages), "width": pages[0].width, "height": pages[0].height, "format": fmt, "count": len(images)}
    if fmt == "pdf":
        res["thumb"] = thumb(pages[0])  # 結果の一覧(ギャラリー)に出す 1 ページ目の絵
    return res
