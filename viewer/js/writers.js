// 统一模型 → 文件。逐个照搬桌面版 script/lv/formats.py 的 _save_litematic / _save_java_nbt /
// _save_mcstructure / flatten_regions，以及 ui_main.py 的 export_text（材料表 txt / csv）。
//
// 读文件时 formats.js 把原始 NBT 标签记在 RAW_TAG 里，这里写回时优先用原标签，
// 所以方块实体 / 实体里的 Byte、Short、Long 这些类型不会被抹成 Int / Double（比桌面版的 _from_python 更保真）。

import { RAW_TAG, isAir } from "./formats.js";
import { javaToBedrock, isWaterlogged } from "./blockmap.js";
import { unitParts } from "./analysis.js";

const D = () => globalThis.deepslate;
const LIST_COMPOUND = 10, LIST_INT = 3, LIST_LIST = 9;

// ---------------------------------------------------------------- 普通 JS 数据 → NBT（同 _from_python）

export function toTag(value) {
  const { NbtCompound, NbtList, NbtByte, NbtInt, NbtDouble, NbtString } = D();
  if (value && typeof value === "object" && RAW_TAG.has(value)) return RAW_TAG.get(value);
  if (Array.isArray(value)) return new NbtList(value.map(toTag));
  if (value && typeof value === "object") {
    const c = new NbtCompound();
    for (const [k, v] of Object.entries(value)) if (v !== undefined && v !== null) c.set(String(k), toTag(v));
    return c;
  }
  if (typeof value === "boolean") return new NbtByte(value ? 1 : 0);
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) < 2 ** 31 ? new NbtInt(value) : new NbtDouble(value);
  return new NbtString(String(value ?? ""));
}

// 在原标签的基础上改几个键（值是标签或普通数据，undefined = 删掉这个键），原标签不动
export function compoundWith(value, changes) {
  const { NbtCompound } = D();
  const base = value ? toTag(value) : null;
  const out = new NbtCompound();
  if (base && base.getId() === LIST_COMPOUND) base.forEach((k, v) => { if (!(k in changes)) out.set(k, v); });
  for (const [k, v] of Object.entries(changes)) if (v !== undefined) out.set(k, v instanceof D().NbtTag ? v : toTag(v));
  return out;
}

export const ints = (values) => new (D().NbtList)(values.map((v) => new (D().NbtInt)(v | 0)), LIST_INT);
export const doubles = (values) => new (D().NbtList)(values.map((v) => new (D().NbtDouble)(+v)));
export const floats = (values) => new (D().NbtList)(values.map((v) => new (D().NbtFloat)(+v)));
export const compounds = (tags) => new (D().NbtList)(tags, LIST_COMPOUND);
const xyzTag = ([x, y, z]) => compoundWith(null, { x: new (D().NbtInt)(x), y: new (D().NbtInt)(y), z: new (D().NbtInt)(z) });
const blockKey = (b) => b.id + JSON.stringify(Object.entries(b.props).sort());

// 实体坐标（相对区域）：读文件时已经放进 entity.pos；没有的话从 NBT 的 Pos 里掏（同 _entity_position）
export function entityPos(entity) {
  if (Array.isArray(entity.pos) && entity.pos.length >= 3) return entity.pos.slice(0, 3).map(Number);
  const raw = entity.nbt || {};
  const p = raw.Pos || raw.pos;
  return Array.isArray(p) && p.length >= 3 ? p.slice(0, 3).map(Number) : [0, 0, 0];
}

// ---------------------------------------------------------------- 多区域合并（同 flatten_regions）

