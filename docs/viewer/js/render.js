// 3D 渲染：deepslate 0.27 的 StructureRenderer + 自己写的环绕相机、点选、实体标记。
//
// 贴图资源（resource/assets.js / atlas.png / icons.json）桌面版和网页版共用一份。
// assets 是 assets.js 定义的全局常量；NON_SELF_CULLING 来自 opaque.js。

const { mat4, vec3, vec4 } = glMatrix;
const BUILD_CHUNK = 4096; // 每扫这么多格看一眼时间，忙够 25 ms 就让出主线程，大结构不会把页面卡死
const FOV = (70 * Math.PI) / 180; // 和 deepslate 的透视一致，点选算射线要用同一个

let resources = null;
let atlasImage = null;
let iconIndex = {}; // resource/icons.json：名字 → [u, v, 宽, 高, (染色)] 或 {parts: [...]}（拼的，箱子），由 script/lv/atlas.py 生成

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

// ---- 大箱子：deepslate 的箱子渲染器不管 type=left/right，两半各画一个单箱子，看起来是两个小箱子。
// 这里给两半换成游戏里的做法：每半用自己的贴图（entity/chest/<名>_left / _right，15 像素宽、接缝那面留空），
// 往另一半那边一直延伸到格子边上，锁扣两半各画 1 像素宽、拼在中缝上。
// 另一半在哪边：type=left 在朝向的顺时针方向（模型空间里是 +x），type=right 在逆时针方向（-x）。
// 半边贴图的排布（像素，64×64）：侧面一圈 y 14–19（盖子）/ 33–43（箱身），
// x 0–14 / 14–29 / 29–43 / 43–58 = 一侧 / 背面 / 另一侧 / 正面；顶 / 底 y 0–14（盖子）/ 19–33（箱身）。
// 正面朝北（z=0），按 facing 绕竖轴转，和 deepslate 的单箱子一样
const CHEST_TEXTURE = {
  chest: "normal", trapped_chest: "trapped",
  copper_chest: "copper", exposed_copper_chest: "copper_exposed", weathered_copper_chest: "copper_weathered", oxidized_copper_chest: "copper_oxidized",
  waxed_copper_chest: "copper", waxed_exposed_copper_chest: "copper_exposed", waxed_weathered_copper_chest: "copper_weathered", waxed_oxidized_copper_chest: "copper_oxidized",
};
const px = (x0, y0, x1, y1) => [x0 / 4, y0 / 4, x1 / 4, y1 / 4]; // 64 像素贴图 → 模型 UV（0–16）
function chestHalfFaces(left, top, side) {
  // top：顶 / 底那块的 y 起点；side：侧面一圈的 y 范围
  const [s0, s1] = side;
  const face = (uv, rotation = 180) => ({ uv, rotation, texture: "#0" });
  const faces = {
    north: face(px(43, s0, 58, s1)),
    south: face(px(14, s0, 29, s1)),
    // 顶 / 底左右反着取：两张半边贴图的接缝边都和模型里的方向相反（左半贴图接缝在 u 小那边、模型在 +x），不反的话中缝会多一条黑边
    up: face(px(44, top, 29, top + 14), 0),
    down: face(px(29, top, 14, top + 14), 0),
  };
  // 外侧那面：左半的贴图只有 29–43 那条，右半只有 0–14 那条；接缝那面不画
  if (left) faces.west = face(px(29, s0, 43, s1));
  else faces.east = face(px(0, s0, 14, s1));
  return faces;
}
const FACING_ANGLE = { north: 0, west: Math.PI / 2, south: Math.PI, east: (Math.PI * 3) / 2 };
function doubleChestMesh(state, res) {
  const name = String(state.getName()).replace(/^minecraft:/, "");
  const type = state.getProperty("type");
  if (!CHEST_TEXTURE[name] || (type !== "left" && type !== "right")) return null;
  const left = type === "left";
  const [x0, x1] = left ? [1, 16] : [0, 15];
  const latch = { uv: px(1, 1, 2, 5), rotation: 180, texture: "#0" };
  const elements = [
    { from: [x0, 0, 1], to: [x1, 10, 15], faces: chestHalfFaces(left, 19, [33, 43]) },
    { from: [x0, 10, 1], to: [x1, 14, 15], faces: chestHalfFaces(left, 0, [14, 19]) },
    {
      from: left ? [15, 7, 0] : [0, 7, 0], to: left ? [16, 11, 1] : [1, 11, 1],
      faces: {
        north: latch,
        [left ? "west" : "east"]: { uv: px(0, 1, 1, 5), rotation: 180, texture: "#0" },
        up: { uv: px(1, 0, 2, 1), texture: "#0" }, down: { uv: px(2, 0, 3, 1), texture: "#0" },
      },
    },
  ];
  const texture = `minecraft:entity/chest/${CHEST_TEXTURE[name]}_${left ? "left" : "right"}`;
  const model = new deepslate.BlockModel(undefined, { 0: texture }, elements);
  const mesh = model.getMesh(res, deepslate.Cull.none());
  const m = mat4.create();
  mat4.scale(m, m, [1 / 16, 1 / 16, 1 / 16]);
  mat4.translate(m, m, [8, 8, 8]);
  mat4.rotateY(m, m, FACING_ANGLE[state.getProperty("facing")] ?? Math.PI);
  mat4.translate(m, m, [-8, -8, -8]);
  return mesh.transform(m);
}

