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
import logging

from .layout import apply_layout
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
        # 4) 枠(レイアウト)をプロンプトの文字列に組み込む(枠が無ければ文字列は変わらない)
        boxes = inputs.get("layout_boxes", "") or ""
        try:
            pp["positive"] = apply_layout(inputs.get("model_type"), inputs.get("task"), text, boxes,
                                          inputs.get("width"), inputs.get("height"))
        except Exception:  # noqa: BLE001  組み込めないときは書いたままのプロンプトで生成する
            logging.exception("[CCA Generator] 枠(レイアウト)をプロンプトに組み込めませんでした")
        if pp["positive"] != text:
            pp["positive_text"] = text
            pp["layout_boxes"] = boxes
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
