// 观光模式：第一人称参观投影，手感照 Minecraft 的旁观 / 创造模式（index.html 的 #tour-side 是它的面板）。
//
//   点左边的画面锁定鼠标（Esc 放出来）；鼠标转视角，画面中间有准星。
//   WASD 只在水平面上走（往上看按 W 也不会往上飘），空格上升 / 跳，Shift 下降 / 潜行，双击 W 疾跑。
//   「允许穿过方块」= 旁观模式：一直在飞、不碰方块。关掉 = 创造模式：方块有碰撞箱，有重力，
//   双击空格切换飞行，飞着落地就变回走路，走路能直接上 0.6 格高的台阶（台阶、半砖）。
//   中键：看准星指着的方块的属性（左上角的信息面板）；右键：开关门 / 活板门 / 栅栏门、拉杆、按钮……，容器就打开信息面板。
//   开门这类改动只是观光时看的，退出观光就还原，不改投影文件。
//
// 碰撞箱取方块模型里的长方体（按方块状态的旋转转好），栅栏 / 墙 / 栅栏门是 1.5 格高（同游戏），
// 花草、火把、告示牌、铁轨、水这些穿得过去。地面 y = 0（结构最底下一层的底面）一直是实心的。

import { getResources } from "./render.js";

const { mat4, vec3 } = glMatrix;

const WIDTH = 0.6, HEIGHT = 1.8, EYE = 1.62; // 玩家碰撞箱和眼睛高度（同游戏）
const STEP = 0.6;           // 走路能直接迈上去的高度
const GRAVITY = 32;         // 格 / 秒²（游戏里 0.08 格 / 刻²）
const JUMP = 9;             // 起跳速度：跳 1.25 格高
const TERMINAL = 78;        // 最大下落速度
const WALK_RATIO = 0.4;     // 走路速度 = 水平速度 × 0.4（默认 11 → 4.4 格 / 秒，和游戏里差不多）
const REACH = 48;           // 准星能指到多远的方块
const DOUBLE_TAP = 300;     // 双击的间隔（毫秒）
const SENSITIVITY = 0.0025; // 鼠标每像素转多少弧度
const EPS = 1e-7;
const FULL = [[0, 0, 0, 1, 1, 1]];

export const TOUR_DEFAULTS = { fov: 70, bright: 100, noclip: true, dim: "overworld", time: "day", hSpeed: 11, vSpeed: 8 };

// 维度 → 地板（render.js 的 ENVIRONMENTS）；维度 + 时间 → 光照颜色（乘在方块颜色上）
const DIM_FLOOR = { overworld: "grass", nether: "nether", end: "end" };
const LIGHT = {
  day: [1, 1, 1], sunset: [1, 0.84, 0.72], night: [0.42, 0.47, 0.66],
  nether: [1, 0.86, 0.78], end: [0.86, 0.82, 1],
};

// ---------------------------------------------------------------- 碰撞箱

// 没有碰撞箱、人能穿过去的方块（同游戏）
const PASS = new Set([
  "air", "cave_air", "void_air", "water", "lava", "bubble_column", "fire", "soul_fire", "light", "structure_void",
  "nether_portal", "end_portal", "end_gateway", "cobweb", "redstone_wire", "tripwire", "tripwire_hook", "lever",
  "short_grass", "grass", "tall_grass", "fern", "large_fern", "seagrass", "tall_seagrass", "kelp", "kelp_plant",
  "dead_bush", "bush", "firefly_bush", "short_dry_grass", "tall_dry_grass", "sweet_berry_bush", "nether_wart",
  "vine", "glow_lichen", "sculk_vein", "resin_clump", "cave_vines", "cave_vines_plant", "twisting_vines", "twisting_vines_plant",
  "weeping_vines", "weeping_vines_plant", "hanging_roots", "pale_hanging_moss", "spore_blossom",
  "crimson_roots", "warped_roots", "nether_sprouts", "crimson_fungus", "warped_fungus", "brown_mushroom", "red_mushroom",
  "sugar_cane", "wheat", "carrots", "potatoes", "beetroots", "melon_stem", "pumpkin_stem", "attached_melon_stem",
  "attached_pumpkin_stem", "torchflower_crop", "pitcher_crop", "pink_petals", "wildflowers", "leaf_litter", "frogspawn",
  "dandelion", "open_eyeblossom", "closed_eyeblossom", "poppy", "blue_orchid", "allium", "azure_bluet", "red_tulip",
  "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose",
  "torchflower", "golden_dandelion", "sunflower", "lilac", "peony", "rose_bush", "pitcher_plant", "mangrove_propagule",
  "small_dripleaf", "powder_snow",
]);
// 按名字结尾认的：火把、告示牌、旗帜、按钮、压力板、铁轨、树苗、珊瑚
const PASS_RE = /(torch|sign|banner|_button|pressure_plate|rail|_sapling|_coral|_coral_fan)$/;

