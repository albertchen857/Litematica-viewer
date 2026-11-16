// Java（.litematic / .nbt）与基岩版（.mcstructure）之间的方块 ID / 状态互转。
// 逐条照搬桌面版 script/lv/blockmap.py，两边规则必须一致，改一边记得改另一边。
//
// 能力边界（同桌面版）：1.21 后基岩大部分 ID 已和 Java 拉齐，默认原样透传，只有下表里的历史改名才换；
// 状态只处理最常见的几种机械对应，其余原样带过去；没把握的方块记进 report，界面上提示用户自查。

// 只写「两边确实不同名」的。左 Java，右 基岩。
export const ID_JAVA_TO_BEDROCK = {
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
};
// 多对一的（cave_air / void_air 都变 air）只保留第一个，反向才不会互相覆盖
export const ID_BEDROCK_TO_JAVA = {};
for (const [java, bedrock] of Object.entries(ID_JAVA_TO_BEDROCK)) if (!(bedrock in ID_BEDROCK_TO_JAVA)) ID_BEDROCK_TO_JAVA[bedrock] = java;

// Java 的 facing 是字符串，基岩的 facing_direction 是 0~5 的整数
const FACING_TO_INT = { down: "0", up: "1", north: "2", south: "3", west: "4", east: "5" };
const INT_TO_FACING = Object.fromEntries(Object.entries(FACING_TO_INT).map(([k, v]) => [v, k]));
// Java 名 -> 基岩名（Java 是 "true"/"false"，基岩是 1/0）
const BOOL_PROPS = {
  open: "open_bit", powered: "powered_bit", lit: "lit", occupied: "occupied_bit", in_wall: "in_wall_bit",
  triggered: "triggered_bit", extended: "extended_bit", attached: "attached_bit", disarmed: "disarmed_bit",
  conditional: "conditional_bit", hanging: "hanging", persistent: "persistent_bit", has_bottle_0: "has_bottle_0",
};
const BOOL_PROPS_REVERSE = Object.fromEntries(Object.entries(BOOL_PROPS).map(([k, v]) => [v, k]));

function javaPropsToBedrock(props) {
  const out = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "waterlogged") continue; // 基岩用第二层放水，写文件时单独处理
    if (key === "facing") out.facing_direction = FACING_TO_INT[value] ?? "2";
    else if (key === "axis") out.pillar_axis = value;
    else if (key === "half") {
      // 楼梯 / 活板门 half=top|bottom -> upside_down_bit；门 / 高草 / 床 half=upper|lower -> upper_block_bit
      if (value === "upper" || value === "lower") out.upper_block_bit = value === "upper" ? "1" : "0";
      else out.upside_down_bit = value === "top" ? "1" : "0";
    } else if (key === "type" && (value === "top" || value === "bottom")) out["minecraft:vertical_half"] = value;
    else if (key === "type" && value === "double") continue; // 双层半砖在基岩是另一个 id，见 slabToBedrock
    else if (key === "mode") out.output_subtract_bit = value === "subtract" ? "1" : "0";
    else if (key === "rotation") out.ground_sign_direction = value;
    else if (key === "delay") out.repeater_delay = /^\d+$/.test(value) ? String(Math.max(0, +value - 1)) : "0";
    else if (key in BOOL_PROPS) out[BOOL_PROPS[key]] = value === "true" ? "1" : "0";
    else out[key] = value;
  }
  return out;
}

function bedrockPropsToJava(props) {
  const out = {};
  for (let [key, value] of Object.entries(props)) {
    value = String(value);
    const on = value === "1" || value === "true";
    if (key === "facing_direction" || key === "minecraft:facing_direction") out.facing = INT_TO_FACING[value] ?? "north";
    else if (key === "pillar_axis" || key === "minecraft:block_face") out.axis = value;
    else if (key === "upside_down_bit") out.half = on ? "top" : "bottom";
    else if (key === "upper_block_bit") out.half = on ? "upper" : "lower";
    else if (key === "minecraft:vertical_half" || key === "top_slot_bit") out.type = value === "top" || on ? "top" : "bottom";
    else if (key in BOOL_PROPS_REVERSE) out[BOOL_PROPS_REVERSE[key]] = on ? "true" : "false";
    else if (key === "minecraft:cardinal_direction") out.facing = value;
    else if (key === "output_subtract_bit") out.mode = on ? "subtract" : "compare";
    else if (key === "ground_sign_direction") out.rotation = value;
    else if (key === "repeater_delay") out.delay = /^\d+$/.test(value) ? String(+value + 1) : "1";
    else out[key] = value;
  }
  return out;
}

const KNOWN_JAVA = new Set(["waterlogged", "facing", "axis", "half", "type", "mode", "rotation", "delay", ...Object.keys(BOOL_PROPS)]);
const KNOWN_BEDROCK = new Set([
  "facing_direction", "minecraft:facing_direction", "pillar_axis", "minecraft:block_face", "upside_down_bit",
  "upper_block_bit", "minecraft:vertical_half", "top_slot_bit", "minecraft:cardinal_direction",
  "output_subtract_bit", "ground_sign_direction", "repeater_delay", ...Object.keys(BOOL_PROPS_REVERSE),
]);

// 双层半砖：oak_slab[type=double] <-> oak_double_slab
const slabToBedrock = (id, props) => (props.type === "double" && id.endsWith("_slab") ? id.slice(0, -5) + "_double_slab" : id);
const slabToJava = (id) => (id.endsWith("_double_slab") ? [id.slice(0, -12) + "_slab", { type: "double" }] : [id, {}]);

// report：一个 Set，记下没把握的方块 id（有不认识的状态键）
export function javaToBedrock(block, report) {
  if (report && Object.keys(block.props).some((k) => !KNOWN_JAVA.has(k))) report.add(block.id);
  const id = ID_JAVA_TO_BEDROCK[block.id] || block.id;
  return { id: slabToBedrock(id, block.props), props: javaPropsToBedrock(block.props) };
}

export function bedrockToJava(block, report) {
  if (report && Object.keys(block.props).some((k) => !KNOWN_BEDROCK.has(k))) report.add(block.id);
  const [id, extra] = slabToJava(ID_BEDROCK_TO_JAVA[block.id] || block.id);
  return { id, props: { ...bedrockPropsToJava(block.props), ...extra } };
}

export const isWaterlogged = (block) => block.props.waterlogged === "true";
