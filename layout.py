"""枠(バウンディングボックス)で指定した配置を、プロンプトに組み込む。

パネルの layout_boxes(JSON)= {"boxes": [{"x", "y", "w", "h"(0〜1 の割合), "type": "obj" / "text",
"desc": 説明, "text": 書く文字(type が text のとき), "character": 人物か(MOSS のみ), "shape": rect / circle / tri1 / tri2 / tri3(範囲別指定の形。三角は fx / fy で反転)}]}

ComfyUI 本体と同じ組み立て方にする:
  枠 → Create Bounding Boxes の elements(build_elements)→ FLUX 3 Image Layout Prompt / MOSS-Image Layout Prompt
キュー投入時(split.py)にプロンプトの文字列へ組み込むので、枠が無いときはプロンプトの文字列も
キャッシュの効き方も今まで通り。
"""
import json
import math

import nodes as comfy_nodes

from .specs import layout_kind


def parse_boxes(value):
    """layout_boxes の JSON → 枠の一覧(大きさの無い枠だけ捨てる。説明が空の枠も残すのは、
    パネルの枠の番号とプロンプトの <obj_N> の番号をずらさないため)"""
    try:
        data = json.loads(value) if isinstance(value, str) else (value or {})
    except (TypeError, ValueError):
        return []
    boxes = data.get("boxes") if isinstance(data, dict) else data
    out = []
    for b in boxes if isinstance(boxes, list) else []:
        if not isinstance(b, dict):
            continue
        try:
            x, y, w, h = (float(b.get(k, 0)) for k in ("x", "y", "w", "h"))
        except (TypeError, ValueError):
            continue
        if w < 0:
            x, w = x + w, -w
        if h < 0:
            y, h = y + h, -h
        x, y = min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)
        w, h = min(w, 1.0 - x), min(h, 1.0 - y)
        typ = "text" if b.get("type") == "text" else "obj"
        desc = str(b.get("desc") or "").strip()
        text = str(b.get("text") or "").strip() if typ == "text" else ""
        if w <= 0.001 or h <= 0.001:
            continue
        try:
            rot = float(b.get("rot") or 0)
        except (TypeError, ValueError):
            rot = 0.0
        shape = b.get("shape") if b.get("shape") in ("circle", "tri1", "tri2", "tri3") else "rect"
        out.append({"x": x, "y": y, "w": w, "h": h, "type": typ, "desc": desc, "text": text,
                    "character": bool(b.get("character")) and typ == "obj",
                    "shape": shape, "fx": bool(b.get("fx")), "fy": bool(b.get("fy")),
                    "rot": max(-180.0, min(180.0, rot))})
    return out


def _grid(v):
    return max(0, min(1000, round(v * 1000)))


def build_elements(boxes):
    """Create Bounding Boxes の elements と同じ形(bbox は 0〜1000 の [y0, x0, y1, x1])"""
    regions = [{"x": b["x"], "y": b["y"], "w": b["w"], "h": b["h"], "type": b["type"], "text": b["text"],
                "desc": b["desc"], "palette": []} for b in boxes]
    try:
        from comfy_extras.nodes_bounding_boxes import build_elements as core_build
        return core_build(regions)
    except Exception:  # noqa: BLE001  古い ComfyUI など: 同じ計算をここで行う
        out = []
        for r in regions:
            el = {"type": r["type"], "bbox": [_grid(r["y"]), _grid(r["x"]), _grid(r["y"] + r["h"]), _grid(r["x"] + r["w"])]}
            if r["type"] == "text":
                el["text"] = r["text"]
            el["desc"] = r["desc"]
            out.append(el)
        return out


def _exec(node_name, **kwargs):
    r = comfy_nodes.NODE_CLASS_MAPPINGS[node_name].execute(**kwargs)
    return (r.result if hasattr(r, "result") else r)[0]


def apply_layout(model_type, task, positive, layout_boxes, width=1024, height=1024):
    """枠があれば、その種別のレイアウトの書き方でプロンプトに組み込む。無ければ positive をそのまま返す"""
    kind = layout_kind(model_type, task)
    if kind == "region":  # 専用の枠の書き方が無いモデル: 枠は 領域プロンプト(regional.py)が領域として使う
        return positive
    boxes = parse_boxes(layout_boxes) if kind else []
    if not boxes:
        return positive
    elements = build_elements(boxes)
    positive = str(positive or "")
    if kind == "flux3":
        if "Flux3LayoutPrompt" in comfy_nodes.NODE_CLASS_MAPPINGS:
            return _exec("Flux3LayoutPrompt", prompt=positive, element=elements)
        rows = [{"id": f"obj_{i + 1}", "bbox": el["bbox"],
                 "desc": (f'{el.get("desc", "")} "{el["text"]}"'.strip() if el["type"] == "text" else el.get("desc", ""))}
                for i, el in enumerate(elements)]
        return f"{positive.rstrip()} {json.dumps(rows, ensure_ascii=False)}"
    if kind == "moss":
        chars = ", ".join(str(i + 1) for i, b in enumerate(boxes) if b["character"])
        w, h = int(width or 1024), int(height or 1024)
        if "MOSSImageLayoutPrompt" in comfy_nodes.NODE_CLASS_MAPPINGS:
            return _exec("MOSSImageLayoutPrompt", prompt=positive, element=elements, width=w, height=h,
                         character_boxes=chars)
        items = []
        for i, (el, b) in enumerate(zip(elements, boxes)):
            item = {"label": "text" if el["type"] == "text" else ("character" if b["character"] else "object"),
                    "caption": el.get("desc", "")}
            if item["label"] == "text":
                item["text"] = el.get("text", "")
            y0, x0, y1, x1 = el["bbox"]
            item["bbox"] = [math.floor(y0 * h / 1000) - h // 2, math.floor(x0 * w / 1000) - w // 2,
                            math.ceil(y1 * h / 1000) - h // 2, math.ceil(x1 * w / 1000) - w // 2]
            items.append(item)
        layout = {"summary": {"caption": positive.strip()}, "items": items, "bbox_coord_space": "abs_centralized",
                  "bbox_format": "yxyx"}
        return json.dumps(layout, ensure_ascii=False, separators=(",", ":"))
    return positive
