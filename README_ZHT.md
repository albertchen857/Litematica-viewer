[简体中文](./README.md) | [English](./README_EN.md) | **繁體中文**

# LitematicaViewer 投影檢視器 v0.9.6

### Minecraft 工具 - 讓投影檢視更加輕量便捷

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/v/release/Albertchen857/LitematicaViewer)]()
[![三连](https://img.shields.io/badge/-一键三连-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1YLWJ6TEeR)
[![转发](https://img.shields.io/badge/-转发-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/3494373232741268)
[![YoutubeIntro](https://img.shields.io/badge/-Youtube-00A1D6?logo=youtube&logoColor=red)](https://www.youtube.com/watch?v=jgHMK4hmpoM)

GITHUB 連結: https://github.com/albertchen857/LitematicaViewer
網頁：https://lite-viewer.com
穩定版 EXE 在右側 Release 下載，最新預覽版請自行 clone 執行（發現問題歡迎提 ISSUE）
求求點點星吧 I want Stars~ target 1000 stars

## 支援的檔案格式

| 格式 | 來源 | 讀取 | 寫入 |
|---|---|---|---|
| `.litematic` | Litematica 模組 | ✅ | ✅ |
| `.nbt` | Java 版結構方塊 | ✅ | ✅ |
| `.mcstructure` | 基岩版結構方塊 | ✅ | ✅ |

三種格式匯入後都會轉成同一套內部結構，所以**所有功能對三種格式一視同仁**，
而且可以互相另存（`資料分析 → 另存為`）。

> 跨版本轉換的注意事項：Java 和基岩的方塊 ID / 狀態命名不完全一樣。程式內建了常見的
> 改名和狀態換算，轉換完會告訴你有多少種方塊沒有現成規則、是原樣寫過去的，建議進遊戲核對。

## 功能

- `匯入` 匯入結構檔案，也可以把檔案直接拖到程式圖示上開啟
- `簡潔分析` 統計方塊名稱與數量，自動換算雙層半磚、含水方塊、重生錨充能等
- `匯出 / 分類匯出` 匯出材料清單（txt / csv）
- `另存為` 在 litematic / nbt / mcstructure 之間互相轉換
- `容器分析器` 列出容器裡的物品，並依容器類型畫出槽位排布
- `步驟檢視器` 逐層檢視方塊擺放，附朝向 / 上下半 / 含水屬性標註
- `3D 渲染` 用 deepslate 渲染引擎在獨立視窗裡檢視整個結構，可以拖動、切層
- `生成圖形投影` 快速生成實心 / 空心長方體
- `替換特定方塊` 依規則批次替換，可以限定座標範圍和方塊狀態
- `跨版本轉換投影` 把 litematic 轉成 1.16 / 1.13 版本
- `介面顏色 / 字型 / 語言` 主題色、字型、中英文切換

## 執行

```bash
pip install -r requirements.txt
python script/LitematicaViewer.py
```

也可以帶檔案路徑直接開啟：

```bash
python script/LitematicaViewer.py 我的投影.litematic
```

打包：

```bash
python tools/lang_build.py && pyinstaller --noconfirm LitematicaViewer.spec
```

## 目錄結構

```
script/
  LitematicaViewer.py   入口
  webview_host.py       3D 渲染視窗的子行程入口
  lv/                   主體程式碼，見 ARCHITECTURE.md
viewer/                 3D 檢視器（「手動3D渲染」用它）；網站 web 分支的 docs/viewer 由它同步過去
  resource/             貼圖圖集，方塊圖示也從這裡裁
lang/
  source/*.json         翻譯的唯一資料來源，改這裡
  data.json             主題色和使用者設定
  setting.json          方塊中文名 / 物品名 / 分類表
tools/
  lang_build.py         編譯 po/mo
  lang_check.py         檢查翻譯有沒有遺漏
```

## 新增一種語言

1. 複製 `lang/source/en_US.json` 成 `lang/source/<語言代碼>.json`，翻譯值，
   把 `lang.name` 改成這門語言的自稱。
2. 重新啟動程式，`說明 → 語言` 裡就會多出這一項。

`.po` / `.mo` 由程式自動編譯，不需要手動產生，也不會進版本庫。

## 分支圖

```
投影檢視器 LitematicaViewer
|- 格式 formats
|  |- .litematic (litemapy)
|  |- .nbt Java 結構方塊 (amulet-nbt)
|  |- .mcstructure 基岩版 (amulet-nbt, 小端)
|- 分析 analysis
|  |- 材料清單 / 分類 / 密度 / 紅石佔比
|  |- 容器分析 containers
|- 功能 edit
|  |- 生成長方體 (實心 / 空心)
|  |- 批次替換方塊 (可限定範圍與狀態)
|  |- litematic 跨版本轉換
|- 渲染 render
|  |- 3D 渲染 (deepslate WebGL, 獨立子行程)
|  |- 步驟檢視器 (逐層 2D)
|- 介面 ui
   |- 可收納側欄 / 主題色 / 字型 / 多語言
```

## Star History

<a href="https://www.star-history.com/?repos=albertchen857%2FLitematica-viewer&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
 </picture>
</a>
