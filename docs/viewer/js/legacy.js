// 老 .schematic（MCEdit / WorldEdit，1.12 及以前）：数字 ID → 现在的方块名，再按邻居补全「存档里不存」的状态。
// 和桌面版 script/lv/legacy.py 是同一套规则。
//
// 1.12 的存档只存 ID 和 0–15 的数值，楼梯拐角、栅栏 / 玻璃板 / 墙 / 红石线的连接、门上半截朝哪、
// 大箱子拼哪边，都是游戏按旁边的方块现算的。1.13 升级存档时（DataFixer）也是按邻居补的，这里照做一遍。
//
// 对照表 resource/legacy.json 由 tools/build_legacy.py 生成（源数据 PrismarineJS/minecraft-data，MIT）。

let table = null;
export async function loadLegacy() {
  if (!table) table = await fetch("resource/legacy.json").then((r) => r.json());
  return table;
}
export const legacyReady = () => !!table;

// "minecraft:oak_stairs[facing=east,half=bottom]" → { id, props }
export function parseState(text) {
  const s = String(text);
  const i = s.indexOf("[");
  if (i < 0) return { id: s.includes(":") ? s : `minecraft:${s}`, props: {} };
  const props = {};
  for (const pair of s.slice(i + 1, s.lastIndexOf("]")).split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) props[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  const id = s.slice(0, i);
  return { id: id.includes(":") ? id : `minecraft:${id}`, props };
}

// 数字 ID + 数值 → { id, props }；找不到这个数值就退回同 ID 的 0 号，再找不到算空气（记进 unknown）
export function legacyBlock(id, data, unknown) {
  const hit = table.blocks[`${id}:${data}`] || table.blocks[`${id}:0`];
  if (!hit) { unknown?.add(`${id}:${data}`); return { id: "minecraft:air", props: {} }; }
  return parseState(hit);
}
export function legacyItem(id, damage = 0) {
  if (typeof id === "string") return id.includes(":") ? id : `minecraft:${id}`;
  return table.items[`${id}:${damage}`] || table.items[`${id}:0`] || "minecraft:air";
}

// ---------------------------------------------------------------- 反过来：现在的方块 → 数字 ID（写 .schematic 用）
//
// 同一个方块名在表里有好几条（不同朝向、半边……），挑属性对得上最多的那条；对得一样多取数值小的。
// 1.13 以后才有的方块（铜、樱花木……）老版本里根本没有，返回 null，写的时候当空气并提示
let reverse = null;
function reverseTable() {
  if (reverse) return reverse;
  reverse = { blocks: new Map(), items: new Map() };
  for (const [key, state] of Object.entries(table.blocks)) {
    const { id, props } = parseState(state);
    const [num, data] = key.split(":").map(Number);
    if (!reverse.blocks.has(id)) reverse.blocks.set(id, []);
    reverse.blocks.get(id).push({ id: num, data, props });
  }
  for (const [key, name] of Object.entries(table.items)) {
    if (!reverse.items.has(name)) { const [id, damage] = key.split(":").map(Number); reverse.items.set(name, { id, damage }); }
  }
  return reverse;
}
export function toLegacy(block) {
  const list = reverseTable().blocks.get(block.id);
  if (!list) return null;
  let best = null, bestScore = -1;
  for (const c of list) {
    let score = 0;
    for (const k in c.props) if (block.props[k] === c.props[k]) score++;
    if (score > bestScore || (score === bestScore && c.data < best.data)) { best = c; bestScore = score; }
  }
  return best;
}
export function toLegacyItem(name) {
  return reverseTable().items.get(name) || null;
}

// ---------------------------------------------------------------- 按邻居补状态

const DIRS = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
const SIDES = Object.keys(DIRS);
const CW = { north: "east", east: "south", south: "west", west: "north" };
const CCW = { north: "west", west: "south", south: "east", east: "north" };
const OPP = { north: "south", south: "north", east: "west", west: "east" };
const axis = (d) => (d === "north" || d === "south" ? "z" : "x");

const isStairs = (b) => b && b.id.endsWith("_stairs");
const isDoor = (b) => b && b.id.endsWith("_door");
const isFence = (b) => b && b.id.endsWith("_fence");
const isGate = (b) => b && b.id.endsWith("_fence_gate");
const isPane = (b) => b && (b.id.endsWith("glass_pane") || b.id === "minecraft:iron_bars");
const isWall = (b) => b && b.id.endsWith("_wall");
const isWire = (b) => b && b.id === "minecraft:redstone_wire";
const isChest = (b) => b && (b.id === "minecraft:chest" || b.id === "minecraft:trapped_chest");
const DOUBLE_PLANTS = new Set(["sunflower", "lilac", "tall_grass", "large_fern", "rose_bush", "peony"].map((n) => `minecraft:${n}`));
// 红石线会朝它们连过去（同一层）
const REDSTONE_PARTS = /(^minecraft:(redstone_torch|redstone_wall_torch|lever|redstone_block|comparator|observer|daylight_detector|target|tripwire_hook|trapped_chest|lectern|detector_rail|redstone_wire))$|_button$|_pressure_plate$/;

// isOpaque(id)：完整、不透明的方块（栅栏、玻璃板、墙都会连上它）
export function fixLegacyNeighbors(region, isOpaque) {
  const [sx, sy, sz] = region.size;
  const { palette, blocks } = region;
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? null : palette[blocks[x * sy * sz + y * sz + z]]);
  const opaque = (b) => !!b && isOpaque(b.id);
  const states = new Map(); // 改过的格子：下标 → 新状态（全算完再写回，算的时候看的都是原状态）
  const get = (i) => states.get(i) || palette[blocks[i]];

  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    const i = x * sy * sz + y * sz + z;
    const b = palette[blocks[i]];
    if (!b || b.id === "minecraft:air") continue;
    const near = (d, dy = 0) => at(x + DIRS[d][0], y + dy, z + DIRS[d][2]);
    const set = (props, id = b.id) => states.set(i, { id, props: { ...b.props, ...props } });

    if (isStairs(b)) {
      // 照原版 StairBlock.getStairsShape
      const f = b.props.facing, h = b.props.half;
      const canTake = (d) => { const n = near(d); return !isStairs(n) || n.props.facing !== f || n.props.half !== h; };
      let shape = "straight";
      const front = near(f), back = near(OPP[f]);
      if (isStairs(front) && front.props.half === h && axis(front.props.facing) !== axis(f) && canTake(OPP[front.props.facing])) {
        shape = front.props.facing === CCW[f] ? "outer_left" : "outer_right";
      } else if (isStairs(back) && back.props.half === h && axis(back.props.facing) !== axis(f) && canTake(back.props.facing)) {
        shape = back.props.facing === CCW[f] ? "inner_left" : "inner_right";
      }
      set({ shape });
    } else if (isDoor(b)) {
      // 上半截只存了铰链 / 通电，下半截只存了朝向 / 开关：互相补
      if (b.props.half === "upper") {
        const low = at(x, y - 1, z);
        if (isDoor(low)) set({ facing: low.props.facing, open: low.props.open }, low.id);
      } else {
        const up = at(x, y + 1, z);
        if (isDoor(up)) set({ hinge: up.props.hinge, powered: up.props.powered });
      }
    } else if (DOUBLE_PLANTS.has(b.id) && b.props.half === "upper") {
      const low = at(x, y - 1, z);
      if (low && DOUBLE_PLANTS.has(low.id)) set({}, low.id); // 上半截是什么花由下半截决定
    } else if (isFence(b)) {
      const nether = b.id === "minecraft:nether_brick_fence";
      const props = {};
      for (const d of SIDES) {
        const n = near(d);
        props[d] = String((isFence(n) && (n.id === "minecraft:nether_brick_fence") === nether) ||
          (isGate(n) && axis(n.props.facing) !== axis(d)) || opaque(n));
      }
      set(props);
    } else if (isPane(b)) {
      const props = {};
      for (const d of SIDES) { const n = near(d); props[d] = String(isPane(n) || isWall(n) || opaque(n)); }
      set(props);
    } else if (isWall(b)) {
      const on = {};
      for (const d of SIDES) {
        const n = near(d);
        on[d] = isWall(n) || isPane(n) || (isGate(n) && axis(n.props.facing) !== axis(d)) || opaque(n);
      }
      const straight = (on.north && on.south && !on.east && !on.west) || (on.east && on.west && !on.north && !on.south);
      const props = { up: String(!straight) };
      for (const d of SIDES) props[d] = on[d] ? "low" : "none";
      set(props);
    } else if (isWire(b)) {
      const above = at(x, y + 1, z);
      const conn = {};
      for (const d of SIDES) {
        const n = near(d);
        if (isWire(n) || (n && REDSTONE_PARTS.test(n.id) && !(n.id === "minecraft:observer" && n.props.facing !== OPP[d]))) conn[d] = "side";
        else if (n?.id.endsWith("repeater") && axis(n.props.facing) === axis(d)) conn[d] = "side";
        else if (isWire(near(d, 1)) && opaque(n) && !opaque(above)) conn[d] = "up";       // 往上爬一格
        else if (isWire(near(d, -1)) && !opaque(n)) conn[d] = "side";                     // 往下走一格
        else conn[d] = "none";
      }
      const on = SIDES.filter((d) => conn[d] !== "none");
      if (on.length === 0) for (const d of SIDES) conn[d] = "side";            // 孤零零一格：画成十字（1.16 起的默认样子）
      else if (on.length === 1) conn[OPP[on[0]]] = "side";                     // 只连一边：对面也伸出去，成一条直线
      set(conn);
    }
  }

  // 大箱子：同朝向、并排的两个单箱子拼起来。type=left 的另一半在朝向的顺时针那边
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    const i = x * sy * sz + y * sz + z;
    const b = get(i);
    if (!isChest(b) || b.props.type !== "single") continue;
    const f = b.props.facing, d = DIRS[CW[f]];
    const px = x + d[0], pz = z + d[2];
    if (px < 0 || pz < 0 || px >= sx || pz >= sz) continue;
    const j = px * sy * sz + y * sz + pz, n = get(j);
    if (!isChest(n) || n.id !== b.id || n.props.facing !== f || n.props.type !== "single") continue;
    states.set(i, { id: b.id, props: { ...b.props, type: "left" } });
    states.set(j, { id: n.id, props: { ...n.props, type: "right" } });
  }

  // 写回：同样的状态共用一个调色板条目
  const index = new Map(palette.map((b, k) => [key(b), k]));
  for (const [i, s] of states) {
    const k = key(s);
    let p = index.get(k);
    if (p === undefined) { p = palette.length; palette.push(s); index.set(k, p); }
    blocks[i] = p;
  }
  return states.size;
}
const key = (b) => b.id + JSON.stringify(Object.keys(b.props).sort().map((k) => [k, b.props[k]]));
