// 格式转换页（convert.html）：一次放好几个投影，选好目标格式 / 游戏版本 / 要不要缩略图，点「转换」才开始。
// 读写全用查看器那套：formats.js 读、writers.js 写、world.js 导出存档、zip.js 打包。
// 一个文件 → 直接存（支持 showSaveFilePicker 的浏览器点按钮时先问存哪）；好几个 → 打成一个 zip。

import { parse, bounds, EXTENSIONS, prepareFormat } from "./formats.js";
import { SAVE_FORMATS, writeLitematic, prepareWrite, download } from "./writers.js";
import { exportWorld } from "./world.js";
import { zip } from "./zip.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------- 语言（同查看器：?lang=cn / tw / en）

const URL_CODE = { zh_CN: "cn", zh_TW: "tw", en_US: "en" };
const FROM_URL = { cn: "zh_CN", zh: "zh_CN", tw: "zh_TW", en: "en_US" };
const START = new URLSearchParams(location.search);
let lang = FROM_URL[START.get("lang")] || "en_US";
let gamedata = null;
const fmt = (s, ...args) => args.reduce((out, a) => out.replace("{}", a), s);
const ui = (key, ...args) => fmt(gamedata?.ui[lang]?.[key] ?? gamedata?.ui.zh_CN[key] ?? key, ...args);
const t = (key, ...args) => ui("web." + key, ...args);

function applyLang() {
  if (!gamedata) return;
  document.documentElement.lang = lang === "en_US" ? "en" : lang === "zh_TW" ? "zh-TW" : "zh-CN";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-ui]").forEach((el) => (el.textContent = ui(el.dataset.ui)));
  $("cv-url").placeholder = t("url.placeholder");
  $("lang").value = lang;
  $("nav-view").href = `./?lang=${URL_CODE[lang]}`;
  $("nav-convert").href = `convert.html?lang=${URL_CODE[lang]}`;
  document.title = `${t("conv.title")} · Litematica Viewer`;
  history.replaceState(null, "", `${location.pathname}?lang=${URL_CODE[lang]}`);
  document.documentElement.classList.remove("i18n-wait");
  renderFiles();
  renderOptions();
}

// 配色：沿用查看器里选的主题
function applyTheme() {
  const theme = gamedata?.themes?.[localStorage.getItem("lv-viewer-theme") || "BlueAr"];
  if (!theme) return;
  const root = document.documentElement.style;
  for (const [k, v] of [["--mc", theme.MC], ["--pc", theme.PC], ["--bg", theme.BG], ["--tt", theme.TT], ["--pr", theme.PR]]) root.setProperty(k, v);
}

// ---------------------------------------------------------------- 文件列表

// { name, bytes, size, status: "ready" | "bad" | "busy" | "done" | "fail", note }
const files = [];
const extOf = (name) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "");
const stemOf = (name) => (name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name);
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

async function addFiles(list) {
  for (const file of list) {
    const ok = EXTENSIONS.includes(extOf(file.name));
    files.push({ name: file.name, size: file.size, bytes: ok ? new Uint8Array(await file.arrayBuffer()) : null,
      status: ok ? "ready" : "bad", note: ok ? "" : t("unsupported") });
  }
  renderFiles();
}

// 网址：添加时就下载（下载不算转换），这样跨域读不了、链接不对能马上看到
function directUrl(raw) {
  const url = new URL(raw);
  const blob = url.hostname === "github.com" && url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
  if (/(^|\.)dropbox\.com$/.test(url.hostname)) { url.searchParams.set("dl", "1"); return url.href; }
  return url.href;
}
async function addUrl(raw) {
  let url;
  try { url = directUrl(String(raw).trim()); if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch { setMsg(t("url.bad")); return; }
  const entry = { name: decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "download"), size: 0, bytes: null, status: "busy", note: t("url.loading") };
  files.push(entry);
  renderFiles();
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(t("url.http", `${res.status} ${res.statusText}`.trim()));
    const cd = res.headers.get("content-disposition") || "";
    const m = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i);
    if (m) try { entry.name = decodeURIComponent(m[1].trim().replace(/^"|"$/g, "")); } catch { /* 用网址里的名字 */ }
    entry.bytes = new Uint8Array(await res.arrayBuffer());
    entry.size = entry.bytes.length;
    entry.status = "ready";
    entry.note = "";
    $("cv-url").value = "";
  } catch (err) {
    entry.status = "bad";
    entry.note = err instanceof TypeError ? t("url.cors") : err.message;
  }
  renderFiles();
}