// .nbt 和 .mcstructure 只支持单区域，多区域的 litematic 要先合并成一块
export function flatten(structure) {
  if (structure.regions.length === 1) return structure.regions[0];
  const lows = [0, 1, 2].map((i) => Math.min(...structure.regions.map((r) => r.origin[i])));
  const highs = [0, 1, 2].map((i) => Math.max(...structure.regions.map((r) => r.origin[i] + r.size[i])));
  const [sx, sy, sz] = highs.map((h, i) => h - lows[i]);

  const palette = [{ id: "minecraft:air", props: {} }], seen = new Map([[blockKey(palette[0]), 0]]);
  const blocks = new Uint32Array(sx * sy * sz);
  const blockEntities = new Map(), entities = [];
  for (const region of structure.regions) {
    const remap = region.palette.map((b) => {
      const key = blockKey(b);
      if (!seen.has(key)) seen.set(key, palette.push(b) - 1);
      return seen.get(key);
    });
    const [ox, oy, oz] = region.origin.map((v, i) => v - lows[i]);
    const [rx, ry, rz] = region.size;
    for (let x = 0, i = 0; x < rx; x++)
      for (let y = 0; y < ry; y++)
        for (let z = 0; z < rz; z++, i++) {
          const to = remap[region.blocks[i]];
          if (to) blocks[(x + ox) * sy * sz + (y + oy) * sz + z + oz] = to; // 空气不覆盖已有方块
        }
    for (const [key, data] of region.blockEntities) {
      const [x, y, z] = key.split(",").map(Number);
      blockEntities.set(`${x + ox},${y + oy},${z + oz}`, data);
    }
    for (const e of region.entities) {
      const p = entityPos(e);
      entities.push({ ...e, pos: [p[0] + ox, p[1] + oy, p[2] + oz] });
    }
  }
  return { name: "merged", origin: lows, size: [sx, sy, sz], palette, blocks, blockEntities, entities };
}

// 只留用到的调色板条目，空气固定 0 号
function compact(region) {
  const used = new Uint8Array(region.palette.length);
  for (const b of region.blocks) used[b] = 1;
  const palette = [{ id: "minecraft:air", props: {} }], map = new Uint32Array(region.palette.length);
  region.palette.forEach((b, i) => { if (used[i] && !isAir(b)) map[i] = palette.push(b) - 1; });
  return { palette, map };
}

// ---------------------------------------------------------------- .litematic（同 _save_litematic，按 litemapy 的写法）

// BlockStates：每格 bits 位紧密排在 long 里，可以跨 long（Litematica 的规则），顺序 y*sx*sz + z*sx + x
function packLitematic(values, bits) {
  const words = new Uint32Array(Math.ceil((values.length * bits) / 64) * 2);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!v) continue;
    const offset = i * bits, w = offset >>> 5, s = offset & 31;
    words[w] |= v << s;
    if (s + bits > 32) words[w + 1] |= v >>> (32 - s);
  }
  const longs = [];
  for (let i = 0; i < words.length; i += 2) longs.push([words[i + 1] | 0, words[i] | 0]); // [高 32 位, 低 32 位]
  return new (D().NbtLongArray)(longs);
}

export function writeLitematic(structure) {
  const { NbtInt, NbtLong, NbtString, NbtFile } = D();
  const meta = structure.meta || {};
  const regions = new (D().NbtCompound)();
  let totalBlocks = 0, totalVolume = 0;
  structure.regions.forEach((region, index) => {
    const [sx, sy, sz] = region.size;
    const { palette, map } = compact(region);
    const ordered = new Uint32Array(sx * sy * sz);
    for (let y = 0, i = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++, i++) {
          const v = map[region.blocks[x * sy * sz + y * sz + z]];
          ordered[i] = v;
          if (v) totalBlocks++;
        }
    totalVolume += sx * sy * sz;
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
    const paletteTags = palette.map((b) => compoundWith(null, {
      Name: new NbtString(b.id),
      Properties: Object.keys(b.props).length ? compoundWith(null, Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, new NbtString(String(v))]))) : undefined,
    }));
    const tiles = [...region.blockEntities].map(([key, data]) => {
      const [x, y, z] = key.split(",").map(Number);
      const block = region.palette[region.blocks[x * sy * sz + y * sz + z]];
      return compoundWith(data, {
        id: data && data.id ? undefined : new NbtString(block.id), // 同 setdefault("id", 方块 id)
        x: new NbtInt(x), y: new NbtInt(y), z: new NbtInt(z),
      });
    });
    // 基岩版实体用 identifier，Litematica 必须有 id，这里补上；坐标写回区域内坐标
    const entities = region.entities.map((e) => compoundWith(e.nbt, {
      id: new NbtString((e.nbt && e.nbt.id) || e.id || "minecraft:pig"),
      identifier: undefined,
      Pos: doubles(entityPos(e)),
    }));
    regions.set(region.name || `Region${index}`, compoundWith(null, {
      Position: xyzTag(region.origin), Size: xyzTag(region.size),
      BlockStatePalette: compounds(paletteTags),
      BlockStates: packLitematic(ordered, bits),
      TileEntities: compounds(tiles), Entities: compounds(entities),
      PendingBlockTicks: compounds([]), PendingFluidTicks: compounds([]),
    }));
  });

  const now = Date.now(), long = (n) => new NbtLong([Math.floor(n / 4294967296), n % 4294967296 | 0]);
  const box = enclosing(structure);
  const metadata = compoundWith(structure.metadata, {
    Name: new NbtString(structure.name || "Unnamed"),
    Author: new NbtString(structure.author || ""),
    Description: new NbtString(structure.description || ""),
    RegionCount: new NbtInt(structure.regions.length),
    TotalBlocks: new NbtInt(totalBlocks), TotalVolume: new NbtInt(totalVolume),
    ...(structure.metadata?.TimeCreated !== undefined ? {} : { TimeCreated: long(now) }), // 原文件有就保留
    TimeModified: long(now),
    EnclosingSize: xyzTag(box),
    // 缩略图（工具「缩略图」生成的 140×140 ARGB）：写进 Litematica 自己的预览图字段，游戏里的投影浏览界面能看到
    ...(structure.preview ? { PreviewImageData: new (D().NbtIntArray)(Array.from(structure.preview)) } : {}),
  });
  const lm = +meta.lm_version || 6;
  const root = compoundWith(null, {
    Version: new NbtInt(lm),
    SubVersion: lm >= 6 ? new NbtInt(+meta.sub_version || 1) : undefined,
    MinecraftDataVersion: new NbtInt(+meta.mc_version || +meta.DataVersion || 3953),
    Metadata: metadata,
    Regions: regions,
  });
  return new NbtFile("", root, "gzip", false, undefined).write();
}

