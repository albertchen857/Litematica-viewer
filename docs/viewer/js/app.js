// 网页版查看器的界面层：读文件 → 统计 → 渲染 → 右侧信息栏 + 工具。
// 算法都在别的模块里，这里只负责把它们接起来、把结果画到页面上。

import { parse, bounds, EXTENSIONS, fromPayload, isAir, RAW_TAG, prepareFormat } from "./formats.js";
import { analyse, totalRows, unitParts, materialOf } from "./analysis.js";
import { SAVE_FORMATS, exportText, download, compoundWith, toTag, writeLitematic, prepareWrite } from "./writers.js";
import { exportWorld } from "./world.js";
import { parseRules, replaceBlocks, RuleError } from "./edit.js";
import { loadResources, View, blockIcon, hasIcon, entityIconId } from "./render.js";
import { splitSteps, structureWithSteps } from "./tools/steps.js";
import { toContour } from "./tools/contour.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const TABLE_LIMIT = 300; // 表格最多先画这么多行，再多就显示「还有 N 项」，几千行 DOM 会卡

// ---------------------------------------------------------------- 语言

// 所有界面文字都在 lang/source/*.json 里（和桌面版同一套翻译）：
//   指标名、分类、单位、页签用桌面版原有的键；网页版自己的文字是 web.* 键。
// tools/build_web_data.py 把它们导出到 data/gamedata.json 的 ui 里。
const LANGS = ["zh_CN", "zh_TW", "en_US"];

// 和主页一样：语言写在网址上 ?lang=cn / tw / en，没写默认英文；地址栏只留 ?lang=（锚点 #desktop 保留）
const URL_CODE = { zh_CN: "cn", zh_TW: "tw", en_US: "en" };
const FROM_URL = { cn: "zh_CN", zh: "zh_CN", tw: "zh_TW", en: "en_US", zh_CN: "zh_CN", zh_TW: "zh_TW", en_US: "en_US" };
const START_PARAMS = new URLSearchParams(location.search); // 地址栏会被改成只剩 ?lang=，启动参数先留一份
function pickLang() {
  return FROM_URL[new URLSearchParams(location.search).get("lang")] || "en_US";
}
let sourceUrl = null; // 现在显示的投影是从哪个网址打开的（本地文件就是 null）
function syncUrl() {
  const file = sourceUrl ? `&file=${encodeURIComponent(sourceUrl)}` : "";
  history.replaceState(null, "", `${location.pathname}?lang=${URL_CODE[lang]}${file}${location.hash}`);
  // 主菜单带上语言；打开着网上的文件时「查看」也带 ?file=，点了还是这个投影
  document.getElementById("nav-view").href = `./?lang=${URL_CODE[lang]}${file}`;
  document.getElementById("nav-convert").href = `convert.html?lang=${URL_CODE[lang]}`;
}
let lang = pickLang();

// 操作偏好存在 localStorage（这个站点自己的存储，不上传）：材料表页签、分步拆解的几个参数。
// 语言写在网址上（?lang=），主题存在 lv-viewer-theme。
const PREFS_KEY = "lv-viewer-prefs";
const STEP_INPUTS = { detail: "opt-detail", maxmat: "opt-maxmat", shapes: "opt-shapes", band: "opt-band", cross: "opt-cross" };
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function setPref(key, value) {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), [key]: value }));
}
function savePrefs() {
  const prefs = { ...loadPrefs(), tab: state.tab };
  for (const [k, id] of Object.entries(STEP_INPUTS)) {
    const el = document.getElementById(id);
    prefs[k] = el.type === "checkbox" ? el.checked : el.value;
  }
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
function restorePrefs() {
  const prefs = loadPrefs();
  if (["all", "blocks", "entities", "items"].includes(prefs.tab)) state.tab = prefs.tab;
  for (const [k, id] of Object.entries(STEP_INPUTS)) {
    if (!(k in prefs)) continue;
    const el = document.getElementById(id);
    if (el.type === "checkbox") el.checked = !!prefs[k]; else el.value = prefs[k];
  }
}
let themeName = localStorage.getItem("lv-viewer-theme") || "BlueAr";
const fmt = (s, ...args) => args.reduce((out, a) => out.replace("{}", a), s);
let gamedata = null;
const ui = (key, ...args) => fmt(gamedata?.ui[lang]?.[key] ?? gamedata?.ui.zh_CN[key] ?? key, ...args);
const t = (key, ...args) => ui("web." + key, ...args);

function nameOf(id) {
  const name = id.replace(/^(entity:)?minecraft:/, "").split("[")[0];
  if (lang === "en_US" || !gamedata) return name;
  return gamedata.blocks[lang][name] || gamedata.items[lang][name] || name;
}

function applyTheme(name) {
  const themes = gamedata?.themes || {};
  const theme = themes[name] || themes.BlueAr;
  if (!theme) return;
  themeName = themes[name] ? name : "BlueAr";
  const root = document.documentElement.style;
  root.setProperty("--mc", theme.MC);
  root.setProperty("--pc", theme.PC);
  root.setProperty("--bg", theme.BG);
  root.setProperty("--tt", theme.TT);
  root.setProperty("--pr", theme.PR);
  document.documentElement.dataset.theme = themeName;
  $("theme").value = themeName;
  view?.setTheme(theme);
}

function applyLang() {
  if (!gamedata) return; // 翻译还没加载完，页面上先显示 HTML 里写的中文
  document.documentElement.lang = lang === "en_US" ? "en" : lang === "zh_TW" ? "zh-TW" : "zh-CN";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-ui]").forEach((el) => (el.textContent = ui(el.dataset.ui)));
  $("picker-search").placeholder = t("picker.search");
  $("url-input").placeholder = t("url.placeholder");
  if (view) setOrtho(view.ortho); // 按钮提示跟着换语言
  renderBatch(); // 全面替换那几行的「原方块 / 换成」提示字
  $("lang").value = lang;
  document.title = t("pageTitle");
  syncUrl();
  // 字都换好了，显示出来（桌面版要等 payload 里的语言，在 main 里去掉）
  if (location.hash !== "#desktop") document.documentElement.classList.remove("i18n-wait");
  if ($("layer-mode")) $("layer-mode").textContent = t("layerMode." + layerMode);
  if (state.structure) renderInfo();
  else renderPlaceholder();
  if (state.steps) renderStep();
}

// ---------------------------------------------------------------- 状态

const state = {
  pristine: null,  // 刚打开时的样子（「还原原始投影」回到这里）
  original: null,  // 工具（等高图）的起点：刚打开的结构，替换过方块就是替换后的
  undo: null,      // 上一次替换前的 { structure, original, edited }，「撤销」用
  edited: false,   // 替换过方块（导出文件名加 _Modified，同桌面版）
  structure: null, // 当前显示的结构（可能是等高图）
  results: null,   // { all: 结果, regions: [[名字, 结果]] }
  region: null,    // 选中的子区域，null = 总体
  tab: "all",
  steps: null,     // 分步拆解结果
  step: 0,
  ignored: new Set(),     // 3D 里隐藏的方块种类（方块 id），信息面板「隐藏这种」
  highlighted: new Set(), // 3D 里高亮的方块种类
};
let view = null;

// ---------------------------------------------------------------- 读文件

async function openFile(file) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!EXTENSIONS.includes(ext)) { alert(t("unsupported")); return; }
  progress(0, t("reading"));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await prepareFormat(file.name);
    const structure = parse(file.name, bytes);
    load(structure, { pristine: true });
    warnUnknownLegacy(structure);
    sourceUrl = null;
    syncUrl();
    window.LVRecent?.save(file).catch(() => {}); // 记成「上次的文件」，下次进来一键再开
  } catch (err) {
    console.error(err);
    progress(null);
    alert(t("failed", err.message || err));
  }
}

// ---- 从网址打开：浏览器直接把文件下下来，跟拖进来的一样处理（也不经过我们的服务器）。
// 对方网站得允许跨域读取（GitHub raw、大部分网盘直链可以；Discord 附件这类不行，只能先下载再拖进来）

// 常见的「网页链接」换成「文件直链」
function directUrl(raw) {
  const url = new URL(raw);
  // github.com/<用户>/<仓库>/blob/<分支>/<路径> → raw.githubusercontent.com/<用户>/<仓库>/<分支>/<路径>
  const blob = url.hostname === "github.com" && url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  // Dropbox 分享链接默认是预览页，dl=1 才是文件本身
  if (/(^|\.)dropbox\.com$/.test(url.hostname)) { url.searchParams.set("dl", "1"); return url.href; }
  return url.href;
}

// 文件名：优先服务器给的（Content-Disposition），再取网址最后一段
function urlFileName(res, url) {
  const cd = res.headers.get("content-disposition") || "";
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i), plain = cd.match(/filename="?([^";]+)"?/i);
  try {
    if (star) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    if (plain) return plain[1].trim();
  } catch { /* 名字解不开就用网址的 */ }
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "download";
  try { return decodeURIComponent(last); } catch { return last; }
}

// 没有扩展名（或者扩展名不对）的：三种格式挨个试
// 老 .schematic 里对照表认不出的数字 ID（模组方块之类）：当空气处理，提示一下有哪些
function warnUnknownLegacy(structure) {
  const unknown = structure.unknownLegacy || [];
  if (unknown.length) toast(t("legacy.unknown", unknown.length, unknown.slice(0, 8).join(", ")), { undo: false });
}

async function parseAnyFormat(name, bytes) {
  await prepareFormat(".schematic"); // 挨个试的时候也可能是老格式
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (EXTENSIONS.includes(ext)) return { structure: parse(name, bytes), name };
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  for (const guess of EXTENSIONS) {
    try { return { structure: parse(stem + guess, bytes), name: stem + guess }; } catch { /* 下一个 */ }
  }
  throw new Error(t("url.unknown"));
}

async function openUrl(raw) {
  let url;
  try {
    url = directUrl(String(raw).trim());
    if (!/^https?:$/.test(new URL(url).protocol)) throw new Error();
  } catch { alert(t("url.bad")); return; }
  progress(0, t("url.loading"));
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    // fetch 直接抛错基本就是跨域被拦或者网络不通（浏览器不告诉页面具体是哪个）
    console.error(err);
    progress(null);
    alert(t("url.cors"));
    return;
  }
  if (!res.ok) { progress(null); alert(t("url.http", `${res.status} ${res.statusText}`.trim())); return; }
  try {
    // 边下边算进度（服务器没给大小就只显示 0%，下完直接跳过去）
    const total = +res.headers.get("content-length") || 0;
    const parts = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.length;
      if (total) progress(Math.min(1, got / total), t("url.loading"));
    }
    const bytes = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { bytes.set(p, at); at += p.length; }
    const { structure, name } = await parseAnyFormat(urlFileName(res, url), bytes);
    progress(0, t("reading"));
    load(structure, { pristine: true });
    warnUnknownLegacy(structure);
    sourceUrl = url;
    syncUrl(); // 渲染的是网上的文件：地址栏带上 ?file=，这个链接分享出去别人打开就是同一个投影
    $("url-input").value = "";
    window.LVRecent?.save(new File([bytes], name)).catch(() => {});
  } catch (err) {
    console.error(err);
    progress(null);
    alert(t("failed", err.message || err));
  }
}

