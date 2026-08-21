"""资源路径、主题色、字体、设置持久化，以及少量跨平台封装。

原来这些散落在各个文件顶部（每个文件都自己 open 一次 data.json），现在统一到这里，
其它模块只 `from .config import ...`。
"""

import json
import os
import subprocess
import sys

APP_NAME = "LitematicaViewer"
APP_VERSION = "0.9.0"

IS_WIN = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"


def res(*parts: str) -> str:
    """返回资源的绝对路径。

    打包后资源被 PyInstaller 解压到 sys._MEIPASS；开发时以仓库根目录为基准
    （本文件位于 <root>/script/lv/config.py，所以向上三层）。
    """
    base = getattr(sys, "_MEIPASS", None)
    if base is None:
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base, *parts)


def user_file(name: str) -> str:
    """返回可写文件的路径（log.txt / error.log）。

    打包后 _MEIPASS 是只读临时目录，必须写到 exe 旁边。
    """
    if getattr(sys, "frozen", False):
        return os.path.join(os.path.dirname(sys.executable), name)
    return res(name)


# --------------------------------------------------------------------------- 设置

_DATA_PATH = res("lang", "data.json")

_DEFAULTS = {
    "Language": "zh_CN",
    "First_open": "0",
    "ui": {"Font": "Arial", "FontSize": 10, "ColorMap": "BlueAr", "cornerRadius": 10},
    # 面板显隐。原来是 "01101010" 这种按位置的字符串，改成看得懂的键名。
    "panels": {"func": 1, "stat": 1, "analysis": 1, "entity": 1},
}


def _load() -> dict:
    with open(_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    save = data.setdefault("Save", {})
    for key, value in _DEFAULTS.items():
        if isinstance(value, dict):
            slot = save.setdefault(key, {})
            for sub_key, sub_value in value.items():
                slot.setdefault(sub_key, sub_value)
        else:
            save.setdefault(key, value)
    save.pop("Basic", None)  # 旧版本的按位字符串，已被 panels 取代
    return data


DATA = _load()
SAVE = DATA["Save"]
UI = SAVE["ui"]


def save_settings() -> None:
    with open(_DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(DATA, f, indent=2, ensure_ascii=False)


def colors() -> dict:
    """当前主题色：MC 主色 / PC 强调色 / BG 背景 / TT 文字 / PR 次要。"""
    return DATA["Color_map"].get(UI["ColorMap"], DATA["Color_map"]["BlueAr"])


def font(scale: float = 1.0, bold: bool = False) -> tuple:
    """按当前字号缩放取字体元组，替代满屏的 (DefaultFont, int(DefaultFontSize * 1.5))。"""
    size = max(6, int(int(UI["FontSize"]) * scale))
    return (UI["Font"], size, "bold") if bold else (UI["Font"], size)


def corner() -> int:
    return int(UI["cornerRadius"])


def language() -> str:
    return SAVE["Language"]


# --------------------------------------------------------------------------- 跨平台

def set_icon(window) -> None:
    """给窗口设图标。iconbitmap(.ico) 只有 Windows 支持，其它平台转 PNG 走 iconphoto。"""
    try:
        if IS_WIN:
            window.iconbitmap(res("icon.ico"))
            return
        from PIL import Image, ImageTk

        image = Image.open(res("icon.ico")).convert("RGBA")
        window._icon_ref = ImageTk.PhotoImage(image)  # 必须留引用，否则被 GC
        window.iconphoto(True, window._icon_ref)
    except Exception as exc:  # 图标不是关键功能，失败就算了
        print(f"[icon] {exc}")


def maximize(window) -> None:
    """最大化窗口。三个平台各有各的写法，macOS 上 '-zoomed' 是无效的。"""
    try:
        if IS_WIN:
            window.state("zoomed")
        elif IS_MAC:
            window.geometry(f"{window.winfo_screenwidth()}x{window.winfo_screenheight()}+0+0")
        else:
            window.attributes("-zoomed", True)
    except Exception as exc:
        print(f"[maximize] {exc}")


def reveal(path: str) -> None:
    """在文件管理器/默认程序里打开路径。原来直接用 os.startfile，非 Windows 会崩。"""
    try:
        if IS_WIN:
            os.startfile(path)  # noqa: S606  仅 Windows 存在
        elif IS_MAC:
            subprocess.call(["open", path])
        else:
            subprocess.call(["xdg-open", path])
    except Exception as exc:
        print(f"[reveal] {exc}")
