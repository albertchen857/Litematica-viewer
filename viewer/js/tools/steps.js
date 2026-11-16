// 分步拆解：把统一模型整理成 Splitter.analyze 要的输入，再跑拆分。
// 拆分规则全在 splitter.js（原样取自「投影分步查看器」），这里只做数据搬运。

import { bounds, isAir } from "../formats.js";

// 和原页面的 cellsToData 同样的规则：去掉空气和命名空间，坐标贴到 0，
// 方块按 y→z→x 排，调色板按首次出现的顺序重排 —— 顺序不同拆出来的步骤也会不同
export function toSplitterData(structure) {
  const box = bounds(structure);
  const palette = [], paletteIndex = new Map(), blocks = [];
  for (const region of structure.regions) {
    const [, ry, rz] = region.size;
    const off = region.origin.map((o, i) => o - box.origin[i]);
    const local = region.palette.map((b) => {
      if (isAir(b)) return -1;
      const n = b.id.replace(/^minecraft:/, "");
      const key = n + JSON.stringify(Object.keys(b.props).sort().map((k) => [k, b.props[k]]));
      if (!paletteIndex.has(key)) { paletteIndex.set(key, palette.length); palette.push({ n, p: b.props }); }
      return paletteIndex.get(key);
    });
    for (let i = 0; i < region.blocks.length; i++) {
      const s = local[region.blocks[i]];
      if (s < 0) continue;
      blocks.push([Math.floor(i / (ry * rz)) + off[0], (Math.floor(i / rz) % ry) + off[1], (i % rz) + off[2], s]);
    }
  }
  blocks.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  const order = [], remap = new Map();
  for (const b of blocks) {
    if (!remap.has(b[3])) { remap.set(b[3], order.length); order.push(palette[b[3]]); }
    b[3] = remap.get(b[3]);
  }
  return { name: structure.name, author: structure.author, size: box.size, palette: order, blocks };
}

// 原页面限 6 万块：拆分里有几处两两比较，再大浏览器会算很久
export const STEP_LIMIT = 60000;

export function splitSteps(structure, splitter, params = {}) {
  const data = toSplitterData(structure);
  if (data.blocks.length > STEP_LIMIT) throw new Error(`too many blocks: ${data.blocks.length}`);
  const result = splitter.analyze(data, params);
  result.input = data;
  return result;
}

// 拆分结果 → 一个带「每格属于第几步」的统一模型（region.stepOf），给 3D 一次建好。
// 之后切到第 k 步只是让 step ≤ k 的格子显示出来，见 render.js 的 View.setFilter。
export function structureWithSteps(result) {
  const { size, palette } = result.input;
  const [sx, sy, sz] = size;
  const blocks = new Uint32Array(sx * sy * sz);
  const stepOf = new Int32Array(sx * sy * sz).fill(-1);
  for (const b of result.blocks) {
    const i = b.x * sy * sz + b.y * sz + b.z;
    blocks[i] = b.s + 1;
    stepOf[i] = b.step;
  }
  return {
    regions: [{
      name: "steps", origin: [0, 0, 0], size, stepOf,
      palette: [{ id: "minecraft:air", props: {} }, ...palette.map((p) => ({ id: "minecraft:" + p.n, props: p.p }))],
      blocks, blockEntities: new Map(), entities: [],
    }],
  };
}
