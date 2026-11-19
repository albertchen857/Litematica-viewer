"""老 .schematic（MCEdit / WorldEdit，1.12 及以前）：数字 ID → 现在的方块名，再按邻居补全存档里不存的状态。

和网页版 viewer/js/legacy.js 是同一套规则：
1.12 的存档只存 ID 和 0–15 的数值，楼梯拐角、栅栏 / 玻璃板 / 墙 / 红石线的连接、门上半截的朝向、
大箱子拼哪边，都是游戏按旁边的方块现算的。1.13 升级存档时（DataFixer）也是按邻居补的，这里照做一遍。

对照表 viewer/resource/legacy.json 由 tools/build_legacy.py 生成（源数据 PrismarineJS/minecraft-data，MIT）。
"""

import functools
import json

import numpy as np
import os
import re

from .config import res
from .model import Block

LEGACY_JSON = res("viewer", "resource", "legacy.json")
OPAQUE_JS = res("viewer", "resource", "opaque.js")


@functools.lru_cache(maxsize=1)
def _table() -> dict:
    with open(LEGACY_JSON, encoding="utf-8") as f:
        return json.load(f)


@functools.lru_cache(maxsize=1)
def opaque_blocks() -> frozenset:
    """opaque.js 里的 OPAQUE_BLOCKS：完整、不透明的方块（栅栏、玻璃板、墙会连上它）。"""
    try:
        text = open(OPAQUE_JS, encoding="utf-8").read()
        body = text[text.index("OPAQUE_BLOCKS"):]
        body = body[: body.index("]")]
        return frozenset(re.findall(r"'(minecraft:[a-z0-9_]+)'", body))
    except (OSError, ValueError):
        return frozenset()


def parse_state(text: str) -> Block:
    """"minecraft:oak_stairs[facing=east,half=bottom]" → Block"""
    text = str(text)
    if "[" not in text:
        return Block.make(text if ":" in text else f"minecraft:{text}")
    name, rest = text.split("[", 1)
    props = dict(p.split("=", 1) for p in rest.rstrip("]").split(",") if "=" in p)
    return Block.make(name if ":" in name else f"minecraft:{name}", {k.strip(): v.strip() for k, v in props.items()})


def legacy_block(block_id: int, data: int, unknown: set) -> Block:
    blocks = _table()["blocks"]
    hit = blocks.get(f"{block_id}:{data}") or blocks.get(f"{block_id}:0")
    if not hit:
        unknown.add(f"{block_id}:{data}")
        return Block.make("minecraft:air")
    return parse_state(hit)


def legacy_item(item_id, damage=0) -> str:
    if isinstance(item_id, str):
        return item_id if ":" in item_id else f"minecraft:{item_id}"
    items = _table()["items"]
    return items.get(f"{item_id}:{damage}") or items.get(f"{item_id}:0") or "minecraft:air"


# --------------------------------------------------------------------------- 按邻居补状态

DIRS = {"north": (0, 0, -1), "south": (0, 0, 1), "west": (-1, 0, 0), "east": (1, 0, 0)}
SIDES = tuple(DIRS)
CW = {"north": "east", "east": "south", "south": "west", "west": "north"}
CCW = {"north": "west", "west": "south", "south": "east", "east": "north"}
OPP = {"north": "south", "south": "north", "east": "west", "west": "east"}
DOUBLE_PLANTS = {f"minecraft:{n}" for n in ("sunflower", "lilac", "tall_grass", "large_fern", "rose_bush", "peony")}
REDSTONE_PARTS = re.compile(
    r"^minecraft:(redstone_torch|redstone_wall_torch|lever|redstone_block|comparator|observer|daylight_detector|target"
    r"|tripwire_hook|trapped_chest|lectern|detector_rail|redstone_wire)$|_button$|_pressure_plate$")


def _axis(d: str) -> str:
    return "z" if d in ("north", "south") else "x"


def _is(b, suffix):
    return b is not None and b.id.endswith(suffix)


def _stairs(b):
    return _is(b, "_stairs")


def _door(b):
    return _is(b, "_door")


def _fence(b):
    return _is(b, "_fence")


def _gate(b):
    return _is(b, "_fence_gate")


def _pane(b):
    return b is not None and (b.id.endswith("glass_pane") or b.id == "minecraft:iron_bars")


def _wall(b):
    return _is(b, "_wall")


def _wire(b):
    return b is not None and b.id == "minecraft:redstone_wire"


def _chest(b):
    return b is not None and b.id in ("minecraft:chest", "minecraft:trapped_chest")


