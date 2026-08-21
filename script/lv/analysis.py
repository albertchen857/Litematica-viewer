"""统计分析：材料清单、分类、密度、红石占比、容器内容。

关键改动：统计不再逐个方块 for 循环，而是先用 numpy 数出「每个调色板条目出现几次」，
再按调色板条目（通常几十到几百个）折算材料。几十万方块的投影从几十秒变成一瞬间。
"""

from dataclasses import dataclass, field

from .i18n import _
from .model import Structure
from .tools import ENTITY, OTHER, category_of

ENTITY_PREFIX = "entity:"

# 拿不到实体方块 / 不该计入材料的
NOT_OBTAINABLE = {
    "minecraft:piston_head",
    "minecraft:moving_piston",
    "minecraft:nether_portal",
    "minecraft:bedrock",
    "minecraft:end_portal",
    "minecraft:end_gateway",
    "minecraft:fire",
}

# 放下去会变成另一个方块的
SIMPLE_SWAP = {
    "minecraft:farmland": "minecraft:dirt",
    "minecraft:dirt_path": "minecraft:dirt",
    "minecraft:bubble_column": "minecraft:water",
    "minecraft:soul_fire": "minecraft:soul_sand",
    "minecraft:tripwire": "minecraft:string",
    "minecraft:redstone_wire": "minecraft:redstone",
    "minecraft:cave_vines_plant": "minecraft:glow_berries",
}

# 属性直接就是个数的方块：海龟蛋 3 个、海泡菜 4 个……
AMOUNT_PROPS = ("eggs", "pickles", "flower_amount", "candles")

RATIO_TYPES = ((0.5, "type1"), (0.3, "type2"), (0.1, "type3"), (0.01, "type4"), (0.0, "type5"))


def material_of(block) -> list:
    """一个方块状态要几样什么材料，返回 [(方块id, 个数), ...]。

    旧版这段逻辑写在三层 for 循环里，而且几处算错（双层台阶算成 3 个、
    海龟蛋算成 n+1 个），这里重写成对着调色板算，顺便把数量修对。
    """
    if block.is_air or block.id in NOT_OBTAINABLE:
        return []

    props = block.properties
    base = SIMPLE_SWAP.get(block.id, block.id)
    extras = []

    if "potted_" in base:  # 盆栽 = 花盆 + 里面那株
        base = base.replace("potted_", "")
        extras.append(("minecraft:flower_pot", 1))
    if base.endswith("_cake") and "candle" in base:  # 插蜡烛的蛋糕 = 蛋糕 + 蜡烛
        base = base[: -len("_cake")]
        extras.append(("minecraft:cake", 1))
    if base.endswith("_cauldron"):  # 装了东西的炼药锅，材料还是空炼药锅
        base = "minecraft:cauldron"
    base = base.replace("wall_", "")  # 墙上的火把/告示牌/旗帜和地上的是同一个物品

    amount = 1
    if props.get("half") == "upper" or props.get("part") == "head":
        amount = 0  # 门、高草、床的上半部分不是独立物品
    elif props.get("type") == "double":
        amount = 2  # 双层台阶要两个台阶
    for key in AMOUNT_PROPS:
        if key in props:
            try:
                amount = int(props[key])
            except (TypeError, ValueError):
                pass

    result = [(base, amount)] if amount else []
    if props.get("waterlogged") == "true":
        result.append(("minecraft:water", 1))
    if "charges" in props:  # 重生锚的充能是荧石堆出来的
        try:
            result.append(("minecraft:glowstone", int(props["charges"])))
        except (TypeError, ValueError):
            pass
    return result + extras


@dataclass
class Result:
    blocks: dict = field(default_factory=dict)  # {方块id: 折算后个数}
    categories: dict = field(default_factory=dict)  # {分类id: [(个数, 方块id), ...]}
    placed: int = 0  # 结构里实际占了多少格
    volume: int = 0
    declared: int = 0  # 文件自己声称的方块数，用来对账
    redstone_ratio: float = 0.0
    fluid: int = 0

    @property
    def density(self) -> float:
        return self.placed / self.volume * 100 if self.volume else 0.0

    @property
    def kinds(self) -> int:
        return len(self.blocks)

    @property
    def machine_type(self) -> str:
        if self.placed <= 10:
            return _("ui.stat.type6")
        for threshold, key in RATIO_TYPES:
            if self.redstone_ratio >= threshold:
                return _(f"ui.stat.{key}")
        return _("ui.stat.type5")

    def sorted_blocks(self) -> list:
        return sorted(self.blocks.items(), key=lambda kv: kv[1], reverse=True)

    def category_totals(self) -> dict:
        return {name: sum(n for n, _id in items) for name, items in self.categories.items() if items}


