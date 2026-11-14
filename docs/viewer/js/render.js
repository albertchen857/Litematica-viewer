// 3D 渲染：deepslate 的 StructureRenderer + 自己写的环绕相机。
//
// 贴图资源（resource/assets.js / opaque.js / atlas.png）和桌面版「手动3D渲染」是同一份，
// 由 tools/build_web_data.py 复制过来。assets / OPAQUE_BLOCKS 等是那两个脚本定义的全局常量。

const { mat4 } = glMatrix;
const BUILD_CHUNK = 20000; // 每次最多加这么多方块就让出主线程，大结构不会把页面卡死

let resources = null;
let atlasImage = null;

// ---------------------------------------------------------------- 资源

export async function loadResources() {
  atlasImage = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("atlas.png"));
    img.src = "resource/atlas.png";
  });

  const definitions = {}, models = {};
  for (const id in assets.blockstates) definitions["minecraft:" + id] = deepslate.BlockDefinition.fromJson(id, assets.blockstates[id]);
  for (const id in assets.models) models["minecraft:" + id] = deepslate.BlockModel.fromJson(id, assets.models[id]);
  for (const m of Object.values(models)) m.flatten({ getBlockModel: (id) => models[id] });

  // 图集按 2 的幂取正方形读出来，UV 也按这个边长归一
  const size = 2 ** Math.ceil(Math.log2(Math.max(atlasImage.width, atlasImage.height)));
  const canvas = document.createElement("canvas");
  canvas.width = atlasImage.width;
  canvas.height = atlasImage.height;
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

  resources = {
    getBlockDefinition: (id) => definitions[id],
    getBlockModel: (id) => models[id],
    getTextureUV: (id) => atlas.getTextureUV(id),
    getTextureAtlas: () => atlas.getTextureAtlas(),
    getBlockFlags: (id) => ({
      opaque: OPAQUE_BLOCKS.has(String(id)),
      self_culling: !NON_SELF_CULLING.has(String(id)),
      semi_transparent: TRANSPARENT_BLOCKS.has(String(id)),
    }),
    getBlockProperties: () => null,
    getDefaultBlockProperties: () => null,
  };
}

// ---------------------------------------------------------------- 表格图标

// 材料表里的小图标直接从图集里裁：block/<名字>，没有就试 _top / _side / _front，
// 再没有就试 item/<名字>。这样不用另带上千张 png。
const iconCache = new Map();
export function blockIcon(id, px = 20) {
  const name = id.split(":").pop();
  if (iconCache.has(name)) return iconCache.get(name);
  let url = "";
  for (const key of [`block/${name}`, `block/${name}_top`, `block/${name}_side`, `block/${name}_front`, `item/${name}`]) {
    const t = assets.textures[key];
    if (!t) continue;
    const [u, v, du] = t;
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(atlasImage, u, v, du, du, 0, 0, px, px); // 动画贴图是竖长条，只取最上面一帧
    url = c.toDataURL();
    break;
  }
  iconCache.set(name, url);
  return url;
}

// ---------------------------------------------------------------- 视图

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl");
    this.renderer = null;
    this.yaw = 0.8;
    this.pitch = 0.6;
    this.distance = 20;
    this.target = [0, 0, 0];
    this.frame = 0;
    this.building = 0;
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
      const [rx, ry, rz] = region.size;
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
    this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height);
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
    });
  }

  bindControls() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener("contextmenu", (e) => e.preventDefault()); // 右键留给平移（以后右键点方块改方块）
    c.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.button === 1 || e.shiftKey };
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
        this.target[0] -= (dx * cy) * k;
        this.target[2] -= (dx * sy) * k;
        this.target[1] += dy * k;
      } else {
        this.yaw += dx * 0.008;
        this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch + dy * 0.008));
      }
      this.draw();
    });
    const end = () => (drag = null);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.distance = Math.max(2, Math.min(4000, this.distance * Math.pow(1.0015, e.deltaY)));
      this.draw();
    }, { passive: false });
  }
}