def fix_neighbors(indices, palette: list, opaque=None) -> list:
    """按邻居补状态，原地改 indices（numpy (sx, sy, sz)），返回新的 palette。"""
    opaque = opaque_blocks() if opaque is None else opaque
    sx, sy, sz = indices.shape

    def at(x, y, z):
        if 0 <= x < sx and 0 <= y < sy and 0 <= z < sz:
            return palette[int(indices[x, y, z])]
        return None

    def solid(b):
        return b is not None and b.id in opaque

    changed = {}

    # 只看要补的那几种方块所在的格子（大结构几千万格，不能每格都走一遍 Python 循环）
    def needs(b):
        return _stairs(b) or _door(b) or _fence(b) or _pane(b) or _wall(b) or _wire(b) or             (b.id in DOUBLE_PLANTS and b.properties.get("half") == "upper")

    targets = [i for i, b in enumerate(palette) if not b.is_air and needs(b)]
    cells = np.argwhere(np.isin(indices, targets)) if targets else ()
    if True:
        for x, y, z in ((int(a), int(b_), int(c)) for a, b_, c in cells):
                b = palette[int(indices[x, y, z])]
                p = b.properties

                def near(d, dy=0):
                    dx, _, dz = DIRS[d]
                    return at(x + dx, y + dy, z + dz)

                def put(props, block_id=None):
                    changed[(x, y, z)] = Block.make(block_id or b.id, {**p, **props})

                if _stairs(b):
                    # 照原版 StairBlock.getStairsShape
                    f, h = p.get("facing"), p.get("half")
                    if f not in DIRS:
                        continue

                    def can_take(d):
                        n = near(d)
                        return not _stairs(n) or n.properties.get("facing") != f or n.properties.get("half") != h

                    shape = "straight"
                    front, back = near(f), near(OPP[f])
                    ff = front.properties.get("facing") if _stairs(front) else None
                    bf = back.properties.get("facing") if _stairs(back) else None
                    if ff in DIRS and front.properties.get("half") == h and _axis(ff) != _axis(f) and can_take(OPP[ff]):
                        shape = "outer_left" if ff == CCW[f] else "outer_right"
                    elif bf in DIRS and back.properties.get("half") == h and _axis(bf) != _axis(f) and can_take(bf):
                        shape = "inner_left" if bf == CCW[f] else "inner_right"
                    put({"shape": shape})
                elif _door(b):
                    if p.get("half") == "upper":
                        low = at(x, y - 1, z)
                        if _door(low):
                            lp = low.properties
                            put({"facing": lp.get("facing", p.get("facing")), "open": lp.get("open", p.get("open"))}, low.id)
                    else:
                        up = at(x, y + 1, z)
                        if _door(up):
                            upp = up.properties
                            put({"hinge": upp.get("hinge", p.get("hinge")), "powered": upp.get("powered", p.get("powered"))})
                elif b.id in DOUBLE_PLANTS and p.get("half") == "upper":
                    low = at(x, y - 1, z)
                    if low is not None and low.id in DOUBLE_PLANTS:
                        put({}, low.id)
                elif _fence(b):
                    nether = b.id == "minecraft:nether_brick_fence"
                    props = {}
                    for d in SIDES:
                        n = near(d)
                        on = (_fence(n) and (n.id == "minecraft:nether_brick_fence") == nether) \
                            or (_gate(n) and _axis(n.properties.get("facing", "north")) != _axis(d)) or solid(n)
                        props[d] = "true" if on else "false"
                    put(props)
                elif _pane(b):
                    put({d: "true" if (_pane(near(d)) or _wall(near(d)) or solid(near(d))) else "false" for d in SIDES})
                elif _wall(b):
                    on = {}
                    for d in SIDES:
                        n = near(d)
                        on[d] = _wall(n) or _pane(n) or (_gate(n) and _axis(n.properties.get("facing", "north")) != _axis(d)) or solid(n)
                    straight = (on["north"] and on["south"] and not on["east"] and not on["west"]) or \
                               (on["east"] and on["west"] and not on["north"] and not on["south"])
                    props = {"up": "false" if straight else "true"}
                    props.update({d: "low" if on[d] else "none" for d in SIDES})
                    put(props)
                elif _wire(b):
                    above = at(x, y + 1, z)
                    conn = {}
                    for d in SIDES:
                        n = near(d)
                        if _wire(n) or (n is not None and REDSTONE_PARTS.search(n.id)
                                        and not (n.id == "minecraft:observer" and n.properties.get("facing") != OPP[d])):
                            conn[d] = "side"
                        elif n is not None and n.id.endswith("repeater") and _axis(n.properties.get("facing", "north")) == _axis(d):
                            conn[d] = "side"
                        elif _wire(near(d, 1)) and solid(n) and not solid(above):
                            conn[d] = "up"
                        elif _wire(near(d, -1)) and not solid(n):
                            conn[d] = "side"
                        else:
                            conn[d] = "none"
                    on = [d for d in SIDES if conn[d] != "none"]
                    if not on:
                        conn = {d: "side" for d in SIDES}
                    elif len(on) == 1:
                        conn[OPP[on[0]]] = "side"
                    put(conn)

    def current(x, y, z):
        return changed.get((x, y, z)) or palette[int(indices[x, y, z])]

    # 大箱子：同朝向、并排的两个单箱子拼起来。type=left 的另一半在朝向的顺时针那边
    chests = [i for i, b in enumerate(palette) if _chest(b)]
    if True:
        for x, y, z in ((int(a), int(b_), int(c)) for a, b_, c in (np.argwhere(np.isin(indices, chests)) if chests else ())):
                b = current(x, y, z)
                if not _chest(b) or b.properties.get("type") != "single" or b.properties.get("facing") not in DIRS:
                    continue
                f = b.properties["facing"]
                dx, _, dz = DIRS[CW[f]]
                px, pz = x + dx, z + dz
                if not (0 <= px < sx and 0 <= pz < sz):
                    continue
                n = current(px, y, pz)
                if not _chest(n) or n.id != b.id or n.properties.get("facing") != f or n.properties.get("type") != "single":
                    continue
                changed[(x, y, z)] = Block.make(b.id, {**b.properties, "type": "left"})
                changed[(px, y, pz)] = Block.make(n.id, {**n.properties, "type": "right"})

    # 写回：同样的状态共用一个调色板条目
    palette = list(palette)
    index = {blk: i for i, blk in enumerate(palette)}
    for (x, y, z), blk in changed.items():
        i = index.get(blk)
        if i is None:
            i = index[blk] = len(palette)
            palette.append(blk)
        indices[x, y, z] = i
    return palette