const shapeCache = new WeakMap(); // 方块对象 → 碰撞箱列表（0~1 的方块内坐标）

function shapeOf(block) {
  let s = shapeCache.get(block);
  if (!s) shapeCache.set(block, (s = computeShape(block)));
  return s;
}

function computeShape(block) {
  const name = String(block.id).replace(/^minecraft:/, "");
  const props = Object.fromEntries(Object.entries(block.props || {}).map(([k, v]) => [k, String(v)]));
  if (PASS.has(name) || PASS_RE.test(name)) return [];
  if (/fence_gate$/.test(name) && props.open === "true") return [];
  if (/(^|_)chest$/.test(name)) return [[1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16]]; // 箱子是特殊渲染，模型里没有长方体
  if (/shulker_box$/.test(name)) return FULL;
  if (/(_skull|_head)$/.test(name) && !/^piston_head$|wall_/.test(name)) return [[0.25, 0, 0.25, 0.75, 0.5, 0.75]];
  const res = getResources();
  const def = res?.getBlockDefinition("minecraft:" + name);
  if (!def) return FULL;
  let variants;
  try { variants = def.getModelVariants(props); } catch { return FULL; }
  const boxes = [];
  for (const v of variants) {
    const id = String(v.model);
    const model = res.getBlockModel(id.includes(":") ? id : "minecraft:" + id);
    // 方块状态里的旋转：先绕 X 再绕 Y，绕方块中心（同 deepslate 的 BlockDefinition.getMesh）
    let m = null;
    if (v.x || v.y) {
      m = mat4.create();
      mat4.translate(m, m, [8, 8, 8]);
      mat4.rotateY(m, m, (-(v.y || 0) * Math.PI) / 180);
      mat4.rotateX(m, m, (-(v.x || 0) * Math.PI) / 180);
      mat4.translate(m, m, [-8, -8, -8]);
    }
    for (const el of model?.elements || []) {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const x of [el.from[0], el.to[0]]) for (const y of [el.from[1], el.to[1]]) for (const z of [el.from[2], el.to[2]]) {
        const p = m ? vec3.transformMat4(vec3.create(), [x, y, z], m) : [x, y, z];
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
      }
      if (hi.some((h, a) => h - lo[a] < 0.1)) continue; // 薄片（贴图用的平面）不挡人
      boxes.push([...lo.map((x) => Math.round(x * 1000) / 16000), ...hi.map((x) => Math.round(x * 1000) / 16000)]);
    }
  }
  // 栅栏、墙、栅栏门：碰撞箱 1.5 格高，跳不过去（同游戏）
  if (/(_fence|_wall|fence_gate)$/.test(name)) for (const b of boxes) b[4] = 1.5;
  return boxes;
}

// 一个长方体沿某根轴最多能走多远（被 boxes 里的挡住就停在它跟前）。b 和 boxes 都是 [x0, y0, z0, x1, y1, z1]
function clip(boxes, b, d, axis) {
  if (!d) return 0;
  const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
  for (const c of boxes) {
    if (c[o1 + 3] <= b[o1] + EPS || c[o1] >= b[o1 + 3] - EPS) continue;
    if (c[o2 + 3] <= b[o2] + EPS || c[o2] >= b[o2 + 3] - EPS) continue;
    if (d > 0 && c[axis] >= b[axis + 3] - EPS) d = Math.min(d, Math.max(0, c[axis] - b[axis + 3]));
    else if (d < 0 && c[axis + 3] <= b[axis] + EPS) d = Math.max(d, Math.min(0, c[axis + 3] - b[axis]));
  }
  return d;
}
const shift = (b, axis, d) => { b[axis] += d; b[axis + 3] += d; };

