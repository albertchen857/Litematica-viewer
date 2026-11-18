// 把结构导出成一个 Java 版存档（虚空世界，里面只有这个投影），打成 zip 下载。
// 逐个照搬桌面版 script/lv/world.py，两边规则必须一致，改一边记得改另一边。
//
// 解压后的文件夹直接丢进 .minecraft/saves 就能进。结构从 (0, 64, 0) 开始放，
// 玩家出生在结构南边上方，创造模式、飞行。
//
// 区块按 1.18 ~ 1.21.4 的格式写（DataVersion 封顶 4189）：游戏打开旧存档会自己升级，
// 新版本才有的方块名升级器不认识也不会动，所以新投影照样能完整进新游戏。
//
//   <存档>/level.dat            gzip NBT，世界设置（虚空超平坦、游戏规则、玩家位置）
//   <存档>/icon.png             存档列表里的小图（缩略图）
//   <存档>/region/r.X.Z.mca     方块和方块实体，32×32 个区块一个文件
//   <存档>/entities/r.X.Z.mca   1.17 起实体单独存一份

import { flatten, compoundWith, compounds, doubles, floats, entityPos } from "./writers.js";
import { zip } from "./zip.js";

const DATA_VERSION_MIN = 2860;     // 1.18：区块改成 sections + block_states 调色板的第一版
const DATA_VERSION_MAX = 4189;     // 1.21.4：见上面，封顶交给游戏自己升级
const DATA_VERSION_DEFAULT = 3953; // 1.21
const WORLD_BOTTOM = -64, WORLD_TOP = 320;
const SECTION_MIN = WORLD_BOTTOM / 16, SECTION_MAX = WORLD_TOP / 16; // -4 .. 19

// 方块实体 id 和方块 id 不一致的几类。没写 id 的方块实体游戏会直接丢掉。
const BLOCK_ENTITY_IDS = [
  ["_hanging_sign", "minecraft:hanging_sign"], ["_sign", "minecraft:sign"],
  ["_banner", "minecraft:banner"], ["_bed", "minecraft:bed"],
  ["_head", "minecraft:skull"], ["_skull", "minecraft:skull"],
  ["shulker_box", "minecraft:shulker_box"], ["command_block", "minecraft:command_block"],
];

const D = () => globalThis.deepslate;
const int = (v) => new (D().NbtInt)(v | 0);
const byte = (v) => new (D().NbtByte)(v | 0);
const str = (v) => new (D().NbtString)(String(v));
const long = (n) => new (D().NbtLong)([Math.floor(n / 4294967296), n % 4294967296 | 0]);
const strings = (values) => new (D().NbtList)(values.map(str));

function dataVersion(structure) {
  const meta = structure.meta || {};
  const v = +(meta.mc_version || meta.DataVersion || DATA_VERSION_DEFAULT);
  return Math.max(DATA_VERSION_MIN, Math.min(DATA_VERSION_MAX, v || DATA_VERSION_DEFAULT));
}

// ---------------------------------------------------------------- 区块

// 4096 个调色板下标压进 long 数组（1.16 起的规则）：每个下标占 max(4, 位数) 位，
// 一个 long 里能放几个放几个，剩下的位空着，不跨 long。long 用 [高 32 位, 低 32 位] 表示
function pack(values, paletteSize) {
  const bits = Math.max(4, Math.ceil(Math.log2(paletteSize)));
  const perLong = Math.floor(64 / bits);
  const longs = [];
  for (let start = 0; start < values.length; start += perLong) {
    let lo = 0, hi = 0;
    for (let j = 0; j < perLong && start + j < values.length; j++) {
      const v = values[start + j], shift = j * bits;
      if (shift >= 32) hi |= v << (shift - 32);
      else {
        lo |= v << shift;
        if (shift + bits > 32) hi |= v >>> (32 - shift);
      }
    }
    longs.push([hi | 0, lo | 0]);
  }
  return new (D().NbtLongArray)(longs);
}

