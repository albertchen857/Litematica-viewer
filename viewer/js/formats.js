// 三种结构文件 → 统一模型。和桌面版 script/lv/model.py + formats.py 是同一套思路：
//
// 支持 .litematic / .nbt / .mcstructure，WorldEdit 的 .schem（Sponge v1–v3）和老 .schematic（MCEdit，数字 ID），
// Axiom 的 .bp 蓝图，以及 Valkyrien Skies（VMod）的 .vschem 船只蓝图（带物理连接）。
//
//   Structure { name, author, description, source, version, declared, regions: [Region] }
//   Region    { name, origin:[x,y,z], size:[sx,sy,sz], palette:[{id, props}], blocks, blockEntities, entities }
//
//   blocks 是调色板下标的一维数组，下标 = x*sy*sz + y*sz + z（和 Python 的 numpy C 序一致），
//   palette[0] 永远是空气。后面的统计、渲染只认这个模型，不关心文件原来长什么样。
//
// NBT 解析用 deepslate 自带的 NbtFile.read（能自动认 gzip；基岩版要传 littleEndian）。

import { bedrockToJava } from "./blockmap.js";
import { loadLegacy, legacyBlock, legacyItem, parseState, fixLegacyNeighbors } from "./legacy.js";

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
    // long 数组（投影的 BlockStates 有几百万个）：不拆成几百万个 [高, 低] 小数组，
    // 直接排进一个 Int32Array（高、低、高、低……），大投影能省几百 MB 内存
    case LONG_ARRAY: {
      const items = tag.getItems(), out = new Int32Array(items.length * 2);
      for (let i = 0; i < items.length; i++) { const [hi, lo] = items[i].getAsPair(); out[i * 2] = hi; out[i * 2 + 1] = lo; }
      return out;
    }
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
  // longs：plain() 给的 Int32Array，每个 long 占两格（高 32 位、低 32 位）
  const words = new Uint32Array(longs.length);
  for (let i = 0; i < longs.length; i += 2) {
    words[i] = longs[i + 1] >>> 0;     // 低 32 位在前
    words[i + 1] = longs[i] >>> 0;
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

// ---------------------------------------------------------------- .schem（WorldEdit / Sponge Schematic v1–v3）
//
// v1 / v2：字段都在根上；v3：都在 Schematic 底下，方块在 Blocks { Palette, Data, BlockEntities } 里。
// 方块数据是 varint 字节流，下标顺序 (y * Length + z) * Width + x。方块实体 Pos 是相对结构的格子坐标

// varint 字节流 → 调色板下标数组（每个数 7 位一组，最高位 1 表示后面还有）
function readVarints(bytes, count) {
  const out = new Uint32Array(count);
  let p = 0;
  for (let i = 0; i < count && p < bytes.length; i++) {
    let v = 0, shift = 0, b;
    do { b = bytes[p++] & 0xff; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80 && p < bytes.length);
    out[i] = v >>> 0;
  }
  return out;
}

// 实体坐标：规范写的是相对结构，但有的工具写的是世界坐标；落在结构外面就试着减掉 offset
function relativePos(pos, size, offsets) {
  if (!Array.isArray(pos)) return null;
  const inside = (p) => p.every((v, a) => v >= -1 && v <= size[a] + 1);
  if (inside(pos)) return pos;
  for (const o of offsets) {
    if (!o) continue;
    const p = pos.map((v, a) => v - o[a]);
    if (inside(p)) return p;
  }
  return pos;
}

function readSchem(rootTag) {
  const root = plain(rootTag);
  const s = root.Schematic && typeof root.Schematic === "object" && !Array.isArray(root.Schematic) ? root.Schematic : root;
  const version = s.Version || 1;
  const size = [s.Width || 0, s.Height || 0, s.Length || 0].map((v) => v & 0xffff); // short：大于 32767 的会读成负数
  const [W, H, L] = size;
  const blockBox = version >= 3 ? s.Blocks || {} : s;
  const paletteMap = blockBox.Palette || {};
  const ordered = [];
  for (const [state, i] of Object.entries(paletteMap)) ordered[i] = parseState(state);
  const palette = [AIR, ...Array.from(ordered, (b) => b || AIR)];
  const raw = readVarints(blockBox.Data || blockBox.BlockData || s.BlockData || [], W * H * L);
  const blocks = new Uint32Array(W * H * L);
  for (let y = 0, i = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++, i++) {
    blocks[x * H * L + y * L + z] = raw[i] + 1; // +1：0 号让给空气
  }
  const blockEntities = new Map();
  for (const be of blockBox.BlockEntities || s.BlockEntities || s.TileEntities || []) {
    const [x, y, z] = be.Pos || [];
    if (x === undefined) continue;
    // v3 的内容在 Data 里；v1 / v2 和 Pos、Id 平铺在一起
    const data = { ...(be.Data || be), id: be.Id || be.id };
    delete data.Pos; delete data.Id;
    blockEntities.set(`${x},${y},${z}`, data);
  }
  const meta = s.Metadata || {};
  const weOffset = ["WEOffsetX", "WEOffsetY", "WEOffsetZ"].every((k) => k in meta) ? [meta.WEOffsetX, meta.WEOffsetY, meta.WEOffsetZ] : null;
  const entities = (s.Entities || []).map((e) => {
    const nbt = { ...(e.Data || e), id: e.Id || e.id };
    return { id: nbt.id || "minecraft:unknown", nbt, pos: relativePos(e.Pos, size, [s.Offset, weOffset]) };
  });
  return {
    name: meta.Name || "", author: meta.Author || "", description: "", source: "schem", version: `v${version}`, declared: 0,
    meta: { DataVersion: s.DataVersion || 3953, schem_version: version },
    regions: [{ ...normalise({ name: "schematic", origin: [0, 0, 0], size, palette, blocks, blockEntities, entities }),
      raw: { kind: "schem", palette: Object.keys(paletteMap).sort((a, b) => paletteMap[a] - paletteMap[b]), offset: 1 } }],
  };
}

// ---------------------------------------------------------------- .schematic（MCEdit / WorldEdit 老格式，1.12 及以前）
//
// Blocks / Data 各一个字节一格（ID 超过 255 的高 4 位在 AddBlocks 里，两格共用一个字节），下标 (y * Length + z) * Width + x。
// 数字 ID 用 resource/legacy.json 换成现在的名字，再按邻居补全楼梯拐角、栅栏连接这些（legacy.js）

function readSchematic(rootTag, isOpaque) {
  const s = plain(rootTag);
  const size = [s.Width || 0, s.Height || 0, s.Length || 0].map((v) => v & 0xffff);
  const [W, H, L] = size;
  const ids = s.Blocks || [], datas = s.Data || [], add = s.AddBlocks || null;
  const unknown = new Set();
  const palette = [AIR], index = new Map([["0:0", 0]]);
  const blocks = new Uint32Array(W * H * L);
  for (let y = 0, i = 0; y < H; y++) for (let z = 0; z < L; z++) for (let x = 0; x < W; x++, i++) {
    let id = ids[i] & 0xff;
    if (add) id |= (i & 1 ? (add[i >> 1] & 0xf0) << 4 : (add[i >> 1] & 0x0f) << 8);
    const key = `${id}:${datas[i] & 0x0f}`;
    let p = index.get(key);
    if (p === undefined) {
      p = palette.length;
      palette.push(legacyBlock(id, datas[i] & 0x0f, unknown));
      index.set(key, p);
    }
    blocks[x * H * L + y * L + z] = p;
  }
  const region = normalise({ name: "schematic", origin: [0, 0, 0], size, palette, blocks, blockEntities: new Map(), entities: [] });
  fixLegacyNeighbors(region, isOpaque);
  // 原始 NBT 按钮：显示这一格原来的数字 ID 和数值
  region.raw = { kind: "schematic", palette: [], offset: 0, ids, datas, add, size };
  // 容器里的物品：老版本的物品 id 是数字（加 Damage 区分种类），换成名字
  const fixItems = (list) => (Array.isArray(list) ? list.map((it) => ({ ...it, id: legacyItem(it.id, it.Damage || 0) })) : list);
  for (const te of s.TileEntities || []) {
    if (te.x < 0 || te.y < 0 || te.z < 0 || te.x >= W || te.y >= H || te.z >= L) continue;
    // 老版本的方块实体 id 是 "Chest"、"Trap" 这种，换成那一格方块的名字
    const block = region.palette[region.blocks[te.x * H * L + te.y * L + te.z]];
    region.blockEntities.set(`${te.x},${te.y},${te.z}`, { ...te, id: block.id, Items: fixItems(te.Items) });
  }
  const origin = ["WEOriginX", "WEOriginY", "WEOriginZ"].every((k) => k in s) ? [s.WEOriginX, s.WEOriginY, s.WEOriginZ] : null;
  region.entities = (s.Entities || []).map((e) => ({ id: e.id || "minecraft:unknown", nbt: e, pos: relativePos(e.Pos, size, [origin]) }));
  return {
    name: "", author: "", description: "", source: "schematic", version: s.Materials || "Alpha", declared: 0,
    meta: { DataVersion: 3953 }, // 名字已经换成现在的了，按新版本写出去
    unknownLegacy: [...unknown],
    regions: [region],
  };
}

// ---------------------------------------------------------------- .bp（Axiom 蓝图）
//
// 照 SchemConvert 的 AxiomSchematicFormat（开源）：
//   int 魔数 0x0AE5BB36 | int 长度 + 不压缩的 NBT 头（Name、Author、Tags、BlockCount…）
//   | int 长度 + PNG 缩略图 | int 长度 + gzip NBT 方块数据
// 方块数据：BlockRegion 列表，每项一个 16³ 区段（X / Y / Z 是区段坐标），BlockStates { palette, data }，
// data 和原版区块一样按位压缩、数值不跨 long（每个 long 放 floor(64 / 位数) 个，位数至少 4）。
// 方块实体在 BlockEntities 里，坐标是蓝图里的绝对格子坐标。structure_void 表示「这格不归蓝图管」，当空气

const BP_MAGIC = 0x0ae5bb36;
const VOID_IDS = new Set(["minecraft:structure_void"]);

// 原版区块那种「不跨 long」的按位压缩：longs 是 plain() 给的 Int32Array（高、低、高、低…）
function unpackSection(longs, bits, count) {
  const out = new Uint16Array(count);
  const per = Math.floor(64 / bits), mask = (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const li = Math.floor(i / per), off = (i % per) * bits;
    const hi = longs[li * 2] >>> 0, lo = longs[li * 2 + 1] >>> 0;
    let v;
    if (off + bits <= 32) v = lo >>> off;
    else if (off >= 32) v = hi >>> (off - 32);
    else v = (lo >>> off) | (hi << (32 - off));
    out[i] = v & mask;
  }
  return out;
}

function readBp(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getInt32(0) !== BP_MAGIC) throw new Error("not an Axiom blueprint (.bp)");
  let p = 4;
  const chunk = () => { const n = dv.getInt32(p); const part = bytes.subarray(p + 4, p + 4 + n); p += 4 + n; return part; };
  const headerBytes = chunk(), png = chunk(), dataBytes = chunk();
  const header = headerBytes.length ? plain(deepslate.NbtFile.read(headerBytes, { compression: "none" }).root) : {};
  const data = plain(deepslate.NbtFile.read(dataBytes, {}).root);

  const sections = data.BlockRegion || [];
  if (!sections.length) throw new Error("empty blueprint");
  const lo = ["X", "Y", "Z"].map((k) => Math.min(...sections.map((s) => s[k])));
  const hi = ["X", "Y", "Z"].map((k) => Math.max(...sections.map((s) => s[k])));
  const full = hi.map((h, i) => (h - lo[i] + 1) * 16);
  // 先铺进区段对齐的大格子，再裁到真正有方块的范围（区段是 16³，边上大多是空的）
  const palette = [AIR], index = new Map([["minecraft:air{}", 0]]);
  const keyOf = (b) => b.Name + JSON.stringify(b.Properties || {});
  const grid = new Uint32Array(full[0] * full[1] * full[2]);
  const [FX, FY, FZ] = full;
  let min = [Infinity, Infinity, Infinity], max = [-1, -1, -1];
  for (const s of sections) {
    const raw = s.BlockStates?.palette || [];
    const map = raw.map((b) => {
      if (VOID_IDS.has(b.Name) || AIR_IDS.has(b.Name)) return 0;
      const k = keyOf(b);
      if (!index.has(k)) { index.set(k, palette.length); palette.push({ id: b.Name, props: b.Properties || {} }); }
      return index.get(k);
    });
    const bits = Math.max(4, Math.ceil(Math.log2(Math.max(raw.length, 2))));
    const values = raw.length <= 1 ? new Uint16Array(4096) : unpackSection(s.BlockStates.data || new Int32Array(0), bits, 4096);
    const ox = (s.X - lo[0]) * 16, oy = (s.Y - lo[1]) * 16, oz = (s.Z - lo[2]) * 16;
    for (let y = 0, i = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++, i++) {
      const v = map[values[i]] || 0;
      if (!v) continue;
      const gx = ox + x, gy = oy + y, gz = oz + z;
      grid[gx * FY * FZ + gy * FZ + gz] = v;
      if (gx < min[0]) min[0] = gx; if (gy < min[1]) min[1] = gy; if (gz < min[2]) min[2] = gz;
      if (gx > max[0]) max[0] = gx; if (gy > max[1]) max[1] = gy; if (gz > max[2]) max[2] = gz;
    }
  }
  if (max[0] < 0) min = [0, 0, 0], max = [0, 0, 0];
  const size = max.map((m, i) => m - min[i] + 1);
  const [sx, sy, sz] = size;
  const blocks = new Uint32Array(sx * sy * sz);
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    blocks[x * sy * sz + y * sz + z] = grid[(x + min[0]) * FY * FZ + (y + min[1]) * FZ + (z + min[2])];
  }
  const blockEntities = new Map();
  for (const be of data.BlockEntities || []) {
    const x = (be.X ?? be.x) - lo[0] * 16 - min[0], y = (be.Y ?? be.y) - lo[1] * 16 - min[1], z = (be.Z ?? be.z) - lo[2] * 16 - min[2];
    if (x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz) blockEntities.set(`${x},${y},${z}`, be);
  }
  return {
    name: header.Name || "", author: header.Author || "", description: (header.Tags || []).join(", "),
    source: "bp", version: `Axiom v${header.Version ?? 1}`, declared: header.BlockCount || 0,
    meta: { DataVersion: data.DataVersion || 3953 },
    // 蓝图自带的缩略图（PNG）：右边第一张卡片显示
    previewPng: png.length ? URL.createObjectURL(new Blob([png], { type: "image/png" })) : null,
    regions: [{ name: "blueprint", origin: [0, 0, 0], size, palette, blocks, blockEntities, entities: [],
      raw: { kind: "bp", palette: palette.map((b) => ({ Name: b.id, ...(Object.keys(b.props).length ? { Properties: b.props } : {}) })), offset: 0 } }],
  };
}

