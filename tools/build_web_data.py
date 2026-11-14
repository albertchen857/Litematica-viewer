"""把桌面版的游戏数据同步给网页版（docs/viewer/）。

    python tools/build_web_data.py

做两件事：
  1. lang/setting.json（+ setting_zh_TW.json）→ docs/viewer/data/gamedata.json
     方块 / 物品的中文名（简、繁）和分类关键词，网页版的材料表、饼图分类全靠它。
  2. script/JSrender/resource/ 的贴图图集三件套 → docs/viewer/resource/
     和桌面版「手动3D渲染」用的是同一份，换 Minecraft 版本后重跑一次即可。

两边共用一份数据，网页版和桌面版的中文名、分类就不会对不上。
"""

import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv.tools import CATEGORY_IDS, OTHER  # noqa: E402  分类 id 只在 Python 里定义一次

OUT = os.path.join(ROOT, "docs", "viewer")
RESOURCES = ("atlas.png", "assets.js", "opaque.js", "version.json")


def load(name: str) -> dict:
    path = os.path.join(ROOT, "lang", name)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


UI_PREFIXES = ("ui.stat.", "cat.", "unit.", "ui.chart.", "litem.chart.", "tab.")


def ui_strings(locale: str) -> dict:
    with open(os.path.join(ROOT, "lang", "source", f"{locale}.json"), encoding="utf-8") as f:
        table = json.load(f)
    return {k: v for k, v in table.items() if k.startswith(UI_PREFIXES)}


def main() -> int:
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
        # 界面上和桌面版重合的那部分文字（指标名、分类名、单位、页签），三种语言直接用桌面版的翻译
        "ui": {locale: ui_strings(locale) for locale in ("zh_CN", "zh_TW", "en_US")},
    }
    os.makedirs(os.path.join(OUT, "data"), exist_ok=True)
    target = os.path.join(OUT, "data", "gamedata.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"gamedata.json: {len(base['Blocks'])} 方块, {len(base['Items'])} 物品, {len(keywords)} 个分类关键词")

    os.makedirs(os.path.join(OUT, "resource"), exist_ok=True)
    for name in RESOURCES:
        shutil.copy2(os.path.join(ROOT, "script", "JSrender", "resource", name), os.path.join(OUT, "resource", name))
    print("resource/: " + ", ".join(RESOURCES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