// ---------------------------------------------------------------- 右键：开门这类

const OPENABLE = /(?<!iron)_(door|trapdoor)$|fence_gate$/;

// 右键之后这格变成什么样；不能互动的返回 null
function toggled(block) {
  const name = String(block.id).replace(/^minecraft:/, "");
  const p = block.props || {};
  const flip = (k) => ({ ...p, [k]: p[k] === "true" ? "false" : "true" });
  if (OPENABLE.test(name) && "open" in p) return flip("open");
  if (name === "lever" && "powered" in p) return flip("powered");
  if (name === "daylight_detector" && "inverted" in p) return flip("inverted");
  if (name === "repeater" && "delay" in p) return { ...p, delay: String((+p.delay % 4) + 1) };
  if (name === "comparator" && "mode" in p) return { ...p, mode: p.mode === "compare" ? "subtract" : "compare" };
  if (name === "note_block" && "note" in p) return { ...p, note: String((+p.note + 1) % 25) };
  if (/_button$/.test(name) && "powered" in p) return { ...p, powered: "true" };
  return null;
}

// ---------------------------------------------------------------- 观光

export class Tour {
  // view：render.js 的 View；stage：画面那块（加 is-locked / data-env / data-time）
  // onInspect(命中 | null)：显示 / 关掉方块信息；isContainer(命中)：是不是容器；onStatus({ mode, pos, yaw, locked })
  constructor(view, { stage, onInspect = () => {}, isContainer = () => false, onStatus = () => {} } = {}) {
    this.view = view;
    this.canvas = view.canvas;
    this.stage = stage;
    this.onInspect = onInspect;
    this.isContainer = isContainer;
    this.onStatus = onStatus;
    this.active = false;
    this.locked = false;
    this.opts = { ...TOUR_DEFAULTS };
    this.player = { pos: [0, 0, 0], vel: [0, 0, 0], flying: true, onGround: false };
    this.keys = new Set();
    this.sprint = false;
    this.lastTap = {};
    this.changes = new Map(); // 观光时改过的格子：key → { pos, block: 原来的 }，退出时还原
    this.inspected = null;
    this.saved = null;        // 进观光前的环绕相机
    view.onSceneReady = (reset) => this.sceneChanged(reset);
    this.bind();
  }

  // ---- 进出
  enter() {
    if (this.active) return;
    const v = this.view;
    this.saved = { yaw: v.yaw, pitch: v.pitch, distance: v.distance, target: v.target.slice(), fov: v.fov, ortho: v.ortho };
    this.active = true;
    v.mode = "tour";
    v.setOrtho(false);
    v.select(null);
    this.apply();
    this.spawn();
    this.last = performance.now();
    requestAnimationFrame((t) => this.tick(t));
  }

  exit() {
    if (!this.active) return;
    if (this.locked) this.unlock();
    this.active = false;
    this.keys.clear();
    this.revert();
    const v = this.view, s = this.saved;
    v.mode = "orbit";
    v.envMargin = 24;
    Object.assign(v, { yaw: s.yaw, pitch: s.pitch, distance: s.distance, target: s.target, fov: s.fov });
    v.setOrtho(s.ortho);
    v.setLight(1, [1, 1, 1]);
    v.select(null);
    delete this.stage.dataset.time;
    this.inspected = null;
  }

  // 换了结构（打开新文件 / 还原）：观光时改的那些格子已经跟着旧场景没了；reset = 回到起点
  sceneChanged(reset) {
    this.changes.clear();
    if (!this.active) return;
    const v = this.view;
    // 观光时打开了新文件：退出观光时回到新文件的默认视角
    if (reset) this.saved = { ...this.saved, yaw: v.yaw, pitch: v.pitch, distance: v.distance, target: v.target.slice() };
    this.apply(); // 地板按新结构的大小重铺
    if (reset) this.spawn();
    else this.place();
  }