// ---------------------------------------------------------------- .vschem（Valkyrien Skies / VMod 的船只蓝图）
//
// 照 Valkyrien-Ship-Schematics（ShipSchematic.kt、SchemSerializeDataV1Impl.kt）和 VMod（VModShipSchematicV2.kt）：
//   varint 长度 + "vschem" | varint 长度 + 类型名 | gzip NBT：
//     shipData { maxObjectPos?, data: [ { id, rptc?(世界里相对整体中心), csb_m?/csb_M?(船体包围盒，相对船中心),
//                                         pcp?(船在船坞里的中心), pcomp?, sc(缩放), rot?(四元数 w x y z) } ] }
//     blockPalette: [方块状态]   gridData { "船 id": [ { x, y, z(相对船中心的整数格), pid, edi } ] }
//     extraBlockData: [方块实体]   entityData { "船 id": [ { pos?, entity } ] }
//     extraData { 名字: 字节 }：VMod 的物理连接（绳子、铰链、滑轨……）是其中一份 gzip NBT，里面 vmod_VEntities 列表，
//       每项 { VEntityType, data { shipId1, shipId2, sPos1{x,y,z}, sPos2{x,y,z}, … } }（sPos 是船坞坐标）
//
// 船在世界里可以是任意角度，但这里是方块格子：每条船的旋转对齐到最近的 90°，各占一个子区域；
// 只绕竖轴转的话方块朝向一起转。物理连接按同样的变换画成线