// ---- 背景：地板（海洋 / 草地 / 末地石）+ 天空（CSS 背景，见 viewer.css 的 .stage[data-env]）。
// 地板是一层平铺的方块贴图：结构四周各多铺 24 格，太大就用 2×2、4×4… 的贴片，最多两万片
export const ENVIRONMENTS = {
  ocean: { texture: "minecraft:block/water_still", tint: [0.25, 0.46, 0.85] },
  grass: { texture: "minecraft:block/grass_block_top", tint: [0.49, 0.74, 0.34] },
  end: { texture: "minecraft:block/end_stone", tint: null },
};

// ---- 大结构：deepslate 默认的做法几十万方块就会卡死或者把标签页撑崩，这里打几个补丁
//   1. 网格上传到显卡后，丢掉 JS 里的顶点对象，只记数量（之前每个面一堆对象，几十万方块几千万个对象）
//   2. merge 用 concat 每加一个方块就把整个列表复制一遍，改成就地追加
//   3. 同一种方块状态（含六个面的遮挡情况）的网格只算一次，之后复制一份用（返回的网格会被就地平移，必须复制）
//   4. 每帧要画的网格列表缓存起来，区块有改动才重算（之前每帧都把所有区块翻一遍）
function patchDeepslate() {
  if (deepslate.__lvMeshPatched) return;
  deepslate.__lvMeshPatched = true;
  const M = deepslate.Mesh.prototype;
  M.merge = function (other) {
    for (const q of other.quads) this.quads.push(q);
    for (const l of other.lines) this.lines.push(l);
    return this;
  };
  const rebuild = M.rebuild, clear = M.clear;
  M.rebuild = function (gl, options) {
    rebuild.call(this, gl, options);
    // deepslate 的索引是 16 位，一份网格最多 16383 个面（茂密的树叶区块会超），超了改用 32 位索引
    if (this.indexBuffer) {
      const n = this.quads.length, wide = n * 4 > 65535 && !!gl.getExtension("OES_element_index_uint");
      if (wide) {
        const index = new Uint32Array(n * 6);
        for (let a = 0; a < n; a++) index.set([4 * a, 4 * a + 1, 4 * a + 2, 4 * a, 4 * a + 2, 4 * a + 3], a * 6);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.DYNAMIC_DRAW);
      }
      this.indexBuffer.wide = wide;
    }
    this.uploadedQuads = this.quads.length;
    this.quads = [];
    return this;
  };
  M.clear = function () { this.uploadedQuads = 0; return clear.call(this); };
  M.quadVertices = function () { return (this.quads.length || this.uploadedQuads || 0) * 4; };
  M.quadIndices = function () { return (this.quads.length || this.uploadedQuads || 0) * 6; };
  M.isEmpty = function () { return !this.quads.length && !this.lines.length && !this.uploadedQuads; };

  const cloneVertex = (v) => new deepslate.Vertex(v.pos, v.color, v.texture, v.textureLimit, v.normal, v.blockPos);
  const cloneMesh = (mesh) => {
    const out = new deepslate.Mesh();
    out.quads = mesh.quads.map((q) => new deepslate.Quad(cloneVertex(q.v1), cloneVertex(q.v2), cloneVertex(q.v3), cloneVertex(q.v4)));
    out.lines = mesh.lines.slice();
    return out;
  };
  const meshCache = new WeakMap();
  const getMesh = deepslate.BlockDefinition.prototype.getMesh;
  deepslate.BlockDefinition.prototype.getMesh = function (name, props, uv, blockProps, cull) {
    let cache = meshCache.get(this);
    if (!cache) meshCache.set(this, (cache = new Map()));
    const key = Object.keys(props).sort().map((k) => k + "=" + props[k]).join(",") + "|" +
      (cull ? (cull.up ? 1 : 0) + (cull.down ? 2 : 0) + (cull.north ? 4 : 0) + (cull.south ? 8 : 0) + (cull.east ? 16 : 0) + (cull.west ? 32 : 0) : "");
    let mesh = cache.get(key);
    if (!mesh) cache.set(key, (mesh = getMesh.call(this, name, props, uv, blockProps, cull)));
    return cloneMesh(mesh);
  };
}

