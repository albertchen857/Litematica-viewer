"""游戏数据小工具：中英方块名、方块分类、数量单位、贴图加载。

数据来自 ``lang/setting.json``（Blocks / Items / Category 三张表）。
若某个语言自带 ``lang/setting_<locale>.json``（只需含 Blocks / Items），
则该语言的方块/物品名优先用它的译名，缺的键再回退简体表。
"""

import functools
import json
import os

from .config import res
from .i18n import _, current, is_chinese

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


@functools.lru_cache(maxsize=None)
def name_tables(locale: str) -> dict:
    """按语言返回 ``{"Blocks": {...}, "Items": {...}}`` 的 ID -> 译名表。

    默认用 ``lang/setting.json``（简体）；某语言若带 ``lang/setting_<locale>.json``
    覆盖表，则用它的值覆盖对应键。分类关键词始终按简体表匹配（见 ``_category_lookup``）。
    """
    base = game_data()
    path = res("lang", f"setting_{locale}.json")
    if not os.path.exists(path):
        return {"Blocks": base["Blocks"], "Items": base["Items"]}
    with open(path, encoding="utf-8") as f:
        override = json.load(f)
    return {
        table: {**base[table], **override.get(table, {})}
        for table in ("Blocks", "Items")
    }


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
    """英文 id 与中文名互查。``to_chinese=False`` 时是反过来（中文名 -> 英文 id）。

    反查时先查当前语言的译名表，查不到再回退简体表，这样繁体界面下粘贴简体名
    （或反过来）也能认出来。
    """
    data = name_tables(current())[table]
    if to_chinese:
        return data.get(name, name)
    for source in (data, game_data()[table]):
        for key, value in source.items():
            if value == name:
                return key
    return name


def display_name(block_id: str) -> str:
    """界面上显示的方块名：中文界面查中文名，英文界面直接用 id。"""
    name = block_id.split(":")[-1].split("[")[0]
    if not is_chinese():
        return name
    data = name_tables(current())
    return data["Blocks"].get(name) or data["Items"].get(name) or name


# 数量单位：走 i18n，英文界面显示 LC/Box/St/u，简繁中文各用各的字。
UNIT_STEPS = (
    ("unit.lc", 54 * 27 * 64),
    ("unit.box", 27 * 64),
    ("unit.stack", 64),
    ("unit.unit", 1),
)


def convert_units(number: int) -> str:
    """把数量换算成「箱/盒/组/个」（英文界面为 LC/Box/St/u）。"""
    parts = []
    for key, value in UNIT_STEPS:
        if number >= value:
            parts.append(f"{number // value}{_(key)}")
            number %= value
    return "".join(parts) if parts else f"0{_('unit.unit')}"


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
