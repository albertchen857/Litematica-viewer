// Python 与 deepslate 渲染器之间的桥。
//
// Python（script/lv/render.py）把结构写成 payload.js，里面定义 window.LV_PAYLOAD：
//   { name, size:[sx,sy,sz], palette:[{name, props}], idx:[...], state:[...], counts:{id:n}, labels:{} }
// idx 是线性下标 x*sy*sz + y*sz + z，state 是对应的调色板下标（0 号是空气，不会出现在里面）。
//
// 渲染本身完全交给原作者的 viewer.js / deepslate-helpers.js，这里只负责喂数据和搭 HUD。

// viewer.js 里的操作逻辑会去 localStorage 读这些键，没有就会报错，先给上默认值。
const LV_DEFAULT_SETTINGS = {
   'click-drag': 'pan',
   'click-drag-sensitivity': '1',
   'middle-click-drag': 'move',
   'middle-click-drag-sensitivity': '1',
   'scroll': 'move',
   'scroll-sensitivity': '1',
   'touch-drag': 'pan',
   'touch-drag-sensitivity': '1',
   'two-finger-drag': 'move',
   'gesture-sensitivity': '1',
};

function lvSeedSettings() {
   for (const [key, value] of Object.entries(LV_DEFAULT_SETTINGS)) {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
   }
}

function lvFail(message) {
   document.getElementById('main-content').style.display = 'block';
   document.getElementById('error').innerHTML = message;
}

// Python 把坐标和调色板下标压成了 base64 的 Int32Array，这里解回来。
// 大结构用 JSON 数字数组的话，光文本就有好几 MB，解析还慢 —— 那是加载超时的主因。
function lvDecode(b64, bits) {
   const binary = atob(b64);
   const bytes = new Uint8Array(binary.length);
   for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
   return bits === 16 ? new Uint16Array(bytes.buffer) : new Int32Array(bytes.buffer);
}

// 每次最多连续处理这么多方块，然后让出主线程。
// 一次性 addBlock 几十万个会把页面卡死，浏览器/WebView 会判定脚本无响应。
const LV_CHUNK = 20000;

// 分块构建 deepslate.Structure，边建边回报进度。只放 y 在 [yMin, yMax] 之间的方块。
function lvBuildStructureAsync(payload, yMin, yMax, onProgress, onDone) {
   const [sx, sy, sz] = payload.size;
   const structure = new deepslate.Structure([sx, sy, sz]);
   const layer = sy * sz;
   const total = payload.count;
   let i = 0;

   function step() {
      const end = Math.min(i + LV_CHUNK, total);
      for (; i < end; i++) {
         const flat = payload.idx[i];
         const y = Math.floor(flat / sz) % sy;
         if (y < yMin || y > yMax) continue;
         const entry = payload.palette[payload.state[i]];
         if (!entry) continue;
         const position = [Math.floor(flat / layer), y, flat % sz];
         if (entry.props && Object.keys(entry.props).length) {
            structure.addBlock(position, entry.name, entry.props);
         } else {
            structure.addBlock(position, entry.name);
         }
      }
      if (i < total) {
         onProgress(i / total);
         setTimeout(step, 0);   // 让出一帧，页面不会被判定成卡死
      } else {
         onProgress(1);
         onDone(structure);
      }
   }
   step();
}

function lvBuildHud(payload) {
   const hud = document.getElementById('hud');
   const [sx, sy, sz] = payload.size;
   hud.innerHTML =
      `<b>${payload.name}</b><br>${sx} × ${sy} × ${sz} &nbsp; ${payload.idx.length} ${payload.labels.blocks}` +
      `<br><span style="opacity:.65">${payload.labels.controls}</span>`;
   hud.hidden = false;
}

function lvBuildMaterialList(payload) {
   const list = document.getElementById('materialList');
   list.innerHTML = Object.entries(payload.counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `<div class="row"><span>${id.replace('minecraft:', '')}</span><span>${n}</span></div>`)
      .join('');
   list.hidden = false;
}

function lvBuildSliders(payload, onChange) {
   const [, sy] = payload.size;
   const box = document.getElementById('sliders');
   box.innerHTML =
      `<label>${payload.labels.layer} <span id="lv-y-label">0 – ${sy - 1}</span></label><br>` +
      `<input id="lv-y-min" type="range" min="0" max="${sy - 1}" value="0" step="1"><br>` +
      `<input id="lv-y-max" type="range" min="0" max="${sy - 1}" value="${sy - 1}" step="1">`;
   box.hidden = false;

   const minInput = document.getElementById('lv-y-min');
   const maxInput = document.getElementById('lv-y-max');
   const apply = () => {
      const lo = Math.min(+minInput.value, +maxInput.value);
      const hi = Math.max(+minInput.value, +maxInput.value);
      document.getElementById('lv-y-label').textContent = `${lo} – ${hi}`;
      onChange(lo, hi);
   };
   minInput.addEventListener('change', apply);
   maxInput.addEventListener('change', apply);
}