// 4. 网格列表缓存：拿到第一个区块构建器的时候给它的类打补丁
function patchChunkBuilder(builder) {
  const CB = Object.getPrototypeOf(builder);
  if (CB.__lvPatched) return;
  CB.__lvPatched = true;
  const getMeshes = CB.getMeshes, update = CB.updateStructureBuffers;
  CB.getMeshes = function () { return this.meshList || (this.meshList = getMeshes.call(this)); };
  CB.updateStructureBuffers = function (chunks) { this.meshList = this.chunkList = null; return update.call(this, chunks); };
  // 5. 视锥剔除用：每个非空区块的网格 + 包围盒。deepslate 存区块的下标是 |c|*2 + (c<0 ? 1 : 0)，这里解回区块坐标
  CB.getChunkList = function () {
    if (this.chunkList) return this.chunkList;
    const list = [], size = this.chunkSize;
    const coord = (i) => (i & 1 ? -(i >> 1) : i >> 1);
    this.chunks.forEach((plane, i) => plane?.forEach((row, j) => row?.forEach((chunk, k) => {
      if (!chunk || (chunk.mesh.isEmpty() && chunk.transparentMesh.isEmpty())) return;
      const c = [coord(i), coord(j), coord(k)];
      // 多留 2 格：床、旗帜、高的特殊模型会伸出自己那一格
      const min = c.map((v, a) => v * size[a] - 2), max = c.map((v, a) => (v + 1) * size[a] + 2);
      list.push({ mesh: chunk.mesh, transparentMesh: chunk.transparentMesh, min, max });
    })));
    return (this.chunkList = list);
  };
}

// ---- 视锥剔除：每帧从「投影 × 视图」矩阵取出 6 个裁剪面，整个区块的包围盒都在某个面外面就不画。
// 拉近看大结构的一角、或者 WASD 飞进结构里时，画面外的区块（往往是大半）整块跳过，不再提交给显卡。
// 透视和缩略图用的正交投影都适用（裁剪面是从合起来的矩阵里取的）
function frustumPlanes(proj, view) {
  const m = mat4.multiply(mat4.create(), proj, view);
  // 列主序：第 r 行 = m[r], m[r+4], m[r+8], m[r+12]
  const row = (r) => [m[r], m[r + 4], m[r + 8], m[r + 12]];
  const w = row(3);
  const planes = [];
  for (const r of [0, 1, 2]) {
    const v = row(r);
    planes.push(w.map((x, i) => x + v[i]), w.map((x, i) => x - v[i]));
  }
  return planes;
}

