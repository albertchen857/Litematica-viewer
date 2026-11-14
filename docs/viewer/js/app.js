// 网页版查看器的界面层：读文件 → 统计 → 渲染 → 右侧信息栏 + 工具。
// 算法都在别的模块里，这里只负责把它们接起来、把结果画到页面上。

import { parse, bounds, EXTENSIONS, fromPayload, isAir } from "./formats.js";
import { analyse, totalRows, unitParts, materialOf } from "./analysis.js";
import { SAVE_FORMATS, exportText, download } from "./writers.js";
import { parseRules, replaceBlocks, RuleError } from "./edit.js";
import { loadResources, View, blockIcon } from "./render.js";
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
function syncUrl() {
  history.replaceState(null, "", `${location.pathname}?lang=${URL_CODE[lang]}${location.hash}`);
}
let lang = pickLang();

// 操作偏好存在 localStorage（这个站点自己的存储，不上传）：材料表页签、分步拆解的几个参数。
// 语言写在网址上（?lang=），主题存在 lv-viewer-theme。
const PREFS_KEY = "lv-viewer-prefs";
const STEP_INPUTS = { detail: "opt-detail", maxmat: "opt-maxmat", shapes: "opt-shapes", band: "opt-band", cross: "opt-cross" };
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs() {
  const prefs = { tab: state.tab };
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
  $("replace-target").placeholder = t("replace.target");
  $("lang").value = lang;
  document.title = t("pageTitle");
  syncUrl();
  if ($("layer-mode")) $("layer-mode").textContent = t("layerMode." + layerMode);
  if (state.structure) renderInfo();
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
};
let view = null;

// ---------------------------------------------------------------- 读文件

async function openFile(file) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!EXTENSIONS.includes(ext)) { alert(t("unsupported")); return; }
  progress(0, t("reading"));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    load(parse(file.name, bytes), { pristine: true });
    window.LVRecent?.save(file).catch(() => {}); // 记成「上次的文件」，下次进来一键再开
  } catch (err) {
    console.error(err);
    progress(null);
    alert(t("failed", err.message || err));
  }
}

// pristine：刚打开的文件；original：作为工具的起点；keepCamera：替换 / 撤销时相机不动
function load(structure, { pristine = false, original = pristine, keepCamera = false } = {}) {
  if (pristine) { state.pristine = structure; state.edited = false; state.undo = null; $("toast").hidden = true; }
  if (original) state.original = structure;
  state.structure = structure;
  state.steps = null;
  state.region = null;
  showInspect(null);
  $("steps-exit").hidden = true;
  const all = analyse(structure, gamedata);
  const regions = structure.regions.length > 1
    ? structure.regions.map((r, i) => [r.name || `Region${i + 1}`, analyse(structure, gamedata, { regions: [r] })])
    : [];
  state.results = { all, regions };

  $("empty").classList.add("is-hidden");
  $("bar-file").textContent = (structure.fileName || structure.name) + (state.edited ? ` · ${t("edited")}` : "");
  $("bar-tools").classList.remove("is-off");
  $("tools").hidden = false;
  $("steps").hidden = true;
  $("restore").hidden = structure === state.pristine;
  renderInfo();
  setupLayers(structure);
  draw(structure, !keepCamera);
  // 第一次打开文件时把教程弹出来一次
  if (pristine && !isDesktop() && !localStorage.getItem("lv-viewer-tutorial")) {
    localStorage.setItem("lv-viewer-tutorial", "1");
    $("tutorial-dlg").showModal();
  }
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
  await view.show(structure, box, { resetCamera, onProgress: (r) => progress(r, label) });
  progress(null);
  $("hint").hidden = false;
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
    return `<div class="row" title="${esc(id)}" data-id="${esc(id)}">${icon ? `<img src="${icon}" alt="">` : "<span></span>"}` +
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

function showInspect(hit) {
  const box = $("inspect");
  if (!hit) { box.hidden = true; return; }
  const id = hit.kind === "entity" ? hit.entity.id : hit.block.id;
  const icon = blockIcon(id, 32);
  $("inspect-icon").src = icon || "";
  $("inspect-icon").hidden = !icon;
  $("inspect-name").textContent = (hit.kind === "entity" ? t("entity") + " · " : "") + nameOf(id);
  $("inspect-id").textContent = id;
  const pos = hit.pos.map((v) => (Number.isInteger(v) ? v : v.toFixed(1))).join(", ");
  const regionName = hit.region && state.structure.regions.length > 1 ? "  " + t("region", hit.region.name) : "";
  $("inspect-pos").textContent = t("pos", pos) + regionName;

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
  $("inspect-items").style.gridTemplateColumns = `repeat(${Math.min(9, slots || 9)}, 1fr)`;
  items.forEach((item, n) => {
    const slot = slotOf(item, n);
    const itemId = String(item.id || item.Name);
    const count = Number(item.count ?? item.Count ?? 1);
    if (slot < cells.length) {
      cells[slot] = { html: `<img src="${blockIcon(itemId, 24)}" alt="">${count > 1 ? `<span>${count}</span>` : ""}`, name: nameOf(itemId), id: itemId, count };
    }
  });
  $("inspect-items").innerHTML = cells.map((c) => c.id
    ? `<div class="slot-cell" data-name="${esc(c.name)}" data-id="${esc(c.id)}" data-count="${c.count}">${c.html}</div>`
    : `<div class="slot-cell"></div>`).join("");

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
function exportList(classified) {
  if (!state.structure) { alert(t("needFile")); return; }
  const text = exportText(current(), {
    classified, csv: false, nameOf,
    unit: (k) => ui("unit." + k), catLabel: (c) => ui("cat." + c), order: gamedata.categoryOrder || [],
  });
  download(`${stem()}.txt`, text, "text/plain;charset=utf-8");
}

// 另存成别的格式（同 ui_main.save_as）：存的是当前显示的结构，含替换后的
function saveAs(ext) {
  if (!state.structure) { alert(t("needFile")); return; }
  try {
    const { bytes, report } = SAVE_FORMATS[ext](state.structure);
    download(stem() + ext, bytes);
    if (report.size) alert(ui("app.save.report", report.size) + "\n\n" + [...report].map(short).join(", "));
  } catch (err) {
    console.error(err);
    alert(ui("app.save.fail", err.message || err));
  }
}

// ---------------------------------------------------------------- 右键菜单 + 快速替换方块

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

// 材料表里的一行 → 调色板里对应的方块 id。行是折算后的材料（红石粉、火把……），
// 所以「本身就是它」和「折算出来有它」的方块都算上（墙上的火把会和火把一起换）
function blockSourcesFor(id) {
  const index = state.results.regions.findIndex(([n]) => n === state.region);
  const regions = index < 0 ? state.structure.regions : [state.structure.regions[index]];
  const found = new Set();
  for (const r of regions) for (const b of r.palette) {
    if (isAir(b) || found.has(b.id)) continue;
    if (b.id === id || materialOf(b).some(([m]) => m === id)) found.add(b.id);
  }
  return [...found];
}

// 桌面版里打开的 3D 窗口（#desktop）没有顶栏、存不了文件，替换在桌面版主程序里做
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
    action: () => openReplace({ sources, label: nameOf(id) }),
  }]);
}

