"""把桌面版的数据同步给网页（docs/），网页和桌面版共用一份来源。

    python tools/build_web_data.py

做三件事：
  1. lang/setting.json（+ setting_zh_TW.json）+ lang/source/*.json
     → docs/viewer/data/gamedata.json
     方块 / 物品中文名（简、繁）、分类关键词、界面文字（桌面版原有的指标名 / 分类 / 单位 /
     页签，加网页版自己的 web.* 键）。翻译只在 lang/source 里改一处。
  2. 重建 docs/viewer/resource/icons.json（方块图标在图集里的位置，见 script/lv/atlas.py）
  3. 主页（docs/index.html、docs/main.js）用到的几张方块小图，从图集裁到 docs/assets/blocks/

贴图图集本身（docs/viewer/resource/）桌面版和网页版直接共用，不再复制；
换 Minecraft 版本用 tools/update_jsassets.py，或者让程序开机自动更新。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import atlas  # noqa: E402
from lv.tools import CATEGORY_IDS, OTHER  # noqa: E402  分类 id 只在 Python 里定义一次

DOCS = os.path.join(ROOT, "docs")
OUT = os.path.join(DOCS, "viewer")
UI_PREFIXES = ("ui.stat.", "cat.", "unit.", "ui.chart.", "litem.chart.", "tab.", "web.")


def load(name: str) -> dict:
    path = os.path.join(ROOT, "lang", name)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def ui_strings(locale: str) -> dict:
    with open(os.path.join(ROOT, "lang", "source", f"{locale}.json"), encoding="utf-8") as f:
        table = json.load(f)
    return {k: v for k, v in table.items() if k.startswith(UI_PREFIXES)}


def write_gamedata() -> None:
    base = load("setting.json")
    traditional = load("setting_zh_TW.json")
    keywords = {}
    for chinese, words in base["Category"].items():
        category = CATEGORY_IDS.get(chinese, OTHER)
        for word in words:
            keywords.setdefault(word, category)
    data = {
        "blocks": {"zh_CN": base["Blocks"], "zh_TW": {**base["Blocks"], **traditional.get("Blocks", {})}},
        "items": {"zh_CN": base["Items"], "zh_TW": {**base["Items"], **traditional.get("Items", {})}},
        "categoryKeywords": keywords,
        "categoryOrder": list(CATEGORY_IDS.values()) + ["entity", OTHER],
        "ui": {locale: ui_strings(locale) for locale in ("zh_CN", "zh_TW", "en_US")},
    }
    os.makedirs(os.path.join(OUT, "data"), exist_ok=True)
    with open(os.path.join(OUT, "data", "gamedata.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"gamedata.json: {len(base['Blocks'])} 方块, {len(base['Items'])} 物品, "
          f"{len(keywords)} 个分类关键词, {len(data['ui']['zh_CN'])} 条界面文字")


def homepage_icons() -> set:
    """主页里出现的方块图：HTML 里的 assets/blocks/<名>.png，加 main.js 材料表演示数据的贴图名。"""
    names = set()
    with open(os.path.join(DOCS, "index.html"), encoding="utf-8") as f:
        names.update(re.findall(r"assets/blocks/([a-z0-9_]+)\.png", f.read()))
    with open(os.path.join(DOCS, "main.js"), encoding="utf-8") as f:
        names.update(re.findall(r'\["([a-z0-9_]+)", "', f.read()))
    return names


def write_homepage_icons() -> None:
    folder = os.path.join(DOCS, "assets", "blocks")
    os.makedirs(folder, exist_ok=True)
    wanted = homepage_icons()
    for name in sorted(wanted):
        atlas.texture_image(name).save(os.path.join(folder, f"{name}.png"))
    # 主页不再用的旧图顺手删掉，免得越积越多
    for file in os.listdir(folder):
        if file.endswith(".png") and file[:-4] not in wanted:
            os.remove(os.path.join(folder, file))
    print(f"docs/assets/blocks/: {len(wanted)} 张（{', '.join(sorted(wanted))}）")


def main() -> int:
    write_gamedata()
    print(f"icons.json: {atlas.write_icon_index()} 个图标")
    write_homepage_icons()
    return 0


if __name__ == "__main__":
    sys.exit(main())
