"""生成查看器（viewer/）用的数据，桌面版和网站共用一份来源。

    python tools/build_web_data.py

做两件事：
  1. lang/setting.json（+ setting_zh_TW.json）+ lang/source/*.json
     → viewer/data/gamedata.json
     方块 / 物品中文名（简、繁）、分类关键词、界面文字（桌面版原有的指标名 / 分类 / 单位 /
     页签，加网页版自己的 web.* 键）。翻译只在 lang/source 里改一处。
  2. 重建 viewer/resource/icons.json（方块图标在图集里的位置，见 script/lv/atlas.py）

换 Minecraft 版本用 tools/update_jsassets.py，或者让程序开机自动更新。
网站（web 分支）里的查看器用 tools/sync_site.py 从这里同步过去。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import atlas  # noqa: E402
from lv.tools import CATEGORY_IDS, OTHER  # noqa: E402  分类 id 只在 Python 里定义一次

OUT = os.path.join(ROOT, "viewer")
# 网页版也用到的桌面版文字：导出 / 另存 / 快速替换的提示语，直接复用同一份翻译
UI_PREFIXES = ("ui.stat.", "cat.", "unit.", "ui.chart.", "litem.chart.", "tab.", "web.",
               "app.replace.", "app.save.", "row.replace", "litem.menuAnalysis.", "menu.version.")


def load(name: str) -> dict:
    path = os.path.join(ROOT, "lang", name)
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def ui_strings(locale: str) -> dict:
    with open(os.path.join(ROOT, "lang", "source", f"{locale}.json"), encoding="utf-8") as f:
        table = json.load(f)
    # 桌面版的字符串是 Python format 写法，{{ }} 是转义的花括号；网页只认 {} 占位，这里还原
    return {k: v.replace("{{", "{").replace("}}", "}") for k, v in table.items() if k.startswith(UI_PREFIXES)}


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
        # 五套配色，和桌面版「设置 → 主题色」同一份（lang/data.json 的 Color_map）
        "themes": load("data.json").get("Color_map", {}),
    }
    os.makedirs(os.path.join(OUT, "data"), exist_ok=True)
    with open(os.path.join(OUT, "data", "gamedata.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"gamedata.json: {len(base['Blocks'])} 方块, {len(base['Items'])} 物品, "
          f"{len(keywords)} 个分类关键词, {len(data['ui']['zh_CN'])} 条界面文字")


def main() -> int:
    write_gamedata()
    print(f"icons.json: {atlas.write_icon_index()} 个图标")
    return 0


if __name__ == "__main__":
    sys.exit(main())