  // 起点：结构南边的地面上，往北看，退到整个结构差不多都在画面里
  spawn() {
    const sc = this.view.scene, p = this.player;
    const [sx, sy, sz] = sc ? sc.box.size : [0, 0, 0];
    const back = Math.max(sx, sy) / (2 * Math.tan((this.opts.fov * Math.PI) / 360)) * 0.8 + 3;
    p.pos = [sx / 2, 0, sz + back];
    p.vel = [0, 0, 0];
    p.flying = true;
    this.view.yaw = 0;
    this.view.pitch = -Math.min(0.6, Math.atan2(sy / 2 - EYE, back + sz / 2));
    this.place();
    this.status(true);
  }

  // 面板上的设置 → 画面
  apply(next = {}) {
    Object.assign(this.opts, next);
    const o = this.opts, v = this.view;
    if (!this.active) return;
    v.fov = (o.fov * Math.PI) / 180;
    // 地板铺远一点，看不到边
    const size = v.scene ? Math.max(v.scene.box.size[0], v.scene.box.size[2]) : 0;
    v.envMargin = Math.max(1024, Math.round(size * 4)); // 地板是一整块平面，铺多大都不费事
    if (o.noclip) this.player.flying = true;
    const dim = DIM_FLOOR[o.dim] ? o.dim : "";
    v.setEnvironment(DIM_FLOOR[dim] || null);
    this.stage.dataset.env = dim;
    this.stage.dataset.time = dim === "overworld" ? o.time : "";
    const tint = dim === "overworld" ? LIGHT[o.time] || LIGHT.day : LIGHT[dim] || LIGHT.day;
    v.setLight(Math.max(0.5, Math.min(2, o.bright / 100)), tint);
    this.status(true);
  }

