from .cca import compat, model_dirs
from .cca.audiogen import NODES as AUDIO_NODES
from .cca.extra_models import EXTRA_NODES
from .cca.imgedit import NODES as IMGEDIT_NODES
from .cca.pnginfo import NODES as PNGINFO_NODES
from .cca.videoedit import NODES as VIDEOEDIT_NODES
from .cca.rvcnode import NODES as RVC_NODES
from .cca.panel import PARTS, CCAEditLatent, CCAGeneratorPanel, CCAGeneratorRoutes, CCAHiresFix, CCAMidFrameGuide, CCASizeSelect
from .cca.regional import CCAGenAdv
from .cca.server import register_prompt_hook, register_routes

NODE_CLASS_MAPPINGS = {
    "CCAGeneratorPanel": CCAGeneratorPanel,
    "CCAGeneratorRoutes": CCAGeneratorRoutes,
    "CCAHiresFix": CCAHiresFix,
    "CCASizeSelect": CCASizeSelect,
    "CCAMidFrameGuide": CCAMidFrameGuide,
    "CCAEditLatent": CCAEditLatent,
    "CCAGenAdv": CCAGenAdv,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CCAGeneratorPanel": "CCA Generator Panel",
    "CCAGeneratorRoutes": "CCA Generator Routes",
    "CCAHiresFix": "CCA Hires. fix",
    "CCASizeSelect": "CCA 出力サイズの切り替え",
    "CCAMidFrameGuide": "CCA 途中のフレーム(MiniMax H3)",
    "CCAEditLatent": "CCA 編集の始まり(マスクが無ければ元の画像)",
    "CCAGenAdv": "CCA Generator (内部: マイナスプロンプト / 範囲別指定)",
}
for _name, (_cls, _label) in {**EXTRA_NODES, **IMGEDIT_NODES, **VIDEOEDIT_NODES, **PNGINFO_NODES, **AUDIO_NODES, **RVC_NODES}.items():
    NODE_CLASS_MAPPINGS[_name] = _cls
    NODE_DISPLAY_NAME_MAPPINGS[_name] = _label
for _cls in PARTS:
    NODE_CLASS_MAPPINGS[_cls.__name__] = _cls
    NODE_DISPLAY_NAME_MAPPINGS[_cls.__name__] = f"CCA Generator (内部: {_cls.PART_NAME})"

WEB_DIRECTORY = "./web"

try:
    compat.install()  # ほかの追加ノードが使うライブラリの場所の変更を埋める(torchao の nf4tensor)
except Exception as _e:  # noqa: BLE001
    print(f"[CCA Generator] 互換の設定に失敗: {_e}")

try:
    model_dirs.apply_all()  # 追加したモデルフォルダを登録
except Exception as _e:  # noqa: BLE001
    print(f"[CCA Generator] 追加フォルダの読み込みに失敗: {_e}")
register_routes()
register_prompt_hook()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
