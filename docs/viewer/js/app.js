// 网页版查看器的界面层：读文件 → 统计 → 渲染 → 右侧信息栏 + 工具。
// 算法都在别的模块里，这里只负责把它们接起来、把结果画到页面上。

import { parse, bounds, EXTENSIONS } from "./formats.js";
import { analyse, totalRows, unitParts } from "./analysis.js";
import { loadResources, View, blockIcon } from "./render.js";
import { splitSteps, structureUpTo } from "./tools/steps.js";
import { toContour } from "./tools/contour.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TABLE_LIMIT = 300; // 表格最多先画这么多行，再多就显示「还有 N 项」，几千行 DOM 会卡

// ---------------------------------------------------------------- 语言

// 桌面版已有的词（指标名、分类、单位、页签）来自 gamedata.ui；下面这些是网页版自己的
const TEXT = {
  zh_CN: {
    open: "打开文件", dropTitle: "把投影文件拖到这里", supports: "支持", local: "文件只在你的浏览器里处理，不会上传",
    layers: "显示层", controls: "左键拖动旋转 · 右键拖动平移 · 滚轮缩放", noFile: "还没有打开文件", dropNow: "松手打开",
    reading: "读取中", building: "构建中", more: "还有 {} 项", failed: "打不开这个文件：{}", unsupported: "只支持 .litematic / .nbt / .mcstructure",
    size: "体积", count: "数量", kinds: "种类", tools: "工具", steps: "分步拆解", split: "拆分", contour: "等高图", convert: "转换",
    stepsNote: "按层、按材质把投影拆成一步步的建造顺序", contourNote: "去掉树木花草，只留地表，按高度每 5 格换一种陶瓦 / 羊毛",
    baseY: "最底层的世界 Y", restore: "还原原始投影", stepOf: "步骤 {} / {} · Y={}", total: "合计", tooMany: "方块太多（{}），分步拆解适合 6 万块以内",
    contourDone: "等高图：{} 个地表方块", mismatch: "文件自称 {} 个方块，和实际数出来的不一样",
  },
  zh_TW: {
    open: "開啟檔案", dropTitle: "把投影檔案拖到這裡", supports: "支援", local: "檔案只在你的瀏覽器裡處理，不會上傳",
    layers: "顯示層", controls: "左鍵拖曳旋轉 · 右鍵拖曳平移 · 滾輪縮放", noFile: "還沒有開啟檔案", dropNow: "放開以開啟",
    reading: "讀取中", building: "建構中", more: "還有 {} 項", failed: "無法開啟這個檔案：{}", unsupported: "只支援 .litematic / .nbt / .mcstructure",
    size: "體積", count: "數量", kinds: "種類", tools: "工具", steps: "分步拆解", split: "拆分", contour: "等高圖", convert: "轉換",
    stepsNote: "按層、按材質把投影拆成一步步的建造順序", contourNote: "去掉樹木花草，只留地表，按高度每 5 格換一種陶瓦 / 羊毛",
    baseY: "最底層的世界 Y", restore: "還原原始投影", stepOf: "步驟 {} / {} · Y={}", total: "合計", tooMany: "方塊太多（{}），分步拆解適合 6 萬塊以內",
    contourDone: "等高圖：{} 個地表方塊", mismatch: "檔案自稱 {} 個方塊，和實際數出來的不一樣",
  },
  en_US: {
    open: "Open file", dropTitle: "Drop your schematic here", supports: "Supports", local: "Your file is processed in your browser and never uploaded",
    layers: "Layers", controls: "Left-drag to rotate · right-drag to pan · scroll to zoom", noFile: "No file open", dropNow: "Release to open",
    reading: "Reading", building: "Building", more: "{} more", failed: "Can't open this file: {}", unsupported: "Only .litematic / .nbt / .mcstructure",
    size: "Size", count: "Blocks", kinds: "Kinds", tools: "Tools", steps: "Step splitter", split: "Split", contour: "Contour map", convert: "Convert",
    stepsNote: "Split the build into ordered steps by layer and material", contourNote: "Strip trees and plants, keep the surface, recolor every 5 blocks of height",
    baseY: "World Y of bottom layer", restore: "Restore original", stepOf: "Step {} / {} · Y={}", total: "Total", tooMany: "Too many blocks ({}); the splitter handles up to 60,000",
    contourDone: "Contour: {} surface blocks", mismatch: "The file claims {} blocks, which differs from the actual count",
  },
};

