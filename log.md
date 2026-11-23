# LitematicaViewer 更新日志
---

## 0.9.7 — 2026-11-17 ~ 2026-11-23

### 桌面版 · 新增
- **投影搜索**（`功能 → 投影搜索`，`script/lv/search/`）：在本机给 15 个投影网站建索引（RedenMC、GrabCraft、9minecraft、BuildSchematics、MCMod 等），图片 / 详细两种样式，按下载量、点赞、相关度综合排序，可按站点、版本、标签筛选。只跳转到原站，不下载文件；索引存在本机 `search_index.sqlite`。
- 主界面左下角的 REDENMC 面板换成**投影搜索框**：输入关键词回车，直接打开搜索窗口并搜索。RedenMC 现在是搜索里的一个站（帮助菜单里的 RedenMC 链接还在）。
- 支持 **`.schem`**（WorldEdit / FAWE，Sponge v1–v3 读，v2 写）和老 **`.schematic`**（1.12 及以前，数字 ID，按相邻方块补全朝向 / 连接状态）。
- 导出存档前可以选存档图标：投影缩略图 / 生成等轴图 / 自定义图片 / 不要。

### 桌面版 · 修改
- 「手动3D渲染」窗口只保留渲染画面：去掉右侧信息栏和底部提示，画面占满窗口；保留轴向面板、透视 / 正交切换、显示层滑块和点选方块信息。
- 3D 窗口随查看器一起更新：高亮 / 隐藏方块改成外轮廓、右上角轴向面板、透视 / 正交切换、远处降细节防摩尔纹、动态分辨率、视锥剔除、几十万方块的大结构也能打开。
- 大箱子用左右半边贴图拼成一个整体；箱子图标改用箱子贴图（之前是木板）。
- 许可证改为 **AGPL-3.0**（v0.9.6 及更早是 MIT），补上 deepslate / gl-matrix 的许可声明（`NOTICE.md`）。

### 桌面版 · 修复
- **尺寸为负的 `.litematic`**（Litematica 从反方向框选时会这样存）：实体飘在结构外面、多区域之间对不齐、另存后实体错位。现在原点按最小角算，实体坐标跟着换算。
- 3D 里台阶 / 楼梯挨着同种方块时侧面缺面；两个含水方块挨着时侧面被剔掉。
- 3D 里告示牌、床的黑块。

### 网页版（lite-viewer.com）
- **观光**：顶栏「观光」进入第一人称参观。WASD 水平移动、空格 / Shift 上下、双击空格切换飞行、Ctrl 切换疾跑；方块有碰撞箱和重力，能直接上台阶；中键看方块属性，右键开门 / 拉杆 / 按钮、告示牌改字、打开容器；T 传送到准星位置，C 替换方块；可选调试棒、光源发光、穿墙；可调视野、亮度、维度和时间、移动速度。查看模式原来的 WASD 移动去掉。
- **批量转换页**：多个文件一起转格式 / 换游戏版本 / 生成缩略图，单个直接保存，多个打成 zip。
- 支持 Axiom **`.bp`** 蓝图和 VMod / Valkyrien **`.vschem`** 船只蓝图（读写，物理连接画线并原样写回）；支持 1.12 的 `.litematic`（打开时扁平化，可导出回 1.12 写法）；可导出 `.schematic`。
- 从网址打开投影（粘贴链接 / 拖链接 / `?file=`），GitHub、Dropbox 链接自动转直链。
- 告示牌在信息面板里显示正反面四行字，可以改；容器格子可以放物品；导出菜单、全面替换、改结构名 / 简介、原始 NBT。
- 地板改成每格一张方块贴图；三个页面顶栏统一，加「观光」入口。

---

## 0.9.6 — 2026-11-14 ~ 2026-11-16

### 新增
- **手动3D渲染换成 deepslate 贴图渲染**（和网站共用 `viewer/`）：透明 / 半透明方块、告示牌、床、箱子等特殊模型；点选方块看属性、容器物品格子；实体图标 + 碰撞箱；全部 / 范围 / 单层的层滑块；分步拆解；五套主题配色。
- 渲染引擎（deepslate、gl-matrix）随程序打包到 `viewer/vendor/`，3D 窗口离线可用。
- 首次启动选择语言；更新日志按版本只弹一次。
- 网站 lite-viewer.com（`web` 分支）：浏览器里查看、导出、转换格式、右键替换方块。

