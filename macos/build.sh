#!/usr/bin/env bash
# 在 macOS 上一条命令打出 LitematicaViewer.app 和 .dmg
#
#     chmod +x macos/build.sh
#     ./macos/build.sh
#
# 产物在 dist/ 下。

set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-python3}"

echo "==> Python: $($PYTHON --version)"

# tkinter 不是 Python 自带的，官方 python.org 安装包里有，Homebrew 的要单独装
if ! $PYTHON -c "import tkinter" 2>/dev/null; then
  echo "!! 这个 Python 没有 tkinter。"
  echo "   Homebrew 用户: brew install python-tk"
  echo "   或者装 python.org 的官方安装包（自带 tkinter）"
  exit 1
fi

echo "==> 安装依赖"
$PYTHON -m pip install --upgrade pip
$PYTHON -m pip install -r requirements.txt
$PYTHON -m pip install pyinstaller

echo "==> 生成 .icns 图标"
$PYTHON macos/make_icns.py || echo "   图标生成失败，用默认图标继续"

echo "==> 编译语言文件"
$PYTHON tools/lang_build.py

echo "==> 自检"
$PYTHON tools/lang_check.py

echo "==> 打包"
rm -rf build dist
$PYTHON -m PyInstaller --noconfirm LitematicaViewer.spec

echo "==> 打 dmg"
cd dist
hdiutil create -volname LitematicaViewer \
  -srcfolder LitematicaViewer.app \
  -ov -format UDZO "LitematicaViewer-$(uname -m).dmg"

echo
echo "完成："
ls -lh LitematicaViewer*.dmg
echo
echo "第一次打开会被 Gatekeeper 拦（未签名），右键 → 打开，或者执行："
echo "  xattr -dr com.apple.quarantine /Applications/LitematicaViewer.app"
