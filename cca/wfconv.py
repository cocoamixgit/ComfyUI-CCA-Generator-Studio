"""ワークフロー(サブグラフ入り)を、ComfyUI の API 形式(prompt)に変換する。

画面を開かずに、同じ処理を流すための部分(api.py が使う)。example_workflows の中身を読み、
サブグラフを展開して、つなぎ(リンク)を直接の参照にする。
- バイパスされたノードは、同じ型の入力をそのまま渡す / ミュートされたノードは無いものとして扱う
- 出力ノード(画像の保存 / 動画の保存)から辿れるノードだけを残す
- パネル(CCAGeneratorPanel)の入力は呼び出し側で入れる(キュー投入時に split.py が役割ごとに分ける)
"""
import json
import os

PANEL = "CCAGeneratorPanel"
OUTPUTS = (("image", "CCASaveImage"), ("video", "SaveVideo"))
LINK_KEYS = ("id", "origin_id", "origin_slot", "target_id", "target_slot", "type")
SUB_IN, SUB_OUT = -10, -20  # サブグラフの入口 / 出口を表す ID
WORKFLOW = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "example_workflows", "cca_generator_workflow_en.json")


class _Flat:
    def __init__(self, wf):
        self.sg = {s["id"]: s for s in (wf.get("definitions") or {}).get("subgraphs") or []}
        self.out = {}
        self.kids = {}
        self.top = self._ctx(wf, None, None, ())

    @staticmethod
    def _ctx(box, parent, inst, path):
        links = {}
        for l in box.get("links") or []:
            if isinstance(l, (list, tuple)):
                l = dict(zip(LINK_KEYS, l))
            links[l["id"]] = l
        return {"nodes": {n["id"]: n for n in box.get("nodes") or []}, "links": links,
                "parent": parent, "inst": inst, "path": path}

    @staticmethod
    def _fid(ctx, n):
        return ":".join(str(x) for x in (*ctx["path"], n["id"]))

    def _child(self, ctx, n):
        fid = self._fid(ctx, n)
        if fid not in self.kids:
            self.kids[fid] = self._ctx(self.sg[n["type"]], ctx, n, (*ctx["path"], n["id"]))
        return self.kids[fid]

    def src(self, ctx, lid):
        """リンクの出どころ → [ノード ID, 出力番号](たどれなければ None)"""
        l = ctx["links"].get(lid)
        return None if l is None else self.out_ref(ctx, l["origin_id"], l["origin_slot"])

    def out_ref(self, ctx, nid, slot):
        if nid == SUB_IN:  # サブグラフの入力 → 外側でつながっている先
            ins = ((ctx["inst"] or {}).get("inputs")) or []
            if slot >= len(ins) or ins[slot].get("link") is None:
                return None
            return self.src(ctx["parent"], ins[slot]["link"])
        n = ctx["nodes"].get(nid)
        if n is None or n.get("mode", 0) == 2:
            return None
        if n.get("mode", 0) == 4:
            return self._bypass(ctx, n, slot)
        if n["type"] in self.sg:
            sub = self._child(ctx, n)
            for l in sub["links"].values():
                if l["target_id"] == SUB_OUT and l["target_slot"] == slot:
                    return self.out_ref(sub, l["origin_id"], l["origin_slot"])
            return None
        return [self.emit(ctx, n), slot]

    def _bypass(self, ctx, n, slot):
        outs = n.get("outputs") or []
        if slot >= len(outs):
            return None
        want = outs[slot].get("type")
        ins = n.get("inputs") or []
        pick = None
        if slot < len(ins) and ins[slot].get("link") is not None and ins[slot].get("type") == want:
            pick = ins[slot]
        else:
            pick = next((i for i in ins if i.get("link") is not None and i.get("type") == want), None)
        return self.src(ctx, pick["link"]) if pick else None

    def emit(self, ctx, n):
        fid = self._fid(ctx, n)
        if fid in self.out:
            return fid
        ent = self.out[fid] = {"class_type": n["type"], "inputs": {}, "_meta": {"title": n.get("title") or n["type"]}}
        vals = n.get("widgets_values_named")
        if not isinstance(vals, dict):
            wv = n.get("widgets_values")
            if isinstance(wv, dict):
                vals = wv
            else:
                names = [i["widget"]["name"] for i in n.get("inputs") or [] if isinstance(i.get("widget"), dict)]
                vals = dict(zip(names, wv or []))
        ent["inputs"].update({k: v for k, v in vals.items() if k != "control_after_generate"})
        for i in n.get("inputs") or []:
            if i.get("link") is None:
                continue
            r = self.src(ctx, i["link"])
            if r is not None:  # たどれない所は、ウィジェットの値(あれば)のままにする
                ent["inputs"][i["name"]] = r
        return fid


def build(wf):
    """{"image": {"panel": ID, "prompt": {...}}, "video": {...}}"""
    f = _Flat(wf)
    top = f.top["nodes"]
    panel = next(str(n["id"]) for n in top.values() if n["type"] == PANEL)
    res = {}
    for kind, typ in OUTPUTS:
        f.out = {}
        for n in top.values():
            if n["type"] == typ and n.get("mode", 0) not in (2, 4):
                f.emit(f.top, n)
        res[kind] = {"panel": panel, "prompt": f.out}
    return res


_cache = {}


def template(kind):
    """kind(image / video)の prompt の写しとパネルの ID。ワークフローは最初の 1 回だけ読む"""
    if not _cache:
        with open(WORKFLOW, encoding="utf-8") as fp:
            _cache.update(build(json.load(fp)))
    t = _cache[kind]
    return t["panel"], json.loads(json.dumps(t["prompt"]))
