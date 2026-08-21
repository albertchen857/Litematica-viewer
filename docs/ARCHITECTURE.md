# 架构说明 & 0.8 → 0.9 搬迁对照

这份文档回答两个问题：**代码现在长什么样**，以及**旧版每个功能搬到哪去了**。

---

## 一、现在的结构

旧版是 `script/Tk/LitematicaViewer.py` 一个 1396 行的文件，加上四个互相 import 的
散装模块，全局变量 `Block` / `Block_pos` / `schematic` 到处被读写。
现在拆成一个包，规矩是**一个文件只干一件事，上层可以 import 下层，下层不许回头 import 上层**：

```
                    ui_main / ui_step / ui_container / ui_widgets     ← 只管画界面
                                     │
        ┌────────────┬───────────────┼──────────────┬─────────────┐
     analysis       edit          render         formats        tools
     (统计)       (改结构)      (3D 渲染桥)     (读写文件)    (中文名/贴图)
        └────────────┴───────────────┼──────────────┴─────────────┘
                                     │
                             model (统一结构模型)
                                     │
                        config (路径/主题/设置)  ·  i18n (语言)
```

| 文件 | 干什么 | 主要依赖 |
|---|---|---|
| `config.py` | 资源路径 `res()`、主题色、字体、`lang/data.json` 读写、跨平台的图标/最大化/打开文件夹 | 标准库 |
| `i18n.py` | 语言系统：JSON → `.po`/`.mo` → gettext，缺键回退英文 | `gettext` |
| `model.py` | `Block` / `Region` / `Structure`。调色板 + numpy 索引数组 | `numpy` |
| `formats.py` | 三种文件格式的 load / save，多区域合并 | `litemapy` `amulet-nbt` `nbtlib` |
| `blockmap.py` | Java ↔ 基岩 的 ID 与状态互转，带「没把握」报告 | — |
| `analysis.py` | 材料折算、分类、密度、红石占比、容器扫描 | `numpy` |
| `edit.py` | 生成长方体、批量替换、litematic 改版本号 | `numpy` `amulet-nbt` |
| `render.py` | 写 `payload.js`，起子进程开 3D 窗口（手动全屏渲染） | `subprocess` |
| `thumbnail.py` | 左上角内嵌的小缩略图，pyopengltk + 顶点数组；macOS 上留空 | `PyOpenGL` `pyopengltk` |
| `tools.py` | 中文名、分类、单位换算、贴图加载 | `PIL` |
| `ui_widgets.py` | `CollapsiblePanel`（上下收）、`SideCollapsible`（左右收）等 | `tkinter` `customtkinter` |
| `ui_panels.py` | 四块可复用面板：生成投影 / 替换方块 / REDENMC / 信息（指标+饼图） | `matplotlib` |
| `ui_main.py` | 主窗口 | 上面全部 |
| `ui_step.py` | 步骤查看器 | `PIL` `numpy` |
| `ui_container.py` | 容器分析器 | `analysis` |

### 核心思路：统一模型

三种格式内部其实都是「一张调色板 + 一个索引数组」，所以内部模型就照抄这个：

```python
Structure
 └─ Region(name, origin)
     ├─ palette : list[Block]          # Block(id, props)，palette[0] 恒为空气
     ├─ indices : np.ndarray (x,y,z)   # 值 = palette 下标
     ├─ block_entities : {(x,y,z): dict}
     └─ entities : [{"id", "nbt", "raw"}]
```

带来两个直接好处：

1. **统计快了两个数量级。** 旧版三层 for 循环挨个方块判断；现在
   `np.bincount(indices)` 数出每个调色板条目出现几次，再对着调色板（几十条）算折算。
   32×81×170 的投影从「几十秒 + 一个假的进度条」变成一瞬间。
2. **新格式白嫖所有功能。** 只要 reader 能产出 `Structure`，统计、步骤查看器、
   容器分析、3D 渲染就全都能用，不用各写一遍。

内部模型一律用 **Java 口径**的方块 ID：`.mcstructure` 在读的时候就换算成 Java 命名，
写回去的时候再换回来。这样贴图目录、`setting.json` 的中文名表、分类表都能直接复用。

---

## 二、旧版功能搬到哪了

### 旧 `script/Tk/LitematicaViewer.py`