function readVarInt(bytes, p) {
  let v = 0, shift = 0, b;
  do { b = bytes[p++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  return [v, p];
}
function readUtf(bytes, p) {
  const [n, q] = readVarInt(bytes, p);
  return [new TextDecoder().decode(bytes.subarray(q, q + n)), q + n];
}
// long 原样转十进制字符串（船 id 可能超过 2^53，plain() 转 number 会丢精度）
const longStr = (tag) => { const [h, l] = tag.getAsPair(); return (BigInt.asIntN(64, (BigInt(h) << 32n) | BigInt(l >>> 0))).toString(); };
const vec = (o, p) => [o[p + "x"] || 0, o[p + "y"] || 0, o[p + "z"] || 0];

// 四元数 → 3×3 矩阵，再对齐成最近的「轴对齐」旋转（每行取绝对值最大的那一列，带符号）
function snappedRotation(q) {
  const { x, y, z, w } = q;
  const m = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], used = new Set();
  // 按「最确定」的元素先选，保证三行选到三个不同的列
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push([Math.abs(m[r][c]), r, c]);
  cells.sort((a, b) => b[0] - a[0]);
  const rowDone = new Set();
  for (const [, r, c] of cells) {
    if (rowDone.has(r) || used.has(c)) continue;
    out[r][c] = Math.sign(m[r][c]) || 1;
    rowDone.add(r); used.add(c);
  }
  return out;
}
const mulM = (m, v) => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);

