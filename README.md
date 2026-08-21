**简体中文** | [English](./README_EN.md)

# LitematicaViewer 投影查看器 v0.9.0

### Minecraft tool - 让我的世界投影查看更加的轻量便捷

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/v/release/Albertchen857/LitematicaViewer)]()
[![三连](https://img.shields.io/badge/-一键三连-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1H9ZVYtEta/)
[![转发](https://img.shields.io/badge/-转发-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/3494373232741268)
[![YoutubeIntro](https://img.shields.io/badge/-Youtube-00A1D6?logo=youtube&logoColor=red)](https://www.youtube.com/watch?v=0nofWrfKJeg)

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

> 跨版本转换的注意事项：Java 和基岩的方块 ID / 状态命名不完全一样。程序内置了常见
> 改名和状态换算，转换完会告诉你有多少种方块没有现成规则、是原样写过去的，建议进游戏核对。

## 功能

- `导入` 导入结构文件，也可以把文件直接拖到程序图标上打开
- `简洁分析` 统计方块名与数量，自动折算双层台阶、含水方块、重生锚充能等
- `导出 / 分类导出` 导出材料清单（txt / csv）
- `另存为` 在 litematic / nbt / mcstructure 之间互转
- `容器分析器` 列出容器里的物品，并按容器类型画出槽位排布
- `步骤查看器` 逐层查看方块摆放，带朝向 / 上下半 / 含水属性标注
- `3D 渲染` 用 deepslate 渲染引擎在独立窗口里看整个结构，可以拖动、切层
- `生成图形投影` 快速生成实心 / 空心长方体
- `替换特定方块` 按规则批量替换，可以限定坐标范围和方块状态
- `跨版本转换投影` 把 litematic 转成 1.16 / 1.13 版本
- `界面颜色 / 字体 / 语言` 主题色、字体、中英文切换

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
```

## 加一门语言

1. 复制 `lang/source/en_US.json` 成 `lang/source/<语言代码>.json`，翻译值，
   把 `lang.name` 改成这门语言的自称。
2. 重启程序，`帮助 → 语言` 里就会多出这一项。

`.po` / `.mo` 由程序自动编译，不需要手动生成，也不进版本库。

## 分支图

```
投影查看器 LitematicaViewer
|- 格式 formats
|  |- .litematic (litemapy)
|  |- .nbt Java 结构方块 (amulet-nbt)
|  |- .mcstructure 基岩版 (amulet-nbt, 小端)
|- 分析 analysis
|  |- 材料清单 / 分类 / 密度 / 红石占比
|  |- 容器分析 containers
|- 功能 edit
|  |- 生成长方体 (实心 / 空心)
|  |- 批量替换方块 (可限定范围与状态)
|  |- litematic 跨版本转换
|- 渲染 render
|  |- 3D 渲染 (deepslate WebGL, 独立子进程)
|  |- 步骤查看器 (逐层 2D)
|- 界面 ui
   |- 可收纳侧栏 / 主题色 / 字体 / 多语言
```