def analyse(structure: Structure, count_entities: bool = True, multiplier: int = 1) -> Result:
    materials = {}
    placed = 0

    for region in structure.regions:
        counts = region.palette_counts()
        for index, occurrences in enumerate(counts):
            occurrences = int(occurrences)
            if not occurrences:
                continue
            block = region.palette[index]
            if block.is_air:
                continue
            placed += occurrences
            for block_id, per_block in material_of(block):
                materials[block_id] = materials.get(block_id, 0) + per_block * occurrences

        if count_entities:
            for entity in region.entities:
                key = ENTITY_PREFIX + entity["id"]
                materials[key] = materials.get(key, 0) + 1

    if multiplier > 1:
        materials = {k: v * multiplier for k, v in materials.items()}

    categories = {}
    for block_id, count in materials.items():
        if block_id.startswith(ENTITY_PREFIX):
            category = ENTITY
        else:
            category = category_of(block_id.split(":")[-1])
        categories.setdefault(category, []).append((count, block_id))
    for items in categories.values():
        items.sort(reverse=True)

    result = Result(
        blocks=materials,
        categories=categories,
        placed=placed,
        volume=structure.volume,
        declared=int(structure.meta.get("declared_blocks") or 0),
    )
    result.fluid = sum(n for n, _id in categories.get("fluid", []))

    redstone = sum(n for n, _id in categories.get("redstone", []))
    container = sum(n for n, _id in categories.get("container", []))
    ordered = result.sorted_blocks()
    # 方块种类多的时候，占比最大的那种一般是外壳/填充，剔掉才看得出机器密度
    divisor = result.placed - ordered[0][1] if len(materials) > 5 and ordered else result.placed
    result.redstone_ratio = (redstone + container) / divisor if divisor > 0 else 0.0
    return result


# --------------------------------------------------------------------------- 容器

@dataclass
class Container:
    position: tuple
    block_id: str
    items: list = field(default_factory=list)  # [(物品id, 个数, 槽位), ...]
    note: str = ""  # 命令方块的命令、唱片机的碟、信标的效果等


def _item_entry(raw: dict) -> tuple:
    """Java 用 id/count（1.20.5 之前是 Count），基岩用 Name/Count，这里统一。"""
    item_id = raw.get("id") or raw.get("Name") or "minecraft:unknown"
    count = raw.get("count", raw.get("Count", 1))
    slot = raw.get("Slot", raw.get("slot", 0))
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = 1
    try:
        slot = int(slot)
    except (TypeError, ValueError):
        slot = 0
    return (str(item_id), count, slot)


def containers(structure: Structure) -> list:
    """扫出所有有内容的方块实体。三种格式都走 region.block_entities，逻辑只有一份。"""
    found = []
    for region in structure.regions:
        size = region.size
        for position, data in sorted(region.block_entities.items()):
            if not isinstance(data, dict):
                continue
            # 有些文件里方块实体的坐标和实际区域对不上，越界就别去查方块了
            in_range = all(0 <= position[i] < size[i] for i in range(3))
            block_id = str(data.get("id") or (region.block_at(*position).id if in_range else "?"))
            entry = Container(position=position, block_id=block_id)

            if "Items" in data and isinstance(data["Items"], list):
                entry.items = [_item_entry(i) for i in data["Items"] if isinstance(i, dict)]
            elif "item" in data and isinstance(data["item"], dict):  # 展示框/讲台
                entry.items = [_item_entry(data["item"])]
            elif "RecordItem" in data and isinstance(data["RecordItem"], dict):
                entry.items = [_item_entry(data["RecordItem"])]
                entry.note = _("con.note.disc")
            elif "Command" in data:
                entry.note = str(data["Command"])
            elif "primary_effect" in data:
                entry.note = _("con.note.beacon", data.get("primary_effect", "-"), data.get("Levels", 0))

            if entry.items or entry.note:
                found.append(entry)
    return found


# 容器界面的槽位排布：{匹配关键词: (行, 列)}
SLOT_LAYOUTS = (
    (("chest", "barrel", "shulker_box", "Chest", "Barrel", "ShulkerBox"), (3, 9)),
    (("dispenser", "dropper", "crafter", "Dispenser", "Dropper"), (3, 3)),
    (("chiseled_bookshelf",), (2, 3)),
    (("brewing_stand", "BrewingStand"), (1, 4)),
    (("furnace", "smoker", "blast", "Furnace"), (1, 3)),
    (("hopper", "Hopper"), (1, 5)),
)


def slot_layout(block_id: str) -> tuple:
    for keywords, shape in SLOT_LAYOUTS:
        if any(k in block_id for k in keywords):
            return shape
    return (0, 0)
