// 统计分析。逐条照搬桌面版 script/lv/analysis.py，两边算出来的数要一样：
// 先数「每个调色板下标出现几次」，再按调色板条目折算材料，几十万方块也是一瞬间。

import { isAir } from "./formats.js";

export const ENTITY_PREFIX = "entity:";

// 拿不到实体方块 / 不该计入材料的
const NOT_OBTAINABLE = new Set([
  "minecraft:piston_head", "minecraft:moving_piston", "minecraft:nether_portal", "minecraft:bedrock",
  "minecraft:end_portal", "minecraft:end_gateway", "minecraft:fire",
]);
// 放下去会变成另一个方块的
const SIMPLE_SWAP = {
  "minecraft:farmland": "minecraft:dirt", "minecraft:dirt_path": "minecraft:dirt",
  "minecraft:bubble_column": "minecraft:water", "minecraft:soul_fire": "minecraft:soul_sand",
  "minecraft:tripwire": "minecraft:string", "minecraft:redstone_wire": "minecraft:redstone",
  "minecraft:cave_vines_plant": "minecraft:glow_berries",
};
// 属性直接就是个数的方块：海龟蛋 3 个、海泡菜 4 个……
const AMOUNT_PROPS = ["eggs", "pickles", "flower_amount", "candles"];
const RATIO_TYPES = [[0.5, "type1"], [0.3, "type2"], [0.1, "type3"], [0.01, "type4"], [0, "type5"]];

// 一个方块状态要几样什么材料：[[方块id, 个数], ...]
export function materialOf(block) {
  if (isAir(block) || NOT_OBTAINABLE.has(block.id)) return [];
  const props = block.props;
  let base = SIMPLE_SWAP[block.id] || block.id;
  const extras = [];
  if (base.includes("potted_")) { base = base.replace("potted_", ""); extras.push(["minecraft:flower_pot", 1]); }
  if (base.endsWith("_cake") && base.includes("candle")) { base = base.slice(0, -5); extras.push(["minecraft:cake", 1]); }
  if (base.endsWith("_cauldron")) base = "minecraft:cauldron";
  base = base.replace("wall_", "");

  let amount = 1;
  if (props.half === "upper" || props.part === "head") amount = 0;
  else if (props.type === "double") amount = 2;
  for (const key of AMOUNT_PROPS) if (key in props && !Number.isNaN(parseInt(props[key]))) amount = parseInt(props[key]);

  const result = amount ? [[base, amount]] : [];
  if (props.waterlogged === "true") result.push(["minecraft:water", 1]);
  if ("charges" in props && !Number.isNaN(parseInt(props.charges))) result.push(["minecraft:glowstone", parseInt(props.charges)]);
  return result.concat(extras);
}

// 方块名里的单词命中哪个分类关键词，就归到哪类（和 tools.category_of 一致）
export function categoryOf(blockId, keywords) {
  for (const word of blockId.split(":").pop().split("_")) if (word in keywords) return keywords[word];
  return "other";
}

const sortDesc = (entries) => entries.sort((a, b) => b[1] - a[1]);

export function analyse(structure, gamedata, { countEntities = true, multiplier = 1, regions = structure.regions } = {}) {
  const materials = new Map();
  const add = (id, n) => materials.set(id, (materials.get(id) || 0) + n);
  let placed = 0, volume = 0;

  for (const region of regions) {
    volume += region.blocks.length;
    const counts = new Uint32Array(region.palette.length);
    for (const b of region.blocks) counts[b]++;
    counts.forEach((occurrences, index) => {
      const block = region.palette[index];
      if (!occurrences || isAir(block)) return;
      placed += occurrences;
      for (const [id, per] of materialOf(block)) add(id, per * occurrences);
    });
    if (countEntities) for (const e of region.entities) add(ENTITY_PREFIX + e.id, 1);
  }
  if (multiplier > 1) for (const [k, v] of materials) materials.set(k, v * multiplier);

  const categories = {};
  for (const [id, count] of materials) {
    const cat = id.startsWith(ENTITY_PREFIX) ? "entity" : categoryOf(id, gamedata.categoryKeywords);
    (categories[cat] ||= []).push([id, count]);
  }
  const catTotal = (c) => (categories[c] || []).reduce((s, [, n]) => s + n, 0);

  const all = sortDesc([...materials]);
  // 方块种类多的时候，占比最大的一般是外壳/填充，剔掉才看得出机器密度
  const divisor = materials.size > 5 && all.length ? placed - all[0][1] : placed;
  const redstoneRatio = divisor > 0 ? (catTotal("redstone") + catTotal("container")) / divisor : 0;

  const items = itemTotals(regions);
  return {
    materials, categories, placed, volume, redstoneRatio,
    fluid: catTotal("fluid"),
    density: volume ? (placed / volume) * 100 : 0,
    kinds: materials.size,
    declared: regions === structure.regions ? structure.declared : 0,
    machineType: placed <= 10 ? "type6" : RATIO_TYPES.find(([t]) => redstoneRatio >= t)[1],
    blocks: sortDesc([...materials].filter(([k]) => !k.startsWith(ENTITY_PREFIX))),
    entities: sortDesc([...materials].filter(([k]) => k.startsWith(ENTITY_PREFIX)).map(([k, v]) => [k.slice(ENTITY_PREFIX.length), v])),
    items: sortDesc([...items]),
    categoryTotals: sortDesc(Object.keys(categories).map((c) => [c, catTotal(c)])),
  };
}

// 「总数」页：方块 + 实体 + 容器里的物品，同名合并
export function totalRows(result) {
  const merged = new Map();
  for (const list of [result.blocks, result.entities, result.items])
    for (const [id, n] of list) merged.set(id, (merged.get(id) || 0) + n);
  return sortDesc([...merged]);
}

// ---------------------------------------------------------------- 容器

// Java 用 id/count（1.20.5 之前是 Count），基岩用 Name/Count，这里统一
function itemEntry(raw) {
  return [String(raw.id || raw.Name || "minecraft:unknown"), Number(raw.count ?? raw.Count ?? 1) || 1];
}

export function containers(regions) {
  const found = [];
  for (const region of regions) {
    for (const [pos, data] of region.blockEntities) {
      if (!data || typeof data !== "object") continue;
      let items = [];
      if (Array.isArray(data.Items)) items = data.Items.filter((i) => i && typeof i === "object").map(itemEntry);
      else if (data.item && typeof data.item === "object") items = [itemEntry(data.item)];
      else if (data.RecordItem && typeof data.RecordItem === "object") items = [itemEntry(data.RecordItem)];
      if (items.length) found.push({ pos, id: data.id || "", items });
    }
  }
  return found;
}

function itemTotals(regions) {
  const totals = new Map();
  for (const c of containers(regions)) for (const [id, n] of c.items) totals.set(id, (totals.get(id) || 0) + n);
  return totals;
}

// 盒 / 组 / 个（英文 Box/St/u），和桌面版 tools.convert_units 一样，再多一级「大箱」
export const UNIT_STEPS = [["lc", 54 * 27 * 64], ["box", 27 * 64], ["stack", 64], ["unit", 1]];
export function unitParts(n) {
  const parts = [];
  for (const [key, size] of UNIT_STEPS) if (n >= size) { parts.push([key, Math.floor(n / size)]); n %= size; }
  return parts.length ? parts : [["unit", 0]];
}
