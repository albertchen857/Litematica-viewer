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

  resources = {
    getBlockDefinition: (id) => definitions[String(id)],
    getBlockModel: (id) => models[String(id)],
    getTextureUV: (id) => atlas.getTextureUV(id),
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

export class View {
  // overlay：放实体标记的那层 div；onPick(命中信息 | null)：点了方块 / 实体 / 空白
  constructor(canvas, { overlay = null, onPick = () => {} } = {}) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl");
    this.overlay = overlay;
    this.onPick = onPick;
    this.renderer = null;
    this.yaw = 0.8;
    this.pitch = 0.6;
    this.distance = 20;
    this.target = [0, 0, 0];
    this.frame = 0;
    this.building = 0;
    this.shown = null;    // 当前显示的 {structure, box, layers}，点选时按它查方块
    this.selected = null; // 选中方块的位置 [x,y,z]（相对包围盒），画白框
    this.markers = [];    // 实体标记：{el, pos}
    this.bindControls();
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

  // 结构 → deepslate.Structure。分批加方块，onProgress(0~1)。layers = [yMin, yMax]
  async show(structure, box, { layers = null, resetCamera = true, onProgress = () => {} } = {}) {
    const token = ++this.building; // 新的构建开始，旧的那次就作废
    const [sx, sy, sz] = box.size;
    const target = new deepslate.Structure([sx, sy, sz]);
    const [yMin, yMax] = layers || [0, sy - 1];
    const total = structure.regions.reduce((s, r) => s + r.blocks.length, 0);
    let done = 0;

    for (const region of structure.regions) {
      const [, ry, rz] = region.size;
      const off = region.origin.map((o, i) => o - box.origin[i]);
      const defs = region.palette.map((b) => (b.id && !/:(cave_|void_)?air$/.test(b.id) ? b : null));
      for (let i = 0; i < region.blocks.length; i++) {
        const block = defs[region.blocks[i]];
        if (block) {
          const x = Math.floor(i / (ry * rz)), y = Math.floor(i / rz) % ry, z = i % rz;
          const wy = y + off[1];
          if (wy >= yMin && wy <= yMax) target.addBlock([x + off[0], wy, z + off[2]], block.id, block.props);
        }
        if (++done % BUILD_CHUNK === 0) {
          onProgress(done / total);
          await new Promise((r) => setTimeout(r, 0));
          if (token !== this.building) return; // 已经开始了更新的一次，这次不用建完
        }
      }
    }
    onProgress(1);

    this.renderer = new deepslate.StructureRenderer(this.gl, target, resources, { chunkSize: 8 });
    // deepslate 0.27 的远平面写死 500 格，大结构拉远会被切掉；换成同样的透视、远平面放大
    this.renderer.getPerspective = () => {
      const m = mat4.create();
      mat4.perspective(m, FOV, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 20000);
      return m;
    };
    this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height);
    this.shown = { structure, box, layers: [yMin, yMax] };
    this.selected = null;
    this.buildMarkers(structure, box, [yMin, yMax]);
    if (resetCamera) {
      this.target = [sx / 2, sy / 2, sz / 2];
      this.distance = Math.max(sx, sy, sz) * 1.6 + 4;
      this.yaw = 0.8;
      this.pitch = 0.6;
    }
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
      const view = this.viewMatrix();
      this.renderer.drawStructure(view);
      this.renderer.drawGrid(view);
      if (this.selected) this.renderer.drawOutline(view, this.selected);
      this.placeMarkers(view);
    });
  }

  // ---- 实体：deepslate 不画实体，用贴在屏幕上的小图标标出位置（刷怪蛋 / 物品图），可以点

  buildMarkers(structure, box, [yMin, yMax]) {
    for (const m of this.markers) m.el.remove();
    this.markers = [];
    if (!this.overlay) return;
    for (const region of structure.regions) {
      const off = region.origin.map((o, i) => o - box.origin[i]);
      for (const entity of region.entities || []) {
        if (!Array.isArray(entity.pos) || this.markers.length >= 1000) continue;
        const pos = entity.pos.map((v, i) => Number(v) + off[i]);
        if (pos[1] < yMin || pos[1] > yMax + 1) continue;
        const el = document.createElement("button");
        el.className = "entity-marker";
        el.title = entity.id;
        const icon = blockIcon(entity.id, 32);
        el.innerHTML = icon ? `<img src="${icon}" alt="">` : "<span>?</span>";
        el.addEventListener("click", (e) => { e.stopPropagation(); this.select(null); this.onPick({ kind: "entity", entity, pos }); });
        this.overlay.appendChild(el);
        this.markers.push({ el, pos });
      }
    }
  }

  placeMarkers(view) {
    if (!this.markers.length || !this.renderer) return;
    const clip = mat4.create();
    mat4.multiply(clip, this.renderer.projMatrix, view);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, p = vec4.create();
    for (const m of this.markers) {
      vec4.transformMat4(p, [m.pos[0], m.pos[1] + 0.5, m.pos[2], 1], clip);
      if (p[3] <= 0) { m.el.hidden = true; continue; } // 在相机后面
      const x = (p[0] / p[3] * 0.5 + 0.5) * w, y = (1 - (p[1] / p[3] * 0.5 + 0.5)) * h;
      m.el.hidden = x < -20 || y < -20 || x > w + 20 || y > h + 20;
      m.el.style.transform = `translate(${x - 12}px, ${y - 12}px)`;
    }
  }

  // ---- 点选：从相机沿鼠标方向打一条射线，在格子里一格格走（DDA），第一个实心方块就是它

  blockAt(x, y, z) {
    const { structure, box, layers } = this.shown;
    if (y < layers[0] || y > layers[1]) return null;
    for (const region of structure.regions) {
      const lx = x - (region.origin[0] - box.origin[0]), ly = y - (region.origin[1] - box.origin[1]), lz = z - (region.origin[2] - box.origin[2]);
      const [rx, ry, rz] = region.size;
      if (lx < 0 || ly < 0 || lz < 0 || lx >= rx || ly >= ry || lz >= rz) continue;
      const block = region.palette[region.blocks[lx * ry * rz + ly * rz + lz]];
      if (block && !/:(cave_|void_)?air$/.test(block.id)) {
        return { kind: "block", block, pos: [x, y, z], region, local: [lx, ly, lz] };
      }
    }
    return null;
  }

  pick(clientX, clientY) {
    if (!this.shown) return null;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = 1 - ((clientY - rect.top) / rect.height) * 2;
    const inv = mat4.invert(mat4.create(), this.viewMatrix());
    const t = Math.tan(FOV / 2), aspect = rect.width / rect.height;
    const origin = vec3.transformMat4(vec3.create(), [0, 0, 0], inv);
    const far = vec3.transformMat4(vec3.create(), [nx * t * aspect, ny * t, -1], inv);
    const dir = vec3.normalize(vec3.create(), vec3.sub(vec3.create(), far, origin));
    const size = this.shown.box.size;

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
    for (let i = 0; i < size[0] + size[1] + size[2] + 3; i++) {
      const hit = this.blockAt(...cell);
      if (hit) return hit;
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
      if (drag && drag.button === 0 && !drag.pan &&
          Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5 && performance.now() - drag.t0 < 500) {
        const hit = this.pick(e.clientX, e.clientY);
        this.select(hit ? hit.pos : null);
        this.onPick(hit);
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
