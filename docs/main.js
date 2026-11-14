// Litematica Viewer 主页的交互。没有任何真实功能，只有动效和几个演示：
//   0. 中英切换   1. Banner 进场 + 图标开场   2. 滚动进场   3. 18640 计数
//   4. 材料表页签演示   5. 拖拽上传入口（占位，可整块关掉）

"use strict";
const $ = (id) => document.getElementById(id);
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const STAGGER_CAP = 6; // 列表逐项落下，最多错开 6 个，再多就一起落，免得拖沓

// 给一组元素按顺序写 --i，CSS 用它算 transition-delay
function indexChildren(nodes) {
  nodes.forEach((node, i) => node.style.setProperty("--i", Math.min(i, STAGGER_CAP)));
}

// ------------------------------------------------------------------ 0. 中英切换

// 规则：网址 ?lang= 优先，其次上次手动选的，最后看浏览器语言（中文系 → 中文，其它 → 英文）
const LANG_KEY = "lv-site-lang";
let lang = (() => {
  const query = new URLSearchParams(location.search).get("lang");
  if (query === "en" || query === "zh") return query;
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "en" || saved === "zh") return saved;
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
})();
const t = (zh, en) => (lang === "en" ? en : zh);

function applyLang() {
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  document.querySelectorAll("[data-en]").forEach((el) => {
    if (el.dataset.zh === undefined) el.dataset.zh = el.innerHTML; // 第一次切换前把中文原文存起来
    el.innerHTML = lang === "en" ? el.dataset.en : el.dataset.zh;
  });
  fillTable(currentView, false);
  renderDrop();
}

$("lang-switch").addEventListener("click", () => {
  lang = lang === "en" ? "zh" : "en";
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
});

// ------------------------------------------------------------------ 1. Banner

indexChildren([...document.querySelectorAll(".ba-logo .ch")]);
// 等第一帧画出来再加 class，否则浏览器会把起点和终点合并，直接跳到结果
const start = () => document.body.classList.add("is-ready");
requestAnimationFrame(() => requestAnimationFrame(start));
setTimeout(start, 300); // 后台标签页里 rAF 不跑，兜底一下

// ---- 图标开场
//
// 照搬介绍动画（docs/promo/intro.html）里的图标段：图标按 icon.ico 矢量重绘，
// 零件按节拍一件件出来 —— 深色底 → 代码彩条逐条拉出 → 手柄、镜框描边 →
// 镜片弹出 → 三个方块落进镜片 → 饼图逐块扫开 → 整体弹一下。
// 时间轴沿用原片的秒数（4.34s 开始），播放时把起点平移过来。

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const P = (time, a, b) => clamp((time - a) / (b - a));
const lerp = (a, b, p) => a + (b - a) * p;
function cubic(x1, y1, x2, y2) {
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 10; i++) {
      const cx = 3 * x1 * u * (1 - u) ** 2 + 3 * x2 * u * u * (1 - u) + u ** 3 - x;
      const d = 3 * x1 * (1 - u) ** 2 + 6 * (x2 - x1) * u * (1 - u) + 3 * (1 - x2) * u * u;
      if (Math.abs(cx) < 1e-6) break;
      u = clamp(u - cx / (d || 1e-6));
    }
    return 3 * y1 * u * (1 - u) ** 2 + 3 * y2 * u * u * (1 - u) + u ** 3;
  };
}
const E = { bounce: cubic(0.34, 1.56, 0.64, 1), settle: cubic(0.22, 1, 0.36, 1) };
const B1 = 0.12, B2 = 0.24, B3 = 0.36, ST = 0.04; // beat-1/2/3、beat-stagger（秒）

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs, parent) => {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
};