// pristine：刚打开的文件；original：作为工具的起点；keepCamera：替换 / 撤销时相机不动
function load(structure, { pristine = false, original = pristine, keepCamera = false } = {}) {
  if (pristine) { state.pristine = structure; state.edited = false; state.ignored.clear(); state.highlighted.clear(); }
  if (original) state.original = structure;
  state.undo = null;
  $("toast").hidden = true;
  closePicker();
  state.structure = structure;
  state.steps = null;
  state.region = null;
  showInspect(null);
  $("steps-exit").hidden = true;
  state.results = analyseAll(structure);

  $("empty").classList.add("is-hidden");
  $("bar-file").textContent = (structure.fileName || structure.name) + (state.edited ? ` · ${t("edited")}` : "");
  $("bar-tools").classList.remove("is-off");
  $("tools").hidden = false;
  $("steps").hidden = true;
  $("restore").hidden = structure === state.pristine;
  renderInfo();
  setupLayers(structure);
  renderKindBar();
  draw(structure, !keepCamera);
  // 第一次打开文件时把教程弹出来一次
  if (pristine && !isDesktop() && !localStorage.getItem("lv-viewer-tutorial")) {
    localStorage.setItem("lv-viewer-tutorial", "1");
    $("tutorial-dlg").showModal();
  }
}

function analyseAll(structure) {
  const all = analyse(structure, gamedata);
  const regions = structure.regions.length > 1
    ? structure.regions.map((r, i) => [r.name || `Region${i + 1}`, analyse(structure, gamedata, { regions: [r] })])
    : [];
  return { all, regions };
}

// ---------------------------------------------------------------- 3D

function progress(ratio, label) {
  const box = $("progress");
  if (ratio === null) { box.hidden = true; return; }
  box.hidden = false;
  $("progress-bar").style.setProperty("--p", `${Math.round(ratio * 100)}%`);
  $("progress-text").textContent = `${label} ${Math.round(ratio * 100)}%`;
}

async function draw(structure, resetCamera, label = t("building")) {
  const box = bounds(structure);
  const region = structure === state.structure ? regionIndex() : null;
  await view.show(structure, box, { resetCamera, region, ignore: state.ignored, onProgress: (r) => progress(r, label) });
  progress(null);
  $("hint").hidden = false;
  $("gizmo").removeAttribute("hidden"); // SVG 没有 .hidden 属性，只能删特性
  $("proj-toggle").hidden = false;
}

let layerMode = "all"; // all 全部 / range 范围 / single 单层
const LAYER_MODES = ["all", "range", "single"];

function setupLayers(structure) {
  const [, sy] = bounds(structure).size;
  const lo = $("layer-min"), hi = $("layer-max");
  lo.max = hi.max = sy - 1;
  $("layers").hidden = sy <= 1;
  layerMode = "all";
  $("layers").dataset.mode = "all";
  $("layer-mode").textContent = t("layerMode.all");
  lo.value = 0;
  hi.value = sy - 1;
  lo.disabled = hi.disabled = true;
  showLayerValue();
}
function showLayerValue() {
  const lo = $("layer-min"), hi = $("layer-max");
  let a, b;
  if (layerMode === "all") { a = 0; b = +hi.max; }
  else if (layerMode === "single") { a = b = +hi.value; }
  else { a = Math.min(+lo.value, +hi.value); b = Math.max(+lo.value, +hi.value); }
  $("layer-value").textContent = a === b ? `Y ${a}` : `Y ${a} – ${b}`;
  // 双头滑块中间那段高亮，用 CSS 变量传百分比
  const max = +hi.max || 1;
  $("dual").style.setProperty("--a", `${(a / max) * 100}%`);
  $("dual").style.setProperty("--b", `${(b / max) * 100}%`);
  return [a, b];
}

function setLayerMode(mode) {
  layerMode = mode;
  const lo = $("layer-min"), hi = $("layer-max");
  $("layers").dataset.mode = mode;
  $("layer-mode").textContent = t("layerMode." + mode);
  if (mode === "all") { lo.value = 0; hi.value = hi.max; }
  if (mode === "single") hi.value = 0; // 单层默认从第 0 层看起
  if (mode === "range") { lo.value = 0; hi.value = hi.max; }
  lo.disabled = hi.disabled = mode === "all";
  view.setFilter({ layers: showLayerValue() });
}

// ---------------------------------------------------------------- 右侧信息

function slotsHTML(n) {
  return `<span class="slots">${unitParts(n).map(([k, v]) => `<span class="slot">${v}<small>${esc(ui("unit." + k))}</small></span>`).join("")}</span>`;
}

function current() {
  if (state.region === null) return state.results.all;
  return state.results.regions.find(([name]) => name === state.region)[1];
}

// 分类 → 代表物品（图标）
const CATEGORY_ICON = {
  redstone: "redstone", glass: "glass", stone: "stone", iron: "iron_ingot", fluid: "water_bucket",
  other: "knowledge_book", nature: "oak_leaves", container: "chest", nether: "netherrack", wood: "oak_planks",
  entity: "minecart", wool: "white_wool", terracotta: "terracotta", concrete: "white_concrete", quartz: "quartz_block",
  ore: "diamond_ore", end: "end_stone", rock: "andesite", prismarine: "prismarine", clay: "clay",
};

// 还没打开文件：统计卡片先放 7 行「-」占位，和打开后一样高（打开文件时下面的卡片就不会被挤动，CLS）
function renderPlaceholder() {
  $("stats").innerHTML = ["l1", "l2", "l3", "l4", "l5", "l6", "l7"]
    .map((k) => `<div class="stat"><b>${esc(ui("ui.stat." + k))}</b><span>-</span></div>`).join("");
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
  // 红石偏度、液体偏度不好懂：名字右上角放个灰色小「?」，鼠标放上去出解释
  const TIPS = { "ui.stat.l1": "tip.redstone", "ui.stat.l3": "tip.fluid" };
  $("stats").innerHTML = stats.map(([k, v]) => `<div class="stat" data-stat="${k}"${k === "ui.stat.l7" && !isDesktop() ? ` title="${esc(t("rename.tip"))}"` : ""}>` +
    `<b>${esc(ui(k))}${TIPS[k] ? `<i class="stat-tip" tabindex="0" aria-label="${esc(t(TIPS[k]))}" data-tip="${esc(t(TIPS[k]))}">?</i>` : ""}</b><span>${esc(v)}</span></div>`).join("");
  renderFileThumb();
  $("file-name").title = isDesktop() ? "" : t("rename.tip");

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
    return `<div class="row${kindClass(id)}" title="${esc(id)}" data-id="${esc(id)}">${icon ? `<img src="${icon}" alt="">` : "<span></span>"}` +
      `<span class="name">${esc(nameOf(id))}</span><span class="right"><span class="num">${n}</span>${slotsHTML(n)}</span></div>`;
  }).join("") + (rows.length > TABLE_LIMIT ? `<div class="row-more">${esc(t("more", rows.length - TABLE_LIMIT))}</div>` : "");

  const cats = r.categoryTotals.filter(([, n]) => n > 0);
  // 每类配一个代表物品的图标
  const max = cats.length ? cats[0][1] : 1;
  $("cats").innerHTML = cats.map(([c, n]) =>
    `<div class="cat"><img src="${blockIcon("minecraft:" + (CATEGORY_ICON[c] || "knowledge_book"))}" alt=""><span>${esc(ui("cat." + c))}</span><span class="num">${n}</span><span class="bar"><i style="width:${(n / max) * 100}%"></i></span></div>`).join("");
}

// ---------------------------------------------------------------- 工具：分步拆解

// 细分程度 1~9（粗 → 细）：一个滑块同时管颜色合并阈值和「小组并入邻组」的块数。
// 第 5 档就是原来的默认值（8, 4）。跨层上限固定 64，不放出来。
const DETAIL = [[24, 16], [18, 12], [14, 8], [11, 6], [8, 4], [6, 3], [4, 2], [2, 1], [0, 1]];
function stepParams() {
  const [simThreshold, minBlocks] = DETAIL[(+$("opt-detail").value || 5) - 1];
  return {
    simThreshold, minBlocks,
    maxMaterials: Math.max(1, +$("opt-maxmat").value || 9),
    mergeShapes: $("opt-shapes").checked,
    bandMerge: $("opt-band").checked,
    crossLayer: $("opt-cross").checked,
    crossPerLayer: 64, crossMaxSpan: 64,
  };
}

function runSteps() {
  try {
    state.steps = splitSteps(state.structure, window.Splitter, stepParams());
  } catch (err) {
    alert(String(err.message).startsWith("too many") ? t("tooMany", err.message.split(": ")[1]) : t("failed", err.message));
    return;
  }
  state.step = 0;
  const range = $("step-range");
  range.max = state.steps.steps.length - 1;
  range.value = 0;
  $("steps").hidden = false;
  $("steps-exit").hidden = false;
  $("layers").hidden = true; // 分步时按步骤显示，层滑块先收起来
  prepareSteps();
}

// 一次把所有步骤都摊进场景：每格记下属于第几步，按步骤分好桶、网格建好。
// 之后切到哪一步都只是在两步之间增删方块、重画碰到的那几个区块，几乎是瞬间的。
async function prepareSteps() {
  const steps = state.steps;
  state.step = 0;
  renderStep();
  $("steps").classList.add("is-loading");
  await draw(structureWithSteps(steps), false, t("caching"));
  if (state.steps !== steps) return; // 准备期间又重新拆了 / 退出了
  $("steps").classList.remove("is-loading");
  view.setFilter({ step: 0 });
}

// 退出分步：回到完整的投影，层滑块放回来
function exitSteps() {
  state.steps = null;
  $("steps").hidden = true;
  $("steps-exit").hidden = true;
  setupLayers(state.structure);
  draw(state.structure, false);
}

// ---------------------------------------------------------------- 点选信息（左上角）

// 1.21.5 起名字、告示牌文字存成文本组件对象（{"text": "..."} 或带 extra 的），老版本是 JSON 字符串
function textOf(value) {
  if (value == null) return "";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  return (value.text ?? value.translate ?? "") + (value.extra ? textOf(value.extra) : "");
}

const CONTAINER_SIZES = [
  [/(^|:)(chest|trapped_chest|barrel|.*shulker_box)$/, 27], [/(^|:)hopper$/, 5], [/(dispenser|dropper|crafter)$/, 9],
  [/(furnace|smoker)$/, 3], [/brewing_stand$/, 5], [/chiseled_bookshelf$/, 6], [/(hopper_minecart)$/, 5], [/(chest_minecart|chest_boat)$/, 27],
];
const containerSize = (id) => (CONTAINER_SIZES.find(([re]) => re.test(id)) || [null, 0])[1];

