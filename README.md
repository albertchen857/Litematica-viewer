# Litematica Viewer · 网站（web 分支）

这个分支只放网站：<https://lite-viewer.com>。桌面版代码在 `main` 分支。

托管在 **Cloudflare Workers**（静态文件，Workers Builds 连着这个仓库）：

| 分支 | 去哪 |
|---|---|
| `web` | 正式站 lite-viewer.com（构建根目录 `/docs`，推上来自动上线） |
| `web-preview` | 预览站 <https://web-preview.dev.lite-viewer.com>（多一份 `docs/wrangler.jsonc` 给预览构建用） |

```
docs/
  index.html / main.js / style.css   主页
  privacy.html / terms.html / legal.js  隐私政策、使用条款
  assets/                            主页图片；assets/blocks/ 由 main 的 tools/sync_site.py 裁出来
  viewer/                            网页版查看器 —— 从 main 的 viewer/ 同步，别在这里直接改
    index.html                         查看 / 观光（第一人称参观，#tour）
    convert.html                       批量转换
  handoff.js                         主页拖进来的文件交给查看器
```

改查看器：在 `main` 改 `viewer/`，然后在 main 里运行

    python tools/build_web_data.py      # 翻译 / 方块名有改动时
    python tools/sync_site.py <这个分支的 docs 目录>

再回到这个分支提交。先推 `web-preview` 在预览站看，没问题再推 `web`。

更新日志见 `main` 分支的 [log.md](https://github.com/albertchen857/Litematica-viewer/blob/main/log.md)。

许可证：[AGPL-3.0](LICENSE)，第三方组件和 Minecraft 贴图的版权见 [NOTICE.md](NOTICE.md)。