const STATUS = { ready: "", bad: "conv.bad", busy: "conv.busy", done: "conv.done", fail: "conv.fail" };
function renderFiles() {
  $("cv-files").innerHTML = files.map((f, i) =>
    `<li class="is-${f.status}"><b>${esc(f.name)}</b><small>${f.size ? kb(f.size) : ""}</small>` +
    `<span class="cv-status">${esc([STATUS[f.status] ? t(STATUS[f.status]) : "", f.note].filter(Boolean).join(" · "))}</span>` +
    `<button type="button" class="cv-remove" data-i="${i}" aria-label="remove"${f.status === "busy" ? " disabled" : ""}>×</button></li>`).join("");
  const ready = files.filter((f) => f.bytes && f.status !== "busy").length;
  $("cv-go").disabled = !ready || running;
  $("cv-go").textContent = ready > 1 ? t("conv.goMany", ready) : t("conv.go");
}

// ---------------------------------------------------------------- 选项

const target = () => document.querySelector("input[name=cv-target]:checked").value;
const version = () => +document.querySelector("input[name=cv-version]:checked").value || null;
// 能放缩略图的：.litematic（Metadata.PreviewImageData）、存档（icon.png）
const THUMB_TARGETS = new Set([".litematic", "world"]);
function renderOptions() {
  const tg = target();
  $("cv-version-row").hidden = tg !== ".litematic"; // 现在只有 .litematic 有版本可选，别的格式藏起来
  const can = THUMB_TARGETS.has(tg);
  $("cv-thumb").disabled = !can;
  $("cv-thumb-hint").textContent = can ? "" : t("conv.noThumb");
}

// ---------------------------------------------------------------- 缩略图（离屏 3D，用到才加载贴图）

const PREVIEW_BG = "#f0f3f7";
let viewPromise = null;
function thumbView() {
  viewPromise ||= (async () => {
    if (typeof assets === "undefined") {
      await new Promise((resolve, reject) => {
        const s = Object.assign(document.createElement("script"), { src: "resource/assets.js", onload: resolve, onerror: reject });
        document.head.append(s);
      });
    }
    const { loadResources, View } = await import("./render.js");
    await loadResources();
    return new View($("cv-canvas"));
  })();
  return viewPromise;
}
function previewInts(canvas) {
  const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  const out = new Int32Array(canvas.width * canvas.height);
  for (let i = 0; i < out.length; i++) out[i] = (data[i * 4 + 3] << 24) | (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
  return out;
}
const canvasPng = async (canvas) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, "image/png"))).arrayBuffer());
// 投影自带的缩略图（ARGB 整数）→ 64×64 PNG（存档图标）
async function previewPng(data, size = 64) {
  const ints = Array.from(data), side = Math.round(Math.sqrt(ints.length));
  if (!side || side * side !== ints.length) return null;
  const src = document.createElement("canvas");
  src.width = src.height = side;
  const g = src.getContext("2d"), img = g.createImageData(side, side);
  ints.forEach((v, i) => { img.data.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, (v >>> 24) & 255], i * 4); });
  g.putImageData(img, 0, 0);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  out.getContext("2d").drawImage(src, 0, 0, size, size);
  return canvasPng(out);
}

// ---------------------------------------------------------------- 转换

let running = false;
const setMsg = (text) => { $("cv-msg").textContent = text; };

// 读：扩展名认不出来的（网址下来的）三种格式挨个试
async function read(entry) {
  const ext = extOf(entry.name);
  if (EXTENSIONS.includes(ext)) {
    await prepareFormat(entry.name);
    return parse(entry.name, entry.bytes);
  }
  await prepareFormat(".schematic");
  for (const guess of EXTENSIONS) { try { return parse(stemOf(entry.name) + guess, entry.bytes); } catch { /* 下一个 */ } }
  throw new Error(t("url.unknown"));
}

async function convertOne(entry, opts) {
  const structure = await read(entry);
  const stem = stemOf(entry.name), notes = [];
  if (structure.unknownLegacy?.length) notes.push(t("legacy.unknown", structure.unknownLegacy.length, structure.unknownLegacy.slice(0, 5).join(", ")));
  let thumb = null;
  if (opts.thumb && THUMB_TARGETS.has(opts.target)) {
    const view = await thumbView();
    await view.show(structure, bounds(structure), { resetCamera: true });
    thumb = { preview: previewInts(view.snapshot(140, PREVIEW_BG, "iso")), icon: await canvasPng(view.snapshot(64, PREVIEW_BG, "iso")) };
  }
  if (opts.target === "world") {
    // 存档图标：勾了缩略图用新生成的；没勾但投影自带缩略图就用它的
    const own = structure.metadata?.PreviewImageData;
    const icon = thumb ? thumb.icon : own ? await previewPng(own) : null;
    const result = exportWorld(structure, stem, icon);
    if (result.clipped) notes.push(t("world.clipped"));
    return { name: `${stem}_world.zip`, bytes: result.bytes, notes };
  }
  if (thumb) structure.preview = thumb.preview;
  if (opts.target === ".litematic" && opts.version) {
    return { name: `${stem}_v${opts.version}.litematic`, bytes: writeLitematic(structure, opts.version), notes };
  }
  await prepareWrite(opts.target);
  const { bytes, report } = SAVE_FORMATS[opts.target](structure);
  if (report.size) {
    notes.push((opts.target === ".schematic" ? t("schematic.missing", report.size) : ui("app.save.report", report.size)) + " " +
      [...report].slice(0, 6).map((id) => id.replace(/^minecraft:/, "")).join(", "));
  }
  // 同格式转（比如 .litematic → .litematic）别和原文件重名
  const name = extOf(entry.name) === opts.target ? `${stem}_converted${opts.target}` : `${stem}${opts.target}`;
  return { name, bytes, notes };
}