let inspectHit = null;
function showInspect(hit) {
  const box = $("inspect");
  inspectHit = hit;
  if (!hit) { box.hidden = true; closePicker(); return; }
  // 方块：按坐标找回结构里真正的格子（分步模式下 3D 里的是拆分后的结构；替换后要拿新的）
  const at = hit.kind === "block" ? locate(hit.pos) : null;
  if (at) hit = { ...hit, block: at.block, region: at.region, local: at.local };
  inspectHit = hit;
  $("inspect-edit").hidden = !at || isDesktop();
  if (at && !isDesktop()) renderEdit(hit);
  const id = hit.kind === "entity" ? hit.entity.id : hit.block.id;
  const icon = (hit.kind === "entity" ? blockIcon(entityIconId(hit.entity), 32) : "") || blockIcon(id, 32);
  $("inspect-icon").src = icon || "";
  $("inspect-icon").hidden = !icon;
  $("inspect-name").textContent = (hit.kind === "entity" ? t("entity") + " · " : "") + nameOf(id);
  $("inspect-id").textContent = id;
  const pos = hit.pos.map((v) => (Number.isInteger(v) ? v : v.toFixed(1))).join(", ");
  const regionName = hit.region && state.structure.regions.length > 1 ? "  " + t("region", hit.region.name) : "";
  $("inspect-pos").textContent = t("pos", pos) + regionName;

  renderKind(hit);

  // 方块属性
  const props = hit.kind === "block" ? Object.entries(hit.block.props) : [];
  $("inspect-props").innerHTML = props.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");

  // 容器：方块实体（或运输矿车 / 展示框这类实体）里的物品，按槽位排成背包格子
  const data = hit.kind === "entity" ? hit.entity.nbt || {} : hit.region.blockEntities.get(hit.local.join(",")) || {};
  let items = [];
  if (Array.isArray(data.Items)) items = data.Items;
  else if (data.Item && typeof data.Item === "object") items = [data.Item];
  else if (data.item && typeof data.item === "object") items = [data.item];
  else if (data.RecordItem && typeof data.RecordItem === "object") items = [data.RecordItem];
  items = items.filter((i) => i && (i.id || i.Name));
  const slotOf = (item, n) => +(item.Slot ?? item.slot ?? n);
  // 格子数按容器种类来（和桌面版容器分析器一样）；不认识的按用到的最大槽位凑整行
  const capacity = containerSize(id);
  const used = items.length ? Math.max(...items.map(slotOf)) + 1 : 0;
  const slots = capacity ? Math.max(capacity, used) : Math.ceil(used / 9) * 9;
  const cells = Array.from({ length: Math.min(slots, 54) }, () => ({ html: "" }));
  const editable = hit.kind === "block" && capacity > 0 && !isDesktop(); // 方块容器的格子可以点着放物品
  $("inspect-items").style.gridTemplateColumns = `repeat(${Math.min(9, slots || 9)}, 1fr)`;
  items.forEach((item, n) => {
    const slot = slotOf(item, n);
    const itemId = String(item.id || item.Name);
    const count = Number(item.count ?? item.Count ?? 1);
    if (slot < cells.length) {
      cells[slot] = { html: `<img src="${blockIcon(itemId, 24)}" alt="">${count > 1 ? `<span>${count}</span>` : ""}`, name: nameOf(itemId), id: itemId, count };
    }
  });
  const slotAttr = (i) => (editable ? ` data-slot="${i}"` : "");
  $("inspect-items").innerHTML = cells.map((c, i) => c.id
    ? `<div class="slot-cell${editable ? " is-editable" : ""}"${slotAttr(i)} data-name="${esc(c.name)}" data-id="${esc(c.id)}" data-count="${c.count}">${c.html}</div>`
    : `<div class="slot-cell${editable ? " is-editable" : ""}"${slotAttr(i)}></div>`).join("");
  $("inspect-items-tip").hidden = !editable;

  // 其他值得一看的：命令方块的命令、告示牌的字、自定义名字
  const extra = [];
  if (data.Command) extra.push(t("command", data.Command));
  const lines = data.front_text?.messages || (data.Text1 ? [data.Text1, data.Text2, data.Text3, data.Text4] : null);
  if (lines) {
    const text = lines.map((m) => textOf(m).replace(/^"|"$/g, "")).filter((m) => m && m !== '""').join(" / ");
    if (text) extra.push(t("text", text));
  }
  if (data.CustomName) extra.push(textOf(data.CustomName));
  $("inspect-extra").textContent = extra.join("\n");
  box.hidden = false;
}

function showStep(k) {
  const total = state.steps.steps.length;
  state.step = Math.max(0, Math.min(total - 1, k));
  $("step-range").value = state.step;
  renderStep();
  // 做到第 k 步为止的累计样子，相机不动，方便一步步对照（场景是拆完时预备好的）
  view.setFilter({ step: state.step });
}

// ---- 步骤标题 / 备注的多语言
// 拆分算法（splitter.js，原样取自「投影分步查看器」）只会写简体中文。简体页面原样显示；
// 繁体和英文页面按步骤里的数据重新拼标题，备注按模板匹配后换成对应语言（数字保留）。
const NOTE_PATTERNS = [
  [/^提前放：给步骤 (\d+)（.*）提供依附面$/, "enables"],
  [/^延续下层同一纹理体$/, "continued"],
  [/^顺带放入相邻零碎块/, "merged"],
  [/^挂在本层方块下方/, "deferred"],
  [/^(\d+) 块要等本层相邻步骤放完后才有依附面$/, "later"],
  [/^(\d+) 块悬空/, "floating"],
  [/^(\d+) 块缺少依附方块/, "missing"],
  [/^含 (\d+) 块重力方块/, "gravity"],
  [/^混搭纹理：/, "mixed"],
  [/^本层与上方 (\d+) 层完全相同，重复 (\d+) 次$/, "band"],
  [/^这几种方块互相撑着/, "interleave"],
  [/^跨层步骤：竖向一口气做 (\d+) 层（(.*)），上层轮到时这些位置已完成$/, "cross"],
];

function stepNote(note, st) {
  if (lang === "zh_CN") return note.s;
  for (const [re, key] of NOTE_PATTERNS) {
    const m = note.s.match(re);
    if (!m) continue;
    if (key === "mixed") {
      const total = st.materials.reduce((a, x) => a + x.count, 0) || 1;
      return t("note.mixed", st.materials.map((x) => `${nameOf("minecraft:" + x.item)} ${Math.round((x.count / total) * 100)}%`).join(" / "));
    }
    if (key === "cross") return t("note.cross", m[1], m[2].replace(/、/g, ", "));
    return t("note." + key, ...m.slice(1));
  }
  return note.s;
}

function stepTitle(st) {
  if (lang === "zh_CN") return st.title;
  const names = [...st.materials].sort((a, b) => b.count - a.count).map((x) => nameOf("minecraft:" + x.item));
  const spots = st.spots > 1 ? " · " + t("spots", st.spots) : "";
  if (st.cross) {
    return (names.length > 1 ? names.slice(0, 2).join(" → ") + (names.length > 2 ? " …" : "") : names[0]) + spots + ` (Y${st.ySpan[0]}–Y${st.ySpan[1]})`;
  }
  if (st.interleave) return names.join(" + ") + " " + t("interleaved");
  if (st.deferred) return t("hanging");
  if (st.bodies && st.bodies.length && st.role !== "attach" && st.role !== "redstone") return (names[0] || "") + spots;
  return t("role." + st.role);
}

function renderStep() {
  const st = state.steps.steps[state.step];
  $("step-kicker").textContent = t("stepOf", state.step + 1, state.steps.steps.length, `${st.ySpan[0]}${st.ySpan[1] !== st.ySpan[0] ? "–" + st.ySpan[1] : ""}`);
  $("step-title").textContent = stepTitle(st);
  $("step-mats").innerHTML = st.materials.map((m) => {
    const icon = blockIcon("minecraft:" + m.item);
    return `<div class="step-mat">${icon ? `<img src="${icon}" alt="">` : "<span></span>"}<span>${esc(nameOf("minecraft:" + m.item))}</span><span class="num">${m.count}</span></div>`;
  }).join("");
  $("step-notes").innerHTML = st.notes.map((n) => `<li>${esc(stepNote(n, st))}</li>`).join("");
}

// ---------------------------------------------------------------- 工具：等高图

function runContour() {
  const baseY = parseInt($("base-y").value, 10);
  if (Number.isNaN(baseY)) return;
  const { structure, placed } = toContour(state.original, baseY);
  structure.fileName = state.original.fileName;
  load(structure);
  progress(null);
  $("bar-file").textContent = `${state.original.fileName} · ${t("contourDone", placed)}`;
}

// ---------------------------------------------------------------- 导出 / 转换文件类型

// 导出文件名：原文件名；替换过方块加 _Modified（同桌面版 quick_replace）；等高图用它自己的名字
function stem() {
  const file = state.pristine.fileName || state.pristine.name;
  const base = file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
  if (state.structure !== state.pristine && !state.edited) return state.structure.name || base;
  return base + (state.edited ? "_Modified" : "");
}

// 材料表 txt（同 ui_main.export_text）：按当前选中的子区域
function exportList(classified, csv = false) {
  if (!state.structure) { alert(t("needFile")); return; }
  const text = exportText(current(), {
    classified, csv, nameOf,
    unit: (k) => ui("unit." + k), catLabel: (c) => ui("cat." + c), order: gamedata.categoryOrder || [],
  });
  download(`${stem()}.${csv ? "csv" : "txt"}`, text, csv ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8");
}

// 另存成别的格式（同 ui_main.save_as）：存的是当前显示的结构，含替换后的
async function saveAs(ext) {
  if (!state.structure) { alert(t("needFile")); return; }
  if (ext === "world") return saveWorld();
  try {
    await prepareWrite(ext);
    const { bytes, report } = SAVE_FORMATS[ext](state.structure);
    download(stem() + ext, bytes);
    // .schematic：老版本没有的方块写成了空气；其他格式：没有换算规则的状态原样写进去了
    if (report.size) alert((ext === ".schematic" ? t("schematic.missing", report.size) : ui("app.save.report", report.size)) + "\n\n" + [...report].map(short).join(", "));
  } catch (err) {
    console.error(err);
    alert(ui("app.save.fail", err.message || err));
  }
}

// 换游戏版本（同桌面版 convert_version）：写成 .litematic、Version 改成选的那个，存成 名字_vN.litematic。
// 桌面版只认 .litematic 原文件；网页这里什么格式打开的都能转，存的是当前结构（含替换）
function saveVersion(version) {
  if (!state.structure) { alert(t("needFile")); return; }
  try {
    download(`${stem()}_v${version}.litematic`, writeLitematic(state.structure, version));
  } catch (err) {
    console.error(err);
    alert(ui("app.save.fail", err.message || err));
  }
}

// ---------------------------------------------------------------- 右键菜单 + 快捷替换方块

function openMenu(x, y, head, items) {
  const menu = $("ctx");
  menu.innerHTML = `<div class="ctx-head">${esc(head)}</div>` + items.map((it, i) =>
    `<button type="button" role="menuitem" data-i="${i}"${it.disabled ? " disabled" : ""}>${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ""}</button>`).join("");
  menu.hidden = false;
  // 贴着鼠标，别超出窗口
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  menu.onclick = (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b || b.disabled) return;
    closeMenu();
    items[+b.dataset.i].action();
  };
}
function closeMenu() { $("ctx").hidden = true; }

const short = (id) => id.replace(/^minecraft:/, "");
const json = (o) => (Object.keys(o).length ? JSON.stringify(o) : "");
// 选择框贴在鼠标位置（右键菜单里打开时没有按钮可贴）
const pointAt = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }), contains: () => false });

// 选中的子区域在结构里的下标（没选 = null）
function regionIndex() {
  if (state.region === null || !state.structure) return null;
  const i = state.structure.regions.findIndex((r, k) => (r.name || `Region${k + 1}`) === state.region);
  return i < 0 ? null : i;
}

// 材料表里的一行 → 调色板里对应的方块 id。行是折算后的材料（红石粉、火把……），
// 所以「本身就是它」和「折算出来有它」的方块都算上（墙上的火把会和火把一起换）
function blockSourcesFor(id) {
  const index = regionIndex();
  const regions = index === null ? state.structure.regions : [state.structure.regions[index]];
  const found = new Set();
  for (const r of regions) for (const b of r.palette) {
    if (isAir(b) || found.has(b.id)) continue;
    if (b.id === id || materialOf(b).some(([m]) => m === id)) found.add(b.id);
  }
  return [...found];
}