const icon = $("hero-icon");
const defs = svgEl("defs", {}, icon);
svgEl("rect", { x: 0, y: 0, width: 64, height: 64, rx: 7 }, svgEl("clipPath", { id: "iconClip" }, defs));
svgEl("circle", { cx: 42, cy: 22, r: 13.4 }, svgEl("clipPath", { id: "lensClip" }, defs));
const gBody = svgEl("g", { "clip-path": "url(#iconClip)" }, icon);
const iconBase = svgEl("rect", { x: 0, y: 0, width: 64, height: 64, fill: "#221f34" }, gBody);
const LINES = [
  [2, 14, 5, "#f5a524"], [16, 25, 5, "#22d3ee"], [2, 20, 9.5, "#ef4444"], [2, 12, 14, "#3fa34d"], [14, 21, 14, "#22d3ee"],
  [2, 10, 18.5, "#f5a524"], [12, 18, 18.5, "#22d3ee"], [2, 19, 23, "#ef4444"], [2, 13, 27.5, "#3fa34d"], [2, 10, 32, "#22d3ee"],
].map((l, k) => ({
  x1: l[0], x2: l[1], t0: 4.4 + k * ST,
  el: svgEl("rect", { x: l[0], y: l[2] - 1.25, height: 2.5, rx: 0.6, fill: l[3], width: 0 }, gBody),
}));
const handle = svgEl("line", { x1: 31.5, y1: 33.5, x2: 8, y2: 56.5, stroke: "#6b6a7a", "stroke-width": 6, "stroke-linecap": "round" }, gBody);
const HANDLE_LEN = Math.hypot(23.5, 23);
handle.setAttribute("stroke-dasharray", HANDLE_LEN);
const lens = svgEl("circle", { cx: 42, cy: 22, r: 13.6, fill: "#cecbea" }, gBody);
const gLens = svgEl("g", { "clip-path": "url(#lensClip)" }, gBody);
const ring = svgEl("circle", { cx: 42, cy: 22, r: 15, fill: "none", stroke: "#656473", "stroke-width": 3.4, transform: "rotate(-90 42 22)" }, gBody);
const RING_LEN = 2 * Math.PI * 15;
ring.setAttribute("stroke-dasharray", RING_LEN);

function drawCube(parent, cx, cy, r, col, axes) {
  const h = 0.866 * r, q = 0.5 * r, g = svgEl("g", {}, parent);
  svgEl("polygon", { points: `${cx - h},${cy - q} ${cx},${cy} ${cx},${cy + r} ${cx - h},${cy + q}`, fill: col[1] }, g);
  svgEl("polygon", { points: `${cx},${cy} ${cx + h},${cy - q} ${cx + h},${cy + q} ${cx},${cy + r}`, fill: col[2] }, g);
  svgEl("polygon", { points: `${cx},${cy - r} ${cx + h},${cy - q} ${cx},${cy} ${cx - h},${cy - q}`, fill: col[0] }, g);
  if (axes) {
    const w = r * 0.14;
    svgEl("line", { x1: cx - h, y1: cy + q, x2: cx, y2: cy + r, stroke: "#e5484d", "stroke-width": w }, g);
    svgEl("line", { x1: cx, y1: cy, x2: cx, y2: cy + r, stroke: "#4cd137", "stroke-width": w }, g);
    svgEl("line", { x1: cx, y1: cy + r, x2: cx + h, y2: cy + q, stroke: "#3d7bff", "stroke-width": w }, g);
  }
  return g;
}
const cubes = [
  { g: drawCube(gLens, 35, 18.5, 6.9, ["#4a6fd6", "#2c4aa0", "#3a5cc0"]), t0: 5.3 },
  { g: drawCube(gLens, 49, 18.5, 6.9, ["#9a5a8a", "#6f3a62", "#844b75"]), t0: 5.42 },
  { g: drawCube(gLens, 42, 25.5, 6.9, ["#8f8c98", "#6c6975", "#7d7a86"], true), t0: 5.54 },
];
const PIE = [[0, 0.12, "#ee44dd"], [0.12, 0.27, "#5ad7ea"], [0.27, 0.6, "#8a2bff"], [0.6, 1, "#bdbdbd"]];
const pieSlices = PIE.map((s, k) => ({ a0: s[0], a1: s[1], el: svgEl("path", { fill: s[2] }, gBody), t0: 5.75 + k * ST * 2 }));
function wedge(cx, cy, r, a0, a1) {
  if (a1 - a0 < 1e-4) return "";
  a1 = Math.min(a1, a0 + 0.99999);
  const pt = (a) => `${cx + r * Math.sin(a * 2 * Math.PI)} ${cy - r * Math.cos(a * 2 * Math.PI)}`;
  return `M${cx} ${cy}L${pt(a0)}A${r} ${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${pt(a1)}Z`;
}

