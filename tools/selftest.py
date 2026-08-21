"""不依赖界面的自检：三种格式互相读写 + 统计结果对不对得上。

    python tools/selftest.py [结构文件...]

默认跑 testdata/ 下的所有文件。改完 formats.py / analysis.py 后先跑这个，
比开界面点半天快。
"""

import os
import sys
import tempfile
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import analysis, formats, i18n  # noqa: E402

PASS, FAIL = "  ok  ", " FAIL "
_failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"[{PASS if ok else FAIL}] {label}{(' -> ' + detail) if detail else ''}")
    if not ok:
        _failures.append(label)


def counts_of(structure) -> dict:
    return analysis.analyse(structure).blocks


def roundtrip(structure, fmt: str, label: str) -> None:
    """存成 fmt 再读回来，比较方块种类和总数。"""
    suffix = {"litematic": ".litematic", "nbt": ".nbt", "mcstructure": ".mcstructure"}[fmt]
    handle, path = tempfile.mkstemp(suffix=suffix)
    os.close(handle)
    try:
        report = formats.save(structure, path, fmt)
        size = os.path.getsize(path)
        reloaded = formats.load(path)
        before, after = counts_of(structure), counts_of(reloaded)
        same_total = sum(before.values()) == sum(after.values())
        check(
            f"{label} -> {fmt}",
            same_total,
            f"{size} bytes, {sum(before.values())} vs {sum(after.values())} blocks"
            + (f", 待核对 {report.summary()}" if report else ""),
        )
        if not same_total:
            missing = {k: v for k, v in before.items() if after.get(k) != v}
            print("        差异:", dict(list(missing.items())[:6]))
    finally:
        os.unlink(path)


def main(paths) -> int:
    i18n.install("zh_CN")
    for path in paths:
        print(f"\n=== {os.path.basename(path)} ===")
        try:
            structure = formats.load(path)
        except Exception:
            check(f"读取 {os.path.basename(path)}", False)
            traceback.print_exc()
            continue
        result = analysis.analyse(structure)
        check(
            "读取",
            structure.total_blocks > 0,
            f"{structure.size} 体积{structure.volume} 方块{structure.total_blocks} "
            f"种类{len(result.blocks)} 区域{len(structure.regions)}",
        )
        declared = structure.meta.get("declared_blocks") or 0
        if declared and declared != structure.total_blocks:
            # 只是提示。有些投影的 Metadata.TotalBlocks 本身就是乱填的。
            print(f"[ 注意 ] 文件自称 {declared} 个方块，实际数出来 {structure.total_blocks} 个")
        for fmt in ("litematic", "nbt", "mcstructure"):
            roundtrip(structure, fmt, os.path.basename(path))

    print()
    if _failures:
        print(f"{len(_failures)} 项失败: {_failures}")
        return 1
    print("全部通过")
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        data_dir = os.path.join(ROOT, "testdata")
        args = [
            os.path.join(data_dir, n)
            for n in sorted(os.listdir(data_dir))
            if os.path.splitext(n)[1] in formats.EXTENSIONS
        ]
    sys.exit(main(args))
