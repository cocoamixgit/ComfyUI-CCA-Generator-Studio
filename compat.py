"""ほかの追加ノードが使うライブラリ・配布元の変更を、こちらで埋める。

1. torchao 0.18 で torchao.dtypes.nf4tensor が torchao.quantization.quantize_.workflows.nf4.nf4_tensor へ移った。
   torchtune 0.6.1(HeartMuLa の追加ノードが使う)は古い場所から読むので、古い名前で読まれたときだけ新しい場所の物を渡す。
   古い場所がある版(torchao 0.17 まで)では何もしない(ふつうの読み込みが先に見つけるため)。
2. HeartMuLa のコーデックの配布元が HeartMuLa/HeartCodec-oss から HeartMuLa/HeartCodec-oss-20260123 に変わった。
   追加ノード ComfyUI_FL-HeartMuLa は古い名前からダウンロードしようとするので、読み込み済みの設定を新しい名前に変える。
"""
import importlib
import importlib.abc
import importlib.util
import sys

# 古い名前 → 新しい場所(先頭から順に探す)
MOVED = {
    "torchao.dtypes.nf4tensor": ("torchao.quantization.quantize_.workflows.nf4.nf4_tensor",),
}
HEARTCODEC_OLD = "HeartMuLa/HeartCodec-oss"
HEARTCODEC_NEW = "HeartMuLa/HeartCodec-oss-20260123"


class _MovedLoader(importlib.abc.Loader):
    def __init__(self, target):
        self.target = target

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        # 新しい場所のモジュールそのものを古い名前でも使えるようにする(同じ物なので型の比較も変わらない)
        sys.modules[module.__name__] = importlib.import_module(self.target)


class _MovedFinder(importlib.abc.MetaPathFinder):
    def find_spec(self, name, path=None, target=None):
        for new in MOVED.get(name, ()):
            try:
                if importlib.util.find_spec(new) is None:
                    continue
            except (ImportError, ValueError):
                continue
            return importlib.util.spec_from_loader(name, _MovedLoader(new))
        return None


def install():
    """読み込みの最後に、古い名前の受け口を足す(何度呼んでも 1 つだけ)。"""
    if not any(isinstance(f, _MovedFinder) for f in sys.meta_path):
        sys.meta_path.append(_MovedFinder())


def fix_heartmula_repos():
    """読み込み済みの HeartMuLa の追加ノードの設定で、コーデックの配布元を新しい名前にする。変えた数を返す。"""
    n = 0
    for mod in list(sys.modules.values()):
        variants = getattr(mod, "MODEL_VARIANTS", None) if mod is not None else None
        if not isinstance(variants, dict):
            continue
        for info in variants.values():
            repos = info.get("hf_repos") if isinstance(info, dict) else None
            if isinstance(repos, dict) and repos.get("codec") == HEARTCODEC_OLD:
                repos["codec"] = HEARTCODEC_NEW
                n += 1
    return n