const blockTag = (block) => compoundWith(null, {
  Name: str(block.id),
  Properties: Object.keys(block.props).length
    ? compoundWith(null, Object.fromEntries(Object.entries(block.props).map(([k, v]) => [k, str(v)])))
    : undefined,
});

function chunkTag(region, cx, cz, baseY, blockEntities, version) {
  const [sx, sy, sz] = region.size;
  const sections = [];
  const voidBiome = compoundWith(null, { palette: strings(["minecraft:the_void"]) });
  for (let sectionY = SECTION_MIN; sectionY < SECTION_MAX; sectionY++) {
    // 这个 16³ 小块里每格对应结构的哪个调色板下标，结构外面补空气。区块里的顺序是 y*256 + z*16 + x
    const cube = new Uint32Array(4096);
    let any = false;
    const y0 = sectionY * 16 - baseY;
    for (let y = 0; y < 16; y++) {
      const ry = y0 + y;
      if (ry < 0 || ry >= sy) continue;
      for (let z = 0; z < 16; z++) {
        const rz = cz * 16 + z;
        if (rz >= sz) continue;
        for (let x = 0; x < 16; x++) {
          const rx = cx * 16 + x;
          if (rx >= sx) continue;
          const v = region.blocks[rx * sy * sz + ry * sz + rz];
          if (v) { cube[y * 256 + z * 16 + x] = v; any = true; }
        }
      }
    }
    let states;
    if (any) {
      const used = [...new Set(cube)].sort((a, b) => a - b);
      const local = new Map(used.map((g, i) => [g, i]));
      states = compoundWith(null, {
        palette: compounds(used.map((g) => blockTag(region.palette[g]))),
        data: pack(Array.from(cube, (g) => local.get(g)), used.length),
      });
    } else {
      states = compoundWith(null, { palette: compounds([blockTag(region.palette[0])]) });
    }
    sections.push(compoundWith(null, { Y: byte(sectionY), block_states: states, biomes: voidBiome }));
  }
  return compoundWith(null, {
    DataVersion: int(version),
    xPos: int(cx), zPos: int(cz), yPos: int(SECTION_MIN),
    Status: str("minecraft:full"),
    LastUpdate: long(0), InhabitedTime: long(0),
    // 光照和高度图都不写，isLightOn=0 让游戏进图时自己重算
    isLightOn: byte(0),
    sections: compounds(sections),
    block_entities: compounds(blockEntities),
    structures: compoundWith(null, { References: compoundWith(null, {}), starts: compoundWith(null, {}) }),
  });
}

function blockEntityTag(data, blockId, [x, y, z]) {
  const mapped = (BLOCK_ENTITY_IDS.find(([k]) => blockId.includes(k)) || [null, blockId])[1];
  return compoundWith(data, {
    id: data && data.id ? undefined : str(mapped),
    x: int(x), y: int(y), z: int(z),
    keepPacked: byte(0),
  });
}

// 所有实体换成世界坐标（flatten 已经把区域偏移加好了，这里只加 baseY）
function* entityTags(region, baseY, bedrock) {
  for (const entity of region.entities) {
    const [x, y0, z] = entityPos(entity), y = y0 + baseY;
    if (y < WORLD_BOTTOM || y >= WORLD_TOP) continue;
    // 基岩实体的 NBT 和 Java 完全两套，只保留 id 和位置
    const nbt = bedrock ? null : entity.nbt;
    const rotation = nbt && Array.isArray(nbt.Rotation) && nbt.Rotation.length === 2 ? nbt.Rotation : null;
    yield [compoundWith(nbt, {
      id: str((nbt && nbt.id) || entity.id || "minecraft:pig"),
      identifier: undefined,
      Pos: doubles([x, y, z]),
      UUID: undefined, // 类型转不回 int[4]，让游戏重新生成
      ...(rotation ? { Rotation: floats(rotation) } : {}),
    }), [x, y, z]];
  }
}