function enclosing(structure) {
  const lo = [0, 1, 2].map((i) => Math.min(...structure.regions.map((r) => r.origin[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...structure.regions.map((r) => r.origin[i] + r.size[i])));
  return hi.map((h, i) => h - lo[i]);
}

// ---------------------------------------------------------------- .nbt（同 _save_java_nbt）

export function writeJavaNbt(structure) {
  const { NbtInt, NbtString, NbtFile } = D();
  const region = flatten(structure);
  const [sx, sy, sz] = region.size;
  const { palette, map } = compact(region);
  const paletteTags = palette.map((b) => compoundWith(null, {
    Name: new NbtString(b.id),
    Properties: Object.keys(b.props).length ? compoundWith(null, Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, new NbtString(String(v))]))) : undefined,
  }));
  const blocks = [];
  for (let x = 0, i = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++, i++) {
        const state = map[region.blocks[i]];
        if (!state) continue;
        const data = region.blockEntities.get(`${x},${y},${z}`);
        // 结构方块文件里的方块实体不带坐标（坐标在外面的 pos 里）
        blocks.push(compoundWith(null, {
          state: new NbtInt(state), pos: ints([x, y, z]),
          nbt: data ? compoundWith(data, { x: undefined, y: undefined, z: undefined }) : undefined,
        }));
      }
  const entities = region.entities.map((e) => {
    const [x, y, z] = entityPos(e);
    return compoundWith(null, {
      pos: doubles([x, y, z]), blockPos: ints([Math.floor(x), Math.floor(y), Math.floor(z)]),
      nbt: compoundWith(e.nbt, { id: new NbtString((e.nbt && e.nbt.id) || e.id || "minecraft:unknown"), identifier: undefined }),
    });
  });
  const meta = structure.meta || {};
  const root = compoundWith(null, {
    DataVersion: new NbtInt(+meta.DataVersion || +meta.mc_version || 3953),
    size: ints([sx, sy, sz]),
    palette: compounds(paletteTags),
    blocks: compounds(blocks),
    entities: compounds(entities),
  });
  return new NbtFile("", root, "gzip", false, undefined).write();
}

// ---------------------------------------------------------------- .mcstructure（同 _save_mcstructure）

