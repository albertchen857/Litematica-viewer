"""生成 viewer/resource/legacy.json：老 .schematic（MCEdit / WorldEdit 1.12 及以前）的数字 ID → 现在的方块名。

源数据是 PrismarineJS/minecraft-data 的 data/pc/common/legacy.json（MIT，见 NOTICE.md），
里面是 1.13 刚扁平化时的名字。这里再按之后版本的改名规则换成现在的名字，墙的连接属性换成 1.16 起的写法：

    python tools/build_legacy.py <下载的 legacy.json>

输出 {"blocks": {"id:data": "name[props]"}, "items": {"id:data": "name"}}，桌面版和网页版共用。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "viewer", "resource", "legacy.json")

# 1.13 之后改过名的（DataFixer 里的规则）
RENAME = {
    "minecraft:grass": "minecraft:short_grass",          # 1.20.3
    "minecraft:sign": "minecraft:oak_sign",              # 1.14
    "minecraft:wall_sign": "minecraft:oak_wall_sign",    # 1.14
    "minecraft:grass_path": "minecraft:dirt_path",       # 1.17
    "minecraft:stone_slab": "minecraft:smooth_stone_slab",  # 1.14：1.13 的「石台阶」就是现在的平滑石台阶
}
WALL_SIDES = ("north", "south", "east", "west")


def split(state: str):
    name, _, rest = state.partition("[")
    props = dict(p.split("=", 1) for p in rest.rstrip("]").split(",") if "=" in p) if rest else {}
    return name, props


def join(name: str, props: dict) -> str:
    return name + ("[" + ",".join(f"{k}={v}" for k, v in sorted(props.items())) + "]" if props else "")


def modern(state: str) -> str:
    name, props = split(state)
    name = RENAME.get(name, name)
    if name.endswith("_wall") and not name.endswith("_sign"):
        # 1.16 起墙的四个方向是 none / low / tall（1.13 是 true / false）
        for side in WALL_SIDES:
            if side in props:
                props[side] = "low" if props[side] == "true" else "none"
    return join(name, props)


def main(src: str) -> None:
    data = json.load(open(src, encoding="utf-8"))
    blocks = {k: modern(v) for k, v in data["blocks"].items()}
    items = {k: RENAME.get(v, v) for k, v in data.get("items", {}).items()}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"blocks": blocks, "items": items}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{OUT}: {len(blocks)} 种方块状态, {len(items)} 种物品")


if __name__ == "__main__":
    main(sys.argv[1])