// Anvil 区域文件：8 KiB 文件头（位置表 + 时间戳），后面每个区块按 4 KiB 对齐
function regionFile(chunks) {
  const header = new Uint8Array(8192), view = new DataView(header.buffer);
  const parts = [header];
  let sector = 2;
  const now = Math.floor(Date.now() / 1000);
  for (const [[lx, lz], tag] of [...chunks].sort((a, b) => a[0][1] - b[0][1] || a[0][0] - b[0][0])) {
    const compressed = new (D().NbtFile)("", tag, "zlib", false, undefined).write();
    const length = 5 + compressed.length;
    const size = Math.ceil(length / 4096) * 4096;
    const payload = new Uint8Array(size), pv = new DataView(payload.buffer);
    pv.setUint32(0, compressed.length + 1);
    payload[4] = 2; // 2 = zlib
    payload.set(compressed, 5);
    const slot = 4 * (lx + lz * 32), sectors = size / 4096;
    view.setUint32(slot, (sector << 8) | Math.min(sectors, 255));
    view.setUint32(4096 + slot, now);
    parts.push(payload);
    sector += sectors;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// key "rx,rz" → Map([lx, lz] → tag)
function addToRegion(files, cx, cz, tag) {
  const key = `${cx >> 5},${cz >> 5}`;
  if (!files.has(key)) files.set(key, new Map());
  files.get(key).set([cx & 31, cz & 31], tag);
}

// ---------------------------------------------------------------- level.dat

const rules = (r) => compoundWith(null, Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)])));

function levelDat(name, version, [sx, sy, sz], baseY) {
  const flat = compoundWith(null, {
    type: str("minecraft:flat"),
    settings: compoundWith(null, {
      // 「虚空」预设：一层空气 + the_void 群系，不生成任何结构和装饰
      layers: compounds([compoundWith(null, { block: str("minecraft:air"), height: int(1) })]),
      biome: str("minecraft:the_void"),
      features: byte(0), lakes: byte(0),
      structure_overrides: new (D().NbtList)([], 8),
    }),
  });
  const noise = (settings, source) => compoundWith(null, {
    type: str("minecraft:noise"), settings: str(settings), biome_source: source,
  });
  const dimensions = compoundWith(null, {
    "minecraft:overworld": compoundWith(null, { type: str("minecraft:overworld"), generator: flat }),
    "minecraft:the_nether": compoundWith(null, {
      type: str("minecraft:the_nether"),
      generator: noise("minecraft:nether", compoundWith(null, { type: str("minecraft:multi_noise"), preset: str("minecraft:nether") })),
    }),
    "minecraft:the_end": compoundWith(null, {
      type: str("minecraft:the_end"),
      generator: noise("minecraft:end", compoundWith(null, { type: str("minecraft:the_end") })),
    }),
  });
  // 玩家悬在结构南侧上方，朝北略向下看，正好能看到全貌
  const player = compoundWith(null, {
    Pos: doubles([sx / 2, baseY + sy + 2, sz + 4]),
    Rotation: floats([180, 30]),
    Dimension: str("minecraft:overworld"),
    playerGameType: int(1),
    abilities: compoundWith(null, {
      flying: byte(1), mayfly: byte(1), instabuild: byte(1), invulnerable: byte(1), mayBuild: byte(1),
      flySpeed: new (D().NbtFloat)(0.05), walkSpeed: new (D().NbtFloat)(0.1),
    }),
  });
  const data = compoundWith(null, {
    DataVersion: int(version),
    version: int(19133),
    Version: compoundWith(null, { Id: int(version), Name: str("LitematicaViewer"), Series: str("main"), Snapshot: byte(0) }),
    LevelName: str(name),
    GameType: int(1), Difficulty: byte(0), hardcore: byte(0),
    allowCommands: byte(1), initialized: byte(1),
    LastPlayed: long(Date.now()),
    SpawnX: int(Math.floor(sx / 2)), SpawnY: int(baseY + sy + 1), SpawnZ: int(sz + 4),
    Time: long(0), DayTime: long(6000),
    raining: byte(0), thundering: byte(0),
    // 投影展示用：永远正午、不下雨、不刷怪、不随机刻（作物和火不会自己变）
    GameRules: rules({
      doDaylightCycle: "false", doWeatherCycle: "false", doMobSpawning: "false", doFireTick: "false",
      mobGriefing: "false", randomTickSpeed: "0", doTraderSpawning: "false", doPatrolSpawning: "false",
      doInsomnia: "false", spawnRadius: "0",
    }),
    WorldGenSettings: compoundWith(null, {
      seed: long(0), generate_features: byte(0), bonus_chest: byte(0), dimensions,
    }),
    DataPacks: compoundWith(null, { Enabled: strings(["vanilla"]), Disabled: new (D().NbtList)([], 8) }),
    enabled_features: strings(["minecraft:vanilla"]),
    Player: player,
  });
  return new (D().NbtFile)("", compoundWith(null, { Data: data }), "gzip", false, undefined).write();
}