// 3D 里右键点了一个方块。分步模式下显示的是拆分后的结构，按坐标找回真正的区域和格子
function locate(pos) {
  const s = state.structure, box = bounds(s);
  const world = pos.map((v, i) => v + box.origin[i]);
  for (let k = s.regions.length - 1; k >= 0; k--) {
    const r = s.regions[k], local = world.map((v, i) => v - r.origin[i]);
    if (local.some((v, i) => v < 0 || v >= r.size[i])) continue;
    const block = r.palette[r.blocks[local[0] * r.size[1] * r.size[2] + local[1] * r.size[2] + local[2]]];
    if (!isAir(block)) return { region: r, local, block };
  }
  return null;
}

function blockMenu(hit, x, y) {
  if (hit.kind !== "block") return;
  const at = locate(hit.pos);
  if (!at) return;
  openMenu(x, y, nameOf(at.block.id), [
    ...(isDesktop() ? [] : [{ label: ui("row.replace"), action: () => openReplace({ sources: [at.block.id], label: nameOf(at.block.id), at }) }]),
    { label: t("inspectMenu"), action: () => showInspect(hit) },
  ]);
}

let replaceJob = null;

// 中文名 → id（同桌面版 tools.translate(n, to_chinese=False)：先当前语言，再简体、繁体）
function nameToId(name) {
  for (const l of [lang, "zh_CN", "zh_TW"]) {
    const table = gamedata.blocks[l];
    if (!table) continue;
    for (const [id, n] of Object.entries(table)) if (n === name) return id;
  }
  return name.toLowerCase().replace(/\s+/g, "_");
}

// 目标方块的候选：资源包里有方块状态定义的都算（能摆出来、能渲染）
function fillBlockList() {
  const list = $("block-list");
  if (list.dataset.lang === lang) return;
  const names = gamedata.blocks[lang] || {};
  list.innerHTML = Object.keys(assets.blockstates).sort()
    .map((id) => `<option value="${esc(id)}">${names[id] ? esc(names[id]) : ""}</option>`).join("");
  list.dataset.lang = lang;
}

function openReplace(job) {
  replaceJob = job;
  fillBlockList();
  $("replace-from").textContent = ui("row.replace.from", job.label);
  $("replace-scope").hidden = !job.at;
  if (job.at) {
    const pos = job.at.local.map((v, i) => v + job.at.region.origin[i]).join(", ");
    $("scope-all").textContent = t("replace.scopeAll", job.label);
    $("scope-one").textContent = t("replace.scopeOne", `(${pos})`);
    document.querySelector("#replace-form [name=scope][value=all]").checked = true;
    $("replace-same").checked = false;
  }
  $("replace-target").value = "";
  $("replace-rules").value = job.sources.map((id) => short(id) + "-").join("\n");
  $("replace-adv").open = false;
  $("replace-error").textContent = "";
  $("replace-dlg").showModal();
  $("replace-target").focus();
}

