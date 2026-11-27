"""キュー投入時に CCAGeneratorPanel を役割ごとの内部ノードに分割する(サーバー側の on_prompt フック)。

パネル1つのままだと、Seed を変えただけでもパネルの全出力が「変わった」扱いになり、
モデルの読み直し・プロンプトのエンコード・入力画像のエンコードが毎回走る。
役割ごと(モデル / プロンプト / Seed / サンプリング設定 / route / 画像 / 保存先)に分けると、
変わった部分の下流だけが再実行される(元のワークフローと同じキャッシュの効き方)。

分割後のノード ID:
  モデル読み込み   = パネルと同じ ID(読み込み中の表示・エラー表示がパネルに出るように)
  それ以外         = "<パネルID>.<役割>"
第29版: プロンプトの __名前__(ワイルドカード)もここで置き換える(wildcards.py)。
"""
import copy
import json
import logging

from .layout import apply_layout
from .regional import NEGW_META_KEYS, REGIONAL_META_KEYS, adv_supported, build_config, extract_negw, strip_boxes
from .panel import OUTPUT_MAP, PARTS
from .wildcards import resolve as resolve_wildcards

PANEL_CLASS = "CCAGeneratorPanel"


def _part_id(panel_id, part_cls):
    return panel_id if part_cls.PART_NAME == "models" else f"{panel_id}.{part_cls.PART_NAME}"


def split_panels(prompt):
    if not isinstance(prompt, dict):
        return prompt
    panel_ids = [nid for nid, n in prompt.items()
                 if isinstance(n, dict) and n.get("class_type") == PANEL_CLASS]
    for pid in panel_ids:
        node = prompt[pid]
        inputs = node.get("inputs") or {}
        # パネルの項目を別ノードからつないでいる場合は分割しない(一括実行に任せる)
        if any(isinstance(v, list) for v in inputs.values()):
            continue
        pid_s = str(pid)

        # 1) 参照の付け替え(パネルの出力番号 → 分割先の出力)
        for nid, other in list(prompt.items()):
            if not isinstance(other, dict) or nid == pid:
                continue
            for k, v in (other.get("inputs") or {}).items():
                if isinstance(v, list) and len(v) == 2 and str(v[0]) == pid_s:
                    try:
                        part_cls, idx = OUTPUT_MAP[int(v[1])]
                    except (KeyError, ValueError):
                        continue
                    other["inputs"][k] = [_part_id(pid_s, part_cls), idx]

        # 2) パネルを分割先に置き換え
        title = (node.get("_meta") or {}).get("title") or "CCA Generator"
        del prompt[pid]
        for part_cls in PARTS:
            prompt[_part_id(pid_s, part_cls)] = {
                "class_type": part_cls.__name__,
                "inputs": {k: inputs[k] for k in part_cls.PART_INPUTS if k in inputs},
                "_meta": {"title": f"{title} ({part_cls.PART_NAME})"},
            }
        # 3) ワイルドカード(__名前__)を、登録した行のどれかに置き換える(シードが同じなら同じ言葉)
        pp = prompt[f"{pid_s}.prompt"]["inputs"]
        text = inputs.get("positive", "")
        try:
            raw = text
            text, neg = resolve_wildcards(text, inputs.get("negative", ""), inputs.get("seed"))
            if text != raw or neg != inputs.get("negative", ""):
                pp["positive"], pp["negative"] = text, neg
                pp["wildcard_template"] = raw
        except Exception:  # noqa: BLE001  置き換えられないときは書いたままのプロンプトで生成する
            logging.exception("[CCA Generator] ワイルドカードを置き換えられませんでした")
            text = inputs.get("positive", "")
        orig_text = text  # マイナスプロンプトの語を取り出す前の文(履歴・PNGinfo に残す)
        orig_boxes = inputs.get("layout_boxes", "") or ""
        # 3.5) マイナス重み / 領域プロンプト(無効・対象外の種別なら何もしない)
        try:
            adv, text, boxes_adv = build_config(inputs, inputs.get("model_type"), inputs.get("task"), text,
                                                pp.get("negative", inputs.get("negative", "")),
                                                inputs.get("layout_boxes", "") or "")
            inputs = dict(inputs, layout_boxes=boxes_adv)  # 枠の説明の (単語:-1.0) を除いた枠
            if adv:
                adv_id = f"{pid_s}.adv"
                for nid, other in prompt.items():
                    for k, v in (other.get("inputs") or {}).items():
                        if isinstance(v, list) and len(v) == 2 and str(v[0]) == pid_s and v[1] == 0:
                            other["inputs"][k] = [adv_id, 0]
                prompt[adv_id] = {"class_type": "CCAGenAdv",
                                  "inputs": {"model": [pid_s, 0], "clip": [pid_s, 2], "cfg": adv},
                                  "_meta": {"title": f"{title} (マイナスプロンプト/範囲別指定)"}}
        except Exception:  # noqa: BLE001  組み込めないときは通常の生成にする
            logging.exception("[CCA Generator] マイナスプロンプト / 範囲別指定 を組み込めませんでした")
        # 4) 枠(レイアウト)をプロンプトの文字列に組み込む(枠が無ければ文字列は変わらない)
        boxes = inputs.get("layout_boxes", "") or ""
        try:
            pp["positive"] = apply_layout(inputs.get("model_type"), inputs.get("task"), text, boxes,
                                          inputs.get("width"), inputs.get("height"))
        except Exception:  # noqa: BLE001  組み込めないときは書いたままのプロンプトで生成する
            logging.exception("[CCA Generator] 枠(レイアウト)をプロンプトに組み込めませんでした")
        # 履歴・PNGinfo から、書いたままの文・マイナスプロンプト・範囲別指定(枠とそのプロンプト)・それぞれの設定まで戻せるように残す
        supported = adv_supported(inputs.get("model_type"), inputs.get("task"))
        terms = []
        if supported and inputs.get("negw_enable"):  # マイナスプロンプト: 文と枠の説明に書いた (単語:-数字)
            terms = extract_negw(orig_text)[1] + strip_boxes(orig_boxes)[1]
        rng_on = supported and bool(orig_boxes)
        if pp["positive"] != orig_text or terms or rng_on:
            pp["positive_text"] = orig_text
            pp["layout_boxes"] = orig_boxes
        if terms:
            pp["negw_settings"] = json.dumps({"terms": [[w, x] for w, x in terms],
                                              "settings": {k: inputs[k] for k in NEGW_META_KEYS if k in inputs}},
                                             ensure_ascii=False)
        if rng_on:
            pp["regional_settings"] = json.dumps({k: inputs[k] for k in REGIONAL_META_KEYS if k in inputs}, ensure_ascii=False)
    return prompt


def on_prompt(json_data):
    try:
        if isinstance(json_data, dict) and isinstance(json_data.get("prompt"), dict):
            # 途中で失敗しても元の prompt が壊れないよう、写しを分割してから差し替える
            prompt = copy.deepcopy(json_data["prompt"])
            json_data["prompt"] = split_panels(prompt)
    except Exception:  # noqa: BLE001  分割に失敗してもパネルの一括実行で動く
        logging.exception("[CCA Generator] パネルの分割に失敗しました(一括実行で続行します)")
    return json_data
