"""Full_generator.json から CCA Generator 用のワークフローを作る。

使い方:
    python build_workflow.py <入力: Full_generator.json> <出力: cca_generator_workflow.json>

できあがりの構成(トップレベル):
    [CCA Generator パネル] → [CCA 処理(全モデル)サブグラフ] → [Save Image] / [Save Video]
                                                               + [使い方] [モデル別メモ]

処理内容:
  1. 操作系・ローダー系のノード(プロンプト・画像・サイズ・Global 系・ローダー・LoRA・Flow Selector など)を削除し、
     パネルの出力へつなぎ替える
  2. 残りの処理(モデルごとのサブグラフ 23 個・ルートのスイッチ・Fallback など)を
     「CCA 処理(全モデル)」サブグラフ 1 つにまとめ、中を種別ごとに並べ直す
  3. Flow Selector を CCAGeneratorRoutes に置き換える(処理サブグラフの中)
  4. MOSS I2I サブグラフ内の Edit LoRA を外す(パネル側で適用するため)
  5. Wan2.2 14B サブグラフの High/Low 切り替えステップを入力 split_step に置き換える
  6. 出力サイズの「倍率指定」: MOSS / Qwen の画像→画像の縮小ノードの後ろに CCASizeSelect を挟む
  7. Wan2.2 14B 画像→動画: WanImageToVideo を WanFirstLastFrameToVideo にして最後のフレーム(入力画像2)を受け取る
  8. MiniMax H3 画像→動画: 画像2 = 途中のフレーム(CCAMidFrameGuide)、画像3 = 最後のフレーム
  9. Qwen Image 画像→画像: 画像1と画像2を左右に並べて 1 枚にし(ImageStitch)、TextEncodeQwenImageEdit で渡す
     (Qwen-Image-Edit で 2 枚を使うときの動く組み方。生成する潜在画像は今まで通り画像1から作る)
 10. 第9版: FLUX.2 Klein / FLUX.3 Klein / LTX-2.5 / Kandinsky 6 の処理ノード(1 モデル = 1 ノード)と
     ルートのスイッチを足す。MiniMax(画像・動画)は選べる一覧から外したので、処理はバイパスして折りたたむ
"""
import copy
import importlib.util
import json
import os
import sys
import uuid


