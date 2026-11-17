// 三种结构文件 → 统一模型。和桌面版 script/lv/model.py + formats.py 是同一套思路：
//
//   Structure { name, author, description, source, version, declared, regions: [Region] }
//   Region    { name, origin:[x,y,z], size:[sx,sy,sz], palette:[{id, props}], blocks, blockEntities, entities }
//
//   blocks 是调色板下标的一维数组，下标 = x*sy*sz + y*sz + z（和 Python 的 numpy C 序一致），
//   palette[0] 永远是空气。后面的统计、渲染只认这个模型，不关心文件原来长什么样。
//
// NBT 解析用 deepslate 自带的 NbtFile.read（能自动认 gzip；基岩版要传 littleEndian）。

import { bedrockToJava } from "./blockmap.js";

const AIR = { id: "minecraft:air", props: {} };
const AIR_IDS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
export const isAir = (block) => AIR_IDS.has(block.id);

// ---------------------------------------------------------------- NBT → 普通 JS 对象

// deepslate 0.27 的标签是类：getId() 给类型号（和 NBT 规范一致：1 Byte … 12 LongArray），
// compound 用 forEach((键, 子标签))，列表 / 数组用 getItems()，long 用 getAsPair() 拿 [高32位, 低32位]。
const LONG = 4, BYTE_ARRAY = 7, STRING = 8, LIST = 9, COMPOUND = 10, INT_ARRAY = 11, LONG_ARRAY = 12;
// 转出来的对象 / 数组 → 原来的标签。另存时（writers.js）原样写回，Byte / Short / Long 这些类型不会丢
export const RAW_TAG = new WeakMap();
function plain(tag) {
  if (!tag) return undefined;
  switch (tag.getId()) {
    case COMPOUND: {
      const out = {};
      tag.forEach((key, value) => { out[key] = plain(value); });
      RAW_TAG.set(out, tag);
      return out;
    }
    case LIST: { const out = tag.getItems().map(plain); RAW_TAG.set(out, tag); return out; }
    case LONG: { const [hi, lo] = tag.getAsPair(); return hi * 4294967296 + (lo >>> 0); }
    case LONG_ARRAY: return tag.getItems().map((l) => l.getAsPair());
    case BYTE_ARRAY: case INT_ARRAY: return tag.getItems().map((v) => v.getAsNumber());
    case STRING: return tag.getAsString();
    default: return tag.getAsNumber();
  }
}

const xyz = (v) => [v.x, v.y, v.z];

// ---------------------------------------------------------------- .litematic

// BlockStates 是一串紧密排列的 nbits 位整数，可以跨 long 存放（Litematica 的老规则）。
// 把 long 数组看成小端的 32 位字流，按位偏移取值，跨字的情况一起处理。
function unpackLitematic(longs, bits, count) {
  const words = new Uint32Array(longs.length * 2);
  for (let i = 0; i < longs.length; i++) {
    words[i * 2] = longs[i][1] >>> 0;     // 低 32 位在前
    words[i * 2 + 1] = longs[i][0] >>> 0;
  }
  const out = new Uint32Array(count);
  const mask = bits === 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const offset = i * bits;
    const w = offset >>> 5, s = offset & 31;
    let v = words[w] >>> s;
    if (s + bits > 32) v |= words[w + 1] << (32 - s);
    out[i] = v & mask;
  }
  return out;
}

