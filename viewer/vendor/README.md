# 第三方库（原样拷贝，未修改）

| 文件 | 来源 | 许可 |
| --- | --- | --- |
| `deepslate-0.27.2.umd.js` | https://unpkg.com/deepslate@0.27.2/dist/deepslate.umd.cjs （只改了扩展名） | MIT © Misode |
| `gl-matrix-3.4.3.min.js` | https://unpkg.com/gl-matrix@3.4.3/gl-matrix-min.js | MIT © Brandon Jones, Colin MacKenzie IV |

放在站点本地而不是从 CDN 加载：部分学校 / 公司网络会拦 unpkg，查看器就打不开。
`.cjs` 改成 `.js`：有的静态托管给 `.cjs` 的 MIME 不是 JavaScript，浏览器会拒绝执行。

升级版本：下载新文件、改文件名里的版本号，再改 `../index.html` 里的两行 `<script>`。
