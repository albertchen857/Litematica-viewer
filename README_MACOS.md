[简体中文](./README.md) | [English](./README_EN.md) | **macOS**

# LitematicaViewer on macOS

这个分支放 macOS 相关的打包和文档。代码本身和 `main` 一致 —— 0.9.0 已经把
平台相关的东西都处理掉了，不需要单独维护一份 macOS 代码。

## 直接用

到 [Releases](https://github.com/albertchen857/LitematicaViewer/releases) 下载
`LitematicaViewer-arm64.dmg`（Apple Silicon）或 `LitematicaViewer-x64.dmg`（Intel），
拖进「应用程序」。

**第一次打开会被拦住**，因为这个 app 没有花钱买 Apple 开发者证书签名。两种办法：

- 在「应用程序」里**右键 → 打开**，弹窗里再点一次「打开」；或者
- 终端里执行 `xattr -dr com.apple.quarantine /Applications/LitematicaViewer.app`

## 自己编译

```bash
git clone https://github.com/albertchen857/LitematicaViewer.git
cd LitematicaViewer
git checkout macos
chmod +x macos/build.sh
./macos/build.sh
```

产物在 `dist/`。

不想打包、只想跑源码：

```bash
pip3 install -r requirements.txt
python3 script/LitematicaViewer.py
```

## 关于 issue #7 报的两个错

[#7](https://github.com/albertchen857/LitematicaViewer/issues/7) 里 Python 3.12 / macOS 15.3.2
遇到的两个报错，0.9.0 都从根上解决了：

### `ModuleNotFoundError: No module named 'easygui'`

easygui 是个已经好几年没更新的库，在新版 Python 上装不上。它在旧版里只用来弹
几个对话框（选主题色、选字体、确认框）。

**0.9.0 把 easygui 整个去掉了**，对话框换成 Python 自带的 `tkinter.messagebox`
和一个自己写的列表选择窗口。少一个依赖，也少一个装不上的坑。

### `ImportError: cannot import name 'OpenGLFrame' from partially initialized module 'pyopengltk'`

pyopengltk 靠平台相关的后端把 OpenGL 上下文塞进 Tk 画布里，它的 macOS(Cocoa)
分支基本没人维护，导入时就会挂。旧版的 3D 渲染和左侧那个小预览框都依赖它。

**0.9.0 把 pyopengltk 和 pyopengl 一起去掉了**，3D 渲染改成用
[deepslate](https://github.com/misode/deepslate) 的 WebGL 渲染器，在一个独立子进程的
pywebview 窗口里跑。副作用是渲染效果反而更好了 —— 之前是「取贴图主色画个纯色方块」，
现在是真的按方块模型和贴图渲染。

## macOS 上还需要注意的

**tkinter 不是 Python 自带的。** 如果 `python3 -c "import tkinter"` 报错：

```bash
brew install python-tk          # Homebrew 的 Python
# 或者直接装 python.org 的官方安装包，自带 tkinter
```

**pywebview 用的是系统的 WKWebView**，不用额外装浏览器。但 3D 渲染第一次运行需要联网，
因为 deepslate 和 gl-matrix 是从 unpkg CDN 拉的。想离线用就把这两个库下到
`script/JSrender/resource/`，再改 `script/JSrender/viewer.html` 里的两个 `<script src>`。

**文件关联**：`.app` 的 Info.plist 里声明了 `.litematic` / `.nbt` / `.mcstructure`，
所以可以直接双击结构文件打开，也可以把文件拖到 Dock 图标上。
（`argv_emulation` 只在 macOS 打包时开启，见 `LitematicaViewer.spec`。）

## 代码里的平台分支

0.9.0 之前有几处写死了 Windows API，在 Mac 上必崩。现在都封装在
`script/lv/config.py` 里：

| 函数 | 干什么 | macOS 上走哪条 |
|---|---|---|
| `set_icon(window)` | 设窗口图标 | `iconbitmap(.ico)` 是 Windows 专有，Mac 上用 PIL 转 PNG 走 `iconphoto` |
| `maximize(window)` | 最大化 | `state("zoomed")` 和 `-zoomed` 在 Mac 上都无效，改成按屏幕尺寸设 geometry |
| `reveal(path)` | 打开文件/文件夹 | `os.startfile` 只有 Windows 有，Mac 上用 `open` |
| `user_file(name)` | 日志写哪 | 打包后写在 app 旁边，不写只读的 `_MEIPASS` |