function readLitematic(rootTag) {
  const root = plain(rootTag);
  const meta = root.Metadata || {};
  const regions = [];
  for (const [name, r] of Object.entries(root.Regions || {})) {
    const size = xyz(r.Size);
    const pos = xyz(r.Position);
    const [ax, ay, az] = size.map(Math.abs);
    // 尺寸可以是负的：区域从 Position 往负方向长。换成最小角当原点
    const origin = pos.map((p, i) => (size[i] < 0 ? p + size[i] + 1 : p));
    const palette = r.BlockStatePalette.map((b) => ({ id: b.Name, props: b.Properties || {} }));
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
    const packed = unpackLitematic(r.BlockStates, bits, ax * ay * az);

    // Litematica 的顺序是 y*sx*sz + z*sx + x，换成统一的 x*sy*sz + y*sz + z
    const blocks = new Uint32Array(ax * ay * az);
    for (let y = 0, i = 0; y < ay; y++)
      for (let z = 0; z < az; z++)
        for (let x = 0; x < ax; x++, i++) blocks[x * ay * az + y * az + z] = packed[i];

    const blockEntities = new Map();
    for (const te of r.TileEntities || []) blockEntities.set(`${te.x},${te.y},${te.z}`, te);
    // Litematica 的实体坐标是相对区域 Position（起点角）的，不是最小角：某个轴尺寸为负时，
    // 实体坐标在那个轴上是负的（-|尺寸|+1 ~ 0）。换算成相对最小角，和方块、方块实体对齐
    const shift = size.map((v) => (v < 0 ? v + 1 : 0));
    const entities = (r.Entities || []).map((e) => ({
      id: e.id, nbt: e, pos: Array.isArray(e.Pos) ? e.Pos.map((v, i) => v - shift[i]) : null,
    }));
    // raw：读进来时的原始条目，属性面板的「原始 NBT」用（调色板下标差 offset：补了空气就是 1）
    const region = normalise({ name, origin, size: [ax, ay, az], palette, blocks, blockEntities, entities });
    region.raw = { kind: "litematic", palette: r.BlockStatePalette, offset: region.palette.length - r.BlockStatePalette.length };
    regions.push(region);
  }
  // 和桌面版一样按 Litematica 自己的格式版本给出游戏版本范围
  const lm = root.Version || 0;
  return {
    name: meta.Name || "", author: meta.Author || "", description: meta.Description || "",
    source: "litematic", version: lm <= 3 ? "1.12 / 1.13" : lm <= 6 ? "1.14 ~ 1.20.5" : "1.20.6+",
    declared: meta.TotalBlocks || 0, regions, metadata: meta, // metadata 原样留着（预览图等），另存时只改名字作者简介
    // 写回 .litematic 时原样带上（同桌面版 structure.meta）
    meta: { lm_version: lm || 6, sub_version: root.SubVersion || 1, mc_version: root.MinecraftDataVersion || 3953 },
  };
}

// ---------------------------------------------------------------- .nbt（Java 结构方块）

function readJavaNbt(root) {
  const data = plain(root);
  const size = data.size;
  const raw = data.palette || (data.palettes && data.palettes[0]) || [];
  const palette = [AIR, ...raw.map((b) => ({ id: b.Name, props: b.Properties || {} }))];
  const [sx, sy, sz] = size;
  const blocks = new Uint32Array(sx * sy * sz);
  const blockEntities = new Map();
  for (const b of data.blocks || []) {
    const [x, y, z] = b.pos;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) continue;
    blocks[x * sy * sz + y * sz + z] = b.state + 1; // +1：0 号让给空气
    if (b.nbt) blockEntities.set(`${x},${y},${z}`, b.nbt);
  }
  const entities = (data.entities || []).map((e) => ({ id: (e.nbt && e.nbt.id) || "minecraft:unknown", pos: e.pos, nbt: e.nbt || {} }));
  return {
    name: "", author: data.author || "", description: "", source: "nbt", version: data.DataVersion || 0, declared: 0,
    meta: { DataVersion: data.DataVersion || 0 },
    regions: [{ ...normalise({ name: "structure", origin: [0, 0, 0], size, palette, blocks, blockEntities, entities }),
      raw: { kind: "nbt", palette: raw, offset: 1, blocks: data.blocks || [] } }],
  };
}

// ---------------------------------------------------------------- .mcstructure（基岩版）

