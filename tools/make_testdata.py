"""生成几个带方块 / 容器物品 / 实体的测试投影，放进 testdata/。

    python tools/make_testdata.py

手头的真实投影不一定覆盖得到所有情况（比如酿造台、唱片机、命令方块、各种实体），
自己造几个可控的样本，改完 formats / analysis / 容器分析之后跑自检才有底。
生成的文件同时也顺带验证了写入端：能写出来、还能原样读回去。
"""

import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import formats, i18n  # noqa: E402
from lv.model import AIR, Block, Region, Structure  # noqa: E402

OUT_DIR = os.path.join(ROOT, "testdata")


def _item(item_id: str, count: int, slot: int) -> dict:
    """Java 1.20.5+ 的物品写法：小写 id / count。"""
    return {"id": item_id, "count": count, "Slot": slot}


def _entity(entity_id: str, position: tuple, extra: dict = None) -> dict:
    data = {"id": entity_id, "Pos": [float(v) for v in position]}
    data.update(extra or {})
    return {"id": entity_id, "nbt": data}


def _build(name: str, size: tuple, blocks: dict, block_entities: dict, entities: list,
           description: str = "") -> Structure:
    """blocks 是 {(x,y,z): Block}，其余直接透传。"""
    palette, lookup = [AIR], {AIR: 0}
    indices = np.zeros(size, dtype=np.int32)
    for position, block in blocks.items():
        if block not in lookup:
            lookup[block] = len(palette)
            palette.append(block)
        indices[position] = lookup[block]
    region = Region(name, indices, palette, (0, 0, 0), dict(block_entities), list(entities))
    return Structure(
        regions=[region], name=name, author="LitematicaViewer selftest",
        description=description, source_format=formats.LITEMATIC,
        meta={"lm_version": 6, "mc_version": 3953},
    )


def containers_sample() -> Structure:
    """各种容器各来一个，覆盖不同的槽位排布和特殊字段。"""
    blocks, block_entities = {}, {}

    def place(position, block_id, props=None, data=None):
        blocks[position] = Block.make(block_id, props or {})
        if data is not None:
            payload = {"id": block_id}
            payload.update(data)
            block_entities[position] = payload

    # 一圈石头当地板，顺便让表格里有个数量大的方块
    for x in range(8):
        for z in range(6):
            blocks[(x, 0, z)] = Block.make("minecraft:stone")

    place((1, 1, 1), "minecraft:chest", {"facing": "north", "type": "single"},
          {"Items": [_item("minecraft:diamond", 64, 0), _item("minecraft:iron_ingot", 32, 4),
                     _item("minecraft:redstone", 17, 26)]})
    place((3, 1, 1), "minecraft:barrel", {"facing": "up"},
          {"Items": [_item("minecraft:oak_log", 64, 0), _item("minecraft:oak_log", 64, 1)]})
    place((5, 1, 1), "minecraft:furnace", {"facing": "north", "lit": "false"},
          {"Items": [_item("minecraft:raw_iron", 8, 0), _item("minecraft:coal", 64, 1),
                     _item("minecraft:iron_ingot", 3, 2)]})
    place((1, 1, 3), "minecraft:hopper", {"facing": "down", "enabled": "true"},
          {"Items": [_item("minecraft:wheat", 12, 0), _item("minecraft:carrot", 5, 4)]})
    place((3, 1, 3), "minecraft:dispenser", {"facing": "north", "triggered": "false"},
          {"Items": [_item("minecraft:arrow", 64, 0), _item("minecraft:arrow", 64, 8)]})
    place((5, 1, 3), "minecraft:brewing_stand", {"has_bottle_0": "true"},
          {"Items": [_item("minecraft:potion", 1, 0), _item("minecraft:nether_wart", 9, 3)]})
    place((1, 1, 5), "minecraft:shulker_box", {"facing": "up"},
          {"Items": [_item("minecraft:emerald", 64, s) for s in (0, 9, 18, 26)]})
    place((3, 1, 5), "minecraft:crafter", {"orientation": "north_up", "crafting": "false"},
          {"Items": [_item("minecraft:stick", 1, s) for s in range(9)]})
    place((5, 1, 5), "minecraft:jukebox", {"has_record": "true"},
          {"RecordItem": _item("minecraft:music_disc_cat", 1, 0)})
    place((7, 1, 1), "minecraft:command_block", {"facing": "north", "conditional": "false"},
          {"Command": "/say hello from LitematicaViewer"})
    place((7, 1, 3), "minecraft:chiseled_bookshelf", {"facing": "north"},
          {"Items": [_item("minecraft:book", 1, 0), _item("minecraft:book", 1, 4)]})
    place((7, 1, 5), "minecraft:beacon", None,
          {"primary_effect": "minecraft:haste", "Levels": 4})

    return _build("containers", (8, 2, 6), blocks, block_entities, [],
                  description="每种容器各一个，用来测容器分析器")