// 点「替换」：拼成规则交给 edit.js（规则写法同桌面版），成功就换掉当前结构、重画，相机不动
function applyReplace() {
  const job = replaceJob;
  const one = !!job.at && document.querySelector("#replace-form [name=scope]:checked").value === "one";
  let text;
  if ($("replace-adv").open && !one) {
    text = $("replace-rules").value;
  } else {
    const target = $("replace-target").value.trim();
    if (!target) { $("replace-target").focus(); return false; }
    // 3D 里点的方块：只换这一格、或勾了「只换状态一样的」，就把它的状态写进规则
    const props = job.at && (one || $("replace-same").checked) && Object.keys(job.at.block.props).length
      ? JSON.stringify(job.at.block.props) : "";
    text = job.sources.map((id) => `${short(id)}${props}-${target}`).join("\n");
  }
  let rules;
  try {
    rules = parseRules(text, nameToId);
  } catch (err) {
    if (!(err instanceof RuleError)) throw err;
    $("replace-error").textContent = ui("app.replace.badrule", err.message);
    return false;
  }
  // 目标得是认识的方块（资源包里有定义），不然渲染不出来，进游戏也放不了
  const unknown = [...rules.values()].map(([id]) => id).filter((id) => !assets.blockstates[short(id)]);
  if (unknown.length) { $("replace-error").textContent = ui("app.replace.badrule", unknown.map(short).join(", ")); return false; }

  // 换成没有任何状态的整方块（金块、泥土……）时，旧方块的朝向 / 半砖类型这些就不带过去了
  const clean = (id, props) => {
    const variants = assets.blockstates[short(id)]?.variants;
    return variants && Object.keys(variants).every((k) => k === "") ? {} : props;
  };
  const { structure, replaced } = replaceBlocks(state.structure, rules, one ? { region: job.at.region, local: job.at.local } : null, clean);
  if (!replaced) { $("replace-error").textContent = ui("app.replace.none"); return false; }
  state.undo = { structure: state.structure, original: state.original, edited: state.edited };
  state.edited = true;
  load(structure, { original: state.structure === state.original, keepCamera: true });
  toast(ui("app.replace.done", replaced) + " " + t("replace.saveHint"));
  return true;
}

let toastTimer = 0;
function toast(text) {
  $("toast-text").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 15000);
}

function undoReplace() {
  const prev = state.undo;
  if (!prev) return;
  state.undo = null;
  state.edited = prev.edited;
  load(prev.structure, { keepCamera: true });
  state.original = prev.original;
  $("toast").hidden = true;
}

function bindEditing() {
  $("export-btn").addEventListener("click", () => exportList(false));
  $("export-cat-btn").addEventListener("click", () => exportList(true));
  $("convert-menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ext]");
    if (!b) return;
    document.activeElement?.blur(); // 收起下拉框（键盘打开时靠 focus-within）
    saveAs(b.dataset.ext);
  });
  $("tutorial-btn").addEventListener("click", () => $("tutorial-dlg").showModal());

  $("table").addEventListener("contextmenu", rowMenu);
  // 点别处 / Esc / 滚动 / 窗口变化：收起右键菜单
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctx")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);
  $("side").addEventListener("scroll", closeMenu);

  $("replace-form").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "apply") return; // 取消：直接关
    if (!applyReplace()) e.preventDefault();    // 有错：留在弹窗里显示
  });
  $("toast-undo").addEventListener("click", undoReplace);
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
    if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });

  for (const id of ["layer-min", "layer-max"]) {
    $(id).addEventListener("input", showLayerValue);
    // 换显示层只增删变化的那几层、重画碰到的区块，很快，所以拖的时候就实时更新
    $(id).addEventListener("input", () => view.setFilter({ layers: showLayerValue() }));
  }
  $("regions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-region]");
    if (b) { state.region = b.dataset.region || null; renderInfo(); }
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
  [gamedata] = await Promise.all([fetch("data/gamedata.json").then((r) => r.json()), loadResources()]);
  $("theme").innerHTML = Object.keys(gamedata.themes || {}).map((n) => `<option value="${n}">${n}</option>`).join("");
  applyLang();
  view = new View($("canvas"), { overlay: $("markers"), onPick: showInspect, onContext: blockMenu });
  restorePrefs();
  window.lvViewer = { view, state, showInspect }; // 方便在控制台里调试 / 以后扩展
  applyTheme(themeName);

  // 桌面版「手动3D渲染」：主程序把结构写进 payload.json，用 #desktop 打开本页
  if (location.hash === "#desktop") {
    document.body.classList.add("desktop");
    const payload = await fetch("payload.json?t=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
    if (LANGS.includes(payload.lang)) { lang = payload.lang; applyLang(); }
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
  // ?file=<网址> 可以直接打开远程投影（同源或允许跨域的地址）
  const url = params.get("file");
  if (url) {
    const res = await fetch(url);
    openFile(new File([await res.arrayBuffer()], decodeURIComponent(url.split("/").pop())));
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