function pickLang() {
  const q = new URLSearchParams(location.search).get("lang");
  const saved = localStorage.getItem("lv-viewer-lang");
  const nav = (navigator.language || "").toLowerCase();
  const guess = nav.startsWith("zh") ? (/tw|hk|hant/.test(nav) ? "zh_TW" : "zh_CN") : "en_US";
  for (const v of [q, saved, guess]) if (v && TEXT[v]) return v;
  return "zh_CN";
}
let lang = pickLang();
const fmt = (s, ...args) => args.reduce((out, a) => out.replace("{}", a), s);
const t = (key, ...args) => fmt(TEXT[lang][key] ?? TEXT.zh_CN[key] ?? key, ...args);
let gamedata = null;
const ui = (key, ...args) => fmt(gamedata?.ui[lang]?.[key] ?? gamedata?.ui.zh_CN[key] ?? key, ...args);

function nameOf(id) {
  const name = id.replace(/^(entity:)?minecraft:/, "").split("[")[0];
  if (lang === "en_US" || !gamedata) return name;
  return gamedata.blocks[lang][name] || gamedata.items[lang][name] || name;
}

function applyLang() {
  document.documentElement.lang = lang === "en_US" ? "en" : lang === "zh_TW" ? "zh-TW" : "zh-CN";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-ui]").forEach((el) => (el.textContent = ui(el.dataset.ui)));
  $("lang").value = lang;
  if (state.structure) renderInfo();
  if (state.steps) renderStep();
}

// ---------------------------------------------------------------- 状态

const state = {
  original: null,  // 刚读进来的结构（工具改完可以还原）
  structure: null, // 当前显示的结构（可能是等高图）
  results: null,   // { all: 结果, regions: [[名字, 结果]] }
  region: null,    // 选中的子区域，null = 总体
  tab: "all",
  steps: null,     // 分步拆解结果
  step: 0,
};
let view = null;

// ---------------------------------------------------------------- 读文件

async function openFile(file) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!EXTENSIONS.includes(ext)) { alert(t("unsupported")); return; }
  progress(0, t("reading"));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    load(parse(file.name, bytes), true);
  } catch (err) {
    console.error(err);
    progress(null);
    alert(t("failed", err.message || err));
  }
}

function load(structure, isOriginal) {
  if (isOriginal) state.original = structure;
  state.structure = structure;
  state.steps = null;
  state.region = null;
  const all = analyse(structure, gamedata);
  const regions = structure.regions.length > 1
    ? structure.regions.map((r, i) => [r.name || `Region${i + 1}`, analyse(structure, gamedata, { regions: [r] })])
    : [];
  state.results = { all, regions };

  $("empty").classList.add("is-hidden");
  $("bar-file").textContent = structure.fileName || structure.name;
  $("tools").hidden = false;
  $("steps").hidden = true;
  $("restore").hidden = structure === state.original;
  renderInfo();
  setupLayers(structure);
  draw(structure, true);
}

// ---------------------------------------------------------------- 3D

function progress(ratio, label) {
  const box = $("progress");
  if (ratio === null) { box.hidden = true; return; }
  box.hidden = false;
  $("progress-bar").style.setProperty("--p", `${Math.round(ratio * 100)}%`);
  $("progress-text").textContent = `${label} ${Math.round(ratio * 100)}%`;
}

async function draw(structure, resetCamera, layers = null) {
  const box = bounds(structure);
  await view.show(structure, box, {
    layers, resetCamera,
    onProgress: (r) => progress(r, t("building")),
  });
  progress(null);
  $("hint").hidden = false;
}