function renderIcon(time) {
  iconBase.setAttribute("opacity", time >= 4.34 ? 1 : 0);
  for (const l of LINES) l.el.setAttribute("width", (l.x2 - l.x1) * E.settle(P(time, l.t0, l.t0 + B2)));
  handle.setAttribute("stroke-dashoffset", HANDLE_LEN * (1 - E.settle(P(time, 4.8, 4.8 + B3))));
  ring.setAttribute("stroke-dashoffset", RING_LEN * (1 - E.settle(P(time, 4.85, 4.85 + B3))));
  lens.setAttribute("opacity", P(time, 5.0, 5.0 + B1) > 0 ? 1 : 0);
  lens.setAttribute("r", 13.6 * E.bounce(P(time, 5.0, 5.0 + B3)));
  for (const c of cubes) {
    const p = P(time, c.t0, c.t0 + B3);
    c.g.setAttribute("transform", `translate(0 ${-16 * (1 - E.bounce(p))})`);
    c.g.setAttribute("opacity", p > 0 ? 1 : 0);
  }
  for (const s of pieSlices) {
    const p = E.settle(P(time, s.t0, s.t0 + B2));
    const r = 10 * (p > 0 ? lerp(0.7, 1, E.bounce(P(time, s.t0, s.t0 + B3))) : 1);
    s.el.setAttribute("d", wedge(45, 52.5, r, s.a0, lerp(s.a0, s.a1, p)));
  }
  icon.style.transform = `scale(${1 + 0.06 * Math.sin(Math.PI * P(time, 6.0, 6.0 + B3))})`;
}

const ICON_START = 4.34 - 0.45; // 页面打开 0.45 秒后图标开始出现，和标题错开半拍
const ICON_END = 6.0 + B3;
function playIcon() {
  if (reduceMotion) { renderIcon(ICON_END); return; }
  renderIcon(0);
  const begin = performance.now();
  const frame = (now) => {
    const time = ICON_START + (now - begin) / 1000;
    renderIcon(Math.min(time, ICON_END));
    if (time < ICON_END) requestAnimationFrame(frame); // 播完就停，不在空闲时动
  };
  requestAnimationFrame(frame);
}
playIcon();

// ------------------------------------------------------------------ 2. 滚动进场

// 拖拽入口关掉时，那块面板不参与任何动画（连进场也不要），先把标记拿掉
const dropCard = $("drop-card");
const dropDisabled = dropCard.dataset.disable === "true";
if (dropDisabled) {
  dropCard.classList.add("is-disabled");
  dropCard.removeAttribute("data-reveal");
}

document.querySelectorAll("[data-reveal]").forEach((block) =>
  indexChildren([...block.querySelectorAll("[data-stagger]")])
);
const revealer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      revealer.unobserve(entry.target); // 只进场一次，来回滚不重复播放
      entry.target.querySelectorAll(".count").forEach(countUp);
      if (entry.target.querySelector("#mrows")) fillTable(currentView);
    }
  },
  { threshold: 0.18 }
);
document.querySelectorAll("[data-reveal]").forEach((block) => revealer.observe(block));

// ------------------------------------------------------------------ 3. 计数：悬念之后一拍给答案