// report：Set，收集状态没有对应规则的方块 id，界面上提示用户自查
export function writeMcstructure(structure, report = new Set()) {
  const { NbtInt, NbtString, NbtList, NbtFile } = D();
  const region = flatten(structure);
  const [sx, sy, sz] = region.size;
  const VERSION = 18168865;

  // 转成基岩 ID / 状态，含水方块拆出第二层
  const converted = region.palette.map((b) => (isAir(b) ? b : javaToBedrock(b, report)));
  const water = region.palette.map((b) => isWaterlogged(b));
  const paletteTags = [], remap = new Int32Array(converted.length);
  converted.forEach((b, i) => {
    if (isAir(b)) { remap[i] = -1; return; } // 基岩用 -1 表示这里没方块
    remap[i] = paletteTags.length;
    paletteTags.push(compoundWith(null, {
      name: new NbtString(b.id),
      states: compoundWith(null, Object.fromEntries(Object.entries(b.props).map(([k, v]) => [k, new NbtString(String(v))]))),
      version: new NbtInt(VERSION),
    }));
  });
  let waterIndex = -1;
  if (water.some(Boolean)) { // 第二层要放水，先确保调色板里有水
    waterIndex = paletteTags.length;
    paletteTags.push(compoundWith(null, {
      name: new NbtString("minecraft:water"), states: compoundWith(null, { liquid_depth: new NbtInt(0) }), version: new NbtInt(VERSION),
    }));
  }
  // 基岩也是 x*sy*sz + y*sz + z（ZYX 序），和统一模型的下标一样
  const primary = new Array(region.blocks.length), secondary = new Array(region.blocks.length);
  for (let i = 0; i < region.blocks.length; i++) {
    const b = region.blocks[i];
    primary[i] = new NbtInt(remap[b]);
    secondary[i] = new NbtInt(water[b] ? waterIndex : -1);
  }
  const positionData = new (D().NbtCompound)();
  for (const [key, data] of region.blockEntities) {
    const [x, y, z] = key.split(",").map(Number);
    positionData.set(String(sz * sy * x + sz * y + z), compoundWith(null, { block_entity_data: toTag(data) }));
  }
  // 基岩实体用 identifier 而不是 id，Pos 是世界坐标（读的时候减掉了原点，这里加回去）
  const entities = region.entities.map((e) => compoundWith(e.nbt, {
    id: undefined,
    identifier: new NbtString(e.id || "minecraft:unknown"),
    Pos: floats(entityPos(e).map((v, i) => v + region.origin[i])),
  }));
  const body = compoundWith(null, {
    block_indices: new NbtList([new NbtList(primary, LIST_INT), new NbtList(secondary, LIST_INT)], LIST_LIST),
    entities: compounds(entities),
    palette: compoundWith(null, {
      default: compoundWith(null, { block_palette: compounds(paletteTags), block_position_data: positionData }),
    }),
  });
  const root = compoundWith(null, {
    format_version: new NbtInt(1),
    size: ints([sx, sy, sz]),
    structure: body,
    structure_world_origin: ints(region.origin),
  });
  return new NbtFile("", root, "none", true, undefined).write();
}

// ---------------------------------------------------------------- 材料表（同 ui_main.export_text / _export_line）

// opts: { classified, csv, nameOf(id), unit(key), catLabel(cat), order: [分类…] }
export function exportText(result, { classified, csv, nameOf, unit, catLabel, order }) {
  const units = (n) => unitParts(n).map(([k, v]) => `${v}${unit(k)}`).join("");
  const line = (id, count) => {
    const name = id.split(":").pop();
    return csv ? `${nameOf(id)},${name},${count},${units(count)}\n` : `${count}[${units(count)}] | ${nameOf(id)} [${name}]\n`;
  };
  let out = "";
  if (classified) {
    const cats = Object.keys(result.categories);
    for (const cat of [...order.filter((c) => cats.includes(c)), ...cats.filter((c) => !order.includes(c))]) {
      const items = [...result.categories[cat]].sort((a, b) => b[1] - a[1]);
      if (!items.length) continue;
      out += `\n${catLabel(cat)}\n${"-".repeat(24)}\n`;
      for (const [id, count] of items) out += line(id, count);
    }
  } else {
    for (const [id, count] of [...result.materials].sort((a, b) => b[1] - a[1])) out += line(id, count);
  }
  return String.fromCharCode(0xfeff) + out; // 同桌面版 utf-8-sig，Excel 打开 csv 中文不乱码
}

export const SAVE_FORMATS = {
  ".litematic": (s) => ({ bytes: writeLitematic(s), report: new Set() }),
  ".nbt": (s) => ({ bytes: writeJavaNbt(s), report: new Set() }),
  ".mcstructure": (s) => { const report = new Set(); return { bytes: writeMcstructure(s, report), report }; },
};

export function download(name, data, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