function readMcstructure(root) {
  const data = plain(root);
  const [sx, sy, sz] = data.size;
  const body = data.structure;
  const def = body.palette.default;
  // 读进来就换成 Java 命名（blockmap.js，照 blockmap.py），贴图、中文名、分类表都按 Java id 建的
  const palette = [AIR, ...def.block_palette.map((b) => bedrockToJava({ id: b.name, props: stringify(b.states || {}) }))];
  const primary = body.block_indices[0];
  // 基岩版也是 x*sy*sz + y*sz + z（ZYX 序），-1 是结构空位
  const blocks = new Uint32Array(sx * sy * sz);
  for (let i = 0; i < primary.length; i++) blocks[i] = primary[i] < 0 ? 0 : primary[i] + 1;
  // 第二层通常只放水，表示 Java 的 waterlogged：折回方块自身的 waterlogged=true（同 _apply_waterlogged）
  const second = body.block_indices[1];
  if (second && second.length === primary.length) {
    const water = new Set(def.block_palette.map((b, i) => (String(b.name).includes("water") ? i : -1)).filter((i) => i >= 0));
    const wet = new Map();
    for (let i = 0; i < second.length; i++) {
      if (!water.has(second[i]) || !blocks[i]) continue;
      const old = blocks[i];
      if (!wet.has(old)) {
        wet.set(old, palette.length);
        palette.push({ id: palette[old].id, props: { ...palette[old].props, waterlogged: "true" } });
      }
      blocks[i] = wet.get(old);
    }
  }
  const blockEntities = new Map();
  for (const [key, value] of Object.entries(def.block_position_data || {})) {
    const flat = Number(key);
    if (value.block_entity_data) {
      blockEntities.set(`${Math.floor(flat / (sz * sy))},${Math.floor(flat / sz) % sy},${flat % sz}`, value.block_entity_data);
    }
  }
  // 基岩版实体的 Pos 是世界坐标，减掉结构原点才是相对坐标
  const origin = data.structure_world_origin || [0, 0, 0];
  const entities = (body.entities || []).map((e) => ({
    id: e.identifier || "minecraft:unknown", nbt: e,
    pos: Array.isArray(e.Pos) ? e.Pos.map((v, i) => v - origin[i]) : null,
  }));
  return {
    name: "", author: "", description: "", source: "mcstructure", version: data.format_version || 1, declared: 0,
    meta: { format_version: data.format_version || 1 },
    regions: [{ ...normalise({ name: "structure", origin, size: [sx, sy, sz], palette, blocks, blockEntities, entities }),
      raw: { kind: "mcstructure", palette: def.block_palette, offset: 1, positionData: def.block_position_data || {} } }],
  };
}

function stringify(states) {
  const out = {};
  for (const k in states) out[k] = String(states[k]);
  return out;
}

// palette[0] 不是空气的话整体后移一位，保证「0 = 空气」这条约定
function normalise(region) {
  if (!region.palette.length || !isAir(region.palette[0])) {
    region.palette = [AIR, ...region.palette];
    for (let i = 0; i < region.blocks.length; i++) region.blocks[i] += 1;
  }
  return region;
}

// ---------------------------------------------------------------- 入口

export const EXTENSIONS = [".litematic", ".nbt", ".mcstructure"];

export function parse(fileName, bytes) {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const stem = fileName.slice(0, fileName.length - ext.length);
  let structure;
  const read = (options) => deepslate.NbtFile.read(bytes, options).root;
  if (ext === ".litematic") structure = readLitematic(read({}));
  else if (ext === ".nbt") structure = readJavaNbt(read({}));
  else if (ext === ".mcstructure") structure = readMcstructure(read({ littleEndian: true }));
  else throw new Error(`unsupported: ${ext}`);
  structure.name = structure.name || stem;
  structure.fileName = fileName;
  return structure;
}

// 桌面版传过来的 payload.json（script/lv/render.py 的 build_payload）→ 统一模型。
// 每个区域只带非空气格子的线性下标和调色板下标（base64 二进制），这里铺回整块数组。
// 实体带 id / 坐标 / NBT，方块实体按区域内坐标 "x,y,z" 传，点选时都看得到。
export const PAYLOAD_FORMAT = 3;
function decode(b64, bits) {
  const raw = atob(b64), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bits === 16 ? new Uint16Array(bytes.buffer) : new Int32Array(bytes.buffer);
}
export function fromPayload(p) {
  if (!p || p.format !== PAYLOAD_FORMAT) throw new Error(`payload format ${p && p.format} ≠ ${PAYLOAD_FORMAT}`);
  const regions = p.regions.map((r) => {
    const blocks = new Uint32Array(r.size[0] * r.size[1] * r.size[2]);
    const idx = decode(r.idx_b64, 32), state = decode(r.state_b64, r.state_bits);
    for (let i = 0; i < r.count; i++) blocks[idx[i]] = state[i];
    const entities = (r.entities || []).map((e) => (typeof e === "string" ? { id: e, nbt: {} } : e));
    const blockEntities = new Map(Object.entries(r.block_entities || {}));
    return normalise({ name: r.name, origin: r.origin, size: r.size, palette: r.palette, blocks, blockEntities, entities });
  });
  return {
    name: p.name, author: p.author || "", description: p.description || "", source: p.source || "litematic",
    version: p.version || "", declared: 0, regions, fileName: p.name,
  };
}

// 所有区域的包围盒：最小角和尺寸。多区域的投影渲染、统计体积都用它
export function bounds(structure) {
  const lo = [0, 1, 2].map((i) => Math.min(...structure.regions.map((r) => r.origin[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...structure.regions.map((r) => r.origin[i] + r.size[i])));
  return { origin: lo, size: hi.map((h, i) => h - lo[i]) };
}