function boxVisible(planes, min, max) {
  for (const [a, b, c, d] of planes) {
    // 包围盒上沿法线方向最远的那个角都在面外面，整个盒子就在外面
    const x = a > 0 ? max[0] : min[0], y = b > 0 ? max[1] : min[1], z = c > 0 ? max[2] : min[2];
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}

// 替换 StructureRenderer.drawStructure：同样先画不透明再画半透明，只是跳过视锥外的区块
function drawStructureCulled(view) {
  this.setShader(this.shaderProgram);
  this.setTexture(this.atlasTexture, this.resources.getPixelSize?.());
  this.prepareDraw(view);
  const planes = frustumPlanes(this.projMatrix, view);
  const visible = this.chunkBuilder.getChunkList().filter((c) => boxVisible(planes, c.min, c.max));
  const opts = { pos: true, color: true, texture: true, normal: true };
  for (const c of visible) if (!c.mesh.isEmpty()) this.drawMesh(c.mesh, opts);
  for (const c of visible) if (!c.transparentMesh.isEmpty()) this.drawMesh(c.transparentMesh, opts);
  this.culled = { drawn: visible.length, total: this.chunkBuilder.getChunkList().length }; // 调试用
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
  patchDeepslate();
  if (!deepslate.SpecialRenderers.__lvPatched) {
    const special = deepslate.SpecialRenderers.getBlockMesh;
    deepslate.SpecialRenderers.getBlockMesh = (state, nbt, res, cull) => {
      const chest = doubleChestMesh(state, res);
      if (chest) return chest;
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
// 有没有图标（不生成图片，挑物品列表时用）
export function hasIcon(id) {
  const name = String(id).replace(/^(entity:)?minecraft:/, "").split("[")[0];
  return !!(iconIndex[name] || iconIndex[name + "_spawn_egg"]);
}
export function blockIcon(id, px = 20) {
  const name = String(id).replace(/^(entity:)?minecraft:/, "").split("[")[0];
  const key = name + "@" + px;
  if (iconCache.has(key)) return iconCache.get(key);
  const box = iconIndex[name] || iconIndex[name + "_spawn_egg"];
  let url = "";
  if (box?.parts && atlasImage) {
    // 拼出来的图标（箱子）：每块从图集里抠出来，转 180° 贴到 16×16 上（见 atlas.py 的 CHEST_PARTS）
    const c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    const k = px / 16;
    for (const [u, v, w, h, dx, dy, dw, dh] of box.parts) {
      g.save();
      g.translate((dx + dw) * k, (dy + dh) * k);
      g.rotate(Math.PI);
      g.drawImage(atlasImage, u, v, w, h, 0, 0, dw * k, dh * k);
      g.restore();
    }
    url = c.toDataURL();
  } else if (box && atlasImage) {
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
const CHUNK = 16; // deepslate 的区块边长（StructureRenderer 的 chunkSize）。每个区块两份网格、每份 7 个显卡缓冲区，
// 边长 8 时几十万方块会切出几万个区块、几十万个缓冲区，显卡进程直接崩；16 是 deepslate 的默认值
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
// 方块按区块分好：deepslate 局部重画（updateStructureBuffers(区块列表)）时会把 getBlocks() 全扫一遍，
// 只给它要重画的那几个区块的方块（only），大结构局部更新才快
const chunkOf = (p) => `${Math.floor(p[0] / CHUNK)},${Math.floor(p[1] / CHUNK)},${Math.floor(p[2] / CHUNK)}`;
class LiveStructure {
  constructor(size) {
    this.size = size;
    this.map = new Map();
    this.chunks = new Map(); // "cx,cy,cz" → Map(key → placed)
    this.list = null;
    this.only = null;        // Set("cx,cy,cz")：正在重画的区块
  }
  key(p) { return (p[0] * this.size[1] + p[1]) * this.size[2] + p[2]; }
  getSize() { return this.size; }
  getBlocks() {
    if (this.only) {
      const out = [];
      for (const k of this.only) { const c = this.chunks.get(k); if (c) for (const b of c.values()) out.push(b); }
      return out;
    }
    return this.list || (this.list = [...this.map.values()]);
  }
  getBlock(p) {
    if (p[0] < 0 || p[1] < 0 || p[2] < 0 || p[0] >= this.size[0] || p[1] >= this.size[1] || p[2] >= this.size[2]) return null;
    return this.map.get(this.key(p)) || null;
  }
  put(entry) {
    this.map.set(entry.key, entry.placed);
    const k = chunkOf(entry.pos);
    (this.chunks.get(k) || this.chunks.set(k, new Map()).get(k)).set(entry.key, entry.placed);
    this.list = null;
  }
  drop(entry) {
    this.map.delete(entry.key);
    this.chunks.get(chunkOf(entry.pos))?.delete(entry.key);
    this.list = null;
  }
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
    // 混合方式：deepslate 用 blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)，透明度通道也这么混，
    // 玻璃挡在方块前面时画布在那里变成半透明，页面的浅色背景透出来，玻璃看着发白。
    // 改成颜色照常混、透明度只增不减（ONE, ONE_MINUS_SRC_ALPHA），画面就和游戏里一样
    const gl = this.gl;
    gl.blendFunc = (src, dst) => gl.blendFuncSeparate(src, dst, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // 配合上面的 32 位索引：记住当前绑的索引缓冲区，画的时候它是 32 位的就换成 UNSIGNED_INT
    gl.getExtension("OES_element_index_uint");
    let elements = null;
    const bindBuffer = gl.bindBuffer.bind(gl), drawElements = gl.drawElements.bind(gl);
    gl.bindBuffer = (target, buffer) => { if (target === gl.ELEMENT_ARRAY_BUFFER) elements = buffer; return bindBuffer(target, buffer); };
    gl.drawElements = (mode, count, type, offset) => drawElements(mode, count, elements?.wide ? gl.UNSIGNED_INT : type, offset);
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
    this.env = null;           // 背景：null / "ocean" / "grass" / "end"
    this.envMesh = null;
    this.regionMesh = null;    // 多子区域时每个区域的边框
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
    this.buildRegionBoxes();
    for (const m of this.markers) m.el.style.setProperty("--cat", theme[CATEGORY_COLOR[m.category]]);
    this.draw();
  }

  // 结构 → 场景。先把所有非空气方块摊成条目（分批，onProgress 0~1），按 Y 和按步骤分好桶，
  // 之后换显示层、换步骤都只碰变化的那几桶方块。
  // 区域如果带 stepOf（分步拆解的结果），每格的步骤号就从那里来。
  async show(structure, box, { resetCamera = true, onProgress = () => {}, region = null } = {}) {
    const token = ++this.building; // 新的构建开始，旧的那次就作废
    const [sx, sy, sz] = box.size;
    const entries = [], byY = Array.from({ length: sy }, () => []), byStep = [], byKey = new Map();
    const total = structure.regions.reduce((s, r) => s + r.blocks.length, 0);
    let done = 0, slice = performance.now();
    for (const [ri, region] of structure.regions.entries()) {
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
            pos, step, region, ri, local, block: region.palette[region.blocks[i]],
            key: (pos[0] * sy + pos[1]) * sz + pos[2], hidden: false,
            placed: { pos, state, nbt: undefined },
          };
          entry.placed.entry = entry; // 反查：点选时从 live 里拿到的方块直接找回条目
          entries.push(entry);
          byKey.set(entry.key, entry);
          byY[pos[1]].push(entry);
          if (step >= 0) (byStep[step] ||= []).push(entry);
        }
        // 按时间让出主线程：每忙 25 ms 让一次（按格数让的话，大包围盒里几千万个空气格要让上千次，光等就好几秒）
        if (++done % BUILD_CHUNK === 0 && performance.now() - slice > 25) {
          onProgress((done / total) * 0.3);
          await new Promise((r) => setTimeout(r, 0));
          if (token !== this.building) return;
          slice = performance.now();
        }
      }
    }
    const live = new LiveStructure([sx, sy, sz]);
    const filter = { layers: [0, sy - 1], step: byStep.length ? byStep.length - 1 : null, region };
    const sc = { structure, box, entries, byY, byStep, byKey, live, filter };
    // 六面都被不透明整方块包住的格子看不见，不进渲染（地形这类实心结构能省掉一大半）；切层露出来时再补上。
    // 几十万格一口气做完会卡一下，分批做、中间让出主线程
    for (let i = 0; i < entries.length; i += 50000) {
      for (const e of entries.slice(i, i + 50000)) {
        e.hidden = this.isHidden(e, sc);
        if (this.visible(e, filter)) live.put(e);
      }
      if (entries.length > 50000) {
        await new Promise((r) => setTimeout(r, 0));
        if (token !== this.building) return;
      }
    }
    this.scene = sc;
    this.pending.clear();

    // 先建一个空的渲染器（不在这里一口气做完所有网格，几十万方块会卡死页面），网格交给后台分批做
    live.only = new Set();
    // useInvisibleBlockBuffer：deepslate 默认给包围盒里每个空格画一个小线框（标空气 / 结构空位），
    // 461×83×461 的投影就是一千多万格、上亿根线，直接把页面撑崩 —— 这就是之前的「几十万方块上限」。我们不显示它
    this.renderer = new deepslate.StructureRenderer(this.gl, live, resources, { chunkSize: CHUNK, useInvisibleBlockBuffer: false });
    live.only = null;
    patchChunkBuilder(this.renderer.chunkBuilder);
    this.renderer.drawStructure = drawStructureCulled;
    // deepslate 0.27 的远平面写死 500 格，大结构拉远会被切掉；换成同样的透视、远平面放大
    this.renderer.getPerspective = () => {
      const m = mat4.create();
      mat4.perspective(m, FOV, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 20000);
      return m;
    };
    this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height);
    this.selected = null;
    this.buildMarkers(structure, box);
    this.buildEnvironment();
    this.buildRegionBoxes();
    if (resetCamera) {
      this.target = [sx / 2, sy / 2, sz / 2];
      this.distance = Math.max(sx, sy, sz) * 1.6 + 4;
      this.yaw = 0.8;
      this.pitch = 0.6;
    }
    this.draw();
    // 网格分批做，边做边显示；做完前照样能转、能点
    const all = [...live.chunks.keys()].map((k) => k.split(",").map(Number));
    this.drainTotal = all.length;
    this.onDrain = (left) => onProgress(0.3 + 0.7 * (1 - left / Math.max(1, this.drainTotal)));
    await this.queueChunks(all);
    this.onDrain = null;
    onProgress(1);
  }

  // 只有不透明的整方块挡得住视线
  opaque(entry) {
    return !!entry && !!resources.getBlockFlags(String(entry.placed.state.getName())).opaque;
  }
  isHidden(entry, sc) {
    const [sx, sy, sz] = sc.box.size, [x, y, z] = entry.pos;
    if (x === 0 || y === 0 || z === 0 || x === sx - 1 || y === sy - 1 || z === sz - 1) return false;
    const k = entry.key, step = sy * sz;
    for (const n of [k + step, k - step, k + sz, k - sz, k + 1, k - 1]) if (!this.opaque(sc.byKey.get(n))) return false;
    return true;
  }

  // ---- 替换方块后的增量更新：只改动过的格子换状态，碰到的区块分批重画。
  // 不重建整个场景：没轮到的区块先保持旧样子，一批批换上新的，期间照常能转、能点。
  // changes: [{ pos: 相对包围盒的 [x,y,z], block: 新方块 }]；regionMap：旧区域对象 → 新区域对象
  applyChanges(changes, regionMap = null) {
    const sc = this.scene;
    if (!sc || !changes.length) return Promise.resolve();
    const [, sy, sz] = sc.box.size;
    const chunks = new Map();
    const mark = (p) => {
      const c = [Math.floor(p[0] / CHUNK), Math.floor(p[1] / CHUNK), Math.floor(p[2] / CHUNK)];
      if (c.every((v) => v >= 0)) chunks.set(c.join(","), c);
    };
    const recheck = new Set();
    for (const { pos, block } of changes) {
      const e = sc.byKey.get((pos[0] * sy + pos[1]) * sz + pos[2]);
      if (!e) continue;
      e.block = block;
      e.placed.state = stateOf(block) || e.placed.state;
      recheck.add(e);
      for (const n of [e.key + sy * sz, e.key - sy * sz, e.key + sz, e.key - sz, e.key + 1, e.key - 1]) {
        const ne = sc.byKey.get(n);
        if (ne) recheck.add(ne);
      }
    }
    for (const e of recheck) {
      if (sc.entries === undefined) break;
      e.hidden = this.isHidden(e, sc);
      const shown = sc.live.map.has(e.key), want = this.visible(e, sc.filter);
      if (shown !== want) (want ? sc.live.put(e) : sc.live.drop(e));
      if (!shown && !want) continue; // 现在没显示（被层 / 步骤藏起来）：轮到显示时自然是新的
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
    // 每次最多忙 30 ms 就让出主线程（一批大约 250 个方块）
    const start = performance.now();
    while (this.pending.size && performance.now() - start < 30) {
      const batch = [];
      let blocks = 0;
      for (const [k, c] of this.pending) {
        batch.push(c);
        this.pending.delete(k);
        blocks += sc.chunkCount.get(k) || 1;
        if (blocks >= 250) break;
      }
      this.updateChunks(batch);
    }
    this.onDrain?.(this.pending.size);
    this.draw();
    setTimeout(() => this.drainChunks(), 0);
  }

  // 局部重画：只把这几个区块的方块交给 deepslate
  updateChunks(list) {
    const live = this.scene.live;
    live.only = new Set(list.map((c) => c.join(",")));
    try { this.renderer.updateStructureBuffers(list); } finally { live.only = null; }
  }

  // ---- 缩略图：标准等轴（绕竖轴 45°、俯角 30°，同桌面版 snapshot.py），正交投影、带贴图。
  // 借主画面已经建好网格的渲染器：同一帧里临时换成等轴视角画一张、马上把像素取走，再换回来，
  // 用户看不到闪动（新建一个渲染器第一次做网格要好几秒，这样只要几十毫秒）。
  // 不管现在显示到哪层 / 哪步，画的都是整个结构。返回 size×size 的 canvas；background 为空就是透明底
  snapshot(size = 512, background = null) {
    const sc = this.scene;
    if (!sc || !this.renderer) return null;
    const full = { layers: [0, sc.box.size[1] - 1], step: sc.byStep.length ? sc.byStep.length - 1 : null, region: null };
    const before = sc.filter;
    const filtered = before.layers[0] !== full.layers[0] || before.layers[1] !== full.layers[1] || before.step !== full.step || before.region !== null;
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
    if (f.region != null && entry.ri !== f.region) return false;
    // 被包住的格子：在显示范围的中间就不画（在最上 / 最下一层时上下有一面露出来了，要画）
    if (entry.hidden && f.region == null && f.step === null && entry.pos[1] > f.layers[0] && entry.pos[1] < f.layers[1]) return false;
    if (entry.pos[1] < f.layers[0] || entry.pos[1] > f.layers[1]) return false;
    return f.step === null || entry.step <= f.step;
  }

  // 换显示层 / 换步骤：只看两次范围之间变了的那几桶，增删 live 里的方块，再只重画碰到的区块
  setFilter({ layers, step, region } = {}) {
    const sc = this.scene;
    if (!sc) return;
    const old = sc.filter;
    const next = { layers: layers || old.layers, step: step === undefined ? old.step : step, region: region === undefined ? old.region : region };
    const touched = new Set();
    const consider = (list) => { if (list) for (const e of list) touched.add(e); };
    if (next.region !== old.region) consider(sc.entries); // 换子区域：每格都可能变
    if (next.layers[0] !== old.layers[0] || next.layers[1] !== old.layers[1]) {
      for (const y of new Set([...old.layers, ...next.layers])) consider(sc.byY[y]);
    }
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
    if (next.region !== old.region) this.buildRegionBoxes();
    if (chunks.size) this.updateChunks([...chunks.values()].filter((c) => c.every((v) => v >= 0)));
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
    if (this.envMesh) {
      const r = this.renderer;
      r.setShader(r.shaderProgram);
      r.setTexture(r.atlasTexture, resources.getPixelSize?.());
      r.prepareDraw(view);
      r.drawMesh(this.envMesh, { pos: true, color: true, texture: true, normal: true });
    }
    this.renderer.drawStructure(view);
    if (!this.envMesh) this.renderer.drawGrid(view); // 有地板时不画底下的网格线
    if (this.hitboxMesh) {
      // 借 deepslate 画网格线的着色器画碰撞箱（和 drawOutline 同一套调用）
      this.renderer.setShader(this.renderer.gridShaderProgram);
      this.renderer.prepareDraw(view);
      this.renderer.drawMesh(this.hitboxMesh, { pos: true, color: true });
    }
    if (this.regionMesh) {
      this.renderer.setShader(this.renderer.gridShaderProgram);
      this.renderer.prepareDraw(view);
      this.renderer.drawMesh(this.regionMesh, { pos: true, color: true });
    }
    if (this.selected) this.renderer.drawOutline(view, this.selected);
    this.placeMarkers(view);
  }

  // ---- 背景
  setEnvironment(kind) {
    this.env = ENVIRONMENTS[kind] ? kind : null;
    this.buildEnvironment();
    this.draw();
  }

  buildEnvironment() {
    this.envMesh = null;
    const sc = this.scene, cfg = ENVIRONMENTS[this.env];
    if (!sc || !cfg || !this.renderer) return;
    const [sx, , sz] = sc.box.size, margin = 24;
    let tile = 1;
    while (((sx + 2 * margin) / tile) * ((sz + 2 * margin) / tile) > 20000) tile *= 2;
    const elements = [];
    for (let x = -margin; x < sx + margin; x += tile) {
      for (let z = -margin; z < sz + margin; z += tile) {
        elements.push({ from: [x * 16, -16, z * 16], to: [(x + tile) * 16, 0, (z + tile) * 16],
          faces: { up: { uv: [0, 0, 16, 16], texture: "#t", ...(cfg.tint ? { tintindex: 0 } : {}) } } });
      }
    }
    const model = new deepslate.BlockModel(undefined, { t: cfg.texture }, elements);
    const mesh = model.getMesh(resources, deepslate.Cull.none(), cfg.tint ? () => cfg.tint : undefined);
    const m = mat4.create();
    mat4.translate(m, m, [0, -0.002, 0]); // 比结构底面低一点点，免得和方块底面打架
    mat4.scale(m, m, [1 / 16, 1 / 16, 1 / 16]);
    mesh.transform(m);
    mesh.computeNormals(); // deepslate 的区块构建会补法线，自己做的网格要手动算
    this.envMesh = mesh.rebuild(this.gl, { pos: true, color: true, texture: true, normal: true });
  }

  // ---- 多子区域：每个区域画一圈边框，选中的那个用主题深色，其他用浅色
  buildRegionBoxes() {
    this.regionMesh = null;
    const sc = this.scene;
    if (!sc || !this.renderer || sc.structure.regions.length < 2) return;
    const Mesh = this.renderer.outlineMesh.constructor;
    const mesh = new Mesh();
    sc.structure.regions.forEach((r, i) => {
      const o = r.origin.map((v, k) => v - sc.box.origin[k]);
      const color = hexToRgb(this.theme[sc.filter.region === i ? "PC" : "MC"]);
      mesh.addLineCube(o[0], o[1], o[2], o[0] + r.size[0], o[1] + r.size[1], o[2] + r.size[2], color);
    });
    this.regionMesh = mesh.rebuild(this.gl, { pos: true, color: true });
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