// 只绕竖轴转（第 2 行是 [0, 1, 0]）时，方块的朝向属性跟着转。turns：顺时针（从上往下看）转几个 90°
const H = ["north", "east", "south", "west"];
function yawTurns(m) {
  if (m[1][1] !== 1) return null;
  const north = mulM(m, [0, 0, -1]); // 本地的北转到了哪
  const dir = north[2] === -1 ? "north" : north[0] === 1 ? "east" : north[2] === 1 ? "south" : "west";
  return H.indexOf(dir);
}
function rotateProps(props, turns) {
  if (!turns) return props;
  const out = { ...props };
  const turn = (d) => (H.includes(d) ? H[(H.indexOf(d) + turns) % 4] : d);
  if ("facing" in props) out.facing = turn(props.facing);
  if ("axis" in props && turns % 2) out.axis = props.axis === "x" ? "z" : props.axis === "z" ? "x" : props.axis;
  if ("rotation" in props && /^\d+$/.test(props.rotation)) out.rotation = String((+props.rotation + turns * 4) % 16);
  // 栅栏、墙、红石线这类四个方向的连接
  if (H.every((d) => d in props)) for (const d of H) out[turn(d)] = props[d];
  if ("shape" in props && /^(north_south|east_west)$/.test(props.shape) && turns % 2) out.shape = props.shape === "north_south" ? "east_west" : "north_south";
  return out;
}

