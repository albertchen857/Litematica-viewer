"""扫一遍代码里用到的翻译键，对照 lang/source/*.json 报告缺失和多余的。

    python tools/lang_check.py            只报告
    python tools/lang_build.py            重新编译 po/mo

加了新界面文字之后跑一下，就知道哪几条翻译还没补。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DIR = os.path.join(ROOT, "lang", "source")
CODE_DIR = os.path.join(ROOT, "script")

# 代码里很多地方是先把键放进元组/列表再统一 _(key)，光匹配 _("...") 会漏一大片，
# 所以直接找「长得像翻译键」的字符串字面量：已知命名空间开头 + 点分。
NAMESPACES = (
    "litem.", "ui.", "app.", "cat.", "con.", "menu.", "cube.", "render.", "setting.",
    "func.", "lang.", "thumb.", "side.", "tab.", "rule.", "row.",
)
KEY_PATTERN = re.compile(r'"([a-z][\w]*(?:\.[\w]+)+)"')
# "setting.json"、"log.txt" 这种文件名也长得像键，排掉
FILE_SUFFIXES = (".json", ".py", ".png", ".mo", ".po", ".ico", ".js", ".html", ".txt", ".csv")
# 用 f-string 拼出来的键（_(f"cat.{name}")），只能按前缀整片放行
DYNAMIC_PREFIXES = ("cat.", "ui.stat.type")


def used_keys() -> set:
    keys = set()
    for folder, _dirs, files in os.walk(CODE_DIR):
        if "__pycache__" in folder or "JSrender" in folder:
            continue
        for name in files:
            if not name.endswith(".py"):
                continue
            with open(os.path.join(folder, name), encoding="utf-8") as f:
                keys.update(
                    k
                    for k in KEY_PATTERN.findall(f.read())
                    if k.startswith(NAMESPACES) and not k.endswith(FILE_SUFFIXES)
                )
    return keys


def main() -> int:
    locales = sorted(n[:-5] for n in os.listdir(SOURCE_DIR) if n.endswith(".json"))
    tables = {}
    for locale in locales:
        with open(os.path.join(SOURCE_DIR, f"{locale}.json"), encoding="utf-8") as f:
            tables[locale] = json.load(f)

    code_keys = used_keys()
    base = set(tables[locales[0]])
    problems = 0

    for locale, table in tables.items():
        missing = sorted(code_keys - set(table))
        if missing:
            problems += len(missing)
            print(f"{locale} 缺少 {len(missing)} 条:")
            for key in missing:
                print(f"  {key}")

    for locale, table in tables.items():
        gap = sorted(base - set(table)) + sorted(set(table) - base)
        if gap:
            problems += len(gap)
            print(f"{locale} 与 {locales[0]} 键不一致: {gap}")

    unused = sorted(
        k for k in base
        if k not in code_keys and not k.startswith(DYNAMIC_PREFIXES) and k != "lang.name"
    )
    if unused:
        print(f"\n没被代码用到的 {len(unused)} 条（可能是拼出来的键，或者可以删）:")
        print("  " + ", ".join(unused))

    print(f"\n代码里用到 {len(code_keys)} 条，翻译表有 {len(base)} 条")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
