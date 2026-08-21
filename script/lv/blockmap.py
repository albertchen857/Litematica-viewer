"""Java（.litematic/.nbt）与基岩版（.mcstructure）之间的方块 ID / 状态互转。

先说清楚能力边界，免得导出结果对不上还以为是 BUG：

* 1.21 之后基岩版大部分方块 ID 已经和 Java 拉齐了，所以**默认按原样透传**，
  只有下面 ``ID_JAVA_TO_BEDROCK`` 里列出的历史遗留改名才做替换。
* 方块状态（朝向、上下半砖、是否含水……）两边的键名和取值类型都不一样，
  这里只处理最常见的那几种机械式对应，其余状态原样带过去。
* 转换不出来的方块不会丢，会原样写入并记进 ``ConversionReport.unmapped``，
  界面上会提示有多少种方块没把握，可以自己检查。

想补映射直接往下面的表里加就行，两个方向会自动互为逆表。
"""

from .model import Block

# --------------------------------------------------------------------------- ID

# 只写「两边确实不同名」的。左 Java，右 基岩。
ID_JAVA_TO_BEDROCK = {
    "minecraft:dirt_path": "minecraft:grass_path",
    "minecraft:cobweb": "minecraft:web",
    "minecraft:powered_rail": "minecraft:golden_rail",
    "minecraft:lily_pad": "minecraft:waterlily",
    "minecraft:snow": "minecraft:snow_layer",
    "minecraft:snow_block": "minecraft:snow",
    "minecraft:melon": "minecraft:melon_block",
    "minecraft:nether_quartz_ore": "minecraft:quartz_ore",
    "minecraft:magma_block": "minecraft:magma",
    "minecraft:slime_block": "minecraft:slime",
    "minecraft:sugar_cane": "minecraft:reeds",
    "minecraft:terracotta": "minecraft:hardened_clay",
    "minecraft:note_block": "minecraft:noteblock",
    "minecraft:moving_piston": "minecraft:moving_block",
    "minecraft:piston_head": "minecraft:piston_arm_collision",
    "minecraft:sticky_piston": "minecraft:sticky_piston",
    "minecraft:wall_torch": "minecraft:torch",
    "minecraft:redstone_wall_torch": "minecraft:redstone_torch",
    "minecraft:soul_wall_torch": "minecraft:soul_torch",
    "minecraft:nether_portal": "minecraft:portal",
    "minecraft:end_portal_frame": "minecraft:end_portal_frame",
    "minecraft:cave_air": "minecraft:air",
    "minecraft:void_air": "minecraft:air",
    "minecraft:tall_seagrass": "minecraft:seagrass",
    "minecraft:cocoa": "minecraft:cocoa",
    "minecraft:beetroots": "minecraft:beetroot",
    "minecraft:potatoes": "minecraft:potatoes",
    "minecraft:melon_stem": "minecraft:melon_stem",
    "minecraft:cauldron": "minecraft:cauldron",
    "minecraft:water_cauldron": "minecraft:cauldron",
    "minecraft:small_amethyst_bud": "minecraft:small_amethyst_bud",
    "minecraft:big_dripleaf_stem": "minecraft:big_dripleaf",
}

ID_BEDROCK_TO_JAVA = {}
for _java, _bedrock in ID_JAVA_TO_BEDROCK.items():
    # 多对一的（cave_air/void_air 都变 air）只保留第一个，反向才不会互相覆盖
    ID_BEDROCK_TO_JAVA.setdefault(_bedrock, _java)

# --------------------------------------------------------------------------- 方块状态

# Java 的 facing 是字符串，基岩的 facing_direction 是 0~5 的整数。
_FACING_TO_INT = {"down": "0", "up": "1", "north": "2", "south": "3", "west": "4", "east": "5"}
_INT_TO_FACING = {v: k for k, v in _FACING_TO_INT.items()}

# 键名一一对应、取值需要变形的状态
_BOOL_PROPS = {  # Java 名 -> 基岩名（Java 是 "true"/"false"，基岩是 1/0）
    "open": "open_bit",
    "powered": "powered_bit",
    "lit": "lit",
    "occupied": "occupied_bit",
    "in_wall": "in_wall_bit",
    "triggered": "triggered_bit",
    "extended": "extended_bit",
    "attached": "attached_bit",
    "disarmed": "disarmed_bit",
    "conditional": "conditional_bit",
    "hanging": "hanging",
    "persistent": "persistent_bit",
    "has_bottle_0": "has_bottle_0",
}
_BOOL_PROPS_REVERSE = {v: k for k, v in _BOOL_PROPS.items()}


