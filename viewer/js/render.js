// 3D 渲染：deepslate 0.27 的 StructureRenderer + 自己写的环绕相机、点选、实体标记。
//
// 贴图资源（resource/assets.js / atlas.png / icons.json）桌面版和网页版共用一份。
// assets 是 assets.js 定义的全局常量；NON_SELF_CULLING 来自 opaque.js。

const { mat4, vec3, vec4 } = glMatrix;
const BUILD_CHUNK = 20000; // 每次最多加这么多方块就让出主线程，大结构不会把页面卡死
const FOV = (70 * Math.PI) / 180; // 和 deepslate 的透视一致，点选算射线要用同一个

let resources = null;
let atlasImage = null;
let iconIndex = {}; // resource/icons.json：名字 → [u, v, 宽, 高, (染色)]，由 script/lv/atlas.py 生成

// ---------------------------------------------------------------- 资源

// 新版模型里贴图可以写成 {"sprite": "...", "force_translucent": true}（玻璃之类），统一摊回字符串
function plainTextures(model) {
  if (!model.textures) return model;
  const textures = {};
  for (const [k, v] of Object.entries(model.textures)) textures[k] = typeof v === "string" ? v : v.sprite || v.texture || "";
  return { ...model, textures };
}

// ---- 方块的渲染标记（不再用手写的透明表，直接从模型和贴图算）
//
//   semi_transparent：贴图里有半透明像素（玻璃、冰、史莱姆、染色玻璃……）或模型声明 force_translucent。
//                     deepslate 会把它们放进单独的透明网格最后画，后面的东西才透得出来。
//   opaque：模型是完整的 16³ 立方体、且贴图每个像素都不透明。只有这种才会挡住邻居的面；
//           台阶、楼梯、栅栏、树叶这类不算，旁边的面就不会被错误地剔掉留下空洞。
function textureAlpha(imageData, box, size) {
  if (!box) return { cut: false, partial: false };
  const [u, v, w, h] = box;
  let cut = false, partial = false;
  for (let y = v; y < v + Math.min(w, h); y++) {
    for (let x = u; x < u + w; x++) {
      const a = imageData.data[(y * size + x) * 4 + 3];
      if (a === 0) cut = true;
      else if (a < 255) partial = true;
    }
  }
  return { cut, partial };
}

function computeFlags(imageData, size) {
  const alpha = new Map(); // 贴图路径 → {cut, partial}
  const texAlpha = (path) => {
    const key = path.replace(/^minecraft:/, "");
    if (!alpha.has(key)) alpha.set(key, textureAlpha(imageData, assets.textures[key], size));
    return alpha.get(key);
  };
  // 顺着 parent 链合并 textures，找到 elements
  const chain = (name) => {
    const textures = {};
    let elements = null, translucent = false, seen = 0;
    while (name && seen++ < 16) {
      const m = assets.models[name.replace(/^minecraft:/, "")];
      if (!m) break;
      for (const [k, v] of Object.entries(m.textures || {})) {
        if (k in textures) continue;
        if (typeof v === "string") textures[k] = v;
        else { textures[k] = v.sprite || ""; translucent ||= !!v.force_translucent; }
      }
      if (!elements && m.elements) elements = m.elements;
      name = m.parent;
    }
    return { textures, elements, translucent };
  };
  const resolve = (textures, ref, depth = 0) => {
    const v = textures[ref];
    if (!v || depth > 8) return null;
    return v.startsWith("#") ? resolve(textures, v.slice(1), depth + 1) : v;
  };
  const fullCube = (elements) => elements && elements.length === 1 &&
    elements[0].from.every((v) => v === 0) && elements[0].to.every((v) => v === 16) &&
    Object.keys(elements[0].faces || {}).length === 6;

  const flags = {};
  for (const [id, state] of Object.entries(assets.blockstates)) {
    const models = [];
    for (const v of Object.values(state.variants || {})) models.push(...(Array.isArray(v) ? v : [v]).map((x) => x.model));
    for (const part of state.multipart || []) models.push(...(Array.isArray(part.apply) ? part.apply : [part.apply]).map((x) => x.model));
    let opaque = models.length > 0, semi = false;
    for (const model of new Set(models)) {
      const { textures, elements, translucent } = chain(model);
      const alphas = Object.keys(textures).map((k) => resolve(textures, k)).filter(Boolean).map(texAlpha);
      if (translucent || alphas.some((a) => a.partial)) semi = true;
      if (!fullCube(elements) || alphas.some((a) => a.cut || a.partial)) opaque = false;
    }
    if (/water|lava/.test(id)) { semi = id.includes("water"); opaque = false; }
    flags["minecraft:" + id] = { opaque: opaque && !semi, semi_transparent: semi, self_culling: !NON_SELF_CULLING.has("minecraft:" + id) };
  }
  return flags;
}