function countUp(node) {
  const target = Number(node.dataset.to);
  if (reduceMotion) { node.textContent = String(target); return; }
  const delay = 720, duration = 960;
  const begin = performance.now() + delay;
  const settle = (x) => 1 - Math.pow(1 - x, 4); // 和 ease-settle 一样：快出、不过冲
  function frame(now) {
    const p = clamp((now - begin) / duration);
    node.textContent = String(Math.round(target * settle(p)));
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ 4. 材料表演示

// 数据取自设计系统里那座「小型府邸」：[贴图, 中文名, 英文名, 数量]
const SAMPLE = {
  blocks: [
    ["grass_block", "草方块", "Grass Block", 9922], ["smooth_quartz", "平滑石英块", "Smooth Quartz Block", 1414],
    ["bricks", "红砖块", "Bricks", 770], ["spruce_planks", "云杉木板", "Spruce Planks", 543],
    ["gray_concrete", "灰色混凝土", "Gray Concrete", 497], ["polished_granite", "磨制花岗岩", "Polished Granite", 431],
  ],
  entities: [
    ["armor_stand", "盔甲架", "Armor Stand", 6], ["painting", "画", "Painting", 4], ["item_frame", "物品展示框", "Item Frame", 3],
  ],
  items: [
    ["redstone", "红石粉", "Redstone Dust", 128], ["redstone_block", "红石块", "Block of Redstone", 64],
    ["chest", "箱子", "Chest", 27], ["stone", "石头", "Stone", 12],
  ],
};
SAMPLE.all = [...SAMPLE.blocks, ...SAMPLE.items, ...SAMPLE.entities].sort((a, b) => b[3] - a[3]);
const TOTALS = { all: [92, 18859], blocks: [90, 18640], entities: [3, 13], items: [4, 231] };

// 和桌面版一样换算：中文 盒/组/个，英文 Box/St/u（1 盒 = 27 组 = 1728 个）
function units(n) {
  const [b, s, u] = lang === "en" ? ["Box", "St", "u"] : ["盒", "组", "个"];
  const box = Math.floor(n / 1728), stack = Math.floor((n % 1728) / 64), one = n % 64;
  return (box ? `${box}${b}` : "") + (stack ? `${stack}${s}` : "") + (one || (!box && !stack) ? `${one}${u}` : "");
}

let currentView = "all";
let tableShown = false; // 表格还没滚进视野时先不填，等进场时再一行行落下

function fillTable(view, animate = true) {
  currentView = view;
  if (animate) tableShown = true;
  if (!tableShown) return;
  $("mrows").replaceChildren(
    ...SAMPLE[view].slice(0, 6).map(([tex, zh, en, n], i) => {
      const row = document.createElement("div");
      row.className = animate ? "mrow" : "mrow no-anim";
      row.style.setProperty("--i", Math.min(i, STAGGER_CAP));
      row.innerHTML =
        `<img src="assets/blocks/${tex}.png" alt=""><span>${t(zh, en)}</span>` +
        `<span class="num">${n}</span><span>${units(n)}</span>`;
      return row;
    })
  );
  const [kinds, total] = TOTALS[view];
  $("tab-count").textContent = t(`${kinds} 种 · 共 ${total} 个`, `${kinds} kinds · ${total} total`);
}

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("is-active", x === tab));
    fillTable(tab.dataset.view);
  })
);

// ------------------------------------------------------------------ 5. 拖拽上传（占位）

const zone = $("dropzone");
const input = $("file-input");
const SUPPORTED = /\.(litematic|nbt|mcstructure)$/i;
let dropped = []; // 记住拖进来的文件，切语言时按新语言重画

function renderDrop() {
  const note = $("drop-note");
  if (dropDisabled) {
    note.textContent = t("网页版分析还在开发中，敬请期待。", "Online analysis is still in development — stay tuned.");
    return;
  }
  $("drop-files").replaceChildren(
    ...dropped.map((file, i) => {
      const ok = SUPPORTED.test(file.name);
      const item = document.createElement("li");
      item.style.setProperty("--i", Math.min(i, STAGGER_CAP));
      item.classList.toggle("is-bad", !ok);
      item.innerHTML = "<b></b><small></small>";
      item.querySelector("b").textContent = file.name;
      item.querySelector("small").textContent = ok
        ? `${(file.size / 1024).toFixed(1)} KB`
        : t("不支持的格式", "Unsupported format");
      return item;
    })
  );
  note.textContent = dropped.length
    ? t("收到了！网页版分析还没上线，现在可以先下载桌面版来看材料清单。",
        "Got it! Online analysis isn't live yet — grab the desktop app to see the material list.")
    : t("文件只在你的浏览器里，不会上传到任何地方。", "Your file stays in your browser and is never uploaded.");
}

function showFiles(files) {
  if (!files.length) return;
  dropped = [...files];
  renderDrop();
}

if (dropDisabled) {
  // 关掉时：点不了、拖不进、键盘也选不中
  input.disabled = true;
  zone.removeAttribute("tabindex");
  zone.setAttribute("aria-disabled", "true");
  zone.addEventListener("click", (e) => e.preventDefault());
} else {
  // dragenter / dragleave 会在子元素之间反复触发，用计数判断是不是真的离开了
  let depth = 0;
  zone.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; zone.classList.add("is-over"); });
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; zone.classList.remove("is-over"); } });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove("is-over");
    showFiles(e.dataTransfer.files);
  });
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => showFiles(input.files));
}
// 拖到页面别处松手时，浏览器默认会直接打开那个文件，这里拦掉
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

applyLang();