| 旧的东西 | 现在在哪 | 备注 |
|---|---|---|
| `TKF.TK_INIT` | `ui_main.App._build` | 拆成 `_build_menu` / `_build_topbar` / `_build_left` / `_build_center` / `_build_right` |
| `TKF.TK_FrameTop` | `App._build_topbar` | 多了一个「3D 渲染」按钮 |
| `TKF.TK_FrameFunc` | `App._build_right` + 三个 `_build_panel_*` | **改成可收纳面板**，标题栏小三角点一下收起，状态存进设置 |
| `TKF.TK_FrameMiddle` | `App._build_center` | 表格 + 两个饼图 + 进度条 |
| `TKF.TK_FrameStat` | `App._build_left` | 原来嵌在这里的 OpenGL 画布删掉了，换成「3D 渲染」按钮 |
| `TKF.import_file` | `App.import_file` | 文件类型加了 `.nbt` / `.mcstructure` |
| `TKF.start_analysis` | `App.start_analysis` → `_analysis_worker` → `_analysis_done` | 读文件和统计放进工作线程，结果用 `root.after` 回主线程 |
| 里面的方块折算逻辑 | `analysis.material_of` | 从「对每个方块判断」改成「对每个调色板条目判断」 |
| `TKF.insert_table` | `App._fill_table` | |
| `TKF.Draw_Chart` | `App._draw_charts` / `App._pie` | |
| `TKF.output_data` | `App.export_text` | |
| `TKF.PB` | 删了 | 旧版那个进度条是 `time.sleep(1)` 假装的；现在统计本身够快，进度条只在读文件时转 |
| `LitStepChecker` | `ui_step.StepChecker` | 数据源从 `Block_pos` 换成索引数组切片 |
| `Setting.set_colormap/set_font/set_fontsize` | `App.choose_colormap` / `choose_font` / `choose_font_size` | 弹窗从 easygui 换成原生 tkinter（easygui 在 macOS 上装不上，见 issue #7） |
| `Setting.ChangeLang` | `App.change_language` | 从「两种语言来回切」改成列出 `lang/source/` 里所有语言 |
| `Update()` | `App.check_update` | 去掉了写死的 `127.0.0.1:7890` 代理回退 |
| `Redenmc()` | `App.open_reden` | |
| `ConAly()` / `StepOpen()` | `App.open_container` / `App.open_step` | 旧版是 `threading.Thread(target=f())`——括号一加当场就执行了，线程白开；现在直接建 Toplevel |
| `hide()` | `App._toggle` | |
| `CS_trans_dict()` | `edit.parse_rules` | 旧版用 `eval()` 解析属性，等于让输入框能执行任意代码，换成 `json.loads` |
| `handle_exception` | `LitematicaViewer.py._install_crash_log` | 日志写到 exe 旁边而不是当前工作目录 |

### 旧 `script/Tk/Litmatool.py`

| 旧函数 | 现在 |
|---|---|
| `grs()` | `config.res()` |
| `cn_translate()` | `tools.translate()` / `tools.display_name()` |
| `convert_units()` | `tools.convert_units()`（语言从 i18n 拿，不再靠传参） |
| `Category_Tran()` | `tools.category_of()`（返回英文分类 id，界面上再翻译） |
| `load_image()` | `tools.block_image()` |
| `id_tran_name()` | `Block.name` 属性 |
| `litVerFix()` | `edit.change_litematic_version()` |
| `manual_install_pk()` | 删了（跑 `install.bat`，非 Windows 用不了） |
| `find_keys_by_value_in_list()` | 删了（没人调用） |

### 旧 `script/Tk/Structure.py`

| 旧函数 | 现在 |
|---|---|
| `create_structure()` | `edit.create_cube()` |
| `change_Schematic()` | `edit.replace_blocks()` |
| `save_Schematic()` | `formats.save()` + `App._save_structure_as()` |
| `get_schematic_bounds()` | 不需要了，`Region.size` 直接就是 |

### 旧 `script/Tk/LitContainer.py`

| 旧的东西 | 现在 |
|---|---|
| `LitCon` 窗口 | `ui_container.ContainerWindow`（Toplevel，不再是第二个 `tk.Tk()`） |
| `LitCon.LitContainer` 里读 NBT | `analysis.containers()`，三种格式共用 |
| 一长串 `elif "chest" in id` 的槽位排布 | `analysis.SLOT_LAYOUTS` 数据表 + `ContainerWindow._slot_map` |

### 旧 `script/Tk/LitRender.py`

整个删掉。`OpenGLView` / `draw_cube` / `CCrgb`（取贴图主色画彩色方块）
被 `render.py` + `JSrender/` 的 deepslate 渲染取代 —— 后者是真的贴图渲染，
而且顺带解决了 `pyopengltk` 在 macOS 上导入失败的问题。

### 旧 `script/JSrender/helper/`

| 旧文件 | 现在 |
|---|---|
| `webview.py` | `script/webview_host.py`（改成独立子进程 + `http_server=True`） |
| `http_server.py` | 删了，pywebview 自带 http 服务 |
| `assets_update.py` | `tools/update_jsassets.py` |

---

## 三、3D 渲染是怎么接的

旧版试过两条路，都会和 Tk 打架：在 Tk 里塞 `pyopengltk` 画布（macOS 直接导入失败），
以及在线程里起 http 服务 + 开窗（pywebview 和 tkinter 都要独占主线程）。

