// 三种结构文件 → 统一模型。和桌面版 script/lv/model.py + formats.py 是同一套思路：
//
//   Structure { name, author, description, source, version, declared, regions: [Region] }
//   Region    { name, origin:[x,y,z], size:[sx,sy,sz], palette:[{id, props}], blocks, blockEntities, entities }
//
//   blocks 是调色板下标的一维数组，下标 = x*sy*sz + y*sz + z（和 Python 的 numpy C 序一致），
//   palette[0] 永远是空气。后面的统计、渲染只认这个模型，不关心文件原来长什么样。
//
// NBT 解析用 deepslate 自带的 readNbt（能自动认 gzip；基岩版要传 littleEndian）。

const AIR = { id: "minecraft:air", props: {} };
const AIR_IDS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
export const isAir = (block) => AIR_IDS.has(block.id);

// ---------------------------------------------------------------- NBT → 普通 JS 对象

// deepslate 0.10 的标签长这样：{type, value}。列表是 {type:'list', value:{type:元素类型, value:[...]}}，
// 列表里的 compound 元素直接是「键 → 标签」的对象。long 是 [高32位, 低32位]。
function plain(tag) {
  if (!tag) return undefined;
  switch (tag.type) {
    case "compound": {
      const out = {};
      for (const key in tag.value) out[key] = plain(tag.value[key]);
      return out;
    }
    case "list":
      return tag.value.value.map((item) => plain({ type: tag.value.type, value: item }));
    case "long":
      return tag.value[0] * 4294967296 + (tag.value[1] >>> 0);
    default:
      return tag.value;
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

function readLitematic(root) {
  const meta = plain(root.Metadata) || {};
  const regions = [];
  for (const [name, tag] of Object.entries(root.Regions.value)) {
    const r = tag.value;
    const size = xyz(plain(r.Size));
    const pos = xyz(plain(r.Position));
    const [ax, ay, az] = size.map(Math.abs);
    // 尺寸可以是负的：区域从 Position 往负方向长。换成最小角当原点
    const origin = pos.map((p, i) => (size[i] < 0 ? p + size[i] + 1 : p));
    const palette = plain(r.BlockStatePalette).map((b) => ({ id: b.Name, props: b.Properties || {} }));
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
    const packed = unpackLitematic(r.BlockStates.value, bits, ax * ay * az);

    // Litematica 的顺序是 y*sx*sz + z*sx + x，换成统一的 x*sy*sz + y*sz + z
    const blocks = new Uint32Array(ax * ay * az);
    for (let y = 0, i = 0; y < ay; y++)
      for (let z = 0; z < az; z++)
        for (let x = 0; x < ax; x++, i++) blocks[x * ay * az + y * az + z] = packed[i];

    const blockEntities = new Map();
    for (const te of plain(r.TileEntities) || []) blockEntities.set(`${te.x},${te.y},${te.z}`, te);
    const entities = (plain(r.Entities) || []).map((e) => ({ id: e.id, pos: e.Pos, nbt: e }));
    regions.push(normalise({ name, origin, size: [ax, ay, az], palette, blocks, blockEntities, entities }));
  }
  // 和桌面版一样按 Litematica 自己的格式版本给出游戏版本范围
  const lm = plain(root.Version) || 0;
  return {
    name: meta.Name || "", author: meta.Author || "", description: meta.Description || "",
    source: "litematic", version: lm <= 3 ? "1.12 / 1.13" : lm <= 6 ? "1.14 ~ 1.20.5" : "1.20.6+",
    declared: meta.TotalBlocks || 0, regions,
  };
}

// ---------------------------------------------------------------- .nbt（Java 结构方块）

function readJavaNbt(root) {
  const data = plain({ type: "compound", value: root });
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
    regions: [normalise({ name: "structure", origin: [0, 0, 0], size, palette, blocks, blockEntities, entities })],
  };
}

// ---------------------------------------------------------------- .mcstructure（基岩版）

function readMcstructure(root) {
  const data = plain({ type: "compound", value: root });
  const [sx, sy, sz] = data.size;
  const body = data.structure;
  const def = body.palette.default;
  // TODO 基岩 → Java 的方块名 / 状态映射（桌面版 blockmap.py）还没搬过来，先原样用
  const palette = [AIR, ...def.block_palette.map((b) => ({ id: b.name, props: stringify(b.states || {}) }))];
  const primary = body.block_indices[0];
  // 基岩版也是 x*sy*sz + y*sz + z（ZYX 序），-1 是结构空位
  const blocks = new Uint32Array(sx * sy * sz);
  for (let i = 0; i < primary.length; i++) blocks[i] = primary[i] < 0 ? 0 : primary[i] + 1;
  const blockEntities = new Map();
  for (const [key, value] of Object.entries(def.block_position_data || {})) {
    const flat = Number(key);
    if (value.block_entity_data) {
      blockEntities.set(`${Math.floor(flat / (sz * sy))},${Math.floor(flat / sz) % sy},${flat % sz}`, value.block_entity_data);
    }
  }
  const entities = (body.entities || []).map((e) => ({ id: e.identifier || "minecraft:unknown", pos: e.Pos, nbt: e }));
  return {
    name: "", author: "", description: "", source: "mcstructure", version: data.format_version || 1, declared: 0,
    regions: [normalise({ name: "structure", origin: data.structure_world_origin || [0, 0, 0], size: [sx, sy, sz], palette, blocks, blockEntities, entities })],
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
  if (ext === ".litematic") structure = readLitematic(deepslate.readNbt(bytes).value);
  else if (ext === ".nbt") structure = readJavaNbt(deepslate.readNbt(bytes).value);
  else if (ext === ".mcstructure") structure = readMcstructure(deepslate.readNbt(bytes, { littleEndian: true }).value);
  else throw new Error(`unsupported: ${ext}`);
  structure.name = structure.name || stem;
  structure.fileName = fileName;
  return structure;
}

// 桌面版传过来的 payload.json（script/lv/render.py 的 build_payload）→ 统一模型。
// 每个区域只带非空气格子的线性下标和调色板下标（base64 二进制），这里铺回整块数组。
// 实体只带 id（够计数），方块实体不传：容器内容在桌面版主界面里看。
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
    const entities = (r.entities || []).map((id) => ({ id, nbt: {} }));
    return normalise({ name: r.name, origin: r.origin, size: r.size, palette: r.palette, blocks, blockEntities: new Map(), entities });
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