// 物理连接的中文 / 英文名在 app.js（按 VEntityType 查翻译），这里只认出类型
function readVschem(bytes) {
  let p = 0, kind, type;
  [kind, p] = readUtf(bytes, p);
  if (kind !== "vschem") throw new Error("not a VMod ship schematic (.vschem)");
  [type, p] = readUtf(bytes, p);
  const rootTag = deepslate.NbtFile.read(bytes.subarray(p), {}).root;
  const root = plain(rootTag);
  const rawShips = rootTag.getCompound("shipData").getList("data");
  const ships = (root.shipData?.data || []).map((s, i) => {
    const csbM = [s.csb_mx, s.csb_my, s.csb_mz], csbX = [s.csb_Mx, s.csb_My, s.csb_Mz];
    const pcp = vec(s, "pcp");
    // 船坞里的包围盒 = 相对中心的包围盒 + 中心取整；保存方块时的「船中心」是包围盒的整数中点
    const minYard = csbM.map((v, a) => v + Math.round(pcp[a])), maxYard = csbX.map((v, a) => v + Math.round(pcp[a]));
    const centerInt = minYard.map((v, a) => Math.trunc((maxYard[a] - v) / 2) + v);
    const rot = s.rotw === undefined ? { x: 0, y: 0, z: 0, w: 1 } : { x: s.rotx, y: s.roty, z: s.rotz, w: s.rotw };
    const m = snappedRotation(rot);
    return { id: longStr(rawShips.get(i).get("id")), rel: vec(s, "rptc"), pcp, centerInt, scale: s.sc || 1, m, turns: yawTurns(m) };
  });
  const byId = new Map(ships.map((s) => [s.id, s]));
  // 船坞坐标 → 整体坐标（相对整个蓝图的中心）
  const rawWorld = (ship, yard) => {
    const d = mulM(ship.m, yard.map((v, a) => (v - ship.pcp[a]) * ship.scale));
    return d.map((v, a) => v + ship.rel[a]);
  };
  // 连接点 / 实体用这个：方块是按中心点向下取整进格子的（船的中心常在 .5 上，方块中心落在整数上，
  // 取整会让整条船错开半格），delta 就是这个错开量，跟着挪同样的量才和画出来的方块对得上
  const toWorld = (ship, yard) => rawWorld(ship, yard).map((v, a) => v + (ship.delta?.[a] || 0));

  const paletteSrc = (root.blockPalette || []).map((b) => ({ id: b.Name, props: b.Properties || {} }));
  const extraBlocks = root.extraBlockData || [];
  const gridTag = rootTag.getCompound("gridData");
  const built = [];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  gridTag.forEach((key, listTag) => {
    const ship = byId.get(key) || byId.get(String(BigInt(key)));
    if (!ship) return;
    const cells = [];
    for (const item of listTag.getItems()) {
      const o = plain(item);
      const yard = [o.x + ship.centerInt[0] + 0.5, o.y + ship.centerInt[1] + 0.5, o.z + ship.centerInt[2] + 0.5];
      const center = rawWorld(ship, yard);
      ship.delta ||= center.map((c) => Math.floor(c) - (c - 0.5)); // 第一格定下这条船的取整偏移
      const w = center.map(Math.floor);
      cells.push({ w, pid: o.pid, edi: o.edi });
      for (let a = 0; a < 3; a++) { if (w[a] < lo[a]) lo[a] = w[a]; if (w[a] > hi[a]) hi[a] = w[a]; }
    }
    built.push({ ship, cells });
  });
  if (!built.length) throw new Error("no ship blocks");

  // 每条船一个子区域
  const regions = built.map(({ ship, cells }, n) => {
    const rlo = [Infinity, Infinity, Infinity], rhi = [-Infinity, -Infinity, -Infinity];
    for (const c of cells) for (let a = 0; a < 3; a++) { rlo[a] = Math.min(rlo[a], c.w[a]); rhi[a] = Math.max(rhi[a], c.w[a]); }
    const size = rhi.map((h, a) => h - rlo[a] + 1), [sx, sy, sz] = size;
    const palette = [AIR], index = new Map();
    const blocks = new Uint32Array(sx * sy * sz), blockEntities = new Map();
    for (const c of cells) {
      const src = paletteSrc[c.pid];
      if (!src || AIR_IDS.has(src.id)) continue;
      if (!index.has(c.pid)) { index.set(c.pid, palette.length); palette.push({ id: src.id, props: rotateProps(src.props, ship.turns) }); }
      const [x, y, z] = c.w.map((v, a) => v - rlo[a]);
      blocks[x * sy * sz + y * sz + z] = index.get(c.pid);
      if (c.edi >= 0 && extraBlocks[c.edi]) blockEntities.set(`${x},${y},${z}`, extraBlocks[c.edi]);
    }
    const entities = (root.entityData?.[ship.id] || []).map((e) => {
      const yard = vec(e, "pos").map((v, a) => v + ship.pcp[a]);
      return { id: e.entity?.id || "minecraft:unknown", nbt: e.entity || {}, pos: toWorld(ship, yard).map((v, a) => v - rlo[a]) };
    });
    return { name: `Ship ${n + 1}`, origin: rlo.map((v, a) => v - lo[a]), size, palette, blocks, blockEntities, entities, shipId: ship.id };
  });

  // 物理连接：在 extraData 里找 VMod 的那份（gzip NBT，有 vmod_VEntities）
  const links = [], unplaced = {};
  const extra = rootTag.get("extraData");
  extra?.forEach?.((name, tag) => {
    let entities;
    try {
      const nbt = deepslate.NbtFile.read(new Uint8Array(tag.getItems().map((b) => b.getAsNumber() & 0xff)), {}).root;
      entities = nbt.get("vmod_VEntities");
    } catch { return; }
    if (!entities) return;
    for (const item of entities.getItems()) {
      const type = item.getString("VEntityType").replace(/^.*\./, "");
      const data = item.getCompound("data");
      const a = data.get("shipId1"), b = data.get("shipId2");
      const p1 = data.get("sPos1"), p2 = data.get("sPos2");
      const s1 = a && byId.get(longStr(a)), s2 = b && byId.get(longStr(b));
      if (!s1 || !s2 || !p1 || !p2) { unplaced[type] = (unplaced[type] || 0) + 1; continue; } // 连着地面（-1）或者单点的（推进器……）
      const pt = (t) => [t.getNumber("x"), t.getNumber("y"), t.getNumber("z")];
      links.push({ type, a: toWorld(s1, pt(p1)).map((v, k) => v - lo[k]), b: toWorld(s2, pt(p2)).map((v, k) => v - lo[k]), ships: [s1.id, s2.id] });
    }
  });

  return {
    name: "", author: "", description: "", source: "vschem", version: type.replace(/^.*\./, ""), declared: 0,
    meta: { DataVersion: 3953 },
    links, unplacedLinks: unplaced, shipCount: ships.length,
    regions: regions.map((r) => normalise(r)),
  };
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

export const EXTENSIONS = [".litematic", ".nbt", ".mcstructure", ".schem", ".schematic", ".bp", ".vschem"];

// 解析前要先准备的数据：老 .schematic 要数字 ID 对照表（异步加载一次）
export async function prepareFormat(fileName) {
  if (/\.schematic$/i.test(fileName)) await loadLegacy();
}
// 栅栏 / 玻璃板 / 墙会连上「完整不透明的方块」：用 opaque.js 那张表
const isOpaqueBlock = (id) => typeof OPAQUE_BLOCKS !== "undefined" && OPAQUE_BLOCKS.has(id);

export function parse(fileName, bytes) {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  const stem = fileName.slice(0, fileName.length - ext.length);
  let structure;
  const read = (options) => deepslate.NbtFile.read(bytes, options).root;
  if (ext === ".litematic") structure = readLitematic(read({}));
  else if (ext === ".nbt") structure = readJavaNbt(read({}));
  else if (ext === ".mcstructure") structure = readMcstructure(read({ littleEndian: true }));
  else if (ext === ".schem") structure = readSchem(read({}));
  else if (ext === ".schematic") structure = readSchematic(read({}), isOpaqueBlock);
  else if (ext === ".bp") structure = readBp(bytes);
  else if (ext === ".vschem") structure = readVschem(bytes);
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
