"""把 lang/source/*.json 编译成 gettext 用的 .po / .mo。

    python tools/lang_build.py

程序启动时也会自动编译（i18n.ensure_compiled），所以平时改完翻译直接重启就行；
这个脚本主要给打包流程用 —— 生成物不进版本库，CI 里要先跑一遍再 pyinstaller。
"""

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import i18n  # noqa: E402


def main() -> int:
    locales = i18n.available_locales()
    if not locales:
        print("lang/source/ 下没有语言文件")
        return 1
    for locale in locales:
        i18n.compile_locale(locale)
        target = os.path.join(i18n.LOCALE_DIR, locale, "LC_MESSAGES", f"{i18n.DOMAIN}.mo")
        print(f"{locale}: {os.path.getsize(target)} bytes -> {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