export async function loadResources() {
  iconIndex = await fetch("resource/icons.json").then((r) => r.json()).catch(() => ({}));
  atlasImage = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("atlas.png"));
    img.src = "resource/atlas.png";
  });

  const definitions = {}, models = {};
  for (const id in assets.blockstates) definitions["minecraft:" + id] = deepslate.BlockDefinition.fromJson(assets.blockstates[id]);
  for (const id in assets.models) models["minecraft:" + id] = deepslate.BlockModel.fromJson(plainTextures(assets.models[id]));
  for (const m of Object.values(models)) m.flatten({ getBlockModel: (id) => models[String(id)] });

  // 图集按 2 的幂取正方形读出来（deepslate 0.27 要求），UV 也按这个边长归一
  const size = 2 ** Math.ceil(Math.log2(Math.max(atlasImage.width, atlasImage.height)));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(atlasImage, 0, 0);
  const imageData = ctx.getImageData(0, 0, size, size);
  const uv = {};
  for (const id in assets.textures) {
    const [u, v, du, dv] = assets.textures[id];
    const dv2 = du !== dv && id.startsWith("block/") ? du : dv; // 动画贴图只取第一帧
    uv["minecraft:" + id] = [u / size, v / size, (u + du) / size, (v + dv2) / size];
  }
  const atlas = new deepslate.TextureAtlas(imageData, uv);
  const flags = computeFlags(imageData, size);

  // 贴图缺失的处理：
  //   新版（26.x）告示牌、床已经是普通方块模型，贴图都在图集里；但 deepslate 0.27 还会用「特殊渲染器」
  //   按旧版实体贴图（entity/signs/oak、entity/bed/white）再画一遍，图集里没有就画成黑块盖在上面。
  //   所以特殊渲染器只要用到图集里没有的贴图，这一块就不画它，只留方块模型（箱子这类贴图还在的照常画）。
  //   玩家头的 steve 皮肤新版也没了，换成同目录里有的皮肤。
  const aliases = new Map();
  let missingTexture = false;
  const textureUV = (id) => {
    let key = String(id);
    if (!(key in uv)) {
      if (!aliases.has(key)) {
        const folder = key.slice(0, key.lastIndexOf("/") + 1);
        aliases.set(key, folder.includes("entity/player/") ? Object.keys(uv).find((k) => k.startsWith(folder)) || null : null);
      }
      if (aliases.get(key)) key = aliases.get(key);
      else missingTexture = true;
    }
    return atlas.getTextureUV(key);
  };
  if (!deepslate.SpecialRenderers.__lvPatched) {
    const special = deepslate.SpecialRenderers.getBlockMesh;
    deepslate.SpecialRenderers.getBlockMesh = (state, nbt, res, cull) => {
      missingTexture = false;
      const mesh = special(state, nbt, res, cull);
      return missingTexture ? new deepslate.Mesh() : mesh;
    };
    deepslate.SpecialRenderers.__lvPatched = true;
  }

  resources = {
    getBlockDefinition: (id) => definitions[String(id)],
    getBlockModel: (id) => models[String(id)],
    getTextureUV: textureUV,
    getTextureAtlas: () => atlas.getTextureAtlas(),
    getBlockFlags: (id) => flags[String(id)] || { opaque: false, semi_transparent: false, self_culling: true },
    getBlockProperties: () => null,
    getDefaultBlockProperties: () => null,
  };
}

// ---------------------------------------------------------------- 表格图标

