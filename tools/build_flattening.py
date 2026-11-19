"""生成 viewer/resource/flattening.json：1.12（扁平化之前）的方块写法，按「数字 ID:数值」排。

1.12 的 .litematic 存的是扁平化之前的方块状态（红色羊毛是 minecraft:wool[color=red]，1.13 起才叫 red_wool）。
读的时候：1.12 写法 → 数字 ID:数值 → 现在的写法（legacy.json）；写成 1.12 时反过来。

方块名来自 minecraft-data 的 1.12 blocks.json（MIT）；属性是按 1.12 各方块「元数据 → 状态」的规则自己写的（下面 props()）。
可以拿一份 1.12 方块状态清单（每行 "$ minecraft:名字[属性] => …"）核对，只在本地用：

    python tools/build_flattening.py <minecraft-data 1.12 blocks.json> <legacy.json（原始）> [核对用清单]
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "viewer", "resource", "flattening.json")

COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
          "silver", "cyan", "purple", "blue", "brown", "green", "red", "black"]
WOOD = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"]
FRONT = ["down", "up", "north", "south", "west", "east"]       # EnumFacing.getFront(i)
HORIZ = ["south", "west", "north", "east"]                      # EnumFacing.getHorizontal(i)
BOOL = lambda b: "true" if b else "false"


def front_h(m):
    """getFront，竖直方向退回 north（箱子、熔炉、梯子、墙上的告示牌 / 旗帜）"""
    f = FRONT[m % 6] if m < 6 else "north"
    return "north" if f in ("down", "up") else f


def stairs(m):
    return {"facing": ["east", "west", "south", "north"][m & 3], "half": "top" if m & 4 else "bottom"}


def door(m):
    if m & 8:
        return {"half": "upper", "hinge": "right" if m & 1 else "left", "powered": BOOL(m & 2)}
    return {"half": "lower", "facing": ["east", "south", "west", "north"][m & 3], "open": BOOL(m & 4)}


def trapdoor(m):
    return {"facing": ["north", "south", "west", "east"][m & 3], "open": BOOL(m & 4), "half": "top" if m & 8 else "bottom"}


def gate(m):
    return {"facing": HORIZ[m & 3], "open": BOOL(m & 4), "powered": BOOL(m & 8)}


def button(m):
    return {"facing": ["down", "east", "west", "south", "north", "up"][m & 7] if (m & 7) < 6 else "down", "powered": BOOL(m & 8)}


def torch(m):
    return {"facing": {1: "east", 2: "west", 3: "south", 4: "north", 5: "up"}.get(m, "up")}


def pillar(m):
    return {"axis": ["y", "x", "z", "none"][(m >> 2) & 3]}


def rail_powered(m):
    return {"shape": ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south"][m & 7] if (m & 7) < 6 else "north_south",
            "powered": BOOL(m & 8)}


def leaves(variants, m):
    return {"variant": variants[m & 3] if (m & 3) < len(variants) else variants[0], "decayable": BOOL(not m & 4), "check_decay": BOOL(m & 8)}


def directional(m):        # 发射器、活塞、侦测器、末地烛、命令方块、潜影盒……
    return {"facing": FRONT[m & 7] if (m & 7) < 6 else "down"}


SIMPLE_AGE = {"wheat", "carrots", "potatoes", "beetroots", "nether_wart", "reeds", "cactus", "fire", "chorus_flower",
              "frosted_ice", "pumpkin_stem", "melon_stem"}
COLORED = {"wool", "stained_glass", "stained_hardened_clay", "stained_glass_pane", "carpet", "concrete", "concrete_powder"}
STAIRS = {"oak_stairs", "stone_stairs", "brick_stairs", "stone_brick_stairs", "nether_brick_stairs", "sandstone_stairs",
          "spruce_stairs", "birch_stairs", "jungle_stairs", "quartz_stairs", "acacia_stairs", "dark_oak_stairs",
          "red_sandstone_stairs", "purpur_stairs"}
DOORS = {"wooden_door", "iron_door", "spruce_door", "birch_door", "jungle_door", "acacia_door", "dark_oak_door"}
GATES = {"fence_gate", "spruce_fence_gate", "birch_fence_gate", "jungle_fence_gate", "acacia_fence_gate", "dark_oak_fence_gate"}
DIRECTIONAL = {"dispenser", "dropper", "observer", "end_rod", "command_block", "repeating_command_block", "chain_command_block"} | \
              {f"{c}_shulker_box" for c in COLORS}
GLAZED = {f"{c}_glazed_terracotta" for c in COLORS}
SLAB_STONE = ["stone", "sandstone", "wood_old", "cobblestone", "brick", "stone_brick", "nether_brick", "quartz"]  # 1.12 的叫法


def props(name, m):
    """1.12 方块 name 的元数据 m → 状态属性（只写由元数据决定的那些；连接、拐角这类「现算」的不写）。"""
    if name == "stone":
        return {"variant": ["stone", "granite", "smooth_granite", "diorite", "smooth_diorite", "andesite", "smooth_andesite"][m]}
    if name == "dirt":
        return {"variant": ["dirt", "coarse_dirt", "podzol"][m]}
    if name in ("planks", "double_wooden_slab"):
        return {"variant": WOOD[m & 7]}
    if name == "wooden_slab":
        return {"variant": WOOD[m & 7], "half": "top" if m & 8 else "bottom"}
    if name == "sapling":
        return {"type": WOOD[m & 7], "stage": str(m >> 3)}
    if name in ("water", "flowing_water", "lava", "flowing_lava"):
        return {"level": str(m)}
    if name == "sand":
        return {"variant": ["sand", "red_sand"][m]}
    if name == "log":
        return {"variant": ["oak", "spruce", "birch", "jungle"][m & 3], **pillar(m)}
    if name == "log2":
        return {"variant": ["acacia", "dark_oak"][m & 1], **pillar(m)}
    if name == "leaves":
        return leaves(["oak", "spruce", "birch", "jungle"], m)
    if name == "leaves2":
        return leaves(["acacia", "dark_oak"], m)
    if name == "sponge":
        return {"wet": BOOL(m == 1)}
    if name in ("sandstone", "red_sandstone"):
        p = "" if name == "sandstone" else "red_"
        return {"type": [f"{p}sandstone", f"chiseled_{p}sandstone", f"smooth_{p}sandstone"][m]}
    if name == "bed":
        return {"facing": HORIZ[m & 3], "occupied": BOOL(m & 4), "part": "head" if m & 8 else "foot"}
    if name in ("golden_rail", "detector_rail", "activator_rail"):
        return rail_powered(m)
    if name == "rail":
        return {"shape": ["north_south", "east_west", "ascending_east", "ascending_west", "ascending_north", "ascending_south",
                          "south_east", "south_west", "north_west", "north_east"][m]}
    if name in ("piston", "sticky_piston"):
        return {**directional(m), "extended": BOOL(m & 8)}
    if name in ("piston_head", "piston_extension"):
        return {**directional(m), "type": "sticky" if m & 8 else "normal"}
    if name == "tallgrass":
        return {"type": ["dead_bush", "tall_grass", "fern"][m]}
    if name in COLORED:
        return {"color": COLORS[m]}
    if name == "yellow_flower":
        return {"type": "dandelion"}
    if name == "red_flower":
        return {"type": ["poppy", "blue_orchid", "allium", "houstonia", "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy"][m]}
    if name == "double_stone_slab":
        return {"variant": SLAB_STONE[m & 7], "seamless": BOOL(m & 8)}
    if name == "stone_slab":
        return {"variant": SLAB_STONE[m & 7], "half": "top" if m & 8 else "bottom"}
    if name == "double_stone_slab2":
        return {"variant": "red_sandstone", "seamless": BOOL(m & 8)}
    if name == "stone_slab2":
        return {"variant": "red_sandstone", "half": "top" if m & 8 else "bottom"}
    if name == "purpur_double_slab":
        return {"variant": "default"}
    if name == "purpur_slab":
        return {"variant": "default", "half": "top" if m & 8 else "bottom"}
    if name == "tnt":
        return {"explode": BOOL(m & 1)}
    if name in ("torch", "redstone_torch", "unlit_redstone_torch"):
        return torch(m)
    if name in SIMPLE_AGE:
        return {"age": str(m)}
    if name in STAIRS:
        return stairs(m)
    if name in ("chest", "trapped_chest", "furnace", "lit_furnace", "ladder", "wall_sign", "ender_chest", "wall_banner"):
        return {"facing": front_h(m)}
    if name == "redstone_wire":
        return {"power": str(m)}
    if name == "farmland":
        return {"moisture": str(m)}
    if name in ("standing_sign", "standing_banner"):
        return {"rotation": str(m)}
    if name in DOORS:
        return door(m)
    if name == "lever":
        return {"facing": ["down_x", "east", "west", "south", "north", "up_z", "up_x", "down_z"][m & 7], "powered": BOOL(m & 8)}
    if name in ("stone_pressure_plate", "wooden_pressure_plate"):
        return {"powered": BOOL(m & 1)}
    if name in ("light_weighted_pressure_plate", "heavy_weighted_pressure_plate", "daylight_detector", "daylight_detector_inverted"):
        return {"power": str(m)}
    if name in ("stone_button", "wooden_button"):
        return button(m)
    if name == "snow_layer":
        return {"layers": str((m & 7) + 1)}
    if name == "jukebox":
        return {"has_record": BOOL(m & 1)}
    if name in ("pumpkin", "lit_pumpkin"):
        return {"facing": HORIZ[m & 3]}
    if name == "portal":
        return {"axis": "z" if (m & 3) == 2 else "x"}
    if name == "cake":
        return {"bites": str(m)}
    if name in ("unpowered_repeater", "powered_repeater"):
        return {"facing": HORIZ[m & 3], "delay": str((m >> 2) + 1)}
    if name in ("trapdoor", "iron_trapdoor"):
        return trapdoor(m)
    if name == "monster_egg":
        return {"variant": ["stone", "cobblestone", "stone_brick", "mossy_brick", "cracked_brick", "chiseled_brick"][m]}
    if name == "stonebrick":
        return {"variant": ["stonebrick", "mossy_stonebrick", "cracked_stonebrick", "chiseled_stonebrick"][m]}
    if name in ("brown_mushroom_block", "red_mushroom_block"):
        return {"variant": {0: "all_inside", 1: "north_west", 2: "north", 3: "north_east", 4: "west", 5: "center", 6: "east",
                            7: "south_west", 8: "south", 9: "south_east", 10: "stem", 14: "all_outside", 15: "all_stem"}.get(m, "all_inside")}
    if name == "vine":
        return {"south": BOOL(m & 1), "west": BOOL(m & 2), "north": BOOL(m & 4), "east": BOOL(m & 8)}
    if name in GATES:
        return gate(m)
    if name == "brewing_stand":
        return {"has_bottle_0": BOOL(m & 1), "has_bottle_1": BOOL(m & 2), "has_bottle_2": BOOL(m & 4)}
    if name == "cauldron":
        return {"level": str(m)}
    if name == "end_portal_frame":
        return {"facing": HORIZ[m & 3], "eye": BOOL(m & 4)}
    if name == "cocoa":
        return {"facing": HORIZ[m & 3], "age": str(m >> 2)}
    if name == "tripwire_hook":
        return {"facing": HORIZ[m & 3], "attached": BOOL(m & 4), "powered": BOOL(m & 8)}
    if name == "tripwire":
        return {"powered": BOOL(m & 1), "attached": BOOL(m & 4), "disarmed": BOOL(m & 8)}
    if name in ("command_block", "repeating_command_block", "chain_command_block"):
        return {**directional(m), "conditional": BOOL(m & 8)}
    if name == "observer":
        return {**directional(m), "powered": BOOL(m & 8)}
    if name in DIRECTIONAL:
        return directional(m)
    if name in ("dispenser", "dropper"):
        return {**directional(m), "triggered": BOOL(m & 8)}
    if name == "cobblestone_wall":
        return {"variant": ["cobblestone", "mossy_cobblestone"][m]}
    if name == "flower_pot":
        return {"legacy_data": str(m)}
    if name == "skull":
        return {"facing": FRONT[m & 7] if (m & 7) < 6 else "down", "nodrop": BOOL(m & 8)}
    if name == "anvil":
        return {"facing": HORIZ[m & 3], "damage": str(m >> 2)}
    if name in ("unpowered_comparator", "powered_comparator"):
        return {"facing": HORIZ[m & 3], "mode": "subtract" if m & 4 else "compare", "powered": BOOL(m & 8)}
    if name == "hopper":
        f = FRONT[m & 7] if (m & 7) < 6 else "down"
        return {"facing": "down" if f == "up" else f, "enabled": BOOL(not m & 8)}
    if name == "quartz_block":
        # 6 / 10 是放置时的重复数值，等于 3 / 4（横着的石英柱）
        return {"variant": {0: "default", 1: "chiseled", 2: "lines_y", 3: "lines_x", 4: "lines_z", 6: "lines_x", 10: "lines_z"}[m]}
    if name == "prismarine":
        return {"variant": ["prismarine", "prismarine_bricks", "dark_prismarine"][m]}
    if name in ("hay_block", "bone_block", "purpur_pillar"):
        return {"axis": ["y", "x", "z"][(m >> 2) % 3]}
    if name == "double_plant":
        if m & 8:
            return {"half": "upper"}
        return {"half": "lower", "variant": ["sunflower", "syringa", "double_grass", "double_fern", "double_rose", "paeonia"][m & 7]}
    if name in GLAZED:
        return {"facing": HORIZ[m & 3]}
    if name == "structure_block":
        return {"mode": ["save", "load", "corner", "data"][m]}
    return {}


def main(blocks112, legacy_path, check=None):
    names = {b["id"]: b["name"] for b in json.load(open(blocks112, encoding="utf-8"))}
    legacy = json.load(open(legacy_path, encoding="utf-8"))["blocks"]
    to112, bad = {}, []
    for key in legacy:
        bid, meta = map(int, key.split(":"))
        name = names.get(bid)
        if not name:
            bad.append(key)
            continue
        try:
            p = props(name, meta)
        except (IndexError, KeyError):
            bad.append(key)
            continue
        state = f"minecraft:{name}" + ("[" + ",".join(f"{k}={v}" for k, v in sorted(p.items())) + "]" if p else "")
        to112[key] = state
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"to112": to112}, f, separators=(",", ":"))
    print(f"{OUT}: {len(to112)} 条；没法生成 {len(bad)} 条：{bad[:20]}")
    if check:
        verify(to112, check)


def verify(to112, path):
    """拿 1.12 状态清单核对：我写的每一条（名字 + 属性）在清单里都要找得到一个对得上的状态。"""
    listed = {}
    for line in open(path, encoding="utf-8"):
        if not line.startswith("$ "):
            continue
        left = line[2:].split(" => ")[0].strip()
        name, _, rest = left.partition("[")
        p = dict(x.split("=", 1) for x in rest.rstrip("]").split(",") if "=" in x)
        listed.setdefault(name, []).append(p)
    missing_name, wrong = [], []
    for key, state in to112.items():
        name, _, rest = state.partition("[")
        mine = dict(x.split("=", 1) for x in rest.rstrip("]").split(",") if "=" in x)
        if name not in listed:
            missing_name.append(state)   # 清单里没有这个名字（没有方块状态文件的简单方块，正常）
            continue
        if not any(all(cand.get(k) == v for k, v in mine.items()) for cand in listed[name]):
            wrong.append(f"{key} → {state}")
    print(f"核对：{len(to112) - len(missing_name)} 条有对照；对不上 {len(wrong)} 条")
    for w in wrong[:60]:
        print("  ", w)
    print(f"清单里没有的名字（应该都是没有属性的简单方块）：{sorted({s.split('[')[0] for s in missing_name if '[' in s})}")


if __name__ == "__main__":
    main(*sys.argv[1:])
