"""CCA Generator の版。

版を設定する場所は pyproject.toml の version の 1 か所だけ。ここで読み込んで、
生成情報(PNGinfo の Version)・タイル生成の情報・生成パネルの表記(CCA Generator v1.3 など)に使う。
"""
import os
import re

TOOL_NAME = "CCA Generator"


def _read_version():
    try:
        with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pyproject.toml"), encoding="utf-8") as f:
            m = re.search(r'^version\s*=\s*"([^"]+)"', f.read(), re.M)
        if m:
            return m.group(1)
    except OSError:
        pass
    return "0"


VERSION = _read_version()  # 例: 1.3.0
VERSION_SHORT = ".".join(VERSION.split(".")[:2])  # 画面の表記に使う(例: 1.3)