现在的做法：

```
主进程 (tkinter)                          子进程 (pywebview)
     │                                         │
     ├─ render.write_payload()                 │
     │    写 script/JSrender/payload.js         │
     │    window.LV_PAYLOAD = {size, palette,  │
     │                         idx[], state[]} │
     │                                         │
     └─ subprocess.Popen(webview_host.py) ────►│
                                               ├─ webview.start(http_server=True)
                                               ├─ viewer.html 加载 payload.js
                                               └─ bridge.js → deepslate 渲染
```

几个要点：

- **必须是子进程**，不是线程。两个 GUI 事件循环放一个进程里必冲突。
- **payload 走 `<script>` 而不是 fetch**，所以不存在跨域问题。
- **贴图图集必须走 http**：`canvas.getImageData()` 读 `file://` 来的图片会抛安全错误，
  这就是 `http_server=True` 的用处。
- 渲染核心 `src/viewer.js` 和 `src/deepslate-helpers.js` 是原作者的代码，**一行没改**；
  新增的只有 `src/bridge.js`（喂数据 + HUD）和 `viewer.html`。
- `deepslate` 和 `gl-matrix` 还是从 unpkg CDN 拉的，**第一次用 3D 需要联网**。
  想离线用就把这两个库下到 `script/JSrender/resource/`，再改 `viewer.html` 里的两个
  `<script src>`。

---

## 四、语言系统

```
lang/source/zh_CN.json        ← 唯一数据源，只改这个
        │  i18n.compile_locale()（启动时发现 JSON 比 mo 新就自动跑）
        ▼
lang/zh_CN/LC_MESSAGES/litematicaviewer.po   ← 给 Poedit 之类的工具
lang/zh_CN/LC_MESSAGES/litematicaviewer.mo   ← gettext 实际读的
```

旧版的问题是把 mo 直接放在 `lang/en_US.mo`，而 gettext 只认
`<localedir>/<语言>/LC_MESSAGES/<域>.mo` 这个目录结构，所以**永远匹配不上、永远 fallback**，
界面上显示的是 `litem.title` 这种原始键名。现在按标准布局生成，`.mo` 的二进制由
`i18n._mo_bytes()` 自己写（不依赖系统装没装 gettext 工具链）。

其它改进：

- `_("key", 参数...)` 直接带参数格式化，格式化失败只打日志不崩界面。
- 目标语言缺某个键时自动回退英文（`add_fallback`），再没有才显示键名。
- 语言菜单从 `lang/source/` 目录扫出来，加一门语言不用改代码。
- `tools/lang_check.py` 报告代码里用到但翻译表没有的键。

---

## 五、自检

```bash
python tools/selftest.py     # 三种格式互相读写，比对方块数
python tools/lang_check.py   # 翻译键有没有漏
python tools/shot.py         # 开一次主界面截图，肉眼看布局
python tools/shot_window.py step|container 文件路径 输出.png
```


---

## 六、0.9.1 的界面调整

| 要求 | 落点 |
|---|---|
| 左上角内嵌 3D 缩略图，不能操作，受设置里「旋转」「大体积仍渲染」控制 | `thumbnail.py`，主界面 `App._build_left` |
| 「手动3D渲染」保留，仍是打开全屏网页渲染器 | `App.open_3d` → `render.open_viewer` |
| 刚打开默认渲染一个工作台 | `App._show_default_thumbnail` |
| REDENMC 搜索放左下角 | `App._build_left` 里 `side=tk.BOTTOM` |
| 表格图标别压到名字列 | `#0` 列宽 46 + `anchor="center"` |
| 进度条用旧款式，放饼图下面 | `ChartsPanel`（`extras=True`） |
| 右边三块合成一个左右收起的侧栏，默认收起 | `ui_widgets.SideCollapsible`，`App._build_side` |
| 窗口变窄时：先收侧栏 → 再收饼图列 → 最后收左列 | `App._apply_layout`，阈值见文件顶部三个常量 |
| 倍数输入放饼图上面，对账/提示放饼图下面，删掉「分析设置」面板 | `ChartsPanel` |
| 四块功能各有独立窗口，入口在功能菜单 | `ui_panels.py` + `App.open_panel_window` |

缩略图为什么用 pyopengltk 而不是纯软件渲染：这是明确选定的方案 ——
Windows/Linux 上走硬件加速，macOS 上因为 pyopengltk 的 Cocoa 后端导入即失败，
那个位置直接留一句说明，其它功能不受影响。相比旧版 `LitRender`，这里避开了两个性能坑：
主色按方块 id 缓存（旧版每帧每方块都 `Image.open()` 读一次贴图），
以及加载时用 numpy 把可见面摊成顶点数组、每帧只发一次 `glDrawArrays`
（旧版是三层 Python 循环逐面 `glVertex3fv`）。
