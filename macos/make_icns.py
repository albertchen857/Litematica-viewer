"""把 icon.ico 转成 macOS 用的 icon.icns。

    python macos/make_icns.py

macOS 上会调用系统自带的 iconutil 生成真正的 .icns。
其它系统上只会生成中间的 icon.iconset/ 目录并提示你 —— 因为 .icns 的打包
必须靠 iconutil，Windows/Linux 上没有这个工具。
没有 .icns 也能打包，只是 Dock 图标会是 PyInstaller 的默认图标。
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "icon.ico")
ICONSET = os.path.join(ROOT, "icon.iconset")
TARGET = os.path.join(ROOT, "icon.icns")

# .iconset 里的文件名是固定的，iconutil 靠名字识别尺寸
SIZES = [
    (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
]


def main() -> int:
    from PIL import Image

    if not os.path.exists(SOURCE):
        print(f"找不到 {SOURCE}")
        return 1

    source = Image.open(SOURCE)
    # .ico 里有多张尺寸，挑最大的那张当母版，放大出来才不糊
    if getattr(source, "n_frames", 1) > 1:
        best, best_area = source, 0
        for index in range(source.n_frames):
            source.seek(index)
            area = source.width * source.height
            if area > best_area:
                best, best_area = source.copy(), area
        source = best
    source = source.convert("RGBA")
    print(f"母版尺寸 {source.size}")
    if min(source.size) < 512:
        print(
            f"   注意: 母版只有 {source.width}px，放大到 512/1024 会糊。"
            f"想要清晰的 Dock 图标，换一张 1024x1024 的 icon.png 做母版。"
        )

    os.makedirs(ICONSET, exist_ok=True)
    for size, name in SIZES:
        source.resize((size, size), Image.LANCZOS).save(os.path.join(ICONSET, name))
    print(f"已生成 {ICONSET}（{len(SIZES)} 个尺寸）")

    if sys.platform != "darwin":
        print("当前不是 macOS，跳过 iconutil。到 Mac 上再跑一次本脚本即可生成 icon.icns。")
        return 0

    subprocess.run(["iconutil", "-c", "icns", ICONSET, "-o", TARGET], check=True)
    print(f"已生成 {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