// 挑哪一块由 icons.json 决定（桌面版 atlas.py 生成，两边用同一张表）：有物品贴图的用物品贴图，
// 完整方块顺着模型链挑一张面贴图，草、树叶、水这些灰度贴图带一个染色值。实体查不到就试它的刷怪蛋。
const iconCache = new Map();
export function blockIcon(id, px = 20) {
  const name = String(id).replace(/^(entity:)?minecraft:/, "").split("[")[0];
  const key = name + "@" + px;
  if (iconCache.has(key)) return iconCache.get(key);
  const box = iconIndex[name] || iconIndex[name + "_spawn_egg"];
  let url = "";
  if (box && atlasImage) {
    const [u, v, w, h, tint] = box;
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(atlasImage, u, v, w, h, 0, 0, px, px);
    if (tint !== undefined) {
      // 先整块乘上群系色，再用原图的透明度把形状抠回来
      g.globalCompositeOperation = "multiply";
      g.fillStyle = "#" + tint.toString(16).padStart(6, "0");
      g.fillRect(0, 0, px, px);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(atlasImage, u, v, w, h, 0, 0, px, px);
    }
    url = c.toDataURL();
  }
  iconCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------- 视图

const AIR_RE = /:(cave_|void_)?air$/;
// deepslate 的特殊渲染器只注册了 16 种染色潜影盒，未染色的会整个不显示；画的时候借最接近的紫色
const RENDER_AS = { "minecraft:shulker_box": "minecraft:purple_shulker_box" };
const CHUNK = 8; // deepslate 的区块边长（StructureRenderer 的 chunkSize）
const stateOf = (b) => (b.id && !AIR_RE.test(b.id) ? new deepslate.BlockState(RENDER_AS[b.id] || b.id, b.props) : null);
// WASD 移动：跟着视角走。W/S 沿视线前后（往上看就往上飞），A/D 左右平移，空格 / Shift 竖直上下。
// 值是 [前后, 左右, 上下]
const MOVE_KEYS = {
  KeyW: [1, 0, 0], KeyS: [-1, 0, 0], KeyA: [0, -1, 0], KeyD: [0, 1, 0],
  Space: [0, 0, 1], ShiftLeft: [0, 0, -1], ShiftRight: [0, 0, -1],
};

// 给 deepslate 用的「活」结构：可以随时加减方块。deepslate 自己的 Structure 只能加不能删，
// 换步骤 / 换显示层时要整个重建；用这个只要改动那几格、重画受影响的区块。
// deepslate 只会调 getSize / getBlocks / getBlock 三个方法。
class LiveStructure {
  constructor(size) {
    this.size = size;
    this.map = new Map();
    this.list = null;
  }
  key(p) { return (p[0] * this.size[1] + p[1]) * this.size[2] + p[2]; }
  getSize() { return this.size; }
  getBlocks() { return this.list || (this.list = [...this.map.values()]); }
  getBlock(p) {
    if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= this.size[0] || p[1] >= this.size[1] || p[2] >= this.size[2]) return null;
    return this.map.get(this.key(p)) || null;
  }
  put(entry) { this.map.set(entry.key, entry.placed); this.list = null; }
  drop(entry) { this.map.delete(entry.key); this.list = null; }
}

