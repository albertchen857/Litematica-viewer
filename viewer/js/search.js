// 投影搜索页（search.html）。数据都在桌面版的 Python 那边（script/lv/search/），通过 pywebview 的 window.pywebview.api 调：
//   sites() → [{ key, name, url, count, note }]    search({ q, sites, sort, filters }) → [结果]
//   crawl(sites) 后台更新索引                      status() → { running, site, done, total, added, error }
//   open(url) 用系统浏览器打开原页面（只跳转，不下载）
// 不在桌面版里（没有 pywebview）就提示用桌面版。

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------- 语言（同查看器）
const FROM_URL = { cn: "zh_CN", zh: "zh_CN", tw: "zh_TW", en: "en_US" };
let lang = FROM_URL[new URLSearchParams(location.search).get("lang")] || "zh_CN";
let gamedata = null;
const fmt = (s, ...a) => a.reduce((o, x) => o.replace("{}", x), s);
const t = (key, ...a) => fmt(gamedata?.ui[lang]?.["web." + key] ?? gamedata?.ui.zh_CN["web." + key] ?? key, ...a);

function applyLang() {
  document.documentElement.lang = lang === "en_US" ? "en" : lang === "zh_TW" ? "zh-TW" : "zh-CN";
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-t-title]").forEach((el) => (el.title = t(el.dataset.tTitle)));
  $("sr-q").placeholder = t("sr.placeholder");
  $("lang").value = lang;
  document.title = `${t("sr.title")} · Litematica Viewer`;
  renderSites();
  render();
}

// ---------------------------------------------------------------- 状态
const api = () => window.pywebview?.api;
// 偏好（勾选的网站、样式、语言）存在 Python 那边：窗口是 private_mode，localStorage 每次都是空的
let prefs = {};
const savePrefs = () => api()?.save_prefs(prefs);
let sites = [];
let results = [];
let style = "grid";
let selected = -1; // 图片样式里点开的那一条

// ---------------------------------------------------------------- 网站列表
function chosenSites() {
  return [...document.querySelectorAll("#sr-site-list input:checked")].map((i) => i.value);
}
function renderSites() {
  const on = new Set(prefs.sites || sites.map((s) => s.key));
  $("sr-site-list").innerHTML = sites.map((s) =>
    `<label class="sr-site${s.note ? " has-note" : ""}${s.note === "spa" || s.note === "unreachable" ? " is-off" : ""}" title="${esc(s.url + (s.note ? "\n" + t("sr.note." + s.note) : ""))}">` +
    `<input type="checkbox" value="${esc(s.key)}"${on.has(s.key) ? " checked" : ""}>` +
    `<span>${esc(s.name)}</span><small>${s.count || 0}</small></label>`).join("");
}

// ---------------------------------------------------------------- 搜索
function filters() {
  const f = {};
  for (const k of ["tag", "version", "after", "minDownloads", "minLikes", "author"]) {
    const v = $("f-" + k).value.trim();
    if (v) f[k] = v;
  }
  return f;
}
async function run() {
  if (!api()) return;
  prefs.sites = chosenSites();
  savePrefs();
  results = await api().search({ q: $("sr-q").value, sites: prefs.sites, sort: $("sr-sort").value, filters: filters() });
  selected = -1;
  render();
}

const num = (n) => (n == null ? "" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(0) + "k" : String(n));
const siteName = (key) => sites.find((s) => s.key === key)?.name || key;

