**简体中文** | [English](./README_EN.md)

# LitematicaViewer 投影查看器 v0.9.2

### Minecraft tool - 让我的世界投影查看更加的轻量便捷

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/v/release/Albertchen857/LitematicaViewer)]()
[![三连](https://img.shields.io/badge/-一键三连-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1H9ZVYtEta/)
[![转发](https://img.shields.io/badge/-转发-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/3494373232741268)
[![YoutubeIntro](https://img.shields.io/badge/-Youtube-00A1D6?logo=youtube&logoColor=red)](https://www.youtube.com/watch?v=0nofWrfKJeg)

<a href="https://github.com/LitematicaViewer/Litematica-Nova">
  <img src="https://img.shields.io/badge/Pro%20版-Litematica%20Nova-7C3AED?style=for-the-badge&logo=github&logoColor=white" alt="Litematica Nova — 投影查看器 Pro 版" />
</a>

> 想要更强的版本？**[Litematica Nova](https://github.com/LitematicaViewer/Litematica-Nova)** 是投影查看器的 Pro 版。

GITHUB链接: https://github.com/albertchen857/LitematicaViewer
稳定版 EXE 在右侧 Release 下载，最新预览版自行克隆运行（发现问题欢迎提 ISSUE）
求求点点星吧 I want Stars~ target 100 stars

## 支持的文件格式

| 格式 | 来源 | 读 | 写 |
|---|---|---|---|
| `.litematic` | Litematica 模组 | ✅ | ✅ |
| `.nbt` | Java 版结构方块 | ✅ | ✅ |
| `.mcstructure` | 基岩版结构方块 | ✅ | ✅ |

三种格式导入后会转成同一套内部结构，所以**所有功能对三种格式一视同仁**，
而且可以互相另存（`数据分析 → 另存为`）。

> 跨格式转换的注意事项：Java 和基岩的方块 ID / 状态命名不完全一样。程序内置了常见
> 改名和状态换算（朝向、含水、上下半、双层台阶、比较器模式、中继器延迟等），
> 转换完会告诉你有多少种方块没有现成规则、是原样写过去的，建议进游戏核对。

## 功能

### 看

- `导入` 导入结构文件，也可以把文件直接拖到程序图标上打开
- `材料表格` 四个页签切换：**方块 / 实体 / 物品 / 总数**
  - 物品 = 所有容器内物品的合计，不用一个个翻容器
  - 总数 = 方块 + 实体 + 物品，同名合并
  - 右键某一行：`忽略`（临时从表里藏起来）、`快捷替换方块`
- `统计面板` 红石偏度、材质判定、液体、密度、作者、版本、简介
- `饼图` 方块构成 + 分类构成
- `3D 缩略图` 左上角常驻的小预览，可在设置里开关自动旋转
- `手动3D渲染` 用 deepslate 渲染引擎在独立窗口里看整个结构，可拖动视角、按层切片
- `步骤查看器` 逐层查看方块摆放，带朝向 / 上下半 / 含水属性标注
- `容器分析器` 列出容器里的物品，并按容器类型画出槽位排布

### 改

- `生成图形投影` 生成实心 / 空心长方体，方块用带贴图的下拉框挑
- `替换特定方块` 一行一条规则，`＋/−` 增删，可限定坐标范围和方块状态
- `另存为` 在 litematic / nbt / mcstructure 之间互转
- `跨版本转换投影` 把 litematic 转成 1.16 / 1.13 版本

### 导出

- `导出 / 分类导出` 导出材料清单（txt / csv）
- `生成缩略图` 按标准等轴渲染一张结构照片，**直接写进投影文件自己的预览图字段**，
  这样在游戏里的 Litematica 投影浏览界面就能看到缩略图（仅 `.litematic` 支持）

### 界面

- 右侧「投影工具」侧栏可左右收起，默认收起
- 窗口拉窄时按「侧栏 → 饼图列 → 左列」的顺序让位，中间的表格保到最后
- 生成投影 / 替换方块 / REDENMC 搜索 / 信息显示 四块都能**单独开窗口**（功能菜单里），
  窗口再小也点得到
- 主题色、字体、字号、中英文切换

> **方块选择框**都是「半下拉」：既能点开按贴图挑，也能直接敲程序没收录的方块。
> 想带方块状态就写成 `hopper{"facing":"west"}` 这样。

## 运行

```bash
pip install -r requirements.txt
python script/LitematicaViewer.py
```

也可以带文件路径直接打开：

```bash
python script/LitematicaViewer.py 我的投影.litematic
```

打包：

```bash
python tools/lang_build.py && pyinstaller --noconfirm LitematicaViewer.spec
```

> macOS 用户看 [README_MACOS.md](https://github.com/albertchen857/LitematicaViewer/blob/macos/README_MACOS.md)（`macos` 分支）。
> 左上角的内嵌 3D 缩略图依赖 pyopengltk，在 macOS 上用不了，那个位置会留空，
> 其它功能不受影响 —— 用「手动3D渲染」即可。

## 目录结构

```
script/
  LitematicaViewer.py   入口
  webview_host.py       3D 渲染窗口的子进程入口
  lv/                   主体代码，见 docs/ARCHITECTURE.md
  JSrender/             deepslate 网页渲染器（改自 Ending_Credits 的 litematic-viewer）
lang/
  source/*.json         翻译的唯一数据源，改这里
  data.json             主题色和用户设置
  setting.json          方块中文名 / 物品名 / 分类表
tools/
  lang_build.py         编译 po/mo
  lang_check.py         检查翻译有没有漏
  selftest.py           三种格式互相读写的自检
  make_testdata.py      生成带容器 / 实体 / 特殊属性的测试投影
```

## 加一门语言

1. 复制 `lang/source/en_US.json` 成 `lang/source/<语言代码>.json`，翻译值，
   把 `lang.name` 改成这门语言的自称。
2. 重启程序，`帮助 → 语言` 里就会多出这一项。

`.po` / `.mo` 由程序自动编译，不需要手动生成，也不进版本库。

## 分支

| 分支 | 内容 |
|---|---|
| `main` | 主线 |
| `macos` | macOS 打包脚本、图标、Release 工作流 |
| `original` | 改版之前的 0.8.0c 原版（只做了能启动的最小修复），留着对比用 |

## 分支图

```
投影查看器 LitematicaViewer
|- 格式 formats
|  |- .litematic (litemapy)
|  |- .nbt Java 结构方块 (amulet-nbt)
|  |- .mcstructure 基岩版 (amulet-nbt, 小端)
|  |- Java <-> 基岩 方块 ID / 状态互转 blockmap
|- 分析 analysis
|  |- 材料清单 / 分类 / 密度 / 红石占比
|  |- 容器分析 containers
|  |- 容器物品合计 item_totals
|- 功能 edit
|  |- 生成长方体 (实心 / 空心)
|  |- 批量替换方块 (可限定范围与状态)
|  |- litematic 跨版本转换
|- 渲染 render
|  |- 手动3D渲染 (deepslate WebGL, 独立子进程)
|  |- 内嵌缩略图 (pyopengltk, 非 macOS)
|  |- 等轴缩略图写入投影文件 snapshot
|  |- 步骤查看器 (逐层 2D)
|- 界面 ui
   |- 可收纳侧栏 / 面板独立开窗 / 主题色 / 字体 / 多语言
```

## Star History

<a href="https://www.star-history.com/?repos=albertchen857%2FLitematica-viewer&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
 </picture>
</a>
