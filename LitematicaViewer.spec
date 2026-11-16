# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置。

    pyinstaller LitematicaViewer.spec

三个平台共用这一份。图标在 macOS 上要 .icns，没有的话 PyInstaller 会忽略 .ico，
不影响打包结果。
"""

import os
import sys

IS_MAC = sys.platform == "darwin"

# macOS 的 Dock 图标要 .icns，用 macos/make_icns.py 从 icon.ico 生成；
# 没生成也能打包，只是图标会是 PyInstaller 的默认图标。
ICON = "icon.icns" if IS_MAC and os.path.exists("icon.icns") else "icon.ico"

# 版本号只在 script/lv/config.py 写一处，这里读出来给 macOS 的 Info.plist 用
import re as _re
with open("script/lv/config.py", encoding="utf-8") as _f:
    APP_VERSION = _re.search(r'APP_VERSION = "([^"]+)"', _f.read()).group(1)

# 资源要按运行时 res() 期望的相对路径放，路径变了程序就找不到贴图和语言文件
datas = [
    ("lang/*.json", "lang"),
    ("lang/source/*.json", "lang/source"),
    ("icon.ico", "."),
    ("tm_icon.ico", "."),
    ("requirements.txt", "."),
    # 网页版查看器：「手动3D渲染」直接用它；方块图标也从它的贴图图集里裁
    ("viewer/index.html", "viewer"),
    ("viewer/viewer.css", "viewer"),
    ("viewer/js/*.js", "viewer/js"),
    ("viewer/js/tools/*.js", "viewer/js/tools"),
    ("viewer/vendor/*.js", "viewer/vendor"),  # deepslate / gl-matrix，离线也能渲染
    ("viewer/data/*.json", "viewer/data"),
    ("viewer/resource/*", "viewer/resource"),
]

# 预编译好的 .mo 一起带上，避免打包后还得现场编译（有些系统临时目录是只读的）。
# 语言列表直接扫 lang/source，加新语言时这里不用再改。
source_dir = os.path.join("lang", "source")
for name in sorted(os.listdir(source_dir)):
    if not name.endswith(".json"):
        continue
    folder = os.path.join("lang", name[:-5], "LC_MESSAGES")
    if os.path.isdir(folder):
        datas.append((os.path.join(folder, "*.mo"), folder.replace("\\", "/")))

a = Analysis(
    ["script/LitematicaViewer.py"],
    pathex=["script"],
    binaries=[],
    datas=datas,
    hiddenimports=[
        "webview_host",     # 3D 子进程入口，只在函数里 import，静态分析会漏
        "lv.ui_step",
        "lv.ui_container",
        "webview",
        "litemapy",
        "nbtlib",
        "amulet_nbt",
        "customtkinter",
        "matplotlib.backends.backend_tkagg",
        "OpenGL.GL",          # 内嵌 3D 缩略图，非 macOS
        "OpenGL.GLU",
        "pyopengltk",
        "lv.ui_panels",
        "lv.thumbnail",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["PyQt5", "PySide2", "PySide6", "tkinter.test", "test"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="LitematicaViewer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    icon=ICON,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=IS_MAC,  # macOS 上把「用本程序打开」的文件转成 argv
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="LitematicaViewer",
)

if IS_MAC:
    app = BUNDLE(
        coll,
        name="LitematicaViewer.app",
        icon=ICON,
        bundle_identifier="com.albertchen857.litematicaviewer",
        info_plist={
            "CFBundleShortVersionString": APP_VERSION,
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "CFBundleDocumentTypes": [
                {
                    "CFBundleTypeName": "Minecraft structure",
                    "CFBundleTypeRole": "Viewer",
                    "LSItemContentTypes": ["public.data"],
                    "CFBundleTypeExtensions": ["litematic", "nbt", "mcstructure"],
                }
            ],
        },
    )