  // ---- 输入
  bind() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      if (!this.locked) {
        if (e.button === 0) { this.clickAt = [e.clientX, e.clientY]; this.lock(); }
        return;
      }
      e.preventDefault();
      if (e.button === 1) this.inspect();
      else if (e.button === 2) this.use();
    });
    // 中键别出浏览器的自动滚动
    c.addEventListener("mousedown", (e) => { if (this.active && e.button === 1) e.preventDefault(); });
    document.addEventListener("pointerlockchange", () => this.setLocked(this.active && document.pointerLockElement === c));
    // 用 pointermove 不用 mousemove：按下时 preventDefault 了，浏览器会停发 mousemove
    document.addEventListener("pointermove", (e) => {
      if (!this.locked) return;
      // 没锁住鼠标时（浏览器不让锁）：光标藏起来，照样是移动鼠标就转头；光标到画面边上会一直转（见 tick 的 edgeTurn）。
      // 移动量自己按光标位置算：有的内嵌窗口不给 movementX
      let dx = e.movementX, dy = e.movementY;
      if (this.fake) {
        const last = this.cursor;
        this.cursor = [e.clientX, e.clientY];
        if (!last) return;
        dx = e.clientX - last[0];
        dy = e.clientY - last[1];
      }
      const v = this.view;
      v.yaw += dx * SENSITIVITY;
      v.pitch = Math.max(-1.5697, Math.min(1.5697, v.pitch + dy * SENSITIVITY));
      this.place();
    });
    window.addEventListener("keydown", (e) => {
      if (this.fake && e.code === "Escape") { this.setLocked(false); return; }
      if (!this.locked || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); // 空格别滚页面
      const now = performance.now();
      if (!e.repeat) {
        const tap = now - (this.lastTap[e.code] || 0) < DOUBLE_TAP;
        this.lastTap[e.code] = tap ? 0 : now;
        // 双击空格：飞 / 走（旁观模式一直在飞）
        if (tap && e.code === "Space" && !this.opts.noclip) {
          this.player.flying = !this.player.flying;
          this.player.vel[1] = 0;
          this.status(true);
        }
        if (tap && e.code === "KeyW") this.sprint = true; // 双击 W 疾跑
      }
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  // 锁定鼠标。浏览器不给锁（有些内嵌的网页窗口不支持）就退一步：光标照常显示，按住左键拖动转视角，键盘照常，Esc 退出。
  // Esc 刚退出来马上再点，浏览器会拒绝一下（SecurityError，要等约 1 秒），这种不算
  lock() {
    const fallback = (err) => {
      if (err?.name === "SecurityError" || !this.active) return;
      this.fake = true;
      this.setLocked(true);
      this.cursor = this.clickAt || null; // 从点下去的位置开始算移动量
    };
    try {
      const r = this.canvas.requestPointerLock();
      if (r?.catch) r.catch(fallback);
      else if (!this.canvas.requestPointerLock) fallback();
    } catch (err) { fallback(err); }
  }

  unlock() {
    if (this.fake) this.setLocked(false);
    else document.exitPointerLock();
  }

  setLocked(on) {
    if (!on) this.fake = false;
    this.cursor = null;
    this.locked = on;
    this.stage.classList.toggle("is-locked", on);
    this.stage.classList.toggle("is-fake", on && !!this.fake); // 没真锁住：光标还在，别藏
    if (!on) { this.keys.clear(); this.sprint = false; }
    this.status(true);
  }

  // ---- 每帧
  tick(now) {
    if (!this.active) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const before = this.player.pos.slice();
    // 掉帧时拆成小步走，不会一步穿过薄墙
    for (let left = dt; left > 1e-6; left -= 1 / 60) this.physics(Math.min(left, 1 / 60));
    const p = this.player;
    if (p.pos.some((x, i) => Math.abs(x - before[i]) > 1e-6)) this.place();
    this.edgeTurn(dt);
    // 上台阶：人一下子抬高了，镜头慢慢跟上去（约 0.1 秒），不是一下跳上去
    if (this.stepOffset) {
      this.stepOffset *= Math.exp(-dt * 18);
      if (Math.abs(this.stepOffset) < 1e-3) this.stepOffset = 0;
      this.place();
    }
    // 准星指着哪格：一帧最多算一次（鼠标一秒能报上千次移动）
    if (this.dirty) {
      this.dirty = false;
      const hit = this.aim(), v = this.view;
      v.selected = hit ? hit.pos : null;
      v.draw();
    }
    this.status();
    requestAnimationFrame((t) => this.tick(t));
  }

  // 锁不住鼠标时：光标在画面边上那一圈（宽度的 8%）就一直往那边转，越靠边转得越快
  edgeTurn(dt) {
    if (!this.fake || !this.cursor) return;
    const r = this.canvas.getBoundingClientRect(), v = this.view;
    const band = Math.max(24, Math.min(r.width, r.height) * 0.08);
    const push = (x, lo, hi) => (x < lo + band ? -(1 - Math.max(0, x - lo) / band) : x > hi - band ? 1 - Math.max(0, hi - x) / band : 0);
    const sx = push(this.cursor[0], r.left, r.right), sy = push(this.cursor[1], r.top, r.bottom);
    if (!sx && !sy) return;
    v.yaw += sx * 2.6 * dt;
    v.pitch = Math.max(-1.5697, Math.min(1.5697, v.pitch + sy * 1.6 * dt));
    this.place();
  }

  physics(dt) {
    const k = this.keys, o = this.opts, p = this.player, yaw = this.view.yaw;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const s = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const up = k.has("Space"), down = k.has("ShiftLeft") || k.has("ShiftRight");
    if (f <= 0) this.sprint = false;
    // 只在水平面上走：前方 = (sin yaw, 0, -cos yaw)，右手 = (cos yaw, 0, sin yaw)
    let wx = f * Math.sin(yaw) + s * Math.cos(yaw), wz = -f * Math.cos(yaw) + s * Math.sin(yaw);
    const len = Math.hypot(wx, wz);
    if (len) { wx /= len; wz /= len; }
    const flying = o.noclip || p.flying;
    let speed = o.hSpeed * (flying ? 1 : WALK_RATIO);
    if (this.sprint) speed *= flying ? 2 : 1.3;
    if (!flying && down) speed *= 0.3; // 潜行
    // 速度慢慢跟上（飞着有点滑，地上停得快，空中不好拐弯），和游戏里的惯性差不多
    const a = 1 - Math.exp(-dt * (flying ? 6 : p.onGround ? 20 : 3));
    p.vel[0] += (wx * speed - p.vel[0]) * a;
    p.vel[2] += (wz * speed - p.vel[2]) * a;
    if (flying) {
      p.vel[1] += (((up ? 1 : 0) - (down ? 1 : 0)) * o.vSpeed - p.vel[1]) * (1 - Math.exp(-dt * 12));
    } else {
      if (up && p.onGround) p.vel[1] = JUMP;
      p.vel[1] = Math.max(-TERMINAL, p.vel[1] - GRAVITY * dt);
    }
    for (let i = 0; i < 3; i++) if (Math.abs(p.vel[i]) < 1e-3 && !(i === 1 && !flying)) p.vel[i] = 0;
    this.move(p.vel[0] * dt, p.vel[1] * dt, p.vel[2] * dt);
  }

  // 玩家碰撞箱
  box(pos = this.player.pos) {
    const h = WIDTH / 2;
    return [pos[0] - h, pos[1], pos[2] - h, pos[0] + h, pos[1] + HEIGHT, pos[2] + h];
  }

  // 这个范围里所有方块的碰撞箱（世界坐标），外加 y = 0 的地面
  collect(lo, hi) {
    const out = [];
    if (lo[1] < 0) out.push([-1e6, -16, -1e6, 1e6, 0, 1e6]);
    const v = this.view, sc = v.scene;
    if (!sc) return out;
    const [sx, sy, sz] = sc.box.size, f = sc.filter;
    const x0 = Math.max(0, Math.floor(lo[0])), x1 = Math.min(sx - 1, Math.floor(hi[0]));
    const y0 = Math.max(0, Math.floor(lo[1]) - 1), y1 = Math.min(sy - 1, Math.floor(hi[1])); // 低一格：栅栏 1.5 格高
    const z0 = Math.max(0, Math.floor(lo[2])), z1 = Math.min(sz - 1, Math.floor(hi[2]));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const e = sc.byKey.get((x * sy + y) * sz + z);
      // 隐藏的种类、显示层外的不算（看不见的东西不挡人）
      if (!e || f.ignore?.has(e.block.id) || !v.inView(e, f)) continue;
      for (const b of shapeOf(e.block)) out.push([b[0] + x, b[1] + y, b[2] + z, b[3] + x, b[4] + y, b[5] + z]);
    }
    return out;
  }

  // 按 Y、X、Z 的顺序一根轴一根轴地走，被挡住就贴着停下（同游戏）
  slide(boxes, b, d) {
    const out = [0, 0, 0];
    for (const axis of [1, 0, 2]) {
      out[axis] = clip(boxes, b, d[axis], axis);
      shift(b, axis, out[axis]);
    }
    return out;
  }

  move(dx, dy, dz) {
    const p = this.player;
    if (this.opts.noclip) {
      p.pos[0] += dx; p.pos[1] += dy; p.pos[2] += dz;
      p.onGround = false;
      return;
    }
    const start = this.box();
    const reach = STEP + 0.1;
    const boxes = this.collect(
      [Math.min(start[0], start[0] + dx) - 1, Math.min(start[1], start[1] + dy) - 1, Math.min(start[2], start[2] + dz) - 1],
      [Math.max(start[3], start[3] + dx) + 1, Math.max(start[4], start[4] + dy) + reach, Math.max(start[5], start[5] + dz) + 1],
    );
    const flying = p.flying;
    let b = start.slice();
    let got = this.slide(boxes, b, [dx, dy, dz]);
    // 迈台阶：走路时（在地上）水平被挡，试试先抬高 0.6 再走、再落下，走得更远就用这个
    const blocked = got[0] !== dx || got[2] !== dz;
    if (blocked && !flying && (p.onGround || (dy < 0 && got[1] !== dy))) {
      const b2 = start.slice();
      const lift = clip(boxes, b2, STEP, 1);
      shift(b2, 1, lift);
      const hx = clip(boxes, b2, dx, 0); shift(b2, 0, hx);
      const hz = clip(boxes, b2, dz, 2); shift(b2, 2, hz);
      const drop = clip(boxes, b2, -lift + Math.min(0, dy), 1); shift(b2, 1, drop);
      if (hx * hx + hz * hz > got[0] * got[0] + got[2] * got[2] + 1e-9) {
        b = b2;
        got = [hx, lift + drop, hz];
        this.stepOffset = (this.stepOffset || 0) - (lift + drop); // 镜头先留在原来的高度，再慢慢跟上
      }
    }
    if (got[0] !== dx) p.vel[0] = 0;
    if (got[2] !== dz) p.vel[2] = 0;
    const hitY = Math.abs(got[1] - dy) > 1e-9;
    if (hitY) p.vel[1] = 0;
    p.onGround = (hitY && dy < 0) || (!flying && got[1] > 0 && dy <= 0);
    if (p.onGround && flying && dy < 0) { p.flying = false; this.status(true); } // 飞着落地 = 不飞了（同游戏）
    p.pos = [(b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2];
  }

  // 相机放到眼睛上；下一帧画（准星指着的方块画白框）
  place() {
    const v = this.view, p = this.player;
    v.distance = 0;
    v.target = [p.pos[0], p.pos[1] + EYE + (this.stepOffset || 0), p.pos[2]];
    this.dirty = true;
  }

  // 准星（画面正中）指着的方块
  aim() {
    if (!this.view.scene) return null;
    const r = this.canvas.getBoundingClientRect();
    const hit = this.view.pick(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return null;
    const eye = this.view.target;
    return Math.hypot(hit.pos[0] + 0.5 - eye[0], hit.pos[1] + 0.5 - eye[1], hit.pos[2] + 0.5 - eye[2]) <= REACH ? hit : null;
  }

  // ---- 中键 / 右键
  inspect() {
    const hit = this.aim();
    this.inspected = hit ? hit.pos : null;
    this.onInspect(hit);
  }

  use() {
    const hit = this.aim();
    if (!hit) return;
    const next = toggled(hit.block);
    if (next) {
      const block = { id: hit.block.id, props: next };
      const list = [{ pos: hit.pos, block }];
      // 门：上下两半一起开关
      if (/_door$/.test(hit.block.id) && hit.block.props.half) {
        const other = [hit.pos[0], hit.pos[1] + (hit.block.props.half === "lower" ? 1 : -1), hit.pos[2]];
        const o = this.view.blockAt(...other) || this.entryBlock(other);
        if (o && o.block.id === hit.block.id) list.push({ pos: other, block: { id: o.block.id, props: { ...o.block.props, open: next.open } } });
      }
      this.change(list);
      // 按钮：按下去过一会儿自己弹回来（石头 1 秒，木头 1.5 秒）
      if (/_button$/.test(hit.block.id)) {
        const pos = hit.pos, wood = !/(stone|blackstone)_button$/.test(hit.block.id);
        setTimeout(() => {
          const now = this.entryBlock(pos);
          if (this.active && now?.block.props.powered === "true") this.change([{ pos, block: { id: now.block.id, props: { ...now.block.props, powered: "false" } } }]);
        }, wood ? 1500 : 1000);
      }
      return;
    }
    // 容器：打开信息面板（物品格子），鼠标放出来好看
    if (this.isContainer(hit)) {
      this.inspected = hit.pos;
      this.onInspect(hit);
      this.unlock();
    }
  }

  // 场景里这格现在的方块（不管显不显示）
  entryBlock(pos) {
    const sc = this.view.scene;
    if (!sc) return null;
    const [sx, sy, sz] = sc.box.size;
    if (pos.some((v, i) => v < 0 || v >= [sx, sy, sz][i])) return null;
    const e = sc.byKey.get((pos[0] * sy + pos[1]) * sz + pos[2]);
    return e ? { block: e.block, pos: e.pos } : null;
  }

  change(list) {
    for (const c of list) {
      const key = c.pos.join(",");
      if (!this.changes.has(key)) this.changes.set(key, { pos: c.pos, block: this.entryBlock(c.pos)?.block });
    }
    this.view.applyChanges(list);
    // 信息面板正开着这一格：刷新成新的属性
    if (this.inspected && list.some((c) => String(c.pos) === String(this.inspected))) this.onInspect(this.view.blockAt(...this.inspected));
  }

  revert() {
    const list = [...this.changes.values()].filter((c) => c.block).map((c) => ({ pos: c.pos, block: c.block }));
    this.changes.clear();
    if (list.length) this.view.applyChanges(list);
  }

  // ---- 面板上的状态：模式 / 位置 / 朝向（每 150 毫秒最多报一次）
  status(force = false) {
    const now = performance.now();
    if (!force && now - (this.lastStatus || 0) < 150) return;
    this.lastStatus = now;
    const p = this.player;
    this.onStatus({
      mode: this.opts.noclip ? "spectator" : p.flying ? "fly" : "walk",
      pos: p.pos.slice(), yaw: this.view.yaw, locked: this.locked,
    });
  }
}
