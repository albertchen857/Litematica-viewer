"""语言系统。

数据源只有一个：``lang/source/<locale>.json``，一个扁平的 {键: 译文} 字典。
其余文件全部由本模块自动生成，不要手改::

    lang/source/zh_CN.json                          <- 只编辑这个
    lang/zh_CN/LC_MESSAGES/litematicaviewer.po      <- 生成，给 Poedit 之类的工具看
    lang/zh_CN/LC_MESSAGES/litematicaviewer.mo      <- 生成，gettext 运行时真正读的

旧版本的问题是把 mo 直接放在 ``lang/en_US.mo``，而 gettext 只会去
``<localedir>/<语言>/LC_MESSAGES/<域>.mo`` 找，所以永远匹配不上、永远 fallback，
界面上显示的就是 "litem.title" 这种原始键名。这里按标准目录布局生成，并且在
JSON 比 mo 新时自动重新编译，改完翻译重启程序即可生效。
"""

import array
import gettext
import json
import os
import struct

from .config import res

DOMAIN = "litematicaviewer"
SOURCE_DIR = res("lang", "source")
LOCALE_DIR = res("lang")
FALLBACK_LOCALE = "en_US"

_translate = None  # 当前 gettext 实例的 gettext 方法
_current = None


# --------------------------------------------------------------------------- 编译

def _mo_bytes(messages: dict) -> bytes:
    """把 {msgid: msgstr} 打包成 .mo 二进制（GNU gettext 格式）。

    比调用外部 msgfmt 可靠：用户机器上不一定装了 gettext 工具链。
    """
    items = sorted((k.encode("utf-8"), v.encode("utf-8")) for k, v in messages.items())
    key_start = 7 * 4 + 16 * len(items)
    value_start = key_start + sum(len(k) + 1 for k, _ in items)

    key_table, value_table = [], []
    ids, strs = bytearray(), bytearray()
    for key, value in items:
        key_table += [len(key), key_start + len(ids)]
        value_table += [len(value), value_start + len(strs)]
        ids += key + b"\x00"
        strs += value + b"\x00"

    header = struct.pack(
        "<7I", 0x950412DE, 0, len(items), 7 * 4, 7 * 4 + len(items) * 8, 0, 0
    )
    table = array.array("i", key_table + value_table)
    if array.array("i").itemsize != 4:  # 理论上不会发生，保险
        raise RuntimeError("平台 int 不是 4 字节，无法生成 .mo")
    return header + table.tobytes() + bytes(ids) + bytes(strs)


def _po_text(locale: str, messages: dict) -> str:
    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")

    lines = [f'msgid ""\nmsgstr "{escape(messages[""])}"\n']
    for key in sorted(k for k in messages if k):
        lines.append(f'msgid "{escape(key)}"\nmsgstr "{escape(messages[key])}"\n')
    return "\n".join(lines)


def _read_source(locale: str) -> dict:
    with open(os.path.join(SOURCE_DIR, f"{locale}.json"), encoding="utf-8") as f:
        messages = json.load(f)
    # msgid "" 是 gettext 的元数据条目，charset 必须写对，否则译文按 ASCII 解码。
    messages[""] = (
        f"Project-Id-Version: LitematicaViewer\n"
        f"Content-Type: text/plain; charset=UTF-8\n"
        f"Content-Transfer-Encoding: 8bit\n"
        f"Language: {locale}\n"
    )
    return messages


def compile_locale(locale: str) -> None:
    """把一个语言的 JSON 编译成 .po + .mo。"""
    messages = _read_source(locale)
    out_dir = os.path.join(LOCALE_DIR, locale, "LC_MESSAGES")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{DOMAIN}.po"), "w", encoding="utf-8") as f:
        f.write(_po_text(locale, messages))
    with open(os.path.join(out_dir, f"{DOMAIN}.mo"), "wb") as f:
        f.write(_mo_bytes(messages))


def available_locales() -> list:
    if not os.path.isdir(SOURCE_DIR):
        return [FALLBACK_LOCALE]
    return sorted(n[:-5] for n in os.listdir(SOURCE_DIR) if n.endswith(".json"))


def display_name(locale: str) -> str:
    """语言菜单里显示的名字，取自 JSON 里的 ``lang.name`` 键。"""
    try:
        with open(os.path.join(SOURCE_DIR, f"{locale}.json"), encoding="utf-8") as f:
            return json.load(f).get("lang.name", locale)
    except Exception:
        return locale


def ensure_compiled(locale: str) -> None:
    """JSON 比 mo 新（或 mo 不存在）就重新编译一次。"""
    source = os.path.join(SOURCE_DIR, f"{locale}.json")
    if not os.path.exists(source):
        return
    mo = os.path.join(LOCALE_DIR, locale, "LC_MESSAGES", f"{DOMAIN}.mo")
    if os.path.exists(mo) and os.path.getmtime(mo) >= os.path.getmtime(source):
        return
    try:
        compile_locale(locale)
        print(f"[i18n] 已编译语言 {locale}")
    except OSError as exc:  # 打包后目录只读，用已有的 mo 就行
        print(f"[i18n] 无法编译 {locale}: {exc}")


# --------------------------------------------------------------------------- 运行时

def install(locale: str = None) -> str:
    """加载语言。缺某个键时退回英文，英文也没有就原样返回键名。"""
    global _translate, _current
    from . import config

    locale = locale or config.language()
    if locale not in available_locales():
        locale = FALLBACK_LOCALE

    for name in {locale, FALLBACK_LOCALE}:
        ensure_compiled(name)

    translation = gettext.translation(DOMAIN, LOCALE_DIR, languages=[locale], fallback=True)
    if locale != FALLBACK_LOCALE:
        translation.add_fallback(
            gettext.translation(DOMAIN, LOCALE_DIR, languages=[FALLBACK_LOCALE], fallback=True)
        )
    _translate = translation.gettext
    _current = locale
    return locale


def current() -> str:
    return _current or FALLBACK_LOCALE


def is_chinese() -> bool:
    """中文界面下才显示「中文名 + 英文 ID」双列、以及「箱/盒/组」单位。"""
    return current().startswith("zh")


def _(key: str, *args, **kwargs) -> str:
    """取译文。可直接带参数：``_("litem.procbar.1", 3, 10, 5)``。

    格式化失败时返回未格式化的译文，绝不因为一条翻译写错就让整个界面崩掉。
    """
    if _translate is None:
        install()
    text = _translate(key)
    if args or kwargs:
        try:
            return text.format(*args, **kwargs)
        except (IndexError, KeyError, ValueError):
            print(f"[i18n] 占位符不匹配: {key}")
    return text