// 桌面版里打开的 3D 窗口（#desktop）没有顶栏、存不了文件，编辑功能在桌面版主程序里做
const isDesktop = () => document.body.classList.contains("desktop");

function rowMenu(e) {
  const row = e.target.closest(".row[data-id]");
  if (!row || isDesktop()) return;
  e.preventDefault();
  const id = row.dataset.id;
  // 实体页、容器物品页的不是摆在那里的方块，没法换
  const sources = state.tab === "entities" || state.tab === "items" ? [] : blockSourcesFor(id);
  openMenu(e.clientX, e.clientY, nameOf(id), [{
    label: ui("row.replace"), disabled: !sources.length, note: sources.length ? "" : t("replace.noBlock"),
    action: () => quickReplace({ anchor: pointAt(e.clientX, e.clientY), sources }),
  }, ...kindMenu(sources)]);
}

// 3D 里右键点了一个方块。分步模式下显示的是拆分后的结构，按坐标找回真正的区域和格子
function locate(pos) {
  const s = state.structure, box = bounds(s);
  const world = pos.map((v, i) => v + box.origin[i]);
  for (let k = s.regions.length - 1; k >= 0; k--) {
    const r = s.regions[k], local = world.map((v, i) => v - r.origin[i]);
    if (local.some((v, i) => v < 0 || v >= r.size[i])) continue;
    const index = local[0] * r.size[1] * r.size[2] + local[1] * r.size[2] + local[2];
    const block = r.palette[r.blocks[index]];
    if (!isAir(block)) return { region: r, local, block, index };
  }
  return null;
}

function blockMenu(hit, x, y) {
  if (hit.kind !== "block") return;
  const at = locate(hit.pos);
  if (!at) return;
  openMenu(x, y, nameOf(at.block.id), [
    ...(isDesktop() ? [] : [{ label: ui("row.replace"), action: () => quickReplace({ anchor: pointAt(x, y), sources: [at.block.id], at }) }]),
    { label: t("inspectMenu"), action: () => showInspect(hit) },
    ...kindMenu([at.block.id]),
  ]);
}

// ---------------------------------------------------------------- 3D 里隐藏 / 高亮某种方块
// 按方块 id 算（同一种方块不管什么状态都算）。材料表里的一行可能对应好几种方块（比如床的物品对应 16 色床），一起切换

function toggleKind(set, ids) {
  const all = ids.every((id) => set.has(id));
  for (const id of ids) (all ? set.delete(id) : set.add(id));
}

function applyKinds() {
  view.setFilter({ ignore: state.ignored });
  const { truncated } = view.setHighlight(state.highlighted);
  if (truncated) toast(t("kind.tooMany"), { undo: false });
  renderKindBar();
  renderInfo(); // 材料表的行标记
  if (inspectHit?.kind === "block") renderKind(inspectHit);
}

function kindMenu(ids) {
  if (!ids.length || !view) return [];
  return [
    { label: t(ids.every((id) => state.ignored.has(id)) ? "kind.unignore" : "kind.ignore"), action: () => { toggleKind(state.ignored, ids); applyKinds(); } },
    { label: t(ids.every((id) => state.highlighted.has(id)) ? "kind.unhighlight" : "kind.highlight"), action: () => { toggleKind(state.highlighted, ids); applyKinds(); } },
  ];
}

// 材料表一行的标记：这行对应的方块全被隐藏了 → 变淡；有被高亮的 → 左边一道黄
function kindClass(id) {
  if ((!state.ignored.size && !state.highlighted.size) || state.tab === "entities" || state.tab === "items") return "";
  const sources = blockSourcesFor(id);
  if (!sources.length) return "";
  return (sources.every((s) => state.ignored.has(s)) ? " is-ignored" : "") + (sources.some((s) => state.highlighted.has(s)) ? " is-lit" : "");
}

function renderKindBar() {
  const parts = [];
  if (state.ignored.size) parts.push(t("kind.hiddenCount", state.ignored.size));
  if (state.highlighted.size) parts.push(t("kind.litCount", state.highlighted.size));
  $("kind-bar").hidden = !parts.length;
  $("kind-outline-wrap").hidden = !state.ignored.size;
  $("kind-bar-text").textContent = parts.join(" · ");
}

// 信息面板里「这种方块」那块：材料表里写的数量（同材料表的折算：床 / 门算一个、双层台阶算两个……）+ 两个开关
function renderKind(hit) {
  const box = $("inspect-kind");
  box.hidden = hit.kind !== "block" || !state.results;
  if (box.hidden) return;
  const id = hit.block.id;
  const rows = current().blocks;
  const mats = materialOf(hit.block);
  $("inspect-count").innerHTML = `<span>${esc(t("kind.inTable"))}</span>` + (mats.length
    ? mats.map(([m]) => {
      const n = rows.find(([k]) => k === m)?.[1] || 0;
      const icon = blockIcon(m);
      return `<span class="inspect-count-row">${icon ? `<img src="${icon}" alt="">` : ""}<b>${esc(nameOf(m))}</b><span class="num">${n}</span>${slotsHTML(n)}</span>`;
    }).join("")
    : `<span class="inspect-count-row">${esc(t("kind.notCounted"))}</span>`);
  const hidden = state.ignored.has(id), lit = state.highlighted.has(id);
  $("kind-ignore").textContent = t(hidden ? "kind.unignore" : "kind.ignore");
  $("kind-ignore").classList.toggle("is-on", hidden);
  $("kind-highlight").textContent = t(lit ? "kind.unhighlight" : "kind.highlight");
  $("kind-highlight").classList.toggle("is-on", lit);
}

// 快捷替换：选完就换。3D 里点的方块可选 全部同类 / 只这一格（记住上次选的）
function quickReplace({ anchor, sources, at = null }) {
  const id = sources[0];
  const scope = at ? {
    value: loadPrefs().replaceScope === "one" ? "one" : "all",
    options: [{ value: "all", label: t("picker.scopeAll", nameOf(id)) }, { value: "one", label: t("picker.scopeOne") }],
    onChange: (v) => setPref("replaceScope", v),
  } : null;
  openPicker({
    anchor, current: short(id), scope,
    groups: [{ label: t("picker.related"), ids: similarBlocks(id) }],
    onPick: async (target) => {
      const one = scope?.value === "one";
      // 只换这一格：把它的状态写进规则，保证换的就是这格
      const props = one ? json(at.block.props) : "";
      const text = sources.map((s) => `${short(s)}${props}-${target}`).join("\n");
      const result = await runRules(text, one ? { region: at.region, local: at.local } : null);
      if (result.error) toast(result.error, { undo: false });
    },
  });
}

// 中文名 → id（同桌面版 tools.translate(n, to_chinese=False)：先当前语言，再简体、繁体）
function nameToId(name) {
  for (const l of [lang, "zh_CN", "zh_TW"]) {
    const table = gamedata.blocks[l];
    if (!table) continue;
    for (const [id, n] of Object.entries(table)) if (n === name) return id;
  }
  return name.toLowerCase().replace(/\s+/g, "_");
}

let toastTimer = 0;
function toast(text, { undo = true } = {}) {
  $("toast-text").textContent = text;
  $("toast-undo").hidden = !undo;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 15000);
}

function undoReplace() {
  const prev = state.undo;
  if (!prev) return;
  state.undo = null;
  state.edited = prev.edited;
  swapStructure(prev.structure);
  state.original = prev.original;
  $("toast").hidden = true;
}

function bindEditing() {
  $("export-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-export]");
    if (!b) return;
    document.activeElement?.blur();
    exportList(b.dataset.export.endsWith("-cat"), b.dataset.export.startsWith("csv"));
  });
  $("convert-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ext], [data-version]");
    if (!b) return;
    document.activeElement?.blur(); // 收起下拉框（键盘打开时靠 focus-within）
    if (b.dataset.version) saveVersion(+b.dataset.version);
    else saveAs(b.dataset.ext);
  });
  $("tutorial-btn").addEventListener("click", () => $("tutorial-dlg").showModal());

  $("table").addEventListener("contextmenu", rowMenu);
  // 点别处 / Esc / 滚动 / 窗口变化：收起右键菜单
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctx")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);
  $("side").addEventListener("scroll", closeMenu);
  $("toast-undo").addEventListener("click", undoReplace);
  bindTools();
}

// ---------------------------------------------------------------- 替换方块：规则 → 结构 → 增量重画

// 能含水的方块（waterlogged 不影响模型，方块状态定义里看不出来，按名字认）
const WATERLOGGABLE = /(stairs|_slab|fence|_wall$|pane|iron_bars|trapdoor|chain|lantern|sign|ladder|chest|campfire|candle|scaffolding|coral|sea_pickle|conduit|lightning_rod|dripstone|amethyst|dripleaf|glow_lichen|hanging_roots|mangrove_roots|grate|heavy_core|decorated_pot|barrier|^light$|rail|bulb|shelf)/;

// 方块状态定义里第一种状态的属性，当默认值（石头换成门：朝向、铰链这些没带过来，就用它补，不然找不到模型）
function defaultProps(id) {
  const first = Object.keys(assets.blockstates[short(id)]?.variants || {})[0];
  const out = {};
  if (first) for (const pair of first.split(",")) { const [k, v] = pair.split("="); if (v !== undefined) out[k] = v; }
  return out;
}

// 规则文本（写法同桌面版 edit.py）→ 替换。only：只换这一格 { region, local }。选中了子区域就只换那个区域。
// 占两格的方块（床、门、高花……）会检查一遍，有问题弹窗问怎么办。
// 返回 { replaced } / { error }（错误文字已翻译好）/ { cancelled }
async function runRules(text, only = null) {
  let rules;
  try {
    rules = parseRules(text, nameToId);
  } catch (err) {
    if (!(err instanceof RuleError)) throw err;
    return { error: ui("app.replace.badrule", err.message) };
  }
  // 目标得是认识的方块（资源包里有定义），不然渲染不出来，进游戏也放不了
  const unknown = [...rules.values()].map(([id]) => id).filter((id) => !assets.blockstates[short(id)]);
  if (unknown.length) return { error: ui("app.replace.badrule", unknown.map(short).join(", ")) };
  const clean = (id, props, source) => {
    const variants = assets.blockstates[short(id)]?.variants;
    // 换成没有任何状态的整方块（金块、泥土……）：旧方块的朝向 / 半砖类型这些就不带过去了
    if (variants && Object.keys(variants).every((k) => k === "")) return {};
    // 换成别的方块：只留新方块认识的属性（台阶换成门，type=top 就不该跟过去）
    if (source && short(source.id) !== short(id)) {
      const known = propValues(id);
      props = Object.fromEntries(Object.entries(props).filter(([k]) => k in known || (k === "waterlogged" && WATERLOGGABLE.test(short(id)))));
    }
    return { ...defaultProps(id), ...props };
  };
  const index = regionIndex();
  const inRegion = only ? null : index === null ? null : state.structure.regions[index];
  const { structure } = replaceBlocks(state.structure, rules, only, clean, inRegion);
  const fixed = await fixMultiBlock(state.structure, structure);
  if (fixed.cancelled) return { cancelled: true };
  const replaced = countChanged(state.structure, fixed.structure);
  const notes = [fixed.beds ? t("bed.skipped", fixed.beds) : "", fixed.skipped ? t("tall.skipped", fixed.skipped) : ""].filter(Boolean).join(" ");
  if (!replaced) return { error: [ui("app.replace.none"), notes].filter(Boolean).join(" ") };
  commitEdit(fixed.structure);
  toast([ui("app.replace.done", replaced), notes, t("replace.saveHint")].filter(Boolean).join(" "));
  return { replaced };
}