// 一条结果的详细信息（列表样式的右半边、图片样式的右侧面板共用）
function detailHTML(r, big = false) {
  const rows = [
    [t("sr.d.author"), r.author], [t("sr.d.size"), r.size], [t("sr.d.uploaded"), r.uploaded],
    [t("sr.d.downloads"), num(r.downloads)], [t("sr.d.likes"), num(r.likes)], [t("sr.d.versions"), (r.versions || []).join(", ")],
  ].filter(([, v]) => v);
  return `<b class="sr-name">${esc(r.name || r.url)}</b>` +
    `<span class="sr-site-tag">${esc(siteName(r.site))}</span>` +
    `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` +
    (r.tags?.length ? `<div class="sr-tags">${r.tags.slice(0, big ? 20 : 8).map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : "") +
    (big && r.description ? `<p class="sr-desc">${esc(r.description)}</p>` : "");
}
const imgHTML = (r) => (r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'sr-noimg',textContent:'▦'}))">` : `<span class="sr-noimg">▦</span>`);

function render() {
  const indexed = sites.reduce((n, s) => n + (s.count || 0), 0);
  $("sr-count").textContent = !api() ? t("sr.desktopOnly") : !indexed ? t("sr.empty") : t("sr.count", results.length);
  const grid = $("sr-grid");
  grid.className = "sr-grid is-" + style;
  document.querySelectorAll(".sr-style button").forEach((b) => b.classList.toggle("is-on", b.dataset.style === style));
  if (style === "list") {
    // 样式 2：一行一条，左图右信息，点整行直接跳原站
    grid.innerHTML = results.map((r, i) => `<button type="button" class="sr-row" data-i="${i}">${imgHTML(r)}<div class="sr-info">${detailHTML(r)}</div></button>`).join("");
    $("sr-detail").hidden = true;
  } else {
    // 样式 1：图片网格，点图片右侧出详细信息，再点（面板里的图 / 按钮）跳原站
    grid.innerHTML = results.map((r, i) => `<button type="button" class="sr-card${i === selected ? " is-on" : ""}" data-i="${i}">${imgHTML(r)}<span class="sr-card-name">${esc(r.name)}</span><small>${esc(siteName(r.site))}</small></button>`).join("");
    renderDetail();
  }
}
function renderDetail() {
  const box = $("sr-detail");
  const r = results[selected];
  box.hidden = !r;
  if (!r) return;
  box.innerHTML = `<button type="button" class="sr-detail-close" aria-label="close">×</button>` +
    `<button type="button" class="sr-detail-img" data-open="${selected}">${imgHTML(r)}</button>` +
    detailHTML(r, true) +
    `<button type="button" class="btn btn-accent sr-open" data-open="${selected}">${esc(t("sr.open"))}</button>` +
    `<p class="sr-url">${esc(r.url)}</p>`;
}
function openResult(i) {
  const r = results[i];
  if (r) api()?.open(r.url);
}

// ---------------------------------------------------------------- 更新索引
let polling = null;
async function crawl() {
  if (!api()) return;
  const chosen = chosenSites();
  if (!chosen.length) return;
  await api().crawl(chosen);
  poll();
}
function poll() {
  clearTimeout(polling);
  polling = setTimeout(async () => {
    const s = await api().status();
    $("sr-crawl").disabled = s.running;
    $("sr-crawl-status").textContent = s.running
      ? t("sr.crawling", siteName(s.site), s.done, s.total || "?", s.added)
      : s.finished ? t("sr.crawled", s.added) + (s.errors?.length ? " · " + t("sr.crawlErrors", s.errors.length) : "") : "";
    if (s.errors?.length) $("sr-crawl-status").title = s.errors.join("\n");
    if (s.running) poll();
    else {
      sites = await api().sites();
      renderSites();
      if (s.finished) { run(); loadFacets(); }
    }
  }, 800);
}

async function loadFacets() {
  const f = await api().facets();
  $("tag-list").innerHTML = f.tags.map((x) => `<option value="${esc(x)}">`).join("");
  $("version-list").innerHTML = f.versions.map((x) => `<option value="${esc(x)}">`).join("");
}

// ---------------------------------------------------------------- 启动
function bind() {
  $("sr-form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
  $("sr-sort").addEventListener("change", run);
  document.querySelectorAll(".sr-filters input").forEach((i) => i.addEventListener("change", run));
  $("sr-site-list").addEventListener("change", run);
  $("sr-all").addEventListener("click", () => { document.querySelectorAll("#sr-site-list input").forEach((i) => (i.checked = true)); run(); });
  $("sr-none").addEventListener("click", () => { document.querySelectorAll("#sr-site-list input").forEach((i) => (i.checked = false)); run(); });
  $("sr-crawl").addEventListener("click", crawl);
  document.querySelectorAll(".sr-style button").forEach((b) => b.addEventListener("click", () => { style = prefs.style = b.dataset.style; savePrefs(); render(); }));
  $("sr-grid").addEventListener("click", (e) => {
    const el = e.target.closest("[data-i]");
    if (!el) return;
    const i = +el.dataset.i;
    if (style === "list") { openResult(i); return; }
    if (selected === i) { openResult(i); return; } // 已经选中的再点一下：跳原站
    selected = i;
    document.querySelectorAll(".sr-card").forEach((c) => c.classList.toggle("is-on", +c.dataset.i === i));
    renderDetail();
  });
  $("sr-detail").addEventListener("click", (e) => {
    if (e.target.closest(".sr-detail-close")) { selected = -1; render(); return; }
    const el = e.target.closest("[data-open]");
    if (el) openResult(+el.dataset.open);
  });
  $("lang").addEventListener("change", (e) => { lang = e.target.value; prefs.lang = lang; savePrefs(); applyLang(); });
}

async function waitApi() {
  // pywebview 的 api 在页面加载后才挂上（pywebviewready 事件）
  if (api()) return true;
  return new Promise((resolve) => {
    window.addEventListener("pywebviewready", () => resolve(true), { once: true });
    setTimeout(() => resolve(!!api()), 3000);
  });
}

async function main() {
  bind();
  gamedata = await fetch("data/gamedata.json").then((r) => r.json()).catch(() => null);
  applyLang();
  if (!(await waitApi())) { render(); return; }
  api().icon().then((src) => { const img = document.querySelector(".brand img"); if (src && img) img.src = src; });
  prefs = (await api().prefs()) || {};
  style = prefs.style || "grid";
  if (prefs.lang && !new URLSearchParams(location.search).get("lang")) lang = prefs.lang;
  sites = await api().sites();
  applyLang();
  loadFacets();
  const s = await api().status();
  if (s.running) poll();
  run();
}
main();
