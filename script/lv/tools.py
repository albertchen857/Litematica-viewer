"""游戏数据小工具：中英方块名、方块分类、数量单位、贴图加载。

数据来自 ``lang/setting.json``（Blocks / Items / Category 三张表）。
"""

import functools
import json
import os

from .config import res
from .i18n import _, is_chinese

# setting.json 里的分类键是中文，内部改用固定的英文 id，界面显示再翻译，
# 这样英文界面下饼图不会还是一堆中文标签。
CATEGORY_IDS = {
    "羊毛": "wool", "陶瓦": "terracotta", "混凝土": "concrete", "玻璃": "glass",
    "木制": "wood", "石英": "quartz", "矿类": "ore", "红石": "redstone",
    "容器": "container", "铁类": "iron", "末地类": "end", "地狱类": "nether",
    "石质": "stone", "其他岩石": "rock", "自然类": "nature", "海晶类": "prismarine",
    "粘土类": "clay", "液体": "fluid",
}
ENTITY = "entity"
OTHER = "other"
CATEGORY_ORDER = list(CATEGORY_IDS.values()) + [ENTITY, OTHER]


@functools.lru_cache(maxsize=1)
def game_data() -> dict:
    with open(res("lang", "setting.json"), encoding="utf-8") as f:
        return json.load(f)


@functools.lru_cache(maxsize=1)
def _category_lookup() -> dict:
    """{关键词: 分类 id}，例如 {"wool": "wool", "carpet": "wool"}。"""
    lookup = {}
    for chinese, keywords in game_data()["Category"].items():
        category = CATEGORY_IDS.get(chinese, OTHER)
        for keyword in keywords:
            lookup.setdefault(keyword, category)
    return lookup


def category_of(block_name: str) -> str:
    """按方块名里的单词判断分类，判断不出来归到 other。"""
    lookup = _category_lookup()
    for word in block_name.split("_"):
        if word in lookup:
            return lookup[word]
    return OTHER


def category_label(category: str) -> str:
    return _(f"cat.{category}")


def translate(name: str, to_chinese: bool = True, table: str = "Blocks") -> str:
    """英文 id 与中文名互查。``to_chinese=False`` 时是反过来（中文名 -> 英文 id）。"""
    data = game_data()[table]
    if to_chinese:
        return data.get(name, name)
    for key, value in data.items():
        if value == name:
            return key
    return name


def display_name(block_id: str) -> str:
    """界面上显示的方块名：中文界面查中文名，英文界面直接用 id。"""
    name = block_id.split(":")[-1].split("[")[0]
    if not is_chinese():
        return name
    data = game_data()
    return data["Blocks"].get(name) or data["Items"].get(name) or name


def convert_units(number: int) -> str:
    """把数量换算成「箱/盒/组/个」。英文界面用 LargeChest/Box/Stack/Unit。"""
    units = (
        (("箱", 54 * 27 * 64), ("盒", 27 * 64), ("组", 64), ("个", 1))
        if is_chinese()
        else (("LC", 54 * 27 * 64), ("Box", 27 * 64), ("St", 64), ("u", 1))
    )
    parts = []
    for label, value in units:
        if number >= value:
            parts.append(f"{number // value}{label}")
            number %= value
    return "".join(parts) if parts else ("0个" if is_chinese() else "0u")


# --------------------------------------------------------------------------- 贴图

_image_cache = {}


def texture_path(block_name: str) -> str:
    """先找 block/ 再找 item/，都没有就用占位图。"""
    for folder in ("block", "item"):
        path = res(folder, f"{block_name}.png")
        if os.path.exists(path):
            return path
    return res("block", "info_update.png")


def block_image(block_name: str, size: int = 20):
    """取方块贴图的 Tk 图像，带缓存。

    注意 PhotoImage 必须由调用方持有引用，这里的全局缓存正好起到这个作用；
    旧版就是因为图片被 GC 了导致表格里的图标时有时无。
    """
    key = (block_name, size)
    if key not in _image_cache:
        from PIL import Image, ImageTk

        image = Image.open(texture_path(block_name)).convert("RGBA")
        image = image.resize((size, size), Image.NEAREST)
        _image_cache[key] = ImageTk.PhotoImage(image)
    return _image_cache[key]


def clear_image_cache() -> None:
    _image_cache.clear()
