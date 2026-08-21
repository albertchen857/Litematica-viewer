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

// payload -> deepslate.Structure。只放 y 在 [yMin, yMax] 之间的方块，配合下面的滑块切层看。
function lvBuildStructure(payload, yMin, yMax) {
   const [sx, sy, sz] = payload.size;
   const structure = new deepslate.Structure([sx, sy, sz]);
   const layer = sy * sz;

   for (let i = 0; i < payload.idx.length; i++) {
      const flat = payload.idx[i];
      const y = Math.floor(flat / sz) % sy;
      if (y < yMin || y > yMax) continue;
      const x = Math.floor(flat / layer);
      const z = flat % sz;

      const entry = payload.palette[payload.state[i]];
      if (!entry) continue;
      if (entry.props && Object.keys(entry.props).length) {
         structure.addBlock([x, y, z], entry.name, entry.props);
      } else {
         structure.addBlock([x, y, z], entry.name);
      }
   }
   return structure;
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

function lvStart() {
   const payload = window.LV_PAYLOAD;
   if (typeof deepslate === 'undefined' || typeof glMatrix === 'undefined') {
      lvFail(
         'deepslate / gl-matrix 没能加载。<br><br>' +
         '这两个库是从 unpkg.com 拉的，第一次用 3D 渲染需要联网。<br>' +
         '想离线用的话，把它们下载到 <code>script/JSrender/resource/</code>，' +
         '再把 viewer.html 里的两个 CDN &lt;script&gt; 改成本地路径。'
      );
      return;
   }
   if (!payload) { lvFail('payload.js 没有内容，请从主程序重新打开 3D 渲染。'); return; }
   if (!payload.idx.length) { lvFail(payload.labels.empty || '这个结构里没有方块。'); return; }

   lvSeedSettings();
   createRenderCanvas();          // 来自 viewer.js
   lvBuildHud(payload);
   lvBuildMaterialList(payload);

   const [, sy] = payload.size;
   setStructure(lvBuildStructure(payload, 0, sy - 1), true);   // 来自 viewer.js
   lvBuildSliders(payload, (lo, hi) => setStructure(lvBuildStructure(payload, lo, hi)));
}

// 贴图图集要先加载完，deepslate 才能建材质。图集是同目录的 png，
// 通过 pywebview 的内置 http 服务提供，所以 canvas.getImageData 不会被跨域限制挡住。
document.addEventListener('DOMContentLoaded', () => {
   const atlas = new Image();
   atlas.crossOrigin = 'anonymous';
   atlas.onload = () => {
      try {
         loadDeepslateResources(atlas);   // 来自 deepslate-helpers.js
         lvStart();
      } catch (err) {
         console.error(err);
         lvFail('渲染初始化失败：<code>' + err + '</code>');
      }
   };
   atlas.onerror = () => lvFail('贴图图集 resource/atlas.png 加载失败。');
   atlas.src = 'resource/atlas.png';
});