function commitEdit(next) {
  state.undo = { structure: state.structure, original: state.original, edited: state.edited };
  state.edited = true;
  swapStructure(next);
}

function countChanged(prev, next) {
  let n = 0;
  next.regions.forEach((r, i) => {
    const old = prev.regions[i];
    if (old.blocks === r.blocks) return;
    for (let j = 0; j < r.blocks.length; j++) if (old.palette[old.blocks[j]] !== r.palette[r.blocks[j]]) n++;
  });
  return n;
}

// ---- 占两格的方块
const isBed = (b) => /_bed$/.test(b.id);
const tallCache = new Map();
// 2 格高：方块状态里有 half=upper（门、高草、玫瑰丛、向日葵、小型垂滴叶……；楼梯 / 活板门的 half 是 top/bottom，不算）
function isTall(id) {
  if (!tallCache.has(id)) {
    const def = assets.blockstates[short(id)] || {};
    tallCache.set(id, Object.keys(def.variants || {}).some((k) => /(^|,)half=upper/.test(k)) || JSON.stringify(def.multipart || []).includes('"half":"upper"'));
  }
  return tallCache.get(id);
}
function paletteIndex(region, block) {
  const key = block.id + JSON.stringify(Object.entries(block.props).sort());
  const found = region.palette.findIndex((b) => b.id + JSON.stringify(Object.entries(b.props).sort()) === key);
  return found >= 0 ? found : region.palette.push(block) - 1;
}

// 弹一个对话框，等用户点某个按钮（返回按钮的 value；Esc = cancel）。
// 不靠 dialog 的 close 事件：页面没拿到焦点时浏览器会把它往后拖，点了按钮也迟迟不继续
function askDialog(dlg) {
  return new Promise((resolve) => {
    const done = (value) => {
      dlg.removeEventListener("click", onClick);
      dlg.removeEventListener("cancel", onCancel);
      if (dlg.open) dlg.close(value);
      resolve(value);
    };
    const onClick = (e) => {
      const b = e.target.closest("button[value]");
      if (b) { e.preventDefault(); done(b.value); }
    };
    const onCancel = (e) => { e.preventDefault(); done("cancel"); };
    dlg.addEventListener("click", onClick);
    dlg.addEventListener("cancel", onCancel);
    dlg.showModal();
  });
}

// 检查替换结果里的多格方块：
//   床：只能和床互相换（床是两格拼的，单换一半就坏了），不是床↔床的这些格子恢复原样；
//   2 格高的（门、高草……）：原来不是 2 格高的，要在上面一格放上半截。上面是空气就直接放；
//   上面有东西的弹窗问：覆盖 / 只换没问题的 / 取消
async function fixMultiBlock(prev, next) {
  let beds = 0;
  const ok = [], blocked = [];
  next.regions.forEach((region, ri) => {
    const old = prev.regions[ri];
    if (old.blocks === region.blocks) return;
    const [, ry, rz] = region.size;
    for (let j = 0; j < region.blocks.length; j++) {
      const before = old.palette[old.blocks[j]], after = region.palette[region.blocks[j]];
      if (before === after || before.id === after.id) continue; // 只改了属性：上下半 / 床头床尾都还在
      if (isBed(before) !== isBed(after)) { region.blocks[j] = old.blocks[j]; beds++; continue; }
      if (isTall(after.id) && !isTall(before.id)) {
        const up = Math.floor(j / rz) % ry + 1 < ry ? j + rz : -1;
        (up >= 0 && isAir(region.palette[region.blocks[up]]) ? ok : blocked).push({ ri, j, up });
      }
    }
  });
  let choice = "ok";
  if (blocked.length) {
    const target = next.regions[blocked[0].ri].palette[next.regions[blocked[0].ri].blocks[blocked[0].j]];
    $("tall-text").textContent = t("tall.text", nameOf(target.id), blocked.length, ok.length);
    choice = await askDialog($("tall-dlg"));
    if (choice === "cancel") return { cancelled: true };
  }
  // 顶上已经是区域边界的放不下，覆盖也没用
  const place = choice === "overwrite" ? [...ok, ...blocked.filter((c) => c.up >= 0)] : ok;
  const skip = choice === "overwrite" ? blocked.filter((c) => c.up < 0) : blocked;
  for (const c of skip) next.regions[c.ri].blocks[c.j] = prev.regions[c.ri].blocks[c.j];
  for (const c of place) {
    const region = next.regions[c.ri], b = region.palette[region.blocks[c.j]];
    const [, ry, rz] = region.size, j = c.up;
    region.blocks[c.j] = paletteIndex(region, { id: b.id, props: { ...b.props, half: "lower" } });
    region.blocks[j] = paletteIndex(region, { id: b.id, props: { ...b.props, half: "upper" } });
    region.blockEntities.delete(`${Math.floor(j / (ry * rz))},${Math.floor(j / rz) % ry},${j % rz}`); // 被覆盖的格子原来的方块实体不要了
  }
  return { structure: next, beds, skipped: skip.length };
}

// 换成另一份「同样形状」的结构（替换后 / 撤销时 / 改了容器物品）：不整体重载。
// 只把变了的格子挑出来交给 3D 增量重画（后台分批换上，期间照常能转、能点），统计和表格马上刷新
function swapStructure(next) {
  const prev = state.structure, box = bounds(prev);
  const changes = [], regionMap = new Map();
  next.regions.forEach((region, i) => {
    const old = prev.regions[i];
    regionMap.set(old, region);
    if (old.blocks === region.blocks) return;
    const [, ry, rz] = region.size;
    const off = region.origin.map((o, k) => o - box.origin[k]);
    for (let j = 0; j < region.blocks.length; j++) {
      const before = old.palette[old.blocks[j]], after = region.palette[region.blocks[j]];
      if (before === after) continue; // 调色板条目是同一个对象 = 这格没动
      changes.push({ pos: [Math.floor(j / (ry * rz)) + off[0], (Math.floor(j / rz) % ry) + off[1], (j % rz) + off[2]], block: after });
    }
  });
  state.structure = next;
  if (state.original === prev) state.original = next;
  state.results = analyseAll(next);
  renderInfo();
  $("bar-file").textContent = (next.fileName || next.name) + (state.edited ? ` · ${t("edited")}` : "");
  $("restore").hidden = next === state.pristine;
  view.applyChanges(changes, regionMap);
  // 左上角正开着方块信息：换成新的
  if (inspectHit?.kind === "block") showInspect(inspectHit);
}

// ---------------------------------------------------------------- 方块 / 物品选择框

// 同类方块：官方方块标签（resource/tags.json，tools/update_jsassets.py 生成，只留「同一类东西」的标签），
// 小的标签更具体，排前面。没有标签的（玻璃、红石块……）按名字最后一个词找同族（*_glass、*_block）
let tags = {};
let tagsOf = null;
let allBlockIds = null, allItemIds = null;
const allBlocks = () => (allBlockIds ||= Object.keys(assets.blockstates).sort());
// 物品：物品名表 + 方块（方块也能放进箱子），有图标的才列
const allItems = () => (allItemIds ||= [...new Set([...Object.keys(gamedata.items.zh_CN), ...Object.keys(assets.blockstates)])]
  .filter((id) => hasIcon("minecraft:" + id)).sort());
function similarBlocks(id) {
  const name = short(id);
  if (!tagsOf) {
    tagsOf = new Map();
    for (const [tag, ids] of Object.entries(tags)) for (const b of ids) (tagsOf.get(b) || tagsOf.set(b, []).get(b)).push(tag);
    for (const list of tagsOf.values()) list.sort((a, b) => tags[a].length - tags[b].length);
  }
  const out = new Set();
  for (const tag of tagsOf.get(name) || []) for (const b of tags[tag]) out.add(b);
  if (!out.size) {
    const word = name.split("_").pop();
    for (const b of allBlocks()) if (b === word || b.endsWith("_" + word)) out.add(b);
  }
  out.delete(name);
  return [...out].filter((b) => assets.blockstates[b]);
}

