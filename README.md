# Litematica Viewer · 网站（web 分支）

这个分支只放网站：<https://lite-viewer.com>，托管在 Cloudflare Pages（输出目录 `docs`，无构建命令）。
桌面版代码在 `main` 分支。

```
docs/
  index.html / main.js / style.css   主页
  assets/                            主页图片；assets/blocks/ 由 main 的 tools/sync_site.py 裁出来
  viewer/                            网页版查看器 —— 从 main 的 viewer/ 同步，别在这里直接改
  handoff.js                         主页拖进来的文件交给查看器
```

改查看器：在 `main` 改 `viewer/`，然后在 main 里运行

    python tools/sync_site.py <这个分支的 docs 目录>

再回到这个分支提交。