### 修改
- 仓库拆分：`main` 只放桌面版，网站放 `web` 分支；`docs/viewer` → `viewer/`，`docs/ARCHITECTURE.md` → `ARCHITECTURE.md`。
- 新增 `tools/sync_site.py`（把 `viewer/` 同步到网站）；`build_web_data.py` 只生成查看器数据。
- spec 的 macOS 版本号改为从 `config.py` 读取。
- CI：macOS 构建改用现役的 `macos-15-intel` / `macos-15`（`macos-13` 已下线，任务会一直排队）；三个平台产物打成带版本号的压缩包。

---

## 0.9.4 — 2026-11-01 ~ 2026-11-02

| 提交 | 时间 | 说明 |
|---|---|---|
| `6cc53dc` `bb860ec` | 2026-10-12 | 繁體中文支持 + 繁中 README（by **xiaojiang1727**） |
| `3323893` | 2026-11-01 22:36 | 发版：LitematicaViewer Beta 0.9.4 |
| `8a88621` | 2026-11-02 22:37 | CI：翻译检查改成不卡构建 |
| `1b800d2` | 2026-11-02 22:41 | 补齐繁體中文翻译 |

### 新增
- **繁體中文（台灣）** 语言 `lang/source/zh_TW.json`、对照表 `lang/setting_zh_TW.json`、`README_ZHT.md`（by xiaojiang1727）。语言菜单自动扫目录，无需改代码即出现。

### 修复
- **GitHub Actions 四个平台全部构建失败**（#39 ~ #42）
  - 现象：windows / macos x64 / macos arm64 / linux 全挂在同一步 `Check translations`，`Build` 根本没开始跑 —— 不是平台问题，是一道闸门把四个平台一起拦下。
  - 原因：繁中是基于旧键集翻译的，之后新增的 13 个键没跟上；`tools/lang_check.py` 一发现缺键就退出码 1。
  - 处理：按要求**只改 workflow**，给该步骤加 `continue-on-error: true`。i18n 运行时本来就会把缺的键回退成英文，程序照常可用；保留这一步是为了日志里仍能看到缺哪些键。
  - 验证：本地按 CI 顺序走一遍，并完整执行 `pyinstaller LitematicaViewer.spec`，构建成功、产物可启动、三个语言的 `.mo` 都已打包。闸门后面没有第二个坑。
- **繁中 `tab.count` 占位符错误**：原文 `} 種 · 共 {} 個` 少了一个左花括号，导致「共」后面显示的其实是种类数、总数被吞掉。`.format()` 不报错，所以 i18n 的异常兜底抓不到，是截图核对界面时发现的。

### 修改
- 繁中补齐缺失的 13 条（snapshot / assets.auto / menu.analyse / row.\* / rule.\* / render.\*），用词跟随译者习惯：檔案、匯入、儲存、渲染、方塊、生成。
- 繁中刷新 3 条过时文案：`litem.funcChange.6` 原先描述的还是已删除的文本式替换表，`funcChange.4` / `funcNew.2` 标签同步。
- 三个语言现在都是 173 条，原版 `lang_check.py` 退出码 0 —— 不依赖 `continue-on-error` 也能过。

---

## 0.9.3 — 2026-10-13

| 提交 | 时间 | 说明 |
|---|---|---|
| `5913c56` | 2026-10-13 00:23 | 资源更新到 Minecraft 26.3，block/ 图标改为从 atlas 生成 |
| `78c1aee` | 2026-10-13 00:34 | 发版：Beta 0.9.3（含启动时自动检查资源版本） |
| `8bd1705` `9c131ce` | 2026-10-13 00:41 | 删除 `LitematicaViewer.spec`、`pyEXE.bat`（tag `litematica0_9_3`） |

### 新增
- **启动时自动检查方块资源版本**（`script/lv/assets.py`）
  - 后台线程读取 mcmeta 最新版本号（一个很小的请求），与本地 `script/JSrender/resource/version.json` 比对，不一致才下载约 2MB。不拖慢启动，断网 / 被墙 / 限流都安静跳过。设置菜单有开关，默认开启。
  - **atlas.png 和 assets.js 永远一起换**：assets.js 记录每张贴图在图集里的 `[u,v,w,h]`，只换一个会导致整体 UV 错位、材质全错。
  - **默认只升正式版**（`STABLE_ONLY`）：mcmeta 跟的是最新快照（当时为 26.4-snapshot-3），不应静默把用户顶到快照版。
  - 先写 `.part` 再 `os.replace`，中途断网不会留下半个文件。
