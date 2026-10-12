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

# 资源要按运行时 res() 期望的相对路径放，路径变了程序就找不到贴图和语言文件
datas = [
    ("block/*.png", "block"),
    ("item/*.png", "item"),
    ("lang/*.json", "lang"),
    ("lang/source/*.json", "lang/source"),
    ("icon.ico", "."),
    ("tm_icon.ico", "."),
    ("requirements.txt", "."),
    # 3D 渲染用的网页（deepslate + 贴图图集），少一个都渲染不出来
    ("script/JSrender/viewer.html", "script/JSrender"),
    ("script/JSrender/src/*.js", "script/JSrender/src"),
    ("script/JSrender/resource/*", "script/JSrender/resource"),
]

# 预编译好的 .mo 一起带上，避免打包后还得现场编译（有些系统临时目录是只读的）
for locale in ("zh_CN", "en_US"):
    folder = os.path.join("lang", locale, "LC_MESSAGES")
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
            "CFBundleShortVersionString": "0.9.2",
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