// 先问存哪（要在点击的那一下里问，浏览器才肯弹框）；不支持的浏览器返回 null，最后走普通下载
async function askSave(name) {
  if (!window.showSaveFilePicker) return null;
  const ext = extOf(name);
  return window.showSaveFilePicker({ suggestedName: name, types: [{ description: ext, accept: { "application/octet-stream": [ext] } }] });
}
async function save(handle, name, bytes) {
  if (!handle) { download(name, bytes); return; }
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

async function run() {
  const todo = files.filter((f) => f.bytes && f.status !== "busy");
  if (!todo.length || running) return;
  const opts = { target: target(), version: version(), thumb: $("cv-thumb").checked && !$("cv-thumb").disabled };
  // 输出名先定下来，好在点击时就弹「存到哪」
  const single = todo.length === 1;
  const guess = single
    ? (opts.target === "world" ? `${stemOf(todo[0].name)}_world.zip`
      : opts.target === ".litematic" && opts.version ? `${stemOf(todo[0].name)}_v${opts.version}.litematic`
        : `${stemOf(todo[0].name)}${extOf(todo[0].name) === opts.target ? "_converted" : ""}${opts.target}`)
    : `converted_${todo.length}.zip`;
  let handle = null;
  try { handle = await askSave(guess); } catch (err) { if (err?.name === "AbortError") return; } // 关了存档框 = 不转了
  running = true;
  renderFiles();
  const outputs = [];
  for (const [i, entry] of todo.entries()) {
    entry.status = "busy";
    entry.note = "";
    renderFiles();
    setMsg(t("conv.progress", i + 1, todo.length, entry.name));
    await new Promise((r) => setTimeout(r, 0)); // 先把「转换中」画出来
    try {
      const out = await convertOne(entry, opts);
      outputs.push(out);
      entry.status = "done";
      entry.note = [out.name, ...out.notes].join(" · ");
    } catch (err) {
      console.error(err);
      entry.status = "fail";
      entry.note = err.message || String(err);
    }
    renderFiles();
  }
  running = false;
  try {
    if (!outputs.length) setMsg(t("conv.none"));
    else if (single) { await save(handle, outputs[0].name, outputs[0].bytes); setMsg(t("conv.saved", outputs[0].name)); }
    else {
      // 好几个：打成一个 zip（重名的加序号）
      const used = new Map();
      const entries = outputs.map((o) => {
        const n = used.get(o.name) || 0;
        used.set(o.name, n + 1);
        return { name: n ? `${stemOf(o.name)} (${n + 1})${extOf(o.name)}` : o.name, data: o.bytes };
      });
      await save(handle, guess, zip(entries));
      setMsg(t("conv.savedZip", outputs.length, guess));
    }
  } catch (err) {
    console.error(err);
    setMsg(ui("app.save.fail", err.message || err));
  }
  renderFiles();
}

// ---------------------------------------------------------------- 事件

function bind() {
  const drop = $("cv-drop");
  let depth = 0;
  drop.addEventListener("dragenter", (e) => { e.preventDefault(); if (++depth === 1) drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; drop.classList.remove("is-over"); } });
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove("is-over");
    if (e.dataTransfer.files.length) { addFiles([...e.dataTransfer.files]); return; }
    const link = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").split(/\r?\n/).find((l) => /^https?:\/\//i.test(l.trim()));
    if (link) addUrl(link.trim());
  });
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("cv-input").click(); } });
  $("cv-input").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
  $("cv-url-form").addEventListener("submit", (e) => { e.preventDefault(); addUrl($("cv-url").value); });
  $("cv-files").addEventListener("click", (e) => {
    const b = e.target.closest(".cv-remove");
    if (!b || running) return;
    files.splice(+b.dataset.i, 1);
    renderFiles();
  });
  document.querySelectorAll("input[name=cv-target]").forEach((r) => r.addEventListener("change", renderOptions));
  $("cv-go").addEventListener("click", run);
  $("lang").addEventListener("change", (e) => { lang = e.target.value; applyLang(); });
  // 拖到页面别处松手，浏览器默认会直接打开那个文件：拦掉
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

async function main() {
  bind();
  gamedata = await fetch("data/gamedata.json").then((r) => r.json());
  applyTheme();
  applyLang();
  if (START.get("file")) addUrl(START.get("file")); // ?file=<网址> 直接放进列表（不自动转）
}
main().catch((err) => { console.error(err); document.documentElement.classList.remove("i18n-wait"); });