def entities_sample() -> Structure:
    """矿车 / 怪物 / 动物 / 掉落物都来一点。"""
    blocks = {}
    for x in range(10):
        blocks[(x, 0, 2)] = Block.make("minecraft:rail", {"shape": "east_west"})
        blocks[(x, 0, 1)] = Block.make("minecraft:grass_block", {"snowy": "false"})
        blocks[(x, 0, 3)] = Block.make("minecraft:oak_planks")

    entities = [
        _entity("minecraft:minecart", (1.5, 1.0, 2.5)),
        _entity("minecraft:chest_minecart", (3.5, 1.0, 2.5),
                {"Items": [_item("minecraft:gold_ingot", 16, 0)]}),
        _entity("minecraft:hopper_minecart", (5.5, 1.0, 2.5)),
        _entity("minecraft:villager", (2.5, 1.0, 1.5), {"VillagerData": {"profession": "farmer"}}),
        _entity("minecraft:villager", (4.5, 1.0, 1.5), {"VillagerData": {"profession": "librarian"}}),
        _entity("minecraft:zombie", (6.5, 1.0, 1.5)),
        _entity("minecraft:creeper", (7.5, 1.0, 1.5)),
        _entity("minecraft:cow", (2.5, 1.0, 3.5)),
        _entity("minecraft:cow", (3.5, 1.0, 3.5)),
        _entity("minecraft:sheep", (4.5, 1.0, 3.5), {"Color": 4}),
        _entity("minecraft:chicken", (5.5, 1.0, 3.5)),
        _entity("minecraft:armor_stand", (8.5, 1.0, 1.5)),
        _entity("minecraft:item_frame", (9.5, 1.0, 3.5),
                {"Item": _item("minecraft:diamond_sword", 1, 0)}),
    ]
    return _build("entities", (10, 2, 5), blocks, {}, entities,
                  description="矿车 / 怪物 / 动物 / 展示框，用来测实体统计")


def blocks_sample() -> Structure:
    """带属性的方块：含水、双层台阶、门的上下半、海龟蛋、重生锚这些折算规则。"""
    blocks = {}
    rows = [
        ("minecraft:oak_stairs", {"facing": "north", "half": "bottom", "waterlogged": "true"}),
        ("minecraft:oak_stairs", {"facing": "south", "half": "top", "waterlogged": "false"}),
        ("minecraft:stone_slab", {"type": "double", "waterlogged": "false"}),
        ("minecraft:stone_slab", {"type": "top", "waterlogged": "true"}),
        ("minecraft:turtle_egg", {"eggs": "3", "hatch": "0"}),
        ("minecraft:sea_pickle", {"pickles": "4", "waterlogged": "true"}),
        ("minecraft:respawn_anchor", {"charges": "3"}),
        ("minecraft:pink_petals", {"flower_amount": "4", "facing": "north"}),
        ("minecraft:candle", {"candles": "3", "lit": "true", "waterlogged": "false"}),
        ("minecraft:potted_cactus", {}),
        ("minecraft:water_cauldron", {"level": "3"}),
        ("minecraft:wall_torch", {"facing": "east"}),
        ("minecraft:farmland", {"moisture": "7"}),
        ("minecraft:redstone_wire", {"power": "15", "north": "side", "south": "side"}),
        ("minecraft:piston", {"facing": "up", "extended": "true"}),
        ("minecraft:piston_head", {"facing": "up", "type": "normal", "short": "false"}),
    ]
    for index, (block_id, props) in enumerate(rows):
        blocks[(index % 4, 1 + index // 4, 0)] = Block.make(block_id, props)

    # 门占两格，上下半要分别统计
    blocks[(0, 0, 2)] = Block.make("minecraft:oak_door", {"half": "lower", "facing": "north", "hinge": "left"})
    blocks[(0, 1, 2)] = Block.make("minecraft:oak_door", {"half": "upper", "facing": "north", "hinge": "left"})
    blocks[(2, 0, 2)] = Block.make("minecraft:tall_grass", {"half": "lower"})
    blocks[(2, 1, 2)] = Block.make("minecraft:tall_grass", {"half": "upper"})
    for x in range(4):
        blocks[(x, 0, 3)] = Block.make("minecraft:water", {"level": "0"})

    return _build("blocks", (4, 5, 4), blocks, {}, [],
                  description="带属性的方块，用来测材料折算规则")


SAMPLES = {
    "sample_blocks": blocks_sample,
    "sample_containers": containers_sample,
    "sample_entities": entities_sample,
}


def main() -> int:
    i18n.install("zh_CN")
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, make in SAMPLES.items():
        structure = make()
        for fmt, extension in (("litematic", ".litematic"), ("nbt", ".nbt"),
                               ("mcstructure", ".mcstructure")):
            path = os.path.join(OUT_DIR, name + extension)
            formats.save(structure, path, fmt)
        print(f"{name}: {structure.size} 体积{structure.volume} 方块{structure.total_blocks} "
              f"方块实体{len(structure.regions[0].block_entities)} 实体{len(structure.regions[0].entities)}")
    print(f"\n已写入 {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