// 这份 bridge.js 认得的 payload 版本。Python 那边 render.PAYLOAD_FORMAT 要一致。
const LV_FORMAT = 2;

// payload 里必须有的字段。缺了就说清楚缺哪个，而不是等着某处抛
// "Cannot read properties of undefined (reading 'length')" 这种看不懂的错。
const LV_REQUIRED = ['format', 'size', 'palette', 'count', 'idx_b64', 'state_b64', 'labels'];

function lvCheckPayload(payload) {
   if (!payload || typeof payload !== 'object') return 'payload 是空的';
   const missing = LV_REQUIRED.filter(k => !(k in payload));
   if (missing.length) return '缺少字段：' + missing.join('、');
   if (payload.format !== LV_FORMAT) {
      return `payload 版本是 ${payload.format}，这个页面认的是 ${LV_FORMAT}`;
   }
   return null;
}

function lvStart(payload) {
   if (typeof deepslate === 'undefined' || typeof glMatrix === 'undefined') {
      lvFail(
         'deepslate / gl-matrix 没能加载。<br><br>' +
         '这两个库是从 unpkg.com 拉的，第一次用 3D 渲染需要联网。<br>' +
         '想离线用的话，把它们下载到 <code>script/JSrender/resource/</code>，' +
         '再把 viewer.html 里的两个 CDN &lt;script&gt; 改成本地路径。'
      );
      return;
   }
   const problem = lvCheckPayload(payload);
   if (problem) {
      lvFail(
         `结构数据对不上：<code>${problem}</code><br><br>` +
         (payload && payload.labels && payload.labels.stale
            ? payload.labels.stale
            : '多半是页面脚本被缓存成旧版了。关掉这个 3D 窗口，从主程序重新打开一次即可。')
      );
      return;
   }
   if (!payload.count) { lvFail(payload.labels.empty || '这个结构里没有方块。'); return; }

   // 二进制一次性解完，比逐个解析 JSON 数字快得多
   payload.idx = lvDecode(payload.idx_b64, 32);
   payload.state = lvDecode(payload.state_b64, payload.state_bits);

   lvSeedSettings();
   createRenderCanvas();          // 来自 viewer.js
   lvBuildHud(payload);
   lvBuildMaterialList(payload);

   const [, sy] = payload.size;
   const hud = document.getElementById('hud');
   const baseHud = hud.innerHTML;
   let building = false;

   function rebuild(lo, hi, reset) {
      if (building) return;      // 拖滑块拖太快时别叠着建
      building = true;
      lvBuildStructureAsync(
         payload, lo, hi,
         (ratio) => {
            hud.innerHTML = baseHud +
               `<br><b>${payload.labels.building} ${Math.round(ratio * 100)}%</b>`;
         },
         (structure) => {
            hud.innerHTML = baseHud;
            building = false;
            setStructure(structure, reset);   // 来自 viewer.js
         }
      );
   }

   rebuild(0, sy - 1, true);
   lvBuildSliders(payload, (lo, hi) => rebuild(lo, hi, false));
}

// 贴图图集要先加载完，deepslate 才能建材质。图集是同目录的 png，
// 通过 pywebview 的内置 http 服务提供，所以 canvas.getImageData 不会被跨域限制挡住。
document.addEventListener('DOMContentLoaded', async () => {
   // payload 用 fetch 读而不是 <script> 引：no-store 保证永远拿到主程序刚写的那份，
   // 不会出现「新 payload 配旧脚本」。加个时间戳是给不认 no-store 的 webview 兜底。
   let payload = null;
   try {
      const response = await fetch('payload.json?t=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      payload = await response.json();
   } catch (err) {
      console.error(err);
      lvFail('读不到结构数据 payload.json：<code>' + err + '</code><br><br>请从主程序重新打开 3D 渲染。');
      return;
   }

   const atlas = new Image();
   atlas.crossOrigin = 'anonymous';
   atlas.onload = () => {
      try {
         loadDeepslateResources(atlas);   // 来自 deepslate-helpers.js
         lvStart(payload);
      } catch (err) {
         console.error(err);
         lvFail('渲染初始化失败：<code>' + err + '</code>');
      }
   };
   atlas.onerror = () => lvFail('贴图图集 resource/atlas.png 加载失败。');
   atlas.src = 'resource/atlas.png';
});