// ---- 实体碰撞箱：按种类上色（用当前主题的五个颜色），尺寸取游戏里的碰撞箱（宽, 高）
const ENTITY_SIZE = {
  villager: [0.6, 1.95], wandering_trader: [0.6, 1.95], zombie: [0.6, 1.95], zombie_villager: [0.6, 1.95],
  husk: [0.6, 1.95], drowned: [0.6, 1.95], skeleton: [0.6, 1.99], stray: [0.6, 1.99], wither_skeleton: [0.7, 2.4],
  creeper: [0.6, 1.7], spider: [1.4, 0.9], cave_spider: [0.7, 0.5], enderman: [0.6, 2.9], witch: [0.6, 1.95],
  pillager: [0.6, 1.95], vindicator: [0.6, 1.95], evoker: [0.6, 1.95], piglin: [0.6, 1.95], zombified_piglin: [0.6, 1.95],
  iron_golem: [1.4, 2.7], snow_golem: [0.7, 1.9], cow: [0.9, 1.4], mooshroom: [0.9, 1.4], pig: [0.9, 0.9],
  sheep: [0.9, 1.3], chicken: [0.4, 0.7], horse: [1.3965, 1.6], donkey: [1.3965, 1.5], llama: [0.9, 1.87],
  wolf: [0.6, 0.85], cat: [0.6, 0.7], fox: [0.6, 0.7], rabbit: [0.4, 0.5], bee: [0.7, 0.6], slime: [1.02, 1.02],
  magma_cube: [1.02, 1.02], blaze: [0.6, 1.8], ghast: [4, 4], guardian: [0.85, 0.85], squid: [0.8, 0.8],
  armor_stand: [0.5, 1.975], item_frame: [0.75, 0.75], glow_item_frame: [0.75, 0.75], painting: [1, 1],
  item: [0.25, 0.25], experience_orb: [0.5, 0.5], tnt: [0.98, 0.98], falling_block: [0.98, 0.98],
  minecart: [0.98, 0.7], chest_minecart: [0.98, 0.7], hopper_minecart: [0.98, 0.7], furnace_minecart: [0.98, 0.7],
  tnt_minecart: [0.98, 0.7], command_block_minecart: [0.98, 0.7], spawner_minecart: [0.98, 0.7],
  boat: [1.375, 0.5625], chest_boat: [1.375, 0.5625], leash_knot: [0.375, 0.5], end_crystal: [2, 2],
  arrow: [0.5, 0.5], villager_baby: [0.3, 0.975],
};
// 分五类，对应主题的五个颜色：生物 / 摆设 / 载具 / 掉落物与投射物 / 其他
export function entityCategory(id) {
  const n = String(id).replace(/^minecraft:/, "");
  if (/(item_frame|painting|armor_stand|_display|leash_knot|end_crystal)$/.test(n)) return "decor";
  if (/(minecart|boat|raft)$/.test(n)) return "vehicle";
  if (/^(item|experience_orb|arrow|spectral_arrow|trident|tnt|falling_block|snowball|egg|ender_pearl|fireball|small_fireball|wind_charge)$/.test(n)) return "drop";
  if (ENTITY_SIZE[n] || /(zombie|skeleton|golem|villager|piglin|spider|cow|sheep|pig|horse)/.test(n)) return "mob";
  return "other";
}
const CATEGORY_COLOR = { mob: "PC", decor: "MC", vehicle: "TT", drop: "PR", other: "BG" };
function hexToRgb(hex) {
  const v = parseInt(String(hex).replace("#", ""), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export class View {
  // overlay：放实体标记的那层 div；onPick(命中信息 | null)：点了方块 / 实体 / 空白
  // onContext(命中信息, clientX, clientY)：右键点了一下（没拖动），给右键菜单用
  constructor(canvas, { overlay = null, onPick = () => {}, onContext = () => {} } = {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl");
    this.overlay = overlay;
    this.onPick = onPick;
    this.onContext = onContext;
    this.renderer = null;
    this.yaw = 0.8;
    this.pitch = 0.6;
    this.distance = 20;
    this.target = [0, 0, 0];
    this.frame = 0;
    this.building = 0;
    this.pending = new Map();  // 待重画的区块（替换方块后），见 queueChunks
    this.scene = null;    // {structure, box, entries, byY, byStep, live, filter}
    this.selected = null; // 选中方块的位置 [x,y,z]（相对包围盒），画白框
    this.markers = [];    // 实体：{el, pos, entity, size, category}
    this.hitboxMesh = null;
    this.theme = { MC: "#3399ff", PC: "#0066cc", BG: "#f8f9fa", TT: "#343a40", PR: "#babcc2" };
    this.moveSpeed = 12;      // WASD 每秒走几格，界面上可以调
    this.held = new Set();    // 正按着的移动键
    this.bindControls();
    this.bindKeys();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (!w || !h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.renderer) this.renderer.setViewport(0, 0, w, h);
    this.draw();
  }

  setTheme(theme) {
    this.theme = theme;
    this.rebuildHitboxes();
    for (const m of this.markers) m.el.style.setProperty("--cat", theme[CATEGORY_COLOR[m.category]]);
    this.draw();
  }

  // 结构 → 场景。先把所有非空气方块摊成条目（分批，onProgress 0~1），按 Y 和按步骤分好桶，
  // 之后换显示层、换步骤都只碰变化的那几桶方块。
  // 区域如果带 stepOf（分步拆解的结果），每格的步骤号就从那里来。
  async show(structure, box, { resetCamera = true, onProgress = () => {} } = {}) {
    const token = ++this.building; // 新的构建开始，旧的那次就作废
    const [sx, sy, sz] = box.size;
    const entries = [], byY = Array.from({ length: sy }, () => []), byStep = [];
    const total = structure.regions.reduce((s, r) => s + r.blocks.length, 0);
    let done = 0;
    for (const region of structure.regions) {
      const [, ry, rz] = region.size;
      const off = region.origin.map((o, i) => o - box.origin[i]);
      const states = region.palette.map(stateOf);
      for (let i = 0; i < region.blocks.length; i++) {
        const state = states[region.blocks[i]];
        if (state) {
          const local = [Math.floor(i / (ry * rz)), Math.floor(i / rz) % ry, i % rz];
          const pos = [local[0] + off[0], local[1] + off[1], local[2] + off[2]];
          const step = region.stepOf ? region.stepOf[i] : -1;
          const entry = {
            pos, step, region, local, block: region.palette[region.blocks[i]],
            key: (pos[0] * sy + pos[1]) * sz + pos[2],
            placed: { pos, state, nbt: undefined },
          };
          entry.placed.entry = entry; // 反查：点选时从 live 里拿到的方块直接找回条目
          entries.push(entry);
          byY[pos[1]].push(entry);
          if (step >= 0) (byStep[step] ||= []).push(entry);
        }
        if (++done % BUILD_CHUNK === 0) {
          onProgress(done / total);
          await new Promise((r) => setTimeout(r, 0));
          if (token !== this.building) return;
        }
      }
    }
    onProgress(1);

    const live = new LiveStructure([sx, sy, sz]);
    const filter = { layers: [0, sy - 1], step: byStep.length ? byStep.length - 1 : null };
    for (const e of entries) live.put(e);
    this.scene = { structure, box, entries, byY, byStep, live, filter };
    this.pending.clear();

    this.renderer = new deepslate.StructureRenderer(this.gl, live, resources, { chunkSize: CHUNK });
    // deepslate 0.27 的远平面写死 500 格，大结构拉远会被切掉；换成同样的透视、远平面放大
    this.renderer.getPerspective = () => {
      const m = mat4.create();
      mat4.perspective(m, FOV, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 20000);
      return m;
    };
    this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height);
    this.selected = null;
    this.buildMarkers(structure, box);
    if (resetCamera) {
      this.target = [sx / 2, sy / 2, sz / 2];
      this.distance = Math.max(sx, sy, sz) * 1.6 + 4;
      this.yaw = 0.8;
      this.pitch = 0.6;
    }
    this.draw();
  }

  // ---- 替换方块后的增量更新：只改动过的格子换状态，碰到的区块分批重画。
  // 不重建整个场景：没轮到的区块先保持旧样子，一批批换上新的，期间照常能转、能点。
  // changes: [{ pos: 相对包围盒的 [x,y,z], block: 新方块 }]；regionMap：旧区域对象 → 新区域对象
  applyChanges(changes, regionMap = null) {
    const sc = this.scene;
    if (!sc || !changes.length) return Promise.resolve();
    const [, sy, sz] = sc.box.size;
    sc.byKey ||= new Map(sc.entries.map((e) => [e.key, e]));
    const chunks = new Map();
    const mark = (p) => {
      const c = [Math.floor(p[0] / CHUNK), Math.floor(p[1] / CHUNK), Math.floor(p[2] / CHUNK)];
      if (c.every((v) => v >= 0)) chunks.set(c.join(","), c);
    };
    for (const { pos, block } of changes) {
      const e = sc.byKey.get((pos[0] * sy + pos[1]) * sz + pos[2]);
      if (!e) continue;
      e.block = block;
      e.placed.state = stateOf(block) || e.placed.state;
      if (!sc.live.getBlock(e.pos)) continue; // 现在没显示（被层 / 步骤藏起来）：轮到显示时自然是新的
      mark(e.pos);
      for (let a = 0; a < 3; a++) {
        const r = e.pos[a] % CHUNK;
        if (r === 0 || r === CHUNK - 1) { const q = e.pos.slice(); q[a] += r === 0 ? -1 : 1; mark(q); }
      }
    }
    if (regionMap) for (const e of sc.entries) if (regionMap.has(e.region)) e.region = regionMap.get(e.region);
    sc.live.list = null;
    return this.queueChunks([...chunks.values()]);
  }

  // 待重画的区块排队，后台一批批重画：deepslate 给每个方块做网格大约 0.2 ms，一批凑够约 250 个方块
  // 就让出主线程，所以转视角、点击都不受影响。还没轮到的区块先保持旧样子。
  // 新的改动来了不取消旧的，直接并进队列（连着替换好几次也不会漏画）
  queueChunks(list) {
    for (const c of list) this.pending.set(c.join(","), c);
    if (!this.drainPromise) {
      this.drainPromise = new Promise((resolve) => (this.drainDone = resolve));
      setTimeout(() => this.drainChunks(), 0); // 先让界面（表格、提示）更新出来，再开始画
    }
    return this.drainPromise;
  }

  drainChunks() {
    const sc = this.scene;
    if (!sc || !this.pending.size) {
      this.pending.clear();
      this.drainPromise = null;
      this.drainDone?.();
      return;
    }
    if (!sc.chunkCount) {
      sc.chunkCount = new Map();
      for (const e of sc.entries) {
        const k = e.pos.map((v) => Math.floor(v / CHUNK)).join(",");
        sc.chunkCount.set(k, (sc.chunkCount.get(k) || 0) + 1);
      }
    }
    const batch = [];
    let blocks = 0;
    for (const [k, c] of this.pending) {
      batch.push(c);
      this.pending.delete(k);
      blocks += sc.chunkCount.get(k) || 1;
      if (blocks >= 250) break;
    }
    this.renderer.updateStructureBuffers(batch);
    this.draw();
    setTimeout(() => this.drainChunks(), 0);
  }

  // ---- 缩略图：标准等轴（绕竖轴 45°、俯角 30°，同桌面版 snapshot.py），正交投影、带贴图。
  // 借主画面已经建好网格的渲染器：同一帧里临时换成等轴视角画一张、马上把像素取走，再换回来，
  // 用户看不到闪动（新建一个渲染器第一次做网格要好几秒，这样只要几十毫秒）。
  // 不管现在显示到哪层 / 哪步，画的都是整个结构。返回 size×size 的 canvas；background 为空就是透明底
  snapshot(size = 512, background = null) {
    const sc = this.scene;
    if (!sc || !this.renderer) return null;
    const full = { layers: [0, sc.box.size[1] - 1], step: sc.byStep.length ? sc.byStep.length - 1 : null };
    const before = sc.filter;
    const filtered = before.layers[0] !== full.layers[0] || before.layers[1] !== full.layers[1] || before.step !== full.step;
    if (filtered) this.setFilter(full);

    const [sx, sy, sz] = sc.box.size;
    const view = mat4.create();
    mat4.rotateX(view, view, Math.PI / 6);
    mat4.rotateY(view, view, Math.PI / 4);
    mat4.translate(view, view, [-sx / 2, -sy / 2, -sz / 2]);
    // 包围盒 8 个角投到视图里，算正交投影要框多大
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const x of [0, sx]) for (const y of [0, sy]) for (const z of [0, sz]) {
      const p = vec3.transformMat4(vec3.create(), [x, y, z], view);
      lo = lo.map((v, i) => Math.min(v, p[i]));
      hi = hi.map((v, i) => Math.max(v, p[i]));
    }
    const half = Math.max(hi[0] - lo[0], hi[1] - lo[1]) / 2 * 1.06; // 留一点边
    const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;

    const gl = this.gl, r = this.renderer, oldProj = r.projMatrix;
    const side = Math.min(this.canvas.width, this.canvas.height);
    gl.viewport(0, 0, side, side);
    r.projMatrix = mat4.ortho(mat4.create(), cx - half, cx + half, cy - half, cy + half, -hi[2] - 10, -lo[2] + 10);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    r.drawStructure(view);
    const out = document.createElement("canvas");
    out.width = out.height = size;
    const g = out.getContext("2d");
    if (background) { g.fillStyle = background; g.fillRect(0, 0, size, size); }
    g.imageSmoothingQuality = "high";
    // WebGL 的视口原点在左下，画布坐标原点在左上
    g.drawImage(this.canvas, 0, this.canvas.height - side, side, side, 0, 0, size, size);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    r.projMatrix = oldProj;
    if (filtered) this.setFilter(before);
    this.frame && cancelAnimationFrame(this.frame);
    this.frame = 0;
    // 同一帧里马上画回正常画面：等到下一帧再画的话，等轴图会在左下角露出一帧
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.renderNow();
    return out;
  }

  visible(entry, f) {
    if (entry.pos[1] < f.layers[0] || entry.pos[1] > f.layers[1]) return false;
    return f.step === null || entry.step <= f.step;
  }

  // 换显示层 / 换步骤：只看两次范围之间变了的那几桶，增删 live 里的方块，再只重画碰到的区块
  setFilter({ layers, step } = {}) {
    const sc = this.scene;
    if (!sc) return;
    const old = sc.filter;
    const next = { layers: layers || old.layers, step: step === undefined ? old.step : step };
    const touched = new Set();
    const consider = (list) => { if (list) for (const e of list) touched.add(e); };
    // 层：两次范围的并集里、只在一边的那些层
    const lo = Math.min(old.layers[0], next.layers[0]), hi = Math.max(old.layers[1], next.layers[1]);
    for (let y = lo; y <= hi; y++) {
      const inOld = y >= old.layers[0] && y <= old.layers[1], inNew = y >= next.layers[0] && y <= next.layers[1];
      if (inOld !== inNew) consider(sc.byY[y]);
    }
    // 步骤：新旧步骤号之间的那几步
    if (old.step !== null && next.step !== null && old.step !== next.step) {
      for (let k = Math.min(old.step, next.step) + 1; k <= Math.max(old.step, next.step); k++) consider(sc.byStep[k]);
    }
    const chunks = new Map();
    const mark = (p) => { const c = [Math.floor(p[0] / CHUNK), Math.floor(p[1] / CHUNK), Math.floor(p[2] / CHUNK)]; chunks.set(c.join(","), c); };
    for (const e of touched) {
      const was = this.visible(e, old), now = this.visible(e, next);
      if (was === now) continue;
      if (now) sc.live.put(e); else sc.live.drop(e);
      mark(e.pos);
      // 贴着区块边界的格子，邻居区块里挨着它的那个面也要重算（被挡 / 不被挡变了）
      for (let a = 0; a < 3; a++) {
        const r = e.pos[a] % CHUNK;
        if (r === 0 || r === CHUNK - 1) { const p = e.pos.slice(); p[a] += r === 0 ? -1 : 1; mark(p); }
      }
    }
    sc.filter = next;
    if (chunks.size) this.renderer.updateStructureBuffers([...chunks.values()].filter((c) => c.every((v) => v >= 0)));
    if (this.selected && !sc.live.getBlock(this.selected)) this.selected = null;
    this.placeMarkersVisibility();
    this.draw();
  }

  // ---- 相机：绕 target 转，左键拖转、右键拖平移、滚轮缩放

  viewMatrix() {
    const view = mat4.create();
    mat4.translate(view, view, [0, 0, -this.distance]);
    mat4.rotateX(view, view, this.pitch);
    mat4.rotateY(view, view, this.yaw);
    mat4.translate(view, view, this.target.map((v) => -v));
    return view;
  }

  draw() {
    if (!this.renderer || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  renderNow() {
    if (!this.renderer) return;
    const view = this.viewMatrix();
    this.renderer.drawStructure(view);
    this.renderer.drawGrid(view);
    if (this.hitboxMesh) {
      // 借 deepslate 画网格线的着色器画碰撞箱（和 drawOutline 同一套调用）
      this.renderer.setShader(this.renderer.gridShaderProgram);
      this.renderer.prepareDraw(view);
      this.renderer.drawMesh(this.hitboxMesh, { pos: true, color: true });
    }
    if (this.selected) this.renderer.drawOutline(view, this.selected);
    this.placeMarkers(view);
  }

  // ---- 实体：deepslate 不画实体。画一个按种类上色的碰撞箱，再在头顶贴一个图标，点图标看信息

  buildMarkers(structure, box) {
    for (const m of this.markers) m.el.remove();
    this.markers = [];
    for (const region of structure.regions) {
      const off = region.origin.map((o, i) => o - box.origin[i]);
      for (const entity of region.entities || []) {
        if (!Array.isArray(entity.pos) || this.markers.length >= 1000) continue;
        const pos = entity.pos.map((v, i) => Number(v) + off[i]);
        const name = String(entity.id).replace(/^minecraft:/, "");
        const size = ENTITY_SIZE[name] || [0.6, 1.8];
        const category = entityCategory(entity.id);
        const m = { pos, entity, size, category, el: null };
        if (this.overlay) {
          const el = document.createElement("button");
          el.className = "entity-marker";
          el.dataset.cat = category;
          el.title = entity.id;
          el.style.setProperty("--cat", this.theme[CATEGORY_COLOR[category]]);
          const icon = blockIcon(entity.id, 32);
          el.innerHTML = icon ? `<img src="${icon}" alt="">` : "<span>?</span>";
          el.addEventListener("click", (e) => { e.stopPropagation(); this.select(null); this.onPick({ kind: "entity", entity, pos }); });
          this.overlay.appendChild(el);
          m.el = el;
        }
        this.markers.push(m);
      }
    }
    this.rebuildHitboxes();
  }

  rebuildHitboxes() {
    if (!this.renderer) return;
    const Mesh = this.renderer.outlineMesh.constructor;
    const mesh = new Mesh();
    const layers = this.scene ? this.scene.filter.layers : [-Infinity, Infinity];
    for (const m of this.markers) {
      if (m.pos[1] < layers[0] || m.pos[1] > layers[1] + 1) continue;
      const [w, h] = m.size, [x, y, z] = m.pos;
      mesh.addLineCube(x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2, hexToRgb(this.theme[CATEGORY_COLOR[m.category]]));
    }
    this.hitboxMesh = mesh.rebuild(this.gl, { pos: true, color: true });
  }

  placeMarkersVisibility() {
    this.rebuildHitboxes();
  }

  placeMarkers(view) {
    if (!this.markers.length || !this.renderer) return;
    const clip = mat4.create();
    mat4.multiply(clip, this.renderer.projMatrix, view);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, p = vec4.create();
    const layers = this.scene ? this.scene.filter.layers : [-Infinity, Infinity];
    for (const m of this.markers) {
      if (!m.el) continue;
      vec4.transformMat4(p, [m.pos[0], m.pos[1] + m.size[1] + 0.3, m.pos[2], 1], clip); // 图标贴在碰撞箱头顶
      const outOfLayers = m.pos[1] < layers[0] || m.pos[1] > layers[1] + 1;
      if (p[3] <= 0 || outOfLayers) { m.el.hidden = true; continue; }
      const x = (p[0] / p[3] * 0.5 + 0.5) * w, y = (1 - (p[1] / p[3] * 0.5 + 0.5)) * h;
      m.el.hidden = x < -20 || y < -20 || x > w + 20 || y > h + 20;
      m.el.style.transform = `translate(${x - 12}px, ${y - 24}px)`;
    }
  }

  // ---- 点选：从相机沿鼠标方向打一条射线，在格子里一格格走（DDA），第一个看得见的方块就是它

  blockAt(x, y, z) {
    const sc = this.scene;
    if (!sc) return null;
    const placed = sc.live.getBlock([x, y, z]);
    if (!placed) return null;
    const entry = placed.entry;
    return { kind: "block", block: entry.block, pos: entry.pos, region: entry.region, local: entry.local };
  }

  pick(clientX, clientY) {
    if (!this.scene) return null;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const inv = mat4.invert(mat4.create(), this.viewMatrix());
    const t = Math.tan(FOV / 2), aspect = rect.width / rect.height;
    const origin = vec3.transformMat4(vec3.create(), [0, 0, 0], inv);
    const far = vec3.transformMat4(vec3.create(), [nx * t * aspect, ny * t, -1], inv);
    const dir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), far, origin));
    const size = this.scene.box.size;

    // 先把射线推到包围盒边上（相机在盒子外面时省掉前面那一大段空走）
    let tmin = 0, tmax = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dir[a]) < 1e-9) { if (origin[a] < 0 || origin[a] > size[a]) return null; continue; }
      let t1 = (0 - origin[a]) / dir[a], t2 = (size[a] - origin[a]) / dir[a];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
    }
    if (tmin > tmax) return null;
    const p = [0, 1, 2].map((a) => origin[a] + dir[a] * (tmin + 1e-4));
    const cell = p.map((v, a) => Math.min(size[a] - 1, Math.max(0, Math.floor(v))));
    const step = [0, 1, 2].map((a) => (dir[a] > 0 ? 1 : -1));
    const next = [0, 1, 2].map((a) => (Math.abs(dir[a]) < 1e-9 ? Infinity : ((cell[a] + (dir[a] > 0 ? 1 : 0)) - p[a]) / dir[a]));
    const delta = [0, 1, 2].map((a) => (Math.abs(dir[a]) < 1e-9 ? Infinity : Math.abs(1 / dir[a])));
    const live = this.scene.live;
    for (let i = 0; i < size[0] + size[1] + size[2] + 3; i++) {
      if (live.getBlock(cell)) return this.blockAt(...cell);
      const a = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
      cell[a] += step[a];
      if (cell[a] < 0 || cell[a] >= size[a]) return null;
      next[a] += delta[a];
    }
    return null;
  }

  select(pos) {
    this.selected = pos;
    this.draw();
  }

  // WASD 在世界里平移观察点（相机跟着走）。输入框里打字、弹窗开着的时候不算
  bindKeys() {
    const typing = (e) => e.target.closest?.("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]");
    window.addEventListener("keydown", (e) => {
      if (!MOVE_KEYS[e.code] || e.ctrlKey || e.metaKey || e.altKey || typing(e) || !this.scene) return;
      e.preventDefault(); // 空格别滚页面
      if (!this.held.size) { this.lastMove = performance.now(); requestAnimationFrame(() => this.moveTick()); }
      this.held.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.held.delete(e.code));
    window.addEventListener("blur", () => this.held.clear());
  }

  moveTick() {
    if (!this.held.size) return;
    const now = performance.now(), dt = Math.min(0.25, (now - this.lastMove) / 1000); // 掉帧时也按真实时间走，最多补 0.25 秒
    this.lastMove = now;
    let [fwd, side, up] = [0, 0, 0];
    for (const code of this.held) { const [f, s, u] = MOVE_KEYS[code]; fwd += f; side += s; up += u; }
    // 视线方向 / 右手方向：把相机坐标系的 -Z、+X 转回世界坐标（只取旋转部分）
    const rot = mat4.create();
    mat4.rotateX(rot, rot, this.pitch);
    mat4.rotateY(rot, rot, this.yaw);
    mat4.invert(rot, rot);
    const forward = vec3.transformMat4(vec3.create(), [0, 0, -1], rot);
    const right = vec3.transformMat4(vec3.create(), [1, 0, 0], rot);
    const dir = [0, 1, 2].map((i) => forward[i] * fwd + right[i] * side + (i === 1 ? up : 0));
    const len = Math.hypot(...dir) || 1;
    for (let i = 0; i < 3; i++) this.target[i] += (dir[i] / len) * this.moveSpeed * dt;
    this.draw();
    requestAnimationFrame(() => this.moveTick());
  }

  bindControls() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener("contextmenu", (e) => e.preventDefault()); // 右键留给平移
    c.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(),
               pan: e.button === 2 || e.button === 1 || e.shiftKey, button: e.button };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) {
        // 平移按当前视角的左右 / 上下方向挪 target，挪动量跟距离成正比，远看近看手感一样
        const k = this.distance / 600;
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        this.target[0] -= dx * cy * k;
        this.target[2] -= dx * sy * k;
        this.target[1] += dy * k;
      } else {
        this.yaw += dx * 0.008;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy * 0.008));
      }
      this.draw();
    });
    // 左键按下松开几乎没动 = 点了一下，不是拖：拿去点选方块
    c.addEventListener("pointerup", (e) => {
      const click = drag && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5 && performance.now() - drag.t0 < 500;
      if (click && drag.button === 0 && !drag.pan) {
        const hit = this.pick(e.clientX, e.clientY);
        this.select(hit ? hit.pos : null);
        this.onPick(hit);
      }
      // 右键点一下（没拖）= 右键菜单；拖动还是平移
      if (click && drag.button === 2) {
        const hit = this.pick(e.clientX, e.clientY);
        if (hit) { this.select(hit.pos); this.onContext(hit, e.clientX, e.clientY); }
      }
      drag = null;
    });
    c.addEventListener("pointercancel", () => (drag = null));
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.distance = Math.max(2, Math.min(4000, this.distance * Math.pow(1.0015, e.deltaY)));
      this.draw();
    }, { passive: false });
  }
}

export const getResources = () => resources; // 调试用