// 投影里有的方块，按数量从多到少（全面替换选「原方块」时排最前）
function structureBlocks() {
  const counts = new Map();
  for (const r of state.structure.regions) {
    const c = new Uint32Array(r.palette.length);
    for (const b of r.blocks) c[b]++;
    r.palette.forEach((b, i) => { if (c[i] && !isAir(b)) counts.set(short(b.id), (counts.get(short(b.id)) || 0) + c[i]); });
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// 列表里显示的名字：中文界面用译名，英文界面把 id 的下划线换成空格
const blockLabel = (b) => (lang === "en_US" ? b.replace(/_/g, " ") : nameOf("minecraft:" + b));

const picker = { groups: [], onPick: null, anchor: null, limit: 0, current: null, all: [], allLabel: "" };
const PICKER_PAGE = 150; // 「全部」一次先画这么多，滚到底再接着画

// groups：[{ label, ids }]，最后跟着「全部」（all，默认全部方块）；
// scope：可选，{ value, options: [{value,label}], onChange }；extra：可选，{ html, mount(el) }（比如物品数量）
function openPicker({ anchor, groups, onPick, scope = null, current = null, all = allBlocks(), allLabel = t("picker.all"), extra = null }) {
  picker.groups = groups.filter((g) => g.ids.length);
  Object.assign(picker, { onPick, anchor, current, all, allLabel, limit: PICKER_PAGE });
  const scopeBox = $("picker-scope");
  scopeBox.hidden = !scope;
  if (scope) {
    const paint = () => (scopeBox.innerHTML = scope.options.map((o) =>
      `<button type="button" data-scope="${esc(o.value)}" class="${o.value === scope.value ? "is-active" : ""}" title="${esc(o.label)}">${esc(o.label)}</button>`).join(""));
    paint();
    scopeBox.onclick = (e) => {
      const b = e.target.closest("[data-scope]");
      if (!b) return;
      scope.value = b.dataset.scope;
      scope.onChange(scope.value);
      paint();
    };
  }
  const extraBox = $("picker-extra");
  extraBox.hidden = !extra;
  extraBox.innerHTML = extra ? extra.html : "";
  if (extra?.mount) extra.mount(extraBox);
  $("picker-search").value = "";
  renderPicker();
  const box = $("picker");
  box.hidden = false;
  // 贴着按钮下面；下面放不下就放上面
  const r = anchor.getBoundingClientRect(), h = box.offsetHeight, w = box.offsetWidth;
  box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  box.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  $("picker-search").focus();
}
function closePicker() { $("picker").hidden = true; picker.onPick = null; }

function pickerMatches() {
  const q = $("picker-search").value.trim().toLowerCase();
  if (!q) return () => true;
  const qid = q.replace(/\s+/g, "_");
  const names = [gamedata.blocks.zh_CN, gamedata.blocks.zh_TW, gamedata.items.zh_CN, gamedata.items.zh_TW];
  return (b) => b.includes(qid) || names.some((table) => (table[b] || "").includes(q));
}

function renderPicker() {
  const match = pickerMatches(), seen = new Set();
  const item = (b) => `<button class="picker-item${b === picker.current ? " is-current" : ""}" type="button" data-id="${esc(b)}">` +
    `<img src="${blockIcon("minecraft:" + b, 24)}" alt=""><span>${esc(blockLabel(b))}</span><code>${esc(b)}</code></button>`;
  let html = "";
  for (const g of picker.groups) {
    const ids = g.ids.filter((b) => match(b) && !seen.has(b));
    ids.forEach((b) => seen.add(b));
    if (ids.length) html += `<p class="picker-group">${esc(g.label)}</p>` + ids.map(item).join("");
  }
  const rest = picker.all.filter((b) => match(b) && !seen.has(b));
  if (rest.length) html += `<p class="picker-group">${esc(picker.allLabel)}</p>` + rest.slice(0, picker.limit).map(item).join("");
  picker.more = rest.length > picker.limit;
  $("picker-list").innerHTML = html || `<p class="picker-empty">${esc(t("picker.none"))}</p>`;
}

function choosePicked(id) {
  const fn = picker.onPick;
  closePicker();
  fn?.(id);
}

// ---------------------------------------------------------------- 属性表（替换方块 / 改属性共用）

// 方块每个属性能取哪些值：从方块状态定义里收集（variants 的键、multipart 的 when 条件）
function propValues(id) {
  const def = assets.blockstates[short(id)] || {};
  const values = {};
  const add = (k, v) => String(v).split("|").forEach((x) => (values[k] ||= new Set()).add(x));
  for (const key of Object.keys(def.variants || {})) {
    for (const pair of key.split(",")) { const [k, v] = pair.split("="); if (v !== undefined) add(k, v); }
  }
  const walk = (when) => {
    if (!when) return;
    for (const [k, v] of Object.entries(when)) (k === "OR" || k === "AND" ? v.forEach(walk) : add(k, v));
  };
  for (const part of def.multipart || []) walk(part.when);
  return values;
}
const natural = (a, b) => (isNaN(a) || isNaN(b) ? a.localeCompare(b) : a - b);

// 一行一个属性：只选（原方块的这个属性是这个值才换；任意 = 不管）+ 改成（新方块的这个属性；不变 = 沿用原来的）。
// current：点中方块现在的属性（标在选项后面）；chosen：已经选好的 { filter, set }
function propRowsHTML(source, target, current = null, chosen = { filter: {}, set: {} }) {
  const sv = propValues(source), tv = propValues(target);
  // 方块自己带的属性也算（模型里看不出来的，比如 waterlogged、红石线的 power）
  if (current) for (const [k, v] of Object.entries(current)) {
    (sv[k] ||= new Set()).add(v);
    if (target === source) (tv[k] ||= new Set()).add(v);
  }
  for (const values of [...Object.values(sv), ...Object.values(tv)]) if (values.has("true") || values.has("false")) values.add("true").add("false");
  const keys = [...new Set([...Object.keys(sv), ...Object.keys(tv)])].sort();
  if (!keys.length) return `<tr><td colspan="3">${esc(t("adv.noProps"))}</td></tr>`;
  const select = (attr, k, values, empty, picked, mark) => values
    ? `<select data-${attr}="${esc(k)}" class="${picked ? "is-changed" : ""}"><option value="">${esc(empty)}</option>` +
      [...values].sort(natural).map((v) => `<option value="${esc(v)}"${picked === v ? " selected" : ""}>${esc(v)}${v === mark ? " ←" : ""}</option>`).join("") + "</select>"
    : `<span class="adv-none">—</span>`;
  return keys.map((k) => `<tr><td>${esc(k)}${current && k in current ? `<small>${esc(current[k])}</small>` : ""}</td>` +
    `<td>${select("filter", k, sv[k], t("adv.any"), chosen.filter[k], current?.[k])}</td>` +
    `<td>${select("set", k, tv[k], t("adv.keep"), chosen.set[k], null)}</td></tr>`).join("");
}
function readChosen(box) {
  const filter = {}, set = {};
  for (const el of box.querySelectorAll("[data-filter]")) if (el.value) filter[el.dataset.filter] = el.value;
  for (const el of box.querySelectorAll("[data-set]")) if (el.value) set[el.dataset.set] = el.value;
  return { filter, set };
}

// ---------------------------------------------------------------- 点选信息：替换方块 / 改属性（合在一起，最后点「应用」）

let editAt = null, editTarget = null;
function renderEdit(hit) {
  const at = locate(hit.pos);
  editAt = at;
  if (!at) return;
  if (!editTarget || editTarget.pos !== hit.pos.join()) editTarget = { pos: hit.pos.join(), id: short(at.block.id) };
  paintEdit();
}
function paintEdit(chosen) {
  const at = editAt, src = short(at.block.id), tgt = editTarget.id;
  $("edit-target").innerHTML = `<img src="${blockIcon("minecraft:" + tgt, 20)}" alt=""><span>${esc(blockLabel(tgt))}</span><i class="caret" aria-hidden="true"></i>`;
  $("edit-target-reset").hidden = tgt === src;
  $("edit-scope-all").textContent = t("adv.scopeAll", nameOf(at.block.id));
  $("edit-rows").innerHTML = propRowsHTML(src, tgt, at.block.props, chosen || { filter: {}, set: {} });
}

async function applyEdit() {
  const at = editAt;
  if (!at) return;
  const { filter, set } = readChosen($("edit-rows"));
  const src = short(at.block.id), tgt = editTarget.id;
  if (tgt === src && !Object.keys(set).length) { $("edit-msg").textContent = t("adv.none"); return; }
  const one = document.querySelector('[name="edit-scope"]:checked').value === "one";
  // 只换这一格：用它自己的全部属性做条件，保证换的就是这格
  const result = await runRules(`${src}${json(one ? at.block.props : filter)}-${tgt}${json(set)}`, one ? { region: at.region, local: at.local } : null);
  if (!result.cancelled) $("edit-msg").textContent = result.error || ui("app.replace.done", result.replaced);
}

// ---------------------------------------------------------------- 点选信息：容器里放物品

const RECENT_ITEMS = "lv-viewer-recent-items";
const recentItems = () => { try { return JSON.parse(localStorage.getItem(RECENT_ITEMS)) || []; } catch { return []; } };
const rememberItem = (id) => localStorage.setItem(RECENT_ITEMS, JSON.stringify([id, ...recentItems().filter((x) => x !== id)].slice(0, 10)));

// 点一个格子：选物品（最近放过的 10 个排前面，后面按字母），数量可改；有东西的格子还能清空
function openItemPicker(cell) {
  const at = locate(inspectHit.pos);
  if (!at) return;
  const slot = +cell.dataset.slot, occupied = cell.dataset.id ? short(cell.dataset.id) : null;
  openPicker({
    anchor: cell, current: occupied,
    groups: [{ label: t("items.recent"), ids: recentItems() }],
    all: allItems(), allLabel: t("items.all"),
    extra: {
      html: `<label class="picker-count"><span>${esc(t("items.count"))}</span><input type="number" id="picker-count" min="1" max="99" value="${cell.dataset.count || 1}"></label>` +
        (occupied ? `<button class="btn btn-small btn-plain" id="picker-clear" type="button">${esc(t("items.clear"))}</button>` : ""),
      mount: (box) => box.querySelector("#picker-clear")?.addEventListener("click", () => { closePicker(); setSlotItem(at, slot, null); }),
    },
    onPick: (id) => {
      rememberItem(id);
      setSlotItem(at, slot, id, Math.max(1, Math.min(99, Math.round(+$("picker-count").value) || 1)));
    },
  });
}

// 改一个格子：新的方块实体（原来的其他字段原样留着），写文件时类型也对（Slot 是 Byte，数量按原文件的写法）
function setSlotItem(at, slot, id, count = 1) {
  const D = globalThis.deepslate;
  const key = at.local.join(","), data = at.region.blockEntities.get(key) || null;
  const items = Array.isArray(data?.Items) ? data.Items : [];
  const slotOf = (it, n) => +(it.Slot ?? it.slot ?? n);
  const old = items.some((it) => "Count" in it); // 1.20.5 以前是 Count（Byte），之后是 count（Int）
  const kept = items.filter((it, n) => slotOf(it, n) !== slot);
  if (id) {
    const full = "minecraft:" + short(id), countKey = old ? "Count" : "count";
    const item = { Slot: slot, id: full, [countKey]: count };
    RAW_TAG.set(item, compoundWith(null, {
      Slot: new D.NbtByte(slot), id: new D.NbtString(full), [countKey]: old ? new D.NbtByte(count) : new D.NbtInt(count),
    }));
    kept.push(item);
  }
  kept.sort((a, b) => slotOf(a, 0) - slotOf(b, 0));
  const beId = data?.id || (/shulker_box$/.test(at.block.id) ? "minecraft:shulker_box" : at.block.id);
  const next = { ...(data || {}), id: beId, Items: kept };
  RAW_TAG.set(next, compoundWith(data, { id: new D.NbtString(beId), Items: new D.NbtList(kept.map(toTag), 10) }));
  const s = state.structure;
  commitEdit({ ...s, regions: s.regions.map((r) => (r === at.region ? { ...r, blockEntities: new Map(r.blockEntities).set(key, next) } : r)) });
  toast(id ? t("items.done", blockLabel(short(id)), count) : t("items.cleared"));
}

// ---------------------------------------------------------------- 点选信息：原始 NBT

// 投影文件就给 litematic 里的原样（调色板条目 + 方块实体），.nbt 给调色板 + blocks 条目，
// .mcstructure 给 block_palette + block_position_data。替换过的格子是新条目，按同样的格式现写一份
const snbt = (v) => {
  const tag = v && typeof v === "object" ? toTag(v) : null;
  return tag ? (tag.toPrettyString ? tag.toPrettyString("  ") : tag.toString()) : String(v);
};
function rawNbtText(hit) {
  if (hit.kind === "entity") return `// Entity\n${snbt(hit.entity.nbt || {})}`;
  const at = locate(hit.pos);
  if (!at) return "";
  const r = at.region, raw = r.raw, p = r.blocks[at.index], parts = [];
  const ri = raw ? p - raw.offset : -1;
  const rawPalette = raw && ri >= 0 && ri < raw.palette.length && raw.palette[ri];
  const name = { litematic: "BlockStatePalette", nbt: "palette", mcstructure: "block_palette", schem: "Palette" }[raw?.kind] || "block";
  if (raw?.kind === "schematic") {
    // 老格式：Blocks / Data 两个字节数组，下标 (y * Length + z) * Width + x
    const [W, , L] = raw.size, [x, y, z] = at.local, i = (y * L + z) * W + x;
    let id = raw.ids[i] & 0xff;
    if (raw.add) id |= (i & 1 ? (raw.add[i >> 1] & 0xf0) << 4 : (raw.add[i >> 1] & 0x0f) << 8);
    parts.push(`// Blocks[${i}] / Data[${i}]\n{ id: ${id}, data: ${raw.datas[i] & 0x0f} }  →  ${snbt({ Name: at.block.id, ...(Object.keys(at.block.props).length ? { Properties: at.block.props } : {}) })}`);
    const be0 = r.blockEntities.get(at.local.join(","));
    if (be0) parts.push(`// TileEntities\n${snbt(be0)}`);
    return parts.join("\n\n");
  }
  if (rawPalette) parts.push(`// ${name}[${ri}]\n${snbt(rawPalette)}`);
  else parts.push(`// ${t("nbt.edited")}\n${snbt({ Name: at.block.id, ...(Object.keys(at.block.props).length ? { Properties: at.block.props } : {}) })}`);
  const be = r.blockEntities.get(at.local.join(","));
  if (raw?.kind === "nbt") {
    const entry = raw.blocks.find((b) => b.pos && b.pos.every((v, i) => v === at.local[i]));
    if (entry) parts.push(`// blocks[${raw.blocks.indexOf(entry)}]\n${snbt(entry)}`);
    if (be && (!entry || be !== entry.nbt)) parts.push(`// nbt\n${snbt(be)}`);
  } else if (raw?.kind === "mcstructure") {
    const flat = String(r.size[2] * r.size[1] * at.local[0] + r.size[2] * at.local[1] + at.local[2]);
    if (raw.positionData[flat]) parts.push(`// block_position_data["${flat}"]\n${snbt(raw.positionData[flat])}`);
    else if (be) parts.push(`// block_entity_data\n${snbt(be)}`);
  } else if (be) {
    parts.push(`// ${raw?.kind === "litematic" ? "TileEntities" : "block entity"}\n${snbt(be)}`);
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------- 右键改名字 / 简介

// 在原地变成可编辑：回车保存（简介里 Shift+回车换行），Esc 放弃，点别处也保存
function editInline(el, value, commit, { multiline = false } = {}) {
  if (isDesktop() || el.isContentEditable) return;
  el.textContent = value;
  el.contentEditable = "true";
  el.classList.add("is-editing");
  el.focus();
  document.getSelection().selectAllChildren(el);
  const done = (save) => {
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur);
    el.contentEditable = "false";
    el.classList.remove("is-editing");
    if (save) commit(el.innerText.replace(/\n$/, ""));
    renderInfo();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); done(false); }
    if (e.key === "Enter" && !(multiline && e.shiftKey)) { e.preventDefault(); done(true); }
  };
  const onBlur = () => done(true);
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur);
}