def _load_specs():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "specs.py")
    spec = importlib.util.spec_from_file_location("cca_specs_build", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ROUTE_COUNT = _load_specs().ROUTE_COUNT


def _load_notes():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "notes.py")
    spec = importlib.util.spec_from_file_location("cca_notes", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    def hard_breaks(md):
        # 段落内の改行をそのまま改行として表示する(Markdown の行末 2 スペース)
        return "\n".join(l + "  " if l.strip() and not l.lstrip().startswith(("#", "-", "|", "1.", "2.", "3.", "4."))
                         else l for l in md.split("\n"))
    return hard_breaks(mod.USAGE)

PANEL_TYPE = "CCAGeneratorPanel"
ROUTES_TYPE = "CCAGeneratorRoutes"
SAMPLER_LIST_TYPE = None  # サブグラフ側の型(選択肢のカンマ連結)を元ファイルから拾う

PANEL_OUTPUTS = [
    ("positive", "STRING"), ("negative", "STRING"), ("width", "INT"), ("height", "INT"),
    ("image_1", "IMAGE"), ("mask_1", "MASK"), ("image_2", "IMAGE"),
    ("seed", "INT"), ("steps", "INT"), ("cfg", "FLOAT"),
    ("sampler_name", "COMBO"), ("scheduler", "COMBO"), ("denoise", "FLOAT"),
    ("model", "MODEL"), ("model_low", "MODEL"), ("clip", "CLIP"), ("vae", "VAE"),
    ("audio_vae", "VAE"), ("auto_image_size", "BOOLEAN"), ("image_prefix", "STRING"),
    ("video_prefix", "STRING"), ("split_step", "INT"), ("route", "INT"),
    ("ref_image_1", "IMAGE"), ("edit_format", "COMBO"), ("hires", "CCA_HIRES"),
    ("image_3", "IMAGE"), ("mid_frame_pos", "INT"), ("size_by_scale", "BOOLEAN"),
    ("video_length", "INT"), ("video_fps", "FLOAT"),
    ("video_shift", "FLOAT"),
    ("ref_images", "CCA_IMAGES"), ("latent_upscale", "LATENT_UPSCALE_MODEL"),
]
OUT = {name: i for i, (name, _) in enumerate(PANEL_OUTPUTS)}
PANEL_LABELS = {
    "positive": "プロンプト", "negative": "ネガティブ", "width": "幅", "height": "高さ",
    "image_1": "入力画像1", "mask_1": "マスク", "image_2": "入力画像2", "seed": "シード",
    "steps": "ステップ数", "cfg": "CFG", "sampler_name": "サンプラー", "scheduler": "スケジューラー",
    "denoise": "Denoise", "model": "モデル", "model_low": "モデル (Low-Noise)", "clip": "CLIP",
    "vae": "VAE", "audio_vae": "音声 VAE", "auto_image_size": "サイズ自動", "image_prefix": "画像の保存先",
    "video_prefix": "動画の保存先", "split_step": "High→Low 切替", "route": "ルート",
    "ref_image_1": "参照画像1 (縮小)", "edit_format": "Edit 形式", "hires": "Hires. fix",
    "image_3": "入力画像3", "mid_frame_pos": "途中のフレームの位置(%)", "size_by_scale": "倍率指定",
    "video_length": "フレーム数", "video_fps": "fps", "video_shift": "シフト",
    "ref_images": "参照画像(一覧)", "latent_upscale": "潜在アップスケーラー",
}
EDIT_FORMAT_TYPE = "ai-toolkit,ai-toolkit (kv_cache off),Moss-Image-Edit"
MOSS_I2I_ENCODERS = (23, 24)   # TextEncodeMOSSImageEdit(positive / negative)
QWEN_I2I = dict(vae_encode=108, ksampler=109, scale=105, encoders=(106, 107))
MOSS_I2I_SCALE = 22            # ImageScaleToTotalPixels(今まで通りの出力サイズ)
WAN14_I2V = dict(inst=295, i2v=148)
H3_I2V = dict(inst=299, i2v=192, guider=196)
# Wan のシフト(ModelSamplingSD3)のノード。インスタンスID: [ノードID]
WAN_SHIFT_NODES = {294: [131, 132], 295: [144, 145], 296: [324], 297: [166]}
# 動画のインスタンスID: (長さ length を持つノード, CreateVideo, fps をパネルから受け取るか)
VIDEO_NODES = {294: (135, 139, True), 295: (148, 152, True), 296: (159, 162, True), 297: (169, 172, True),
               298: (178, 186, False), 299: (192, 200, False), 300: (206, 214, False)}
HIRES_SOURCE_SWITCH = 240      # 画像ルートの最後(この出力に Hires. fix を挟む)

# (元ノードID, 元出力スロット) -> パネル出力名
REMAP = {
    (1, 0): "positive", (2, 0): "negative", (4, 0): "width", (5, 0): "height",
    (3, 0): "image_1", (3, 1): "mask_1", (269, 0): "image_2",
    (302, 0): "seed", (304, 0): "steps", (309, 0): "steps",
    (305, 0): "cfg", (310, 0): "cfg", (316, 0): "cfg",
    (306, 0): "sampler_name", (307, 0): "scheduler",
    (308, 0): "denoise", (313, 0): "denoise",
    (331, 0): "model", (339, 0): "model", (360, 0): "model",
    (334, 0): "clip", (339, 1): "clip", (360, 1): "clip",
    (333, 0): "vae", (339, 2): "vae", (359, 0): "audio_vae",
    (350, 0): "model", (351, 0): "model_low",   # Wan2.2 14B T2V: High / Low
    (353, 0): "model", (352, 0): "model_low",   # Wan2.2 14B I2V: High / Low
    (265, 0): "auto_image_size", (270, 0): "image_prefix", (271, 0): "video_prefix",
}
REMOVE = {
    1, 2, 3, 4, 5, 269, 302, 304, 305, 306, 307, 308, 309, 310, 313, 316,
    331, 332, 333, 334, 338, 339, 350, 351, 352, 353, 359, 360, 265, 270, 271, 303,
}
FLOW_SELECTOR = 303
SAVE_IMAGE, SAVE_VIDEO, MEMO = 261, 262, 301
MOSS_I2I_EDIT_LORA = 31
WAN14 = {294: (136, 137), 295: (149, 150)}  # インスタンスID: (High の KSamplerAdvanced, Low の)
WAN14_DEFAULT_SPLIT = 10

# 処理サブグラフ内の並び(行 = 種別、列 = T2x / I2x / R2V)
ROWS = [
    ("MOSS", [280, 281]), ("SD1.5", [282, 283]), ("SDXL", [284, 285]),
    ("Illustrious", [286, 287]), ("Anima", [288, 367]), ("Krea2", [289, 374]),
    ("Qwen Image", [290, 291]), ("MiniMax-H3-Image", [292, 293, 266, 267]),
    ("Wan2.2 14B", [294, 295]), ("Wan2.2 5B", [296, 297]), ("MiniMax H3", [298, 299, 300]),
]
IMAGE_SWITCHES = [240, 241, 242, 243, 244, 245, 246, 247, 248, 377, 249, 378, 250, 251, 252, 253, 238]
VIDEO_SWITCHES = [254, 255, 256, 257, 258, 259, 260, 239]
# 選べる一覧から外した種別(処理はワークフローに残し、バイパスして折りたたむ)
HIDDEN_ROWS = ("MiniMax-H3-Image", "MiniMax H3")
# 第9版で足す処理: (行の名前, ノードの種類, 表示名, ルート番号, 入力, 出力の型)
_IMG_IN = [("model", "MODEL"), ("clip", "CLIP"), ("vae", "VAE"), ("positive", "STRING"), ("negative", "STRING"),
           ("seed", "INT"), ("steps", "INT"), ("cfg", "FLOAT"), ("sampler_name", "COMBO"), ("scheduler", "COMBO"),
           ("width", "INT"), ("height", "INT"), ("size_by_scale", "BOOLEAN"), ("ref_images", "CCA_IMAGES")]
NEW_ROUTES = [
    ("FLUX.2 Klein", "CCAFlux2Klein", "FLUX.2 Klein(テキスト→画像 / 画像→画像)", 23, _IMG_IN, "IMAGE"),
    ("FLUX.3 Klein", "CCAFlux3Klein", "FLUX.3 Klein(テキスト→画像 / 画像→画像)", 24, _IMG_IN, "IMAGE"),
    ("LTX-2.5", "CCALTX25", "LTX-2.5(テキスト→動画 / 画像→動画)", 25,
     [("model", "MODEL"), ("clip", "CLIP"), ("vae", "VAE"), ("audio_vae", "VAE"),
      ("latent_upscale", "LATENT_UPSCALE_MODEL"), ("positive", "STRING"), ("seed", "INT"), ("width", "INT"),
      ("height", "INT"), ("video_length", "INT"), ("video_fps", "FLOAT"), ("ref_images", "CCA_IMAGES")], "VIDEO"),
    ("Kandinsky 6", "CCAKandinsky6", "Kandinsky 6(テキスト→動画 / 画像→動画)※追加ノード kandinsky6", 26,
     [("model", "MODEL"), ("clip", "CLIP"), ("vae", "VAE"), ("audio_vae", "VAE"), ("positive", "STRING"),
      ("negative", "STRING"), ("seed", "INT"), ("steps", "INT"), ("cfg", "FLOAT"), ("sampler_name", "COMBO"),
      ("scheduler", "COMBO"), ("width", "INT"), ("height", "INT"), ("video_length", "INT"), ("video_fps", "FLOAT"),
      ("ref_images", "CCA_IMAGES")], "VIDEO"),
]




class Ids:
    def __init__(self, d):
        self.node = d["last_node_id"]
        self.link = d["last_link_id"]
        for sg in d["definitions"]["subgraphs"]:
            self.node = max(self.node, sg["state"].get("lastNodeId", 0))
            self.link = max(self.link, sg["state"].get("lastLinkId", 0))

    def new_node(self):
        self.node += 1
        return self.node

    def new_link(self):
        self.link += 1
        return self.link


def _uuid():
    return str(uuid.uuid4())


def convert(src):
    d = copy.deepcopy(src)
    ids = Ids(d)
    nodes = {n["id"]: n for n in d["nodes"]}
    sgs = {s["id"]: s for s in d["definitions"]["subgraphs"]}

    panel_id = ids.new_node()
    proc_id = ids.new_node()
    routes_id = ids.new_node()
    usage_id = ids.new_node()
    proc_def_id = _uuid()

    inner_ids = {n["id"] for n in d["nodes"]} - REMOVE - {SAVE_IMAGE, SAVE_VIDEO, MEMO}
    inner_nodes = {i: nodes[i] for i in inner_ids}

    # サブグラフ入力に使うサンプラー/スケジューラーの型(元のサブグラフ入力の型を流用)
    combo_types = {}
    for s in d["definitions"]["subgraphs"]:
        for i in s["inputs"]:
            if i["name"].endswith("_sampler"):
                combo_types.setdefault("sampler_name", i["type"])
            if i["name"].endswith("_scheduler"):
                combo_types.setdefault("scheduler", i["type"])

    # ---- 処理サブグラフの入力スロット(パネル出力の順)----
    used = []  # 処理サブグラフが受け取るパネル出力名
    inner_links = []  # 処理サブグラフ内のリンク(dict 形式)
    top_links = []  # トップレベルのリンク(list 形式)
    slot_links = {}  # 入力名 -> 内部リンクID の一覧

    def slot_of(name):
        if name not in used:
            used.append(name)
            slot_links[name] = []
        return name

    def add_inner(origin_id, origin_slot, target_id, target_slot, typ, lid=None):
        lid = lid or ids.new_link()
        inner_links.append({"id": lid, "origin_id": origin_id, "origin_slot": origin_slot,
                            "target_id": target_id, "target_slot": target_slot, "type": typ})
        return lid

    pending_inputs = []  # (name, link_id) 入力ノード(-10)からのリンク。スロット番号は後で確定
    out_image_link = out_video_link = None
    for link in d["links"]:
        lid, o, os_, t, ts, ty = link[:6]
        if t in REMOVE:
            continue  # 削除ノードへの入力は捨てる
        if t in (SAVE_IMAGE, SAVE_VIDEO):
            if o in REMOVE:
                continue  # 保存先(270/271)は後でパネルから直接つなぐ
            if t == SAVE_IMAGE and nodes[t]["inputs"][ts]["name"] == "images":
                out_image_link = (lid, o, os_, ty)
            elif t == SAVE_VIDEO and nodes[t]["inputs"][ts]["name"] == "video":
                out_video_link = (lid, o, os_, ty)
            else:
                raise RuntimeError(f"想定外の保存ノードへのリンク: {link}")
            continue
        if o == FLOW_SELECTOR:
            add_inner(routes_id, os_, t, ts, "BOOLEAN", lid)
            continue
        if o in REMOVE:
            key = (o, os_)
            if key not in REMAP:
                raise RuntimeError(f"つなぎ替え先が未定義のリンク: {link}")
            name = slot_of(REMAP[key])
            typ = inner_nodes[t]["inputs"][ts]["type"]
            add_inner(-10, None, t, ts, typ, lid)
            pending_inputs.append((name, lid))
            continue
        add_inner(o, os_, t, ts, ty, lid)

    # route → Routes ノード
    rl = add_inner(-10, None, routes_id, 0, "INT")
    pending_inputs.append((slot_of("route"), rl))

    # ---- Wan2.2 14B: split_step 入力を追加 ----
    for inst_id, (high_id, low_id) in WAN14.items():
        inst = inner_nodes[inst_id]
        sg = sgs[inst["type"]]
        lid = add_inner(-10, None, inst_id, len(inst["inputs"]), "INT")
        pending_inputs.append((slot_of("split_step"), lid))
        inst["inputs"].append({"label": "Split Step (INT)", "name": "split_step", "type": "INT",
                               "widget": {"name": "split_step"}, "link": lid})
        if isinstance(inst.get("widgets_values"), list):
            inst["widgets_values"].append(WAN14_DEFAULT_SPLIT)
        if isinstance(inst.get("widgets_values_named"), dict):
            inst["widgets_values_named"]["split_step"] = WAN14_DEFAULT_SPLIT

        slot = len(sg["inputs"])
        sub_nodes = {n["id"]: n for n in sg["nodes"]}
        link_ids = []
        for node_id, widget in ((high_id, "end_at_step"), (low_id, "start_at_step")):
            ks = sub_nodes[node_id]
            if any(i["name"] == widget for i in ks["inputs"]):
                raise RuntimeError(f"{sg['name']} の {node_id} に {widget} 入力が既にあります")
            sl = ids.new_link()
            link_ids.append(sl)
            sg["links"].append({"id": sl, "origin_id": -10, "origin_slot": slot,
                                "target_id": node_id, "target_slot": len(ks["inputs"]), "type": "INT"})
            ks["inputs"].append({"localized_name": widget, "name": widget, "type": "INT",
                                 "widget": {"name": widget}, "link": sl})
        last_pos = sg["inputs"][-1].get("pos", [-100, 0])
        sg["inputs"].append({"id": _uuid(), "name": "split_step", "type": "INT",
                             "linkIds": link_ids, "label": "Split Step",
                             "pos": [last_pos[0], last_pos[1] + 20]})
        b = sg["inputNode"].get("bounding")
        if b:
            b[3] += 20

    # ---- MOSS I2I: 内部の Edit LoRA を外す ----
    moss_i2i = next(s for s in sgs.values() if s["name"].startswith("MOSS | Image to Image"))
    sub_nodes = {n["id"]: n for n in moss_i2i["nodes"]}
    lora = sub_nodes[MOSS_I2I_EDIT_LORA]
    in_link = lora["inputs"][0]["link"]
    out_links = lora["outputs"][0]["links"] or []
    if len(out_links) != 1:
        raise RuntimeError("MOSS I2I の Edit LoRA の出力先が想定と違います")
    out_link = next(l for l in moss_i2i["links"] if l["id"] == out_links[0])
    for l in moss_i2i["links"]:
        if l["id"] == in_link:
            l["target_id"], l["target_slot"] = out_link["target_id"], out_link["target_slot"]
    sub_nodes[out_link["target_id"]]["inputs"][out_link["target_slot"]]["link"] = in_link
    moss_i2i["links"] = [l for l in moss_i2i["links"] if l["id"] != out_link["id"]]
    moss_i2i["nodes"] = [n for n in moss_i2i["nodes"] if n["id"] != MOSS_I2I_EDIT_LORA]

    # ---- サブグラフ定義を編集するための小道具 ----
    def sg_unlink(sg, link_id):
        """サブグラフ内のリンクを外す(接続元の outputs.links からも消す)。"""
        link = next((l for l in sg["links"] if l["id"] == link_id), None)
        if link is None:
            return
        sg["links"] = [l for l in sg["links"] if l["id"] != link_id]
        for n in sg["nodes"]:
            if n["id"] == link["origin_id"]:
                out = n["outputs"][link["origin_slot"]]
                out["links"] = [x for x in (out.get("links") or []) if x != link_id]

    def sg_link(sg, origin_id, origin_slot, target_id, target_slot, typ):
        lid = ids.new_link()
        sg["links"].append({"id": lid, "origin_id": origin_id, "origin_slot": origin_slot,
                            "target_id": target_id, "target_slot": target_slot, "type": typ})
        nodes_by = {n["id"]: n for n in sg["nodes"]}
        if target_id in nodes_by:
            nodes_by[target_id]["inputs"][target_slot]["link"] = lid
        if origin_id in nodes_by:
            out = nodes_by[origin_id]["outputs"][origin_slot]
            out["links"] = (out.get("links") or []) + [lid]
        return lid

    def sg_target_slot(node, input_name, typ, widget=False):
        for i, inp in enumerate(node["inputs"]):
            if inp["name"] == input_name:
                return i
        entry = {"localized_name": input_name, "name": input_name, "type": typ, "link": None}
        if widget:
            entry["widget"] = {"name": input_name}
        node["inputs"].append(entry)
        return len(node["inputs"]) - 1

    def add_sg_input(inst_id, name, typ, label, targets):
        """処理サブグラフの入力 name → モデルのサブグラフ(inst)の新しい入力 → 中の targets へつなぐ。
        targets: [(ノードID, 入力名, ウィジェット入力か)]"""
        inst = inner_nodes[inst_id]
        sg = sgs[inst["type"]]
        lid = add_inner(-10, None, inst_id, len(inst["inputs"]), typ)
        pending_inputs.append((slot_of(name), lid))
        inst["inputs"].append({"label": label, "name": name, "type": typ, "link": lid})
        slot = len(sg["inputs"])
        sub = {n["id"]: n for n in sg["nodes"]}
        link_ids = []
        for node_id, input_name, widget in targets:
            node = sub[node_id]
            ts = sg_target_slot(node, input_name, typ, widget)
            if node["inputs"][ts].get("link") is not None:
                sg_unlink(sg, node["inputs"][ts]["link"])
            link_ids.append(sg_link(sg, -10, slot, node_id, ts, typ))
        last_pos = sg["inputs"][-1].get("pos", [-100, 0])
        sg["inputs"].append({"id": _uuid(), "name": name, "type": typ, "linkIds": link_ids,
                             "label": label, "pos": [last_pos[0], last_pos[1] + 20]})
        b = sg["inputNode"].get("bounding")
        if b:
            b[3] += 20
        return sg

    # ---- MOSS I2I: 参照画像(縮小済み)と Edit 形式をパネルから受け取る ----
    moss_inst = next(i for i, n in inner_nodes.items() if sgs.get(n["type"], {}).get("name", "").startswith("MOSS | Image to Image"))
    add_sg_input(moss_inst, "ref_image_1", "IMAGE", "参照画像1 (縮小済み)",
                 [(n, "images.image_0", False) for n in MOSS_I2I_ENCODERS])
    add_sg_input(moss_inst, "edit_format", EDIT_FORMAT_TYPE, "Edit 形式",
                 [(n, "edit_format", True) for n in MOSS_I2I_ENCODERS])

    # ---- 画像→画像のマスク(塗った所だけ作り直す)。SetLatentNoiseMask を VAEEncode と KSampler の間に入れる ----
    # Qwen Image(第4版)と、SD1.5・SDXL・Illustrious・Anima・Krea2(第17版)。マスクが無いときはパネルが全体を塗ったマスクを渡す
    # (= ふつうの画像→画像と同じ)
    def add_noise_mask(name_prefix, enc_id=None, ks_id=None):
        inst = next(i for i, n in inner_nodes.items() if sgs.get(n["type"], {}).get("name", "").startswith(name_prefix))
        sg = sgs[inner_nodes[inst]["type"]]
        sub = {n["id"]: n for n in sg["nodes"]}
        ks = sub[ks_id] if ks_id else next(n for n in sg["nodes"] if n["type"] == "KSampler")
        latent_slot = next(i for i, x in enumerate(ks["inputs"]) if x["name"] == "latent_image")
        old = next(l for l in sg["links"] if l["id"] == ks["inputs"][latent_slot]["link"])
        enc = sub[enc_id] if enc_id else sub[old["origin_id"]]
        assert enc["type"] == "VAEEncode", (name_prefix, enc["type"])
        mask_node_id = ids.new_node()
        sg["nodes"].append({
            "id": mask_node_id, "type": "SetLatentNoiseMask",
            "pos": [ks["pos"][0] - 40, ks["pos"][1] + ks["size"][1] + 40], "size": [260, 50],
            "flags": {}, "order": 0, "mode": 0,
            "inputs": [{"localized_name": "samples", "name": "samples", "type": "LATENT", "link": None},
                       {"localized_name": "mask", "name": "mask", "type": "MASK", "link": None}],
            "outputs": [{"localized_name": "LATENT", "name": "LATENT", "type": "LATENT", "links": []}],
            "title": "マスク(塗った所だけ作り直す)", "properties": {"Node name for S&R": "SetLatentNoiseMask"},
            "widgets_values": [],
        })
        sg_unlink(sg, ks["inputs"][latent_slot]["link"])
        ks["inputs"][latent_slot]["link"] = None
        sg_link(sg, enc["id"], 0, mask_node_id, 0, "LATENT")
        sg_link(sg, mask_node_id, 0, ks["id"], latent_slot, "LATENT")
        add_sg_input(inst, "mask_1", "MASK", "マスク", [(mask_node_id, "mask", False)])
        return inst

    qwen_inst = add_noise_mask("Qwen Image | Image to Image", QWEN_I2I["vae_encode"], QWEN_I2I["ksampler"])
    for prefix in ("SD1.5 | Image to Image", "SDXL | Image to Image", "Illustrious | Image to Image",
                   "Anima | Image to Image", "Krea2 | Image to Image"):
        add_noise_mask(prefix)

    # ---- サブグラフに新しいノードを足す小道具 ----
    def sg_add_node(sg, node_type, title, pos, inputs, outputs, widgets=None, size=(260, 80)):
        nid = ids.new_node()
        sg["nodes"].append({
            "id": nid, "type": node_type, "pos": list(pos), "size": list(size), "flags": {}, "order": 0, "mode": 0,
            "inputs": [dict({"localized_name": n, "name": n, "type": t, "link": None}, **({"widget": {"name": n}} if w else {}))
                       for n, t, w in inputs],
            "outputs": [{"localized_name": n, "name": n, "type": t, "links": []} for n, t in outputs],
            "title": title, "properties": {"Node name for S&R": node_type},
            "widgets_values": list(widgets or []), "color": "#2a363b", "bgcolor": "#3f5159",
        })
        return nid

    def sg_input_slot(sg, name):
        return next(i for i, x in enumerate(sg["inputs"]) if x["name"] == name)

    def sg_link_input(sg, name, target_id, target_slot, typ):
        """サブグラフに元からある入力 name → 中のノードへつなぐ"""
        slot = sg_input_slot(sg, name)
        lid = sg_link(sg, -10, slot, target_id, target_slot, typ)
        sg["inputs"][slot].setdefault("linkIds", []).append(lid)
        return lid

    def sg_move_outputs(sg, from_id, from_slot, to_id, to_slot, typ):
        """from の出力の行き先を全部 to の出力からに付け替える"""
        moved = [l for l in sg["links"] if l["origin_id"] == from_id and l["origin_slot"] == from_slot]
        sub = {n["id"]: n for n in sg["nodes"]}
        for l in moved:
            sg_unlink(sg, l["id"])
            sub[l["target_id"]]["inputs"][l["target_slot"]]["link"] = None
            sg_link(sg, to_id, to_slot, l["target_id"], l["target_slot"], typ)
        return len(moved)

    # ---- 出力サイズの「倍率指定」: MOSS / Qwen の画像→画像は縮小ノードの後ろで画像1 × 倍率に差し替える ----
    for inst_id, scale_id, img_input in ((moss_inst, MOSS_I2I_SCALE, "in_00"), (qwen_inst, QWEN_I2I["scale"], "in_00")):
        sg = sgs[inner_nodes[inst_id]["type"]]
        src = next(n for n in sg["nodes"] if n["id"] == scale_id)
        sel = sg_add_node(sg, "CCASizeSelect", "出力サイズ(倍率指定のときは画像1 × 倍率)",
                          (src["pos"][0], src["pos"][1] + 140),
                          [("image", "IMAGE", False), ("by_scale_image", "IMAGE", False), ("size_by_scale", "BOOLEAN", True)],
                          [("image", "IMAGE")], [False])
        if sg_move_outputs(sg, scale_id, 0, sel, 0, "IMAGE") < 1:
            raise RuntimeError(f"{sg['name']} の縮小ノードの出力先がありません")
        sg_link(sg, scale_id, 0, sel, 0, "IMAGE")
        sg_link_input(sg, img_input, sel, 1, "IMAGE")
        add_sg_input(inst_id, "size_by_scale", "BOOLEAN", "倍率指定", [(sel, "size_by_scale", True)])

    def sg_drop_link(sg, link_id):
        """リンクを外し、サブグラフ入力の linkIds と接続先の link も片付ける"""
        link = next((l for l in sg["links"] if l["id"] == link_id), None)
        if link is None:
            return
        sg_unlink(sg, link_id)
        if link["origin_id"] == -10:
            ids_ = sg["inputs"][link["origin_slot"]].get("linkIds", [])
            sg["inputs"][link["origin_slot"]]["linkIds"] = [x for x in ids_ if x != link_id]
        for n in sg["nodes"]:
            if n["id"] == link["target_id"]:
                n["inputs"][link["target_slot"]]["link"] = None

    def sg_retype(sg, node, new_type, spec, title=None):
        """ノードの種類を変え、入力を spec [(名前, 型, ウィジェットか)] の並びにする。同じ名前の入力のリンクは引き継ぎ、
        無くなる入力のリンクは外す"""
        old = {i["name"]: i for i in node["inputs"]}
        for name, inp in old.items():
            if inp.get("link") is not None and name not in [x[0] for x in spec]:
                sg_drop_link(sg, inp["link"])
        new_inputs = []
        for name, typ, w in spec:
            e = {"localized_name": name, "name": name, "type": typ, "link": old.get(name, {}).get("link")}
            if w:
                e["widget"] = {"name": name}
            new_inputs.append(e)
        slot = {e["name"]: i for i, e in enumerate(new_inputs)}
        for l in sg["links"]:
            if l["target_id"] == node["id"]:
                l["target_slot"] = slot[node["inputs"][l["target_slot"]]["name"]]
        node.update(type=new_type, inputs=new_inputs, properties={"Node name for S&R": new_type})
        if title:
            node["title"] = title

    # ---- MOSS I2I: 生成の始まり。マスクが無ければ元の画像(VAEEncodeForInpaint はマスク全体だと灰色から作り直すため) ----
    msg = sgs[inner_nodes[moss_inst]["type"]]
    inp_enc = next(n for n in msg["nodes"] if n["type"] == "VAEEncodeForInpaint")
    sg_retype(msg, inp_enc, "CCAEditLatent", [("pixels", "IMAGE", False), ("vae", "VAE", False), ("mask", "MASK", False),
                                              ("grow_mask_by", "INT", True)], title="生成の始まり(マスクが無ければ元の画像)")

    # ---- Qwen Image 画像→画像: 画像1と画像2を左右に並べて 1 枚にして TextEncodeQwenImageEdit に渡す ----
    qsg = sgs[inner_nodes[qwen_inst]["type"]]
    qsub = {n["id"]: n for n in qsg["nodes"]}
    scale_node = qsub[QWEN_I2I["scale"]]
    stitch = sg_add_node(qsg, "ImageStitch", "画像1と画像2を左右に並べる(画像2が無ければ画像1だけ)",
                         (scale_node["pos"][0], scale_node["pos"][1] - 260),
                         [("image1", "IMAGE", False), ("direction", "COMBO", True), ("match_image_size", "BOOLEAN", True),
                          ("spacing_width", "INT", True), ("spacing_color", "COMBO", True), ("image2", "IMAGE", False)],
                         [("IMAGE", "IMAGE")], ["right", True, 0, "white"], size=(300, 150))
    ref_scale = sg_add_node(qsg, "ImageScaleToTotalPixels", "編集の参照画像(1MP)",
                            (scale_node["pos"][0], scale_node["pos"][1] - 90),
                            [("image", "IMAGE", False), ("upscale_method", "COMBO", True), ("megapixels", "FLOAT", True),
                             ("resolution_steps", "INT", True)],
                            [("IMAGE", "IMAGE")], ["nearest-exact", 1, 1], size=(300, 100))
    sg_link_input(qsg, "in_00", stitch, 0, "IMAGE")
    sg_link_input(qsg, "in_06", stitch, 5, "IMAGE")
    sg_link(qsg, stitch, 0, ref_scale, 0, "IMAGE")
    for enc_id in QWEN_I2I["encoders"]:
        enc = qsub[enc_id]
        if enc["type"] != "TextEncodeQwenImageEditPlus":
            raise RuntimeError("Qwen I2I のエンコーダーが想定と違います")
        sg_retype(qsg, enc, "TextEncodeQwenImageEdit",
                  [("clip", "CLIP", False), ("prompt", "STRING", True), ("vae", "VAE", False), ("image", "IMAGE", False)])
        sg_link(qsg, ref_scale, 0, enc_id, 3, "IMAGE")

    # ---- Wan2.2 14B 画像→動画: 最後のフレーム(入力画像2)----
    wsg = sgs[inner_nodes[WAN14_I2V["inst"]]["type"]]
    wnode = next(n for n in wsg["nodes"] if n["id"] == WAN14_I2V["i2v"])
    if wnode["type"] != "WanImageToVideo":
        raise RuntimeError("Wan2.2 14B 画像→動画のノードが想定と違います")
    old_inputs = {i["name"]: i for i in wnode["inputs"]}
    new_spec = [("positive", "CONDITIONING", False), ("negative", "CONDITIONING", False), ("vae", "VAE", False),
                ("clip_vision_start_image", "CLIP_VISION_OUTPUT", False), ("clip_vision_end_image", "CLIP_VISION_OUTPUT", False),
                ("start_image", "IMAGE", False), ("end_image", "IMAGE", False),
                ("width", "INT", True), ("height", "INT", True), ("length", "INT", True), ("batch_size", "INT", True)]
    new_inputs = []
    for n, t, w in new_spec:
        e = {"localized_name": n, "name": n, "type": t, "link": old_inputs.get(n, {}).get("link")}
        if w:
            e["widget"] = {"name": n}
        new_inputs.append(e)
    slot_of_name = {e["name"]: i for i, e in enumerate(new_inputs)}
    for l in wsg["links"]:
        if l["target_id"] == wnode["id"]:
            name = wnode["inputs"][l["target_slot"]]["name"]
            if name not in slot_of_name:
                raise RuntimeError(f"Wan2.2 14B: 付け替え先の無い入力 {name}")
            l["target_slot"] = slot_of_name[name]
    wnode.update(type="WanFirstLastFrameToVideo", inputs=new_inputs,
                 properties={"Node name for S&R": "WanFirstLastFrameToVideo"},
                 title="最初・最後のフレーム → 動画")
    add_sg_input(WAN14_I2V["inst"], "image_2", "IMAGE", "入力画像2(最後のフレーム)", [(wnode["id"], "end_image", False)])

    # ---- MiniMax H3 画像→動画: 途中のフレーム(入力画像3)----
    hsg = sgs[inner_nodes[H3_I2V["inst"]]["type"]]
    hsub = {n["id"]: n for n in hsg["nodes"]}
    i2v, guider = hsub[H3_I2V["i2v"]], hsub[H3_I2V["guider"]]
    pos_slot = next(i for i, o in enumerate(i2v["outputs"]) if o["type"] == "CONDITIONING")
    lat_slot = next(i for i, o in enumerate(i2v["outputs"]) if o["type"] == "LATENT")
    mid = sg_add_node(hsg, "CCAMidFrameGuide", "途中のフレーム(画像2が無ければ素通し)",
                      (guider["pos"][0], guider["pos"][1] - 160),
                      [("positive", "CONDITIONING", False), ("latent", "LATENT", False), ("vae", "VAE", False),
                       ("position", "INT", True), ("image", "IMAGE", False)],
                      [("positive", "CONDITIONING")], [50], size=(300, 140))
    # 画像2(元は最後のフレーム)を途中のフレームへ付け替える。最後のフレームは画像3
    lf_slot = next(i for i, x in enumerate(i2v["inputs"]) if x["name"] == "last_frame")
    old_lf = i2v["inputs"][lf_slot]["link"]
    img2_slot = next(l for l in hsg["links"] if l["id"] == old_lf)["origin_slot"]
    sg_drop_link(hsg, old_lf)
    cond_slot = next(i for i, x in enumerate(guider["inputs"]) if x["name"] == "conditioning")
    sg_unlink(hsg, guider["inputs"][cond_slot]["link"])
    guider["inputs"][cond_slot]["link"] = None
    sg_link(hsg, i2v["id"], pos_slot, mid, 0, "CONDITIONING")
    sg_link(hsg, i2v["id"], lat_slot, mid, 1, "LATENT")
    sg_link_input(hsg, "vae", mid, 2, "VAE")
    sg_link(hsg, mid, 0, guider["id"], cond_slot, "CONDITIONING")
    lid = sg_link(hsg, -10, img2_slot, mid, 4, "IMAGE")
    hsg["inputs"][img2_slot].setdefault("linkIds", []).append(lid)
    add_sg_input(H3_I2V["inst"], "mid_frame_pos", "INT", "途中のフレームの位置(%)", [(mid, "position", True)])
    add_sg_input(H3_I2V["inst"], "image_3", "IMAGE", "入力画像3(最後のフレーム)", [(i2v["id"], "last_frame", False)])

    # ---- 動画の長さ(フレーム数)と fps をパネルから受け取る(MiniMax H3 は音声が 24fps 前提のため fps は固定)----
    for inst_id, (len_id, cv_id, fps_on) in VIDEO_NODES.items():
        add_sg_input(inst_id, "video_length", "INT", "フレーム数", [(len_id, "length", True)])
        if fps_on:
            add_sg_input(inst_id, "video_fps", "FLOAT", "fps", [(cv_id, "fps", True)])

    # ---- Wan のシフトをパネルから受け取る(通常 8、Wan2.2 14B Turbo は 5)----
    for inst_id, shift_ids in WAN_SHIFT_NODES.items():
        add_sg_input(inst_id, "video_shift", "FLOAT", "シフト", [(nid, "shift", True) for nid in shift_ids])

    # ---- 第9版: 新しいモデルの処理ノード + ルートのスイッチ(切替の先頭に足す)----
    new_rows, new_img_sw, new_vid_sw = [], [], []
    for row, node_type, title, route, node_inputs, out_type in NEW_ROUTES:
        nid = ids.new_node()
        inner_nodes[nid] = {
            "id": nid, "type": node_type, "pos": [0, 0], "size": [360, 60 + 22 * len(node_inputs)], "flags": {},
            "order": 0, "mode": 0,
            "inputs": [{"localized_name": n, "name": n, "type": t, "link": None,
                        **({"shape": 7} if n == "ref_images" else {})} for n, t in node_inputs],
            "outputs": [{"localized_name": out_type.lower(), "name": out_type.lower(), "type": out_type, "links": []}],
            "title": title, "properties": {"Node name for S&R": node_type}, "widgets_values": [],
            "color": "#2a363b", "bgcolor": "#3f5159",
        }
        for i, (n, t) in enumerate(node_inputs):
            pending_inputs.append((slot_of(n), add_inner(-10, None, nid, i, t)))
        sw = ids.new_node()
        inner_nodes[sw] = {
            "id": sw, "type": "ComfySwitchNode", "pos": [0, 0], "size": [270, 100], "flags": {}, "order": 0,
            "mode": 0,
            "inputs": [{"name": "on_false", "shape": 7, "type": out_type, "link": None},
                       {"name": "on_true", "shape": 7, "type": out_type, "link": None},
                       {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": None}],
            "outputs": [{"name": "output", "type": out_type, "links": []}],
            "title": f"Route: {row}", "properties": {"Node name for S&R": "ComfySwitchNode"},
            "widgets_values": [False],
        }
        head = out_image_link if out_type == "IMAGE" else out_video_link
        lid, o, os_, ty = head
        add_inner(o, os_, sw, 0, out_type, lid)          # これまでの切替の先頭 → 偽のとき
        add_inner(nid, 0, sw, 1, out_type)              # このモデル → 真のとき
        add_inner(routes_id, route, sw, 2, "BOOLEAN")   # ルート番号
        new_head = (ids.new_link(), sw, 0, out_type)
        if out_type == "IMAGE":
            out_image_link = new_head
            new_img_sw.insert(0, sw)
        else:
            out_video_link = new_head
            new_vid_sw.insert(0, sw)
        new_rows.append((row, [nid]))

    # ---- MiniMax(画像・動画): 選べる一覧から外したので、処理はバイパス(素通し)して折りたたむ ----
    for row, members in ROWS:
        if row in HIDDEN_ROWS:
            for nid in members:
                inner_nodes[nid]["mode"] = 4
                inner_nodes[nid].setdefault("flags", {})["collapsed"] = True

    # ---- Hires. fix: 画像ルートの出力に挟む ----
    hires_id = ids.new_node()
    hires_inputs = [("image", "IMAGE"), ("hires", "CCA_HIRES"), ("model", "MODEL"), ("clip", "CLIP"),
                    ("vae", "VAE"), ("positive", "STRING"), ("negative", "STRING"), ("seed", "INT"),
                    ("steps", "INT"), ("cfg", "FLOAT"), ("sampler_name", "COMBO"), ("scheduler", "COMBO")]
    inner_nodes[hires_id] = {
        "id": hires_id, "type": "CCAHiresFix", "pos": [0, 0], "size": [260, 280], "flags": {},
        "order": 0, "mode": 0,
        "inputs": [{"localized_name": n, "name": n, "type": t, "link": None} for n, t in hires_inputs],
        "outputs": [{"localized_name": "image", "name": "image", "type": "IMAGE", "links": []}],
        "title": "Hires. fix(無効なら素通し)", "properties": {"Node name for S&R": "CCAHiresFix"},
        "widgets_values": [], "color": "#2a363b", "bgcolor": "#3f5159",
    }
    lid, o, os_, ty = out_image_link
    add_inner(o, os_, hires_id, 0, "IMAGE", lid)
    for i, (n, t) in enumerate(hires_inputs[1:], 1):
        l2 = add_inner(-10, None, hires_id, i, t)
        pending_inputs.append((slot_of(n), l2))
    out_image_link = (ids.new_link(), hires_id, 0, "IMAGE")

    # ---- 入力スロット番号の確定(パネル出力の順に並べる)----
    used.sort(key=lambda n: OUT[n])
    slot_index = {n: i for i, n in enumerate(used)}
    by_id = {l["id"]: l for l in inner_links}
    for name, lid in pending_inputs:
        by_id[lid]["origin_slot"] = slot_index[name]
        slot_links[name].append(lid)

    # ---- 処理サブグラフの出力 ----
    outputs = []
    for name, info in (("IMAGE", out_image_link), ("VIDEO", out_video_link)):
        lid, o, os_, ty = info
        add_inner(o, os_, -20, len(outputs), ty, lid)
        outputs.append({"id": _uuid(), "name": name, "type": ty, "linkIds": [lid],
                        "localized_name": name, "label": "画像" if name == "IMAGE" else "動画"})

    # ---- 内部ノードの入出力の link 参照を付け直す ----
    routes_node = {
        "id": routes_id, "type": ROUTES_TYPE, "pos": [0, 0], "size": [240, 600], "flags": {},
        "order": 0, "mode": 0,
        "inputs": [{"name": "route", "type": "INT", "link": rl}],
        "outputs": [{"name": f"route_{i:02d}", "type": "BOOLEAN", "links": [], "slot_index": i}
                    for i in range(ROUTE_COUNT)],
        "title": "ルート (どの処理を使うか)", "properties": {"Node name for S&R": ROUTES_TYPE},
        "widgets_values": [],
    }
    inner_nodes[routes_id] = routes_node
    for n in inner_nodes.values():
        for out in n.get("outputs", []):
            out["links"] = []
    for l in inner_links:
        if l["origin_id"] in inner_nodes:
            inner_nodes[l["origin_id"]]["outputs"][l["origin_slot"]]["links"].append(l["id"])
    linked_inputs = {(l["target_id"], l["target_slot"]): l["id"] for l in inner_links}
    for n in inner_nodes.values():
        for i, inp in enumerate(n.get("inputs", [])):
            inp["link"] = linked_inputs.get((n["id"], i))

    # ---- 並べ直し ----
    col_x = [460, 1060, 1660]
    y = 0
    groups = []
    # 並び: 元の行(MiniMax は最後にまとめる) + 第9版の行
    rows = ([r for r in ROWS if r[0] not in HIDDEN_ROWS] + new_rows
            + [(f"{t}(使わない・バイパス中)", m) for t, m in ROWS if t in HIDDEN_ROWS])
    for title, members in rows:
        row_h = 0
        x_i = 0
        for nid in members:
            n = inner_nodes[nid]
            if n["type"] == "ComfySwitchNode":  # MiniMax-H3-Image の I2I サイズ切替
                n["pos"] = [col_x[2], y + (0 if nid == 266 else 140)]
                n["size"] = [270, 100]
                continue
            n["pos"] = [col_x[x_i], y + 40]
            row_h = max(row_h, 30 if n.get("flags", {}).get("collapsed") else n["size"][1])
            x_i += 1
        row_h += 80
        groups.append({"id": len(groups) + 1, "title": title,
                       "bounding": [col_x[0] - 30, y, 1800, row_h], "color": "#3f3f3f",
                       "font_size": 28, "flags": {}})
        y += row_h + 40
    total_h = y

    sw_x = 2350
    sy = 0
    for nid in new_img_sw + IMAGE_SWITCHES:
        inner_nodes[nid]["pos"] = [sw_x, sy]
        sy += 120
    groups.append({"id": len(groups) + 1, "title": "画像ルートの切替(上から順に判定)",
                   "bounding": [sw_x - 30, -60, 340, sy + 40], "color": "#3f5f3f", "font_size": 22,
                   "flags": {}})
    sy += 120
    vy0 = sy
    for nid in new_vid_sw + VIDEO_SWITCHES:
        inner_nodes[nid]["pos"] = [sw_x, sy]
        sy += 120
    groups.append({"id": len(groups) + 1, "title": "動画ルートの切替",
                   "bounding": [sw_x - 30, vy0 - 60, 340, sy - vy0 + 40], "color": "#3f3f5f",
                   "font_size": 22, "flags": {}})
    routes_node["pos"] = [100, 0]
    inner_nodes[hires_id]["pos"] = [sw_x + 380, 0]

    # ---- 処理サブグラフの定義 ----
    inputs = []
    for i, name in enumerate(used):
        typ = dict(PANEL_OUTPUTS)[name]
        if typ == "COMBO":
            typ = EDIT_FORMAT_TYPE if name == "edit_format" else combo_types[name]
        inputs.append({"id": _uuid(), "name": name, "type": typ, "linkIds": slot_links[name],
                       "label": PANEL_LABELS[name], "pos": [-280, 40 + 20 * i]})
    proc_def = {
        "id": proc_def_id, "version": 1,
        "state": {"lastGroupId": len(groups), "lastNodeId": ids.node, "lastLinkId": 0,
                  "lastRerouteId": 0},
        "revision": 0, "config": {}, "name": "CCA 処理(全モデル)",
        "inputNode": {"id": -10, "bounding": [-400, 0, 200, 40 + 20 * len(inputs)]},
        "outputNode": {"id": -20, "bounding": [2800, 0, 140, 90]},
        "inputs": inputs, "outputs": outputs, "widgets": [],
        "nodes": sorted(inner_nodes.values(), key=lambda n: n["id"]),
        "groups": groups, "links": inner_links, "extra": {},
    }

    # ---- トップレベル ----
    save_image = nodes[SAVE_IMAGE]
    save_video = nodes[SAVE_VIDEO]
    panel_links = {i: [] for i in range(len(PANEL_OUTPUTS))}

    proc_inputs = []
    for i, name in enumerate(used):
        lid = ids.new_link()
        typ = inputs[i]["type"]
        top_links.append([lid, panel_id, OUT[name], proc_id, i, dict(PANEL_OUTPUTS)[name]])
        panel_links[OUT[name]].append(lid)
        entry = {"label": PANEL_LABELS[name], "name": name, "type": typ, "link": lid}
        proc_inputs.append(entry)

    li = ids.new_link()
    lv = ids.new_link()
    top_links.append([li, proc_id, 0, SAVE_IMAGE, 0, "IMAGE"])
    top_links.append([lv, proc_id, 1, SAVE_VIDEO, 0, "VIDEO"])
    for save, name, link_id in ((save_image, "image_prefix", li), (save_video, "video_prefix", lv)):
        for i, inp in enumerate(save["inputs"]):
            if inp["name"] in ("images", "video"):
                inp["link"] = link_id
            elif inp["name"] == "filename_prefix":
                pl = ids.new_link()
                top_links.append([pl, panel_id, OUT[name], save["id"], i, "STRING"])
                panel_links[OUT[name]].append(pl)
                inp["link"] = pl
        save["outputs"] = [dict(o, links=[]) for o in save.get("outputs", [])]
    save_image.update(pos=[1060, 0], size=[520, 560], title="保存: 画像")
    save_video.update(pos=[1060, 640], size=[520, 560], title="保存: 動画")
    save_image.pop("color", None), save_image.pop("bgcolor", None)

    panel = {
        "id": panel_id, "type": PANEL_TYPE, "pos": [0, 0], "size": [480, 1400], "flags": {},
        "order": 0, "mode": 0, "inputs": [],
        "outputs": [{"name": n, "label": PANEL_LABELS[n], "type": t, "links": panel_links[i],
                     "slot_index": i} for i, (n, t) in enumerate(PANEL_OUTPUTS)],
        "title": "CCA Generator",
        # cca_init: 初回読み込み時に前回設定/既定値で埋める(JS 側で消える)
        "properties": {"Node name for S&R": PANEL_TYPE, "cca_init": True},
        "color": "#1f3b4d", "bgcolor": "#24485e",
    }
    proc = {
        "id": proc_id, "type": proc_def_id, "pos": [600, 0], "size": [340, 40 + 22 * len(used)],
        "flags": {}, "order": 1, "mode": 0, "inputs": proc_inputs,
        "outputs": [{"name": "IMAGE", "label": "画像", "type": "IMAGE", "links": [li], "slot_index": 0},
                    {"name": "VIDEO", "label": "動画", "type": "VIDEO", "links": [lv], "slot_index": 1}],
        "title": "CCA 処理(全モデル)", "properties": {"Node name for S&R": "CCA 処理(全モデル)"},
        "widgets_values": [], "color": "#2b2b3b", "bgcolor": "#35354a",
    }
    # キャンバスのメモは 1 つだけ(パネルの開き方)。モデルごとの使い方はパネルの「? 使い方」で見る
    usage_md = _load_notes()
    usage = {
        "id": usage_id, "type": "MarkdownNote", "pos": [1800, 0], "size": [420, 200], "flags": {},
        "order": 2, "mode": 0, "inputs": [], "outputs": [], "title": "使い方",
        "properties": {}, "widgets_values": [usage_md], "color": "#432", "bgcolor": "#653",
    }
    d["groups"] = []

    d["nodes"] = [panel, proc, save_image, save_video, usage]
    d["links"] = top_links
    subgraphs = [s for s in d["definitions"]["subgraphs"] if s["id"] != nodes[FLOW_SELECTOR]["type"]]
    subgraphs.append(proc_def)
    d["definitions"]["subgraphs"] = subgraphs

    d["last_node_id"] = ids.node
    d["last_link_id"] = ids.link
    for sg in subgraphs:
        sg["state"]["lastNodeId"] = max(sg["state"].get("lastNodeId", 0), ids.node)
        sg["state"]["lastLinkId"] = max(sg["state"].get("lastLinkId", 0), ids.link)
    d["id"] = _uuid()
    d.setdefault("extra", {})
    d["extra"] = {k: v for k, v in d["extra"].items() if k == "frontendVersion"}
    d["extra"].update(ccaGenerator=True, ccaHiresNode=f"{proc_id}:{hires_id}",
                      ds={"scale": 0.5, "offset": [80, 120]})
    _ = total_h
    return d


# ---------------------------------------------------------------- 検証
def validate(d):
    errors = []

    def check(graph_nodes, links, label, io_ids=()):
        nodes = {n["id"]: n for n in graph_nodes}
        by_id = {}
        for l in links:
            if isinstance(l, list):
                lid, o, os_, t, ts = l[:5]
            else:
                lid, o, os_, t, ts = l["id"], l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"]
            if lid in by_id:
                errors.append(f"{label}: リンクID重複 {lid}")
            by_id[lid] = (o, os_, t, ts)
            if o not in nodes and o not in io_ids:
                errors.append(f"{label}: link {lid} の接続元 {o} が存在しない")
            if t not in nodes and t not in io_ids:
                errors.append(f"{label}: link {lid} の接続先 {t} が存在しない")
            if t in nodes:
                ins = nodes[t].get("inputs", [])
                if ts >= len(ins) or ins[ts].get("link") != lid:
                    errors.append(f"{label}: link {lid} が接続先 {t}.in{ts} と一致しない")
            if o in nodes:
                outs = nodes[o].get("outputs", [])
                if os_ >= len(outs) or lid not in (outs[os_].get("links") or []):
                    errors.append(f"{label}: link {lid} が接続元 {o}.out{os_} に無い")
        for n in graph_nodes:
            for i, inp in enumerate(n.get("inputs", [])):
                if inp.get("link") is not None and inp["link"] not in by_id:
                    errors.append(f"{label}: ノード {n['id']}.in{i} が存在しない link {inp['link']} を参照")
            for i, out in enumerate(n.get("outputs", [])):
                for lid in out.get("links") or []:
                    if lid not in by_id:
                        errors.append(f"{label}: ノード {n['id']}.out{i} が存在しない link {lid} を参照")
        return by_id

    sg_by_id = {s["id"]: s for s in d["definitions"]["subgraphs"]}

    def check_instances(graph_nodes, label):
        for n in graph_nodes:
            if len(n["type"]) == 36 and n["type"].count("-") == 4:
                sg = sg_by_id.get(n["type"])
                if sg is None:
                    errors.append(f"{label}: ノード {n['id']} のサブグラフ定義が無い")
                elif len(n.get("inputs", [])) > len(sg["inputs"]):
                    errors.append(f"{label}: ノード {n['id']} の入力がサブグラフ定義より多い")

    check(d["nodes"], d["links"], "top")
    check_instances(d["nodes"], "top")
    for sg in d["definitions"]["subgraphs"]:
        by_id = check(sg["nodes"], sg["links"], sg["name"], io_ids=(-10, -20))
        check_instances(sg["nodes"], sg["name"])
        for slot, inp in enumerate(sg["inputs"]):
            for lid in inp.get("linkIds", []):
                if lid not in by_id or by_id[lid][0] != -10 or by_id[lid][1] != slot:
                    errors.append(f"{sg['name']}: 入力 {inp['name']} の linkIds {lid} が不整合")
        for slot, out in enumerate(sg["outputs"]):
            for lid in out.get("linkIds", []):
                if lid not in by_id or by_id[lid][2] != -20 or by_id[lid][3] != slot:
                    errors.append(f"{sg['name']}: 出力 {out['name']} の linkIds {lid} が不整合")
    return errors


def use_cca_save(wf):
    """第25版: 画像の保存を CCA の保存ノード(生成情報 parameters を PNG に入れる)に替える。入力・出力は Save Image と同じ"""
    def swap(nodes):
        for n in nodes:
            if n.get("type") == "SaveImage":
                n["type"] = "CCASaveImage"
                props = n.setdefault("properties", {})
                props["Node name for S&R"] = "CCASaveImage"
                props.pop("cnr_id", None)
                props.pop("ver", None)
                n["outputs"] = []
    swap(wf.get("nodes", []))
    for sg in wf.get("definitions", {}).get("subgraphs", []):
        swap(sg.get("nodes", []))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8") as f:
        d = json.load(f)
    if any(n.get("type") == PANEL_TYPE for n in d.get("nodes", [])):
        raise SystemExit("入力は変換前の Full_generator.json を指定してください")
    errors = validate(d)
    if errors:
        print("\n".join(errors[:20]))
        raise SystemExit(f"入力ファイルの検証エラー {len(errors)} 件")
    out = convert(d)
    use_cca_save(out)
    errors = validate(out)
    if errors:
        print("\n".join(errors))
        raise SystemExit(f"検証エラー {len(errors)} 件")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    proc = out["definitions"]["subgraphs"][-1]
    print(f"OK: {dst}  top nodes={len(out['nodes'])} links={len(out['links'])} | "
          f"処理サブグラフ nodes={len(proc['nodes'])} links={len(proc['links'])} inputs={len(proc['inputs'])} | "
          f"subgraphs={len(out['definitions']['subgraphs'])}")


if __name__ == "__main__":
    main()
