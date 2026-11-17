// 批量替换方块。照搬桌面版 script/lv/edit.py 的 parse_rules / replace_blocks：
// 只对调色板（几十条）算一次映射表，再套到索引数组上，几十万方块也是瞬间完成。

export class RuleError extends Error {}

// 规则文本，逗号 / 换行分隔多条，属性部分是 JSON，可省略：
//   iron_block-dirt
//   hopper{"facing":"west"}-hopper{"facing":"down"}
// 返回 Map：原 id → [新 id, 需要匹配的属性, 要改成的属性]。
// nameToId：把中文名换成 id（可选）
export function parseRules(text, nameToId = null) {
  const rules = new Map();
  // 按逗号 / 换行切；花括号里的逗号不切（桌面版是直接 split(",")，带多个状态的规则会被切坏）
  for (let chunk of text.replace(/\n/g, ",").split(/,(?![^{]*\})/)) {
    chunk = chunk.trim();
    if (!chunk) continue;
    const cut = chunk.indexOf("-");
    if (cut < 0) throw new RuleError(chunk);
    const [sourceId, sourceProps] = splitRule(chunk.slice(0, cut), nameToId);
    const [targetId, targetProps] = splitRule(chunk.slice(cut + 1), nameToId);
    rules.set(sourceId, [targetId, sourceProps, targetProps]);
  }
  if (!rules.size) throw new RuleError("");
  return rules;
}

function splitRule(text, nameToId) {
  text = text.trim();
  let head = text, props = {};
  const brace = text.indexOf("{");
  if (brace >= 0) {
    head = text.slice(0, brace);
    try {
      props = Object.fromEntries(Object.entries(JSON.parse(text.slice(brace))).map(([k, v]) => [String(k), String(v)]));
    } catch {
      throw new RuleError(text.slice(brace));
    }
  }
  head = head.trim();
  if (nameToId) head = nameToId(head);
  return [head.includes(":") ? head : `minecraft:${head}`, props];
}

const sameBlock = (a, b) => a.id === b.id && JSON.stringify(Object.entries(a.props).sort()) === JSON.stringify(Object.entries(b.props).sort());

// 按规则替换，返回 { structure: 新结构, replaced: 替换了多少格 }。原结构不动。
// only：可选，只替换这一格 { region, local:[x,y,z] }（3D 里右键某一个方块时用）
// clean：可选，(新 id, 合并后的状态, 原方块) → 实际写入的状态（比如换成没有状态的整方块时把旧状态清掉）
// inRegion：可选，只换这一个子区域（多子区域的投影选中了某个区域时）
export function replaceBlocks(structure, rules, only = null, clean = (_id, props) => props, inRegion = null) {
  let replaced = 0;
  const regions = structure.regions.map((region) => {
    if (inRegion && region !== inRegion) return region;
    // 先算调色板映射：哪些调色板条目要变成什么
    const palette = region.palette.slice();
    const remap = palette.map((_, i) => i);
    region.palette.forEach((block, index) => {
      const rule = rules.get(block.id);
      if (!rule) return;
      const [targetId, needProps, setProps] = rule;
      if (!Object.entries(needProps).every(([k, v]) => block.props[k] === v)) return;
      const next = { id: targetId, props: clean(targetId, { ...block.props, ...setProps }, block) };
      const found = palette.findIndex((b) => sameBlock(b, next));
      remap[index] = found >= 0 ? found : palette.push(next) - 1;
    });
    const blocks = region.blocks.slice();
    const [, ry, rz] = region.size;
    const blockEntities = new Map(region.blockEntities);
    const apply = (i) => {
      const from = blocks[i], to = remap[from];
      if (to === from) return;
      blocks[i] = to;
      replaced++;
      // 换成了别的方块（箱子 → 石头）：原来的方块实体（箱子里的东西）不再属于它，去掉；
      // 只是改状态（漏斗换朝向）就留着
      if (blockEntities.size && palette[to].id !== palette[from].id) {
        blockEntities.delete(`${Math.floor(i / (ry * rz))},${Math.floor(i / rz) % ry},${i % rz}`);
      }
    };
    if (only) {
      if (only.region === region) apply(only.local[0] * ry * rz + only.local[1] * rz + only.local[2]);
    } else {
      for (let i = 0; i < blocks.length; i++) apply(i);
    }
    return { ...region, palette, blocks, blockEntities, entities: region.entities.slice() };
  });
  return { structure: { ...structure, regions }, replaced };
}