def _java_props_to_bedrock(props: dict) -> dict:
    out = {}
    for key, value in props.items():
        if key == "waterlogged":
            continue  # 基岩用第二层放水，在 formats.py 里单独处理
        if key == "facing":
            out["facing_direction"] = _FACING_TO_INT.get(value, "2")
        elif key == "axis":
            out["pillar_axis"] = value
        elif key == "half":  # 楼梯/活板门的上下放置
            out["upside_down_bit"] = "1" if value in ("top", "upper") else "0"
        elif key == "type":  # 半砖
            out["minecraft:vertical_half"] = "top" if value == "top" else "bottom"
        elif key == "mode":  # 比较器：比较/减法
            out["output_subtract_bit"] = "1" if value == "subtract" else "0"
        elif key == "rotation":  # 立式告示牌/旗帜/头颅的 16 向
            out["ground_sign_direction"] = value
        elif key == "delay":  # 中继器：Java 是 1~4，基岩是 0~3
            out["repeater_delay"] = str(max(0, int(value) - 1)) if value.isdigit() else "0"
        elif key in _BOOL_PROPS:
            out[_BOOL_PROPS[key]] = "1" if value == "true" else "0"
        else:
            out[key] = value
    return out


def _bedrock_props_to_java(props: dict) -> dict:
    out = {}
    for key, value in props.items():
        value = str(value)
        if key in ("facing_direction", "minecraft:facing_direction"):
            out["facing"] = _INT_TO_FACING.get(value, "north")
        elif key in ("pillar_axis", "minecraft:block_face"):
            out["axis"] = value
        elif key == "upside_down_bit":
            out["half"] = "top" if value in ("1", "true") else "bottom"
        elif key in ("minecraft:vertical_half", "top_slot_bit"):
            out["type"] = "top" if value in ("top", "1", "true") else "bottom"
        elif key in _BOOL_PROPS_REVERSE:
            out[_BOOL_PROPS_REVERSE[key]] = "true" if value in ("1", "true") else "false"
        elif key == "minecraft:cardinal_direction":
            out["facing"] = value
        elif key == "output_subtract_bit":
            out["mode"] = "subtract" if value in ("1", "true") else "compare"
        elif key == "ground_sign_direction":
            out["rotation"] = value
        elif key == "repeater_delay":
            out["delay"] = str(int(value) + 1) if value.isdigit() else "1"
        else:
            out[key] = value
    return out


# --------------------------------------------------------------------------- 对外接口

class ConversionReport:
    """记录哪些方块没有把握，界面上提示用户自查。"""

    def __init__(self):
        self.unmapped = set()

    def note(self, block_id: str) -> None:
        self.unmapped.add(block_id)

    def __bool__(self) -> bool:
        return bool(self.unmapped)

    def summary(self, limit: int = 8) -> str:
        names = sorted(self.unmapped)
        head = ", ".join(n.split(":")[-1] for n in names[:limit])
        return f"{len(names)}: {head}{' ...' if len(names) > limit else ''}"


# 上面几个转换函数认识的状态键。除此之外的状态原样带过去，多半也没问题，
# 但两边取值不一样的话就会失真，所以记进报告让用户自己核对。
_KNOWN_JAVA_PROPS = frozenset(
    {"waterlogged", "facing", "axis", "half", "type", "mode", "rotation", "delay", *_BOOL_PROPS}
)
_KNOWN_BEDROCK_PROPS = frozenset(
    {
        "facing_direction", "minecraft:facing_direction", "pillar_axis", "minecraft:block_face",
        "upside_down_bit", "minecraft:vertical_half", "top_slot_bit", "minecraft:cardinal_direction",
        "output_subtract_bit", "ground_sign_direction", "repeater_delay",
        *_BOOL_PROPS_REVERSE,
    }
)


def java_to_bedrock(block: Block, report: ConversionReport = None) -> Block:
    props = block.properties
    if report is not None and not _KNOWN_JAVA_PROPS.issuperset(props):
        report.note(block.id)
    return Block.make(ID_JAVA_TO_BEDROCK.get(block.id, block.id), _java_props_to_bedrock(props))


def bedrock_to_java(block: Block, report: ConversionReport = None) -> Block:
    props = block.properties
    if report is not None and not _KNOWN_BEDROCK_PROPS.issuperset(props):
        report.note(block.id)
    return Block.make(ID_BEDROCK_TO_JAVA.get(block.id, block.id), _bedrock_props_to_java(props))


def is_waterlogged(block: Block) -> bool:
    return block.properties.get("waterlogged") == "true"