- **`tools/make_block_icons.py`**：从 atlas 生成 `block/` 图标。
  - 顺着 `blockstate → model → parent 链合并 textures → 解开 #ref → 按 [u,v,w,h] 裁图`。
  - 26.3 新增的 **460 个方块图标全部补齐，0 个解析失败**；`block/` 940 → 1401 个，下拉可选方块 940 → 1400。
  - 默认只补缺不覆盖原有图标，`--all` 可整体重生成。`block/` 从手工收集的目录变成可复现的产物。

### 修改
- **资源更新到 Minecraft 26.3 正式版**
  - atlas.png 1.81MB → 2.04MB；blockstates 1168 → 1288，models 3673 → 4192，textures 2518 → 2874。
  - mcmeta 当时跟的是 26.4-snapshot-3，所以按版本锁定了 atlas / summary / assets 三个分支各自的提交，避免 atlas 与 blockstates 对不上。
  - `tools/update_jsassets.py` 支持 `update_jsassets.py 26.3` / `latest`，新版本在 `PINS` 表里加一行即可。
- **方块名对照表**：`lang/setting.json` 用官方 `zh_cn.json` 刷新，新增 209 条、更新 9 条（铜灯、树脂块、苍白橡木、嘎吱之心、辰砂等都有了中文名）。
- **README 中英文**：加入 [Litematica Nova](https://github.com/LitematicaViewer/Litematica-Nova)（投影查看器 Pro 版）大按钮入口；功能列表按看 / 改 / 导出 / 界面重写；补分支表（main / macos / original）。
- 版本号对齐（`config.py` 的 `APP_VERSION`、spec 的 `CFBundleShortVersionString`）。

### 修复
- **旧资源更新脚本会毁资源**：路径还是搬家前的 `../resource/`，且下载失败仍会写出残缺的 `assets.js` 覆盖好资源。改为全部下完才落盘。
- **3D 渲染防缓存漏了资源文件**：只给 `src/*.js` 加了时间戳，`resource/assets.js` 和 `atlas.png` 没加。实测更新后首次打开页面读到的仍是旧的 2518 条索引。现已补上。
- **自动更新永远更新不成**：提交标题实际是 `Update <分支名> for 26.3`，正则把 `atlas` 写死，导致查 summary 分支永远匹配不上。修复后实测：把本地标记改成 26.2，程序自动拉回 26.3，下载文件与原文件 md5 一致。

### 关于「atlas 替代 block 文件夹」的结论
- atlas 存的是**面**贴图（`block/oak_planks`），没有按方块 id 索引的条目（搜 "stairs" 一个都没有）。
- `block/` 存的也不是立体图标，而是 16×16 平面贴图（`oak_log.png` 就是原木侧面）。
- 两者缺的只是「方块 id → 贴图路径」这层映射，它就在 blockstates + models 里 —— 所以选择了**由 atlas 生成 block/** 的方案。

> 待办：资源自动更新后不会自动重生成 `block/` 图标（启动时写几百个文件副作用太大），需手动跑 `tools/make_block_icons.py`。`item/` 尚未接入 atlas 生成。

---

## 0.9.2 — 2026-10-12

| 提交 | 时间 | 说明 |
|---|---|---|
| `4433702` | 2026-10-12 21:58 | 界面与渲染调整 + 自造测试投影，修三处 Java/基岩状态映射错误 |
| `e852f32` | 2026-10-12 23:23 | 生成缩略图改为写进投影文件自己的预览图字段 |
| `a31ac97` | 2026-10-12 23:33 | 修手动 3D 渲染「初始化错误 找不到 length 字段」 |
| `7593dba` | 2026-10-12 23:59 | 表格页签改版 + 带贴图的半下拉 + 表格右键菜单 |
| `91f573d` | 2026-10-13 00:10 | README 更新到 0.9.2 |

### 新增
- **材料表格页签**：方块 / 实体 / 物品 / 总数。
  - 物品 = 所有容器内物品合计（`analysis.item_totals`），不用再逐个翻容器分析器。
  - 总数 = 方块 + 实体 + 物品，同名合并。
  - 页签为直角、无间隔的一条（`CTkButton` 自带圆角，改用 `tk.Label` 自绘），旁边显示「N 种 · 共 M 个」。
- **表格右键菜单**：「忽略」（只影响显示，不改文件）、「快捷替换方块」（弹窗选目标直接替换另存）、有忽略项时可「恢复所有被忽略的条目」。
- **`BlockPicker` 半下拉方块选择框**：左边输入框 + 右边 ▾，点开为带方块贴图的列表，边打字边过滤。
  - `ttk.Combobox` 的下拉项放不了贴图，所以自制。
  - **清单只是推荐项，不是白名单**：没收录的方块可直接手输；`hopper{"facing":"west"}` 这种带状态写法仍有效。
  - 复用于：生成图形投影的方块输入、替换规则、右键快捷替换。
- **替换规则行式编辑**：一行一条 `[选择框] → [选择框] [−]`，下方「＋ 添加替换项」。内部仍拼回原文本格式交给 `edit.parse_rules`，解析器只有一份。
- **生成缩略图**：按标准等轴（yaw 45° / pitch 30°）渲染，**直接写进 `.litematic` 的 `Metadata.PreviewImageData`**，游戏内 Litematica 投影浏览界面即可看到。
  - 格式对照真实 Litematica 文件确认：140×140、行优先 ARGB `(a<<24)|(r<<16)|(g<<8)|b`、有符号 int 回绕、不透明浅灰蓝底。
  - 仅 `.litematic` 支持（该字段为 Litematica 专有），写入前弹窗确认（会修改原文件）。
  - 渲染器 `script/lv/snapshot.py` 为纯 PIL 软件渲染，macOS 也能用。
- **`tools/make_testdata.py`**：生成三个可控样本（16 种带属性方块 / 12 种容器带物品 / 13 个实体），每个写出 litematic + nbt + mcstructure 三份。自检扩展到 12 个文件 × 3 目标格式 = 52 条路径。

### 修改
- 顶栏「分析」改名「分析/重置」，重新分析会清空右键忽略项。
- 「投影工具」侧栏不再记忆展开状态，每次启动默认收起。
- 手动 3D 渲染 payload 改为 base64 类型数组（坐标 Int32、调色板下标 Uint16），并**分块构建**（每 2 万方块让出一次主线程，HUD 显示进度），避免浏览器判定脚本无响应。11 万方块实测分 6 批建完。

### 修复
- **Java ↔ 基岩状态映射三处错误**（由自造测试数据发现，真实投影没覆盖到）
  - `half` 被当成一个属性：`top/bottom`（楼梯倒置）与 `upper/lower`（门/高草哪一半）在基岩是两个状态。原先回读后门和高草的上半格被重复计数，数量翻倍。
  - `type=double` 双层半砖在基岩是独立 id（`*_double_slab`），原先被丢掉，只算一个半砖。
  - `type` 被无差别当半砖处理，`piston_head[type=normal]`、`chest[type=single]` 被误改。
- **手动 3D 渲染「初始化错误 找不到 length」**：webview 持久缓存留着旧 `bridge.js` 去读新格式 payload。四层处理：webview 改无痕模式、本地脚本带时间戳加载、payload 改为 `payload.json` 用 `fetch(no-store)` 读、payload 加 `format` 版本号并在页面开场校验。实测 `<meta>` 的 Cache-Control 管不到子资源，无效。
- 命令行带文件打开时，默认工作台缩略图的定时器会在分析完成后把缩略图覆盖回去。

> 设计说明：右键「忽略」只影响表格显示，不影响饼图和导出。

---

## 0.9.1 — 2026-08-21

| 提交 | 时间 | 说明 |
|---|---|---|
| `969419d` | 2026-08-21 13:12 | `macos` 分支：打包脚本、图标、Release 工作流、issue #7 说明 |
| `162f964` | 2026-08-21 14:05 | `original` 分支：让 0.8.0c 原版能正常启动 |
| `dce0420` | 2026-08-21 14:44 | 界面调整：内嵌缩略图 / 侧栏改左右收 / 面板可独立开窗 |
| `506bd4b` | 2026-08-21 15:08 | 发版：Beta 0.9.1 |

### 新增
- **左上角内嵌 3D 缩略图**（`script/lv/thumbnail.py`，pyopengltk）：不可操作，由设置菜单「缩略图自动旋转」「大体积结构也渲染缩略图」控制；启动默认渲染一个工作台。
  - 避开旧版 `LitRender` 两个性能坑：主色按方块 id 缓存（旧版每帧每方块都 `Image.open()`）；加载时用 numpy 把可见面摊成顶点数组，每帧一次 `glDrawArrays`（旧版三层 Python 循环逐面 `glVertex3fv`）。
  - macOS 上 pyopengltk 的 Cocoa 后端导入即失败，该位置显示说明文字，其余功能不受影响（requirements 加平台标记）。
- **四块功能面板可独立开窗**：生成图形投影 / 替换特定方块 / REDENMC 搜索 / 信息显示（7 指标 + 2 饼图），入口在功能菜单。面板代码抽到 `script/lv/ui_panels.py`，主界面与独立窗口共用；信息窗口随分析结果同步刷新。
- **`macos` 分支**：`README_MACOS.md`（安装、Gatekeeper、issue #7 两个报错的根因说明）、`macos/build.sh`、`macos/make_icns.py`、`macos-release.yaml`。
- **`original` 分支**：保留改版前的 0.8.0c，只做能启动的最小修复（入口未调用 `TK_INIT`、`self.litem` 被覆盖、全局 `litem` 未赋值、面板被 `Basic="00000000"` 全部隐藏、gettext 找不到 `.mo`、GL 上下文未就绪即绘制、`PIL.Image` 导入成类、7 个控件只是局部变量）。

### 修改
- 右侧三块功能合并为一个**左右收起**的侧栏（`SideCollapsible`，竖条上为旋转 90° 的标题和三角），默认收起。
- **窄窗自适应**：按「侧栏 → 饼图列 → 左列」的顺序让位，中间表格保留到最后；菜单中手动关闭的列不会因变宽自动回来。
- 进度条恢复旧款式（进度条 + 文字），移到饼图下方。
- 倍数输入移到饼图上方，对账信息与提示移到饼图下方，删除「分析设置」面板。
- REDENMC 搜索固定在左下角；表格图标列加宽，不再压到名字列。

---

## 0.9.0 — 2026-08-21

| 提交 | 时间 | 说明 |
|---|---|---|
| `6b7f3ff` | 2026-08-21 13:08 | 重构 + 多格式 + 网页 3D 渲染 + 语言系统重做 |
| `bedd45a` | 2026-08-21 13:47 | `lang/data.json` 换成 0.9.0 的设置结构 |

### 修复：程序无法启动（复现确认：进程秒退）
- 入口 `threading.Thread(target=TKF).start()` 只跑了 `__init__`，从未调用 `TK_INIT()`。
- `__init__` 里 `self.litem = tk.Tk()` 被随后的 `self.litem = None` 覆盖；全局 `litem` 被引用约 30 处却从未赋值。
- `progress` / `entry_times` / `canvas1` / `analysis_debug` 等真实控件是局部变量，同名属性全是 `None`。
- `Litmatool.py` 的 `from PIL.Image import Image` 导入的是类不是模块，`load_image` 必崩。
- f-string 嵌套同类引号，在 CI 使用的 Python 3.11 上直接 SyntaxError。
- 多处 `threading.Thread(target=f())`，括号一加当场在主线程执行。

### 架构重构
- 1396 行单文件 + 全局变量，拆为 `script/lv/` 包：`config` `i18n` `model` `formats` `blockmap` `analysis` `edit` `render` `tools` `ui_*`，一个文件一件事（详见 `ARCHITECTURE.md`，含旧函数搬迁对照表）。
- **统一结构模型**：调色板 + numpy 索引数组。统计改用 `np.bincount` 对调色板折算，32×81×170 投影从几十秒降到约 0.1 秒。
- 修正旧版材料折算错误：双层台阶算 3 个（应为 2）、海龟蛋/海泡菜算 n+1、`water_cauldron` 被误折成水、空心立方体 `hollow` 参数被覆盖失效。
- 替换规则解析从 `eval()` 改为 `json.loads`（原写法等于让输入框可执行任意代码）。

### 新增：多格式支持
- 新增 `.nbt`（Java 结构方块）与 `.mcstructure`（基岩版）读写，格式依据 minecraft.wiki。基岩版为不压缩小端 NBT，索引 ZYX 序 `index = SZ*SY*X + SZ*Y + Z`，`-1` 为结构空位。
- 三种格式导入后转为同一模型，**所有功能一视同仁**，并可互相另存。内部统一用 Java 口径命名。
- `blockmap.py` 负责 Java ↔ 基岩 ID / 状态互转，转换不了的如实报告给用户。

### 新增：3D 渲染
- 移除 pyopengltk 内嵌 OpenGL，改用 JSrender 的 deepslate 渲染器，跑在**独立子进程**（pywebview + 自带 http 服务），彻底避开与 Tk 主循环冲突。渲染核心 `viewer.js` / `deepslate-helpers.js` 原样复用，只新增 `bridge.js`。

### 修改：语言系统重做
- 旧版 `.mo` 放在 `lang/en_US.mo`，gettext 只认 `<localedir>/<语言>/LC_MESSAGES/<域>.mo`，永远匹配不上，界面显示原始键名。
- 现以 `lang/source/*.json` 为唯一数据源，`i18n._mo_bytes()` 自行生成 `.po` / `.mo`（不依赖系统 gettext 工具链），JSON 比 mo 新时自动重编译；缺键回退英文；语言菜单从目录扫描。

### 修改：界面与跨平台
- 右侧三块小功能改为带小三角的可收纳面板，展开状态记忆。
- 弹窗由 easygui 换为原生 tkinter（easygui 在 macOS 装不上，见 issue #7）。
- 耗时操作放工作线程，结果经 `root.after` 回主线程。
- 图标 / 最大化 / 打开文件夹按平台分支；去掉 pyopengl、pyopengltk、easygui、tqdm、cefpython3、PyQt5 依赖。
- `LitematicaViewer.spec` 首次入库（此前被 `.gitignore` 的 `*.spec` 挡住）。

### 工程
- `tools/selftest.py` 三格式互转自检；`tools/lang_check.py` / `lang_build.py` 翻译检查与编译；`tools/shot.py` / `shot_window.py` 界面截图自检。
- GitHub Actions 改为四平台矩阵构建（windows / macos x64 / macos arm64 / linux）。

---

## 0.8.x — 2025-12-31 ~ 2026-04-21

| 提交 | 时间 | 版本 |
|---|---|---|
| `1618475` | 2025-12-31 | Beta 0.8.0a — 接入 JS 3D 渲染代码 |
| `ac31ed1` | 2026-04-20 | Beta 0.8.0b |
| `e74f2f3` | 2026-04-21 | Beta 0.8.0c（0.9.0 重构的起点，`original` 分支基于此） |
| `368876a` | 2026-04-21 | Beta 0.8.0d — RedenAPI 初步接口（`rendenmcAPI` 分支） |
| `14b3c2c` `b173400` | 2026-05-18 | README 加 Star History |

---

## 0.7.x 及更早 — 2025-04 ~ 2025-10

| 提交 | 时间 | 版本 |
|---|---|---|
| `73d0507` | 2025-10-27 | Release 0.7.8 — 英文版 + 主分析进度条 |
| `9c4fc7a` | 2025-06-14 | Release 0.7.7 |
| `dd24eeb` `c8ba71a` | 2025-05-28 | Release 0.7.6b |
| `43d3d1b` ~ `a9f9ccf` | 2025-05-21 | Release 0.7.6 |
| `74c11fc` | 2025-05-19 | Release 0.7.5c |
| `337a582` | 2025-05-18 | Release 0.7.5b |
| `445caca` ~ `af8535f` | 2025-05-15 ~ 05-18 | Release 0.7.5 — 修复步骤渲染 |
| `e451c43` | 2025-05-13 | Release 0.7.4a — 新增步骤渲染 |
| `b278887` ~ `372ad20` | 2025-05-11 ~ 05-12 | Release 0.7.3 — 更多设置项 |
| `bfc94ce` `d2f6387` | 2025-05-10 | README 中英拆分（by Timer-u, PR #13） |
| `7161152` | 2025-05-07 | Release 0.7.2 |
| `66f5c50` `eaf1265` `1a75faf` | 2025-05-03 | 补 easygui 依赖、Actions 加 pip 缓存（by Timer-u, PR #12） |
| `66c5c4a` | 2025-05-02 | Release 0.7.1 |
| `53951c7` | 2025-04-22 | Release 0.7 |
| `16ae03b` `6394d58` | 2025-04-09 ~ 04-10 | Release 0.6.7a / 0.6.7b |
| `d172aa0` `e1a05fb` | 2025-04-07 | Release 0.6.6 — UI 更新、更多主题色 |

---

## 分支说明

| 分支 | 内容 |
|---|---|
| `main` | 主线 |
| `macos` | macOS 打包脚本、图标、Release 工作流（停在 0.9.0，尚未同步后续界面改动） |
| `original` | 改版前的 0.8.0c，仅做能启动的最小修复，留作对比 |
| `rendenmcAPI` | RedenAPI 接口实验分支（0.8.0d） |
| `BA/dev/migration` | 0.7.8 时期的迁移分支 |