function setupLayers(structure) {
  const [, sy] = bounds(structure).size;
  const lo = $("layer-min"), hi = $("layer-max");
  lo.max = hi.max = sy - 1;
  lo.value = 0;
  hi.value = sy - 1;
  $("layers").hidden = sy <= 1;
  showLayerValue();
}
function showLayerValue() {
  const a = Math.min(+$("layer-min").value, +$("layer-max").value), b = Math.max(+$("layer-min").value, +$("layer-max").value);
  $("layer-value").textContent = `Y ${a} – ${b}`;
  return [a, b];
}

// ---------------------------------------------------------------- 右侧信息

function slotsHTML(n) {
  return `<span class="slots">${unitParts(n).map(([k, v]) => `<span class="slot">${v}<small>${esc(ui("unit." + k))}</small></span>`).join("")}</span>`;
}

function current() {
  if (state.region === null) return state.results.all;
  return state.results.regions.find(([name]) => name === state.region)[1];
}

function renderInfo() {
  const s = state.structure, r = current(), all = state.results.all;
  const [sx, sy, sz] = bounds(s).size;
  $("file-name").textContent = s.name;
  $("file-summary").textContent = `${t("size")} ${sx}×${sy}×${sz} | ${t("count")} ${all.placed} | ${t("kinds")} ${all.kinds}`;

  const version = s.source === "litematic" ? `litematic / ${s.version}` : `${s.source} / ${s.version || "-"}`;
  const stats = [
    ["ui.stat.l1", `${(r.redstoneRatio * 100).toFixed(1)}%`],
    ["ui.stat.l2", ui(`ui.stat.${r.machineType}`)],
    ["ui.stat.l3", `${r.fluid}u`],
    ["ui.stat.l4", `${r.density.toFixed(1)}%`],
    ["ui.stat.l5", s.author || "-"],
    ["ui.stat.l6", version],
    ["ui.stat.l7", (s.description || "-").slice(0, 120)],
  ];
  $("stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><b>${esc(ui(k))}</b><span>${esc(v)}</span></div>`).join("");

  // 子区域：总体 + 每个区域，单区域时不显示
  const regions = $("regions");
  regions.hidden = !state.results.regions.length;
  regions.innerHTML = [[null, ui("tab.region.all")], ...state.results.regions.map(([n]) => [n, n])]
    .map(([name, label]) => `<button class="region-btn${name === state.region ? " is-active" : ""}" data-region="${esc(name ?? "")}">${esc(label)}</button>`).join("");

  $("tabs").innerHTML = ["all", "blocks", "entities", "items"]
    .map((v) => `<button class="tab${v === state.tab ? " is-active" : ""}" role="tab" data-tab="${v}">${esc(ui("tab." + v))}</button>`).join("");

  const rows = state.tab === "all" ? totalRows(r) : r[state.tab];
  $("tab-count").textContent = ui("tab.count", rows.length, rows.reduce((a, [, n]) => a + n, 0));
  $("table").innerHTML = rows.slice(0, TABLE_LIMIT).map(([id, n]) => {
    const icon = blockIcon(id);
    return `<div class="row" title="${esc(id)}">${icon ? `<img src="${icon}" alt="">` : "<span></span>"}` +
      `<span class="name">${esc(nameOf(id))}</span><span class="right"><span class="num">${n}</span>${slotsHTML(n)}</span></div>`;
  }).join("") + (rows.length > TABLE_LIMIT ? `<div class="row-more">${esc(t("more", rows.length - TABLE_LIMIT))}</div>` : "");

  const cats = r.categoryTotals.filter(([, n]) => n > 0);
  const max = cats.length ? cats[0][1] : 1;
  $("cats").innerHTML = cats.map(([c, n]) =>
    `<div class="cat"><span>${esc(ui("cat." + c))}</span><span class="num">${n}</span><span class="bar"><i style="width:${(n / max) * 100}%"></i></span></div>`).join("");
}

// ---------------------------------------------------------------- 工具：分步拆解

function runSteps() {
  try {
    state.steps = splitSteps(state.structure, window.Splitter);
  } catch (err) {
    alert(String(err.message).startsWith("too many") ? t("tooMany", err.message.split(": ")[1]) : t("failed", err.message));
    return;
  }
  state.step = 0;
  const range = $("step-range");
  range.max = state.steps.steps.length - 1;
  range.value = 0;
  $("steps").hidden = false;
  $("layers").hidden = true; // 分步时按步骤显示，层滑块先收起来
  showStep(0);
}

function showStep(k) {
  const total = state.steps.steps.length;
  state.step = Math.max(0, Math.min(total - 1, k));
  $("step-range").value = state.step;
  renderStep();
  // 做到第 k 步为止的累计样子，相机不动，方便一步步对照
  draw(structureUpTo(state.steps, state.step), false);
}

function renderStep() {
  const st = state.steps.steps[state.step];
  $("step-kicker").textContent = t("stepOf", state.step + 1, state.steps.steps.length, `${st.ySpan[0]}${st.ySpan[1] !== st.ySpan[0] ? "–" + st.ySpan[1] : ""}`);
  $("step-title").textContent = st.title;
  $("step-mats").innerHTML = st.materials.map((m) => {
    const icon = blockIcon("minecraft:" + m.item);
    return `<div class="step-mat">${icon ? `<img src="${icon}" alt="">` : "<span></span>"}<span>${esc(nameOf("minecraft:" + m.item))}</span><span class="num">${m.count}</span></div>`;
  }).join("");
  $("step-notes").innerHTML = st.notes.map((n) => `<li>${esc(n.s)}</li>`).join("");
}

// ---------------------------------------------------------------- 工具：等高图

function runContour() {
  const baseY = parseInt($("base-y").value, 10);
  if (Number.isNaN(baseY)) return;
  const { structure, placed } = toContour(state.original, baseY);
  structure.fileName = state.original.fileName;
  load(structure, false);
  progress(null);
  $("bar-file").textContent = `${state.original.fileName} · ${t("contourDone", placed)}`;
}

// ---------------------------------------------------------------- 事件

function bind() {
  $("file-input").addEventListener("change", (e) => e.target.files[0] && openFile(e.target.files[0]));
  $("lang").addEventListener("change", (e) => { lang = e.target.value; localStorage.setItem("lv-viewer-lang", lang); applyLang(); });

  // 整个窗口都能接文件
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); if (++depth === 1) $("drop-veil").hidden = false; });
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("drop-veil").hidden = true; } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    $("drop-veil").hidden = true;
    if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });

  for (const id of ["layer-min", "layer-max"]) {
    $(id).addEventListener("input", showLayerValue);
    $(id).addEventListener("change", () => draw(state.structure, false, showLayerValue()));
  }
  $("regions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-region]");
    if (b) { state.region = b.dataset.region || null; renderInfo(); }
  });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { state.tab = b.dataset.tab; renderInfo(); }
  });

  $("steps-run").addEventListener("click", runSteps);
  $("step-range").addEventListener("change", (e) => showStep(+e.target.value));
  $("step-prev").addEventListener("click", () => showStep(state.step - 1));
  $("step-next").addEventListener("click", () => showStep(state.step + 1));
  $("contour-run").addEventListener("click", runContour);
  $("restore").addEventListener("click", () => load(state.original, true));
}

// ---------------------------------------------------------------- 启动

async function main() {
  bind();
  applyLang();
  [gamedata] = await Promise.all([fetch("data/gamedata.json").then((r) => r.json()), loadResources()]);
  applyLang();
  view = new View($("canvas"));
  const params = new URLSearchParams(location.search);
  // 从主页拖进来的：取出暂存的文件，再把网址里的 from=home 去掉，刷新时不会再找一遍
  if (params.get("from") === "home") {
    const file = await window.LVHandoff.take().catch(() => null);
    params.delete("from");
    history.replaceState(null, "", location.pathname + (params.size ? "?" + params : ""));
    if (file) openFile(file);
  }
  // ?file=<网址> 可以直接打开远程投影（同源或允许跨域的地址）
  const url = params.get("file");
  if (url) {
    const res = await fetch(url);
    openFile(new File([await res.arrayBuffer()], decodeURIComponent(url.split("/").pop())));
  }
}
main().catch((err) => { console.error(err); alert(t("failed", err.message || err)); });