// ---------------------------------------------------------------- 入口

// name：存档名（也是 zip 里的文件夹名）；icon：可选，PNG 字节（存档列表里的小图）
// 返回 { bytes: zip, chunks, entities, clipped }
export function exportWorld(structure, name, icon = null) {
  const region = flatten(structure);
  const version = dataVersion(structure);
  const [sx, sy, sz] = region.size;

  // 不高于 256 就从 y=64 开始放，太高就贴着世界底部放；还放不下的部分只能裁掉
  const baseY = sy <= WORLD_TOP - 64 ? 64 : WORLD_BOTTOM;
  const clipped = sy > WORLD_TOP - baseY;

  // ---- 方块 + 方块实体，按区块切
  const blockEntities = new Map();
  for (const [key, data] of region.blockEntities) {
    const [x, y, z] = key.split(",").map(Number);
    if (y + baseY >= WORLD_TOP) continue;
    const block = region.palette[region.blocks[x * sy * sz + y * sz + z]];
    const ck = `${x >> 4},${z >> 4}`;
    if (!blockEntities.has(ck)) blockEntities.set(ck, []);
    blockEntities.get(ck).push(blockEntityTag(data, block.id, [x, y + baseY, z]));
  }
  const regionFiles = new Map();
  let chunks = 0;
  for (let cx = 0; cx < Math.ceil(sx / 16); cx++) {
    for (let cz = 0; cz < Math.ceil(sz / 16); cz++) {
      addToRegion(regionFiles, cx, cz, chunkTag(region, cx, cz, baseY, blockEntities.get(`${cx},${cz}`) || [], version));
      chunks++;
    }
  }

  // ---- 实体，1.17 起放 entities/ 下面
  const entityChunks = new Map();
  let entities = 0;
  for (const [tag, [x, , z]] of entityTags(region, baseY, structure.source === "mcstructure")) {
    const ck = `${Math.floor(x) >> 4},${Math.floor(z) >> 4}`;
    if (!entityChunks.has(ck)) entityChunks.set(ck, []);
    entityChunks.get(ck).push(tag);
    entities++;
  }
  const entityFiles = new Map();
  for (const [ck, tags] of entityChunks) {
    const [cx, cz] = ck.split(",").map(Number);
    addToRegion(entityFiles, cx, cz, compoundWith(null, {
      DataVersion: int(version),
      Position: new (D().NbtIntArray)([cx, cz]),
      Entities: compounds(tags),
    }));
  }

  const files = [{ name: `${name}/level.dat`, data: levelDat(name, version, [sx, Math.min(sy, WORLD_TOP - baseY), sz], baseY) }];
  for (const [key, map] of regionFiles) {
    const [rx, rz] = key.split(",");
    files.push({ name: `${name}/region/r.${rx}.${rz}.mca`, data: regionFile(map) });
  }
  for (const [key, map] of entityFiles) {
    const [rx, rz] = key.split(",");
    files.push({ name: `${name}/entities/r.${rx}.${rz}.mca`, data: regionFile(map) });
  }
  if (icon) files.push({ name: `${name}/icon.png`, data: icon });
  return { bytes: zip(files), chunks, entities, clipped };
}
