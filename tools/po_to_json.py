"""一次性迁移脚本：把旧的 lang/<locale>.po 转成新的 lang/source/<locale>.json。

新增翻译请直接编辑 lang/source/*.json，之后由 script/lv/i18n.py 自动编译成 po/mo。
本脚本保留下来只为了将来还有旧 po 要导入时能再用一次。

    python tools/po_to_json.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ESCAPES = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}


def unescape(text: str) -> str:
    out, i = [], 0
    while i < len(text):
        if text[i] == "\\" and i + 1 < len(text):
            out.append(ESCAPES.get(text[i + 1], text[i + 1]))
            i += 2
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def parse_po(path: str) -> dict:
    messages, key, value, mode = {}, None, "", None
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            line = raw.rstrip("\n")
            match = re.match(r'^msgid\s+"(.*)"$', line)
            if match:
                if key:
                    messages[key] = value
                key, value, mode = unescape(match.group(1)), "", "id"
                continue
            match = re.match(r'^msgstr\s+"(.*)"$', line)
            if match:
                value, mode = unescape(match.group(1)), "str"
                continue
            match = re.match(r'^"(.*)"$', line)
            if match:
                if mode == "str":
                    value += unescape(match.group(1))
                else:
                    key += unescape(match.group(1))
    if key:
        messages[key] = value
    return messages


def main() -> int:
    names = {"zh_CN": "简体中文", "en_US": "English"}
    out_dir = os.path.join(ROOT, "lang", "source")
    os.makedirs(out_dir, exist_ok=True)
    for locale, label in names.items():
        po = os.path.join(ROOT, "lang", f"{locale}.po")
        if not os.path.exists(po):
            print(f"跳过 {locale}: 找不到 {po}")
            continue
        messages = parse_po(po)
        messages.pop("", None)
        messages["lang.name"] = label
        target = os.path.join(out_dir, f"{locale}.json")
        with open(target, "w", encoding="utf-8") as handle:
            json.dump(dict(sorted(messages.items())), handle, ensure_ascii=False, indent=2)
        print(f"{locale}: {len(messages)} 条 -> {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