// ---------------------------------------------------------------- 工具：全面替换方块

// 同桌面版「替换特定方块」：一行一组 原方块 → 换成，＋/− 增删；每行可以展开属性（只选 / 改成），最后统一「应用」
const newRow = () => ({ from: null, to: null, open: false, filter: {}, set: {} });
const batch = [newRow()];
function pickButton(id, side) {
  const empty = t(side === "from" ? "batch.from" : "batch.to");
  return `<button class="pick${id ? "" : " is-empty"}" type="button" data-side="${side}">` +
    (id ? `<img src="${blockIcon("minecraft:" + id, 20)}" alt="">` : "") +
    `<span>${esc(id ? blockLabel(id) : empty)}</span></button>`;
}
function renderBatch() {
  $("batch-rows").innerHTML = batch.map((row, i) =>
    `<div class="batch-row" data-i="${i}">${pickButton(row.from, "from")}<span class="batch-arrow">→</span>${pickButton(row.to, "to")}` +
    `<button class="btn btn-small btn-plain batch-props-btn${row.open ? " is-on" : ""}" type="button" data-props="${i}" title="${esc(t("batch.props"))}"${row.from ? "" : " disabled"}>⚙</button>` +
    `<button class="btn btn-small btn-plain batch-del" type="button" data-del="${i}" aria-label="remove">−</button>` +
    (row.open && row.from
      ? `<table class="adv-table batch-props"><thead><tr><th>${esc(t("adv.prop"))}</th><th>${esc(t("adv.filter"))}</th><th>${esc(t("adv.set"))}</th></tr></thead>` +
        `<tbody>${propRowsHTML(row.from, row.to || row.from, null, row)}</tbody></table>`
      : "") + "</div>").join("");
}
async function runBatch() {
  const rows = batch.filter((r) => r.from && ((r.to && r.to !== r.from) || Object.keys(r.set).length));
  if (!rows.length) { $("batch-msg").textContent = t("batch.empty"); return; }
  const text = rows.map((r) => `${r.from}${json(r.filter)}-${r.to || r.from}${json(r.set)}`).join("\n");
  const result = await runRules(text);
  if (!result.cancelled) $("batch-msg").textContent = result.error || ui("app.replace.done", result.replaced);
}

// ---------------------------------------------------------------- 工具：缩略图 / 世界存档

const PREVIEW_BG = "#f0f3f7"; // 同桌面版 snapshot.PREVIEW_BG，Litematica 自己的那种浅灰蓝
const canvasPng = async (canvas) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/png"))).arrayBuffer());

// Litematica 的预览图：140×140、行优先的 ARGB int（同 snapshot.to_argb_ints）
function previewInts(canvas) {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const out = new Int32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = (data[i * 4 + 3] << 24) | (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
  return out;
}

let thumbCanvas = null;
let thumbMode = "iso"; // 上次生成用的视角，写进投影时也用这个
// 右边第一张卡片右侧显示投影自带的缩略图（打开时文件里就有的，或者刚生成写进去的）
function previewUrl(structure) {
  const data = structure?.preview || structure?.metadata?.PreviewImageData;
  const ints = data ? Array.from(data) : [];
  const side = Math.round(Math.sqrt(ints.length));
  if (!side || side * side !== ints.length) return "";
  const c = document.createElement("canvas");
  c.width = c.height = side;
  const g = c.getContext("2d"), img = g.createImageData(side, side);
  ints.forEach((v, i) => { // ARGB 整数 → RGBA
    img.data[i * 4] = (v >> 16) & 255; img.data[i * 4 + 1] = (v >> 8) & 255; img.data[i * 4 + 2] = v & 255; img.data[i * 4 + 3] = (v >>> 24) & 255;
  });
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}
let fileThumbFor = null;
function renderFileThumb() {
  const s = state.structure;
  const data = s?.preview || s?.metadata?.PreviewImageData;
  if (fileThumbFor === data) return; // 没变就不重画
  fileThumbFor = data;
  const url = previewUrl(s);
  $("file-thumb").src = url;
  $("file-thumb").hidden = !url;
  $("file-card").classList.toggle("has-thumb", !!url);
}

function runThumb() {
  thumbCanvas = view.snapshot(512, null, thumbMode);
  if (!thumbCanvas) return;
  // 直接写进当前投影（.litematic 的 Metadata.PreviewImageData，140×140）：导出 .litematic 时带着，游戏里投影列表能看到
  state.structure.preview = previewInts(view.snapshot(140, PREVIEW_BG, thumbMode));
  renderFileThumb();
  toast(t("thumb.done"), { undo: false });
  $("thumb-img").src = thumbCanvas.toDataURL();
  $("thumb-img").hidden = false;
  $("thumb-actions").hidden = false;
}


// 同桌面版「导出世界」：存档图标用 64px 缩略图
// 存档图标：游戏只认 64×64 的 icon.png。导出前问一下用哪张：
//   投影自带 / 刚生成写进去的缩略图（有才出现，默认选它）、现生成一张等轴图、不要图标
// 缩到 size×size；不是正方形的从中间裁一块正方形（自定义图片可能是长方形）
function scaledCanvas(src, size = 64) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  const w = src.naturalWidth || src.width, h = src.naturalHeight || src.height, side = Math.min(w, h);
  g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  return c;
}
const loadImage = (url) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });

// 选一张自己的图片：读进来、裁成正方形缩到 64×64。没选 / 读不出来返回 null
function pickImageFile() {
  return new Promise((resolve) => {
    const input = $("world-icon-file");
    input.value = "";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) { resolve(null); return; }
      const url = URL.createObjectURL(file);
      try { resolve(scaledCanvas(await loadImage(url))); } catch { alert(t("worldIcon.badImage")); resolve(null); } finally { URL.revokeObjectURL(url); }
    };
    input.click();
  });
}
async function chooseWorldIcon() {
  const options = [];
  const thumb = previewUrl(state.structure);
  if (thumb) options.push({ value: "thumb", label: t("worldIcon.thumb"), canvas: scaledCanvas(await loadImage(thumb)) });
  options.push({ value: "iso", label: t("worldIcon.iso"), canvas: view.snapshot(64, PREVIEW_BG) });
  options.push({ value: "custom", label: t("worldIcon.custom"), canvas: null });
  options.push({ value: "none", label: t("worldIcon.none"), canvas: null });
  const tile = (o) => (o.canvas ? `<img src="${o.canvas.toDataURL()}" alt="">`
    : `<span class="world-icon-none">${o.value === "custom" ? "＋" : "∅"}</span>`);
  const paint = (checked) => {
    $("world-icons").innerHTML = options.map((o) =>
      `<label class="world-icon"><input type="radio" name="world-icon" value="${o.value}"${o.value === checked ? " checked" : ""}>${tile(o)}<span>${esc(o.label)}</span></label>`).join("");
  };
  paint(options[0].value);
  // 点「自定义图片」：弹文件框，选好了把图换进这个选项；没选就退回原来选的那个
  const onPick = async (e) => {
    const input = e.target.closest("input[name=world-icon]");
    if (!input || input.value !== "custom") return;
    const prev = options.find((o) => o.value !== "custom" && o.canvas)?.value || "none";
    const canvas = await pickImageFile();
    if (canvas) options.find((o) => o.value === "custom").canvas = canvas;
    paint(canvas ? "custom" : (options.find((o) => o.value === "custom").canvas ? "custom" : prev));
  };
  $("world-icons").addEventListener("change", onPick);
  const answer = await askDialog($("world-dlg"));
  $("world-icons").removeEventListener("change", onPick);
  if (answer !== "ok") return undefined; // 取消：不导出
  const picked = options.find((o) => o.value === $("world-icons").querySelector("input:checked")?.value) || options[0];
  return picked.canvas ? canvasPng(picked.canvas) : null;
}

async function saveWorld() {
  try {
    const icon = await chooseWorldIcon();
    if (icon === undefined) return;
    const result = exportWorld(state.structure, stem(), icon);
    download(`${stem()}_world.zip`, result.bytes, "application/zip");
    if (result.clipped) alert(t("world.clipped"));
  } catch (err) {
    console.error(err);
    alert(ui("app.save.fail", err.message || err));
  }
}

function setOrtho(on) {
  view.setOrtho(on);
  const b = $("proj-toggle");
  b.classList.toggle("is-ortho", !!on);
  b.title = t(on ? "proj.ortho" : "proj.persp");
  b.setAttribute("aria-label", b.title);
}

function setMoveSpeed(v) {
  v = Math.max(2, Math.min(64, +v || 12));
  view.moveSpeed = v;
  $("move-speed").value = v;
  $("move-speed-val").textContent = v;
}

// 背景：关闭 / 海洋 / 草地 / 末地（地板在 3D 里画，天空是舞台的 CSS 背景）
function setEnvironment(kind) {
  kind = ["ocean", "grass", "end"].includes(kind) ? kind : "";
  view.setEnvironment(kind || null);
  $("stage").dataset.env = kind;
  $("env").value = kind;
}

function bindTools() {
  // 点选信息：替换方块 / 改属性
  $("edit-target").addEventListener("click", (e) => {
    const at = editAt;
    if (!at) return;
    const keep = readChosen($("edit-rows"));
    openPicker({
      anchor: e.currentTarget, current: editTarget.id,
      groups: [{ label: t("picker.related"), ids: similarBlocks(at.block.id) }],
      onPick: (id) => { editTarget.id = id; paintEdit({ filter: keep.filter, set: {} }); },
    });
  });
  $("edit-target-reset").addEventListener("click", () => { editTarget.id = short(editAt.block.id); paintEdit(); });
  $("edit-rows").addEventListener("change", (e) => e.target.classList.toggle("is-changed", !!e.target.value));
  $("edit-apply").addEventListener("click", applyEdit);
  $("inspect-nbt").addEventListener("click", () => {
    if (!inspectHit) return;
    $("nbt-text").textContent = rawNbtText(inspectHit);
    $("nbt-dlg").showModal();
  });
  $("nbt-copy").addEventListener("click", async () => {
    await navigator.clipboard?.writeText($("nbt-text").textContent).catch(() => {});
    $("nbt-copy").textContent = t("nbt.copied");
    setTimeout(() => ($("nbt-copy").textContent = t("nbt.copy")), 1500);
  });
  $("inspect-items").addEventListener("click", (e) => {
    const cell = e.target.closest(".slot-cell[data-slot]");
    if (cell && !isDesktop()) openItemPicker(cell);
  });

  // 选择框
  $("picker-search").addEventListener("input", () => { picker.limit = PICKER_PAGE; renderPicker(); $("picker-list").scrollTop = 0; });
  $("picker-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = $("picker-list").querySelector("[data-id]"); if (first) choosePicked(first.dataset.id); }
    if (e.key === "Escape") closePicker();
  });
  $("picker-list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) choosePicked(b.dataset.id); });
  // 「全部」滚到底再接着画
  $("picker-list").addEventListener("scroll", (e) => {
    const el = e.currentTarget;
    if (picker.more && el.scrollTop + el.clientHeight > el.scrollHeight - 200) { picker.limit += PICKER_PAGE; const top = el.scrollTop; renderPicker(); el.scrollTop = top; }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!$("picker").hidden && !e.target.closest("#picker") && !(picker.anchor && picker.anchor.contains(e.target))) closePicker();
  });

  // 全面替换
  $("batch-rows").addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      batch.splice(+del.dataset.del, 1);
      if (!batch.length) batch.push(newRow());
      renderBatch();
      return;
    }
    const props = e.target.closest("[data-props]");
    if (props) { const row = batch[+props.dataset.props]; row.open = !row.open; renderBatch(); return; }
    const btn = e.target.closest("[data-side]");
    if (!btn) return;
    const row = batch[+btn.closest(".batch-row").dataset.i], side = btn.dataset.side;
    openPicker({
      anchor: btn, current: row[side],
      groups: side === "from"
        ? [{ label: t("picker.inStructure"), ids: structureBlocks() }]
        : [{ label: t("picker.related"), ids: row.from ? similarBlocks(row.from) : [] }],
      onPick: (id) => {
        row[side] = id;
        // 换了方块，属性可选的值也跟着变：原方块换了就清空「只选」，目标换了就清空「改成」
        if (side === "from") row.filter = {};
        row.set = {};
        renderBatch();
      },
    });
  });
  $("batch-rows").addEventListener("change", (e) => {
    const el = e.target, row = batch[+el.closest(".batch-row")?.dataset.i];
    if (!row) return;
    const [kind, key] = el.dataset.filter !== undefined ? ["filter", el.dataset.filter] : el.dataset.set !== undefined ? ["set", el.dataset.set] : [];
    if (!kind) return;
    if (el.value) row[kind][key] = el.value; else delete row[kind][key];
    el.classList.toggle("is-changed", !!el.value);
  });
  $("batch-add").addEventListener("click", () => { batch.push(newRow()); renderBatch(); });
  $("batch-run").addEventListener("click", runBatch);

  $("proj-toggle").addEventListener("click", () => { setOrtho(!view.ortho); setPref("ortho", view.ortho); });
  $("thumb-iso").addEventListener("click", () => { thumbMode = "iso"; runThumb(); });
  $("thumb-view").addEventListener("click", () => { thumbMode = "view"; runThumb(); });
  $("kind-outline").addEventListener("change", (e) => { setPref("hiddenOutline", e.target.checked); view.setHiddenOutline(e.target.checked); });
  $("thumb-png").addEventListener("click", async () => download(`${stem()}.png`, await canvasPng(thumbCanvas), "image/png"));


  $("move-speed").addEventListener("input", (e) => { setMoveSpeed(e.target.value); setPref("moveSpeed", view.moveSpeed); });
  $("env").addEventListener("change", (e) => { setEnvironment(e.target.value); setPref("env", e.target.value); });

  // 右键标题改结构名、右键简介改简介（导出 .litematic 时写进去）
  $("file-name").addEventListener("contextmenu", (e) => {
    if (!state.structure || isDesktop()) return;
    e.preventDefault();
    editInline(e.currentTarget, state.structure.name || "", (v) => { if (v.trim()) state.structure.name = v.trim(); });
  });
  $("stats").addEventListener("contextmenu", (e) => {
    const value = e.target.closest('[data-stat="ui.stat.l7"] span');
    if (!value || isDesktop()) return;
    e.preventDefault();
    editInline(value, state.structure.description || "", (v) => (state.structure.description = v.trim()), { multiline: true });
  });
  renderBatch();
}

// ---------------------------------------------------------------- 事件

function bind() {
  $("file-input").addEventListener("change", (e) => e.target.files[0] && openFile(e.target.files[0]));
  $("lang").addEventListener("change", (e) => { lang = e.target.value; applyLang(); });

  // 整个窗口都能接文件
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); if (++depth === 1) $("drop-veil").hidden = false; });
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("drop-veil").hidden = true; } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    $("drop-veil").hidden = true;
    if (e.dataTransfer.files[0]) { openFile(e.dataTransfer.files[0]); return; }
    // 从别的标签页拖过来的链接
    const link = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split(/\r?\n/).find((l) => /^https?:\/\//i.test(l.trim()));
    if (link) openUrl(link.trim());
  });
  $("url-form").addEventListener("submit", (e) => { e.preventDefault(); openUrl($("url-input").value); });

  for (const id of ["layer-min", "layer-max"]) {
    $(id).addEventListener("input", showLayerValue);
    // 换显示层只增删变化的那几层、重画碰到的区块，很快，所以拖的时候就实时更新
    $(id).addEventListener("input", () => view.setFilter({ layers: showLayerValue() }));
  }
  $("regions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-region]");
    if (!b) return;
    state.region = b.dataset.region || null;
    renderInfo();
    if (!state.steps) view.setFilter({ region: regionIndex() }); // 3D 只显示这个区域（分步时显示拆分结果，不筛）
  });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) { state.tab = b.dataset.tab; renderInfo(); savePrefs(); }
  });

  $("steps-run").addEventListener("click", runSteps);
  for (const id of Object.values(STEP_INPUTS)) $(id).addEventListener("change", savePrefs);
  $("layer-mode").addEventListener("click", () => setLayerMode(LAYER_MODES[(LAYER_MODES.indexOf(layerMode) + 1) % 3]));
  $("theme").addEventListener("change", (e) => { localStorage.setItem("lv-viewer-theme", e.target.value); applyTheme(e.target.value); });
  // 容器格子的提示：鼠标放上去在格子旁边显示 译名 / ID / 数量
  const tip = $("slot-tip");
  $("inspect-items").addEventListener("pointerover", (e) => {
    const cell = e.target.closest(".slot-cell[data-id]");
    if (!cell) { tip.hidden = true; return; }
    tip.innerHTML = `<b>${esc(cell.dataset.name)}</b><code>${esc(cell.dataset.id)}</code><span>×${cell.dataset.count}</span>`;
    const r = cell.getBoundingClientRect(), host = $("stage").getBoundingClientRect();
    tip.style.left = `${r.left - host.left}px`;
    tip.style.top = `${r.bottom - host.top + 4}px`;
    tip.hidden = false;
  });
  $("inspect-items").addEventListener("pointerleave", () => (tip.hidden = true));
  $("steps-exit").addEventListener("click", exitSteps);
  $("inspect-close").addEventListener("click", () => { showInspect(null); view.select(null); });
  $("kind-ignore").addEventListener("click", () => {
    if (inspectHit?.kind !== "block") return;
    toggleKind(state.ignored, [inspectHit.block.id]);
    applyKinds();
  });
  $("kind-highlight").addEventListener("click", () => {
    if (inspectHit?.kind !== "block") return;
    toggleKind(state.highlighted, [inspectHit.block.id]);
    applyKinds();
  });
  $("kind-reset").addEventListener("click", () => { state.ignored.clear(); state.highlighted.clear(); applyKinds(); });
  $("step-range").addEventListener("change", (e) => showStep(+e.target.value));
  $("step-prev").addEventListener("click", () => showStep(state.step - 1));
  $("step-next").addEventListener("click", () => showStep(state.step + 1));
  $("contour-run").addEventListener("click", runContour);
  $("restore").addEventListener("click", () => load(state.pristine, { pristine: true }));
  bindEditing();
}

// ---------------------------------------------------------------- 启动

async function main() {
  bind();
  applyLang();
  // 翻译表一到就先换语言，不等图集（图集几 MB，等它的话页面会先显示一阵 HTML 里的中文）
  const gamedataReady = fetch("data/gamedata.json").then((r) => r.json());
  gamedataReady.then((data) => { gamedata = data; applyLang(); }).catch(() => document.documentElement.classList.remove("i18n-wait"));
  [gamedata, tags] = await Promise.all([
    gamedataReady,
    fetch("resource/tags.json").then((r) => r.json()).catch(() => ({})),
    loadResources(),
  ]);
  $("theme").innerHTML = Object.keys(gamedata.themes || {}).map((n) => `<option value="${n}">${n}</option>`).join("");
  applyLang();
  view = new View($("canvas"), { overlay: $("markers"), onPick: showInspect, onContext: blockMenu, gizmo: $("gizmo") });
  restorePrefs();
  setMoveSpeed(loadPrefs().moveSpeed || 12);
  setEnvironment(loadPrefs().env || ""); // 默认关闭
  setOrtho(!!loadPrefs().ortho); // 透视 / 正交：记住上次的
  const hiddenOutline = loadPrefs().hiddenOutline !== false; // 隐藏的方块留灰边框：默认留
  $("kind-outline").checked = hiddenOutline;
  view.setHiddenOutline(hiddenOutline);
  window.lvViewer = { view, state, showInspect, runRules }; // 方便在控制台里调试 / 以后扩展
  applyTheme(themeName);

  // 桌面版「手动3D渲染」：主程序把结构写进 payload.json，用 #desktop 打开本页
  if (location.hash === "#desktop") {
    document.body.classList.add("desktop");
    const payload = await fetch("payload.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
    if (LANGS.includes(payload.lang)) { lang = payload.lang; applyLang(); }
    document.documentElement.classList.remove("i18n-wait");
    if (payload.theme) applyTheme(payload.theme);
    load(fromPayload(payload), { pristine: true });
    return;
  }

  const params = START_PARAMS;
  // 从主页拖进来的：取出暂存的文件，再把网址里的 from=home 去掉，刷新时不会再找一遍
  if (params.get("from") === "home") {
    const file = await window.LVHandoff.take().catch(() => null);
    params.delete("from");
    syncUrl();
    if (file) openFile(file);
  }
  // ?file=<网址>（或 ?url=）可以直接打开远程投影（同源或允许跨域的地址），和输入框里粘贴网址一样
  const url = params.get("file") || params.get("url");
  if (url) {
    await openUrl(url);
    return;
  }
  // 什么都没指定：浏览器里存着上次的文件就给个按钮，一键再开（和桌面版「打开上次的文件」一样）
  if (!state.structure && window.LVRecent) {
    const recent = await window.LVRecent.load().catch(() => null);
    if (recent && !state.structure) {
      const btn = $("recent-btn");
      btn.textContent = t("recent", recent.file.name);
      btn.hidden = false;
      btn.addEventListener("click", () => openFile(recent.file), { once: true });
    }
  }
}
main().catch((err) => { console.error(err); alert(t("failed", err.message || err)); });
