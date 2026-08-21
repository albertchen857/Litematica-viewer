"""单独开某个子窗口截图检查（步骤查看器 / 容器分析器）。

    python tools/shot_window.py step      testdata/iron_farm.litematic out.png
    python tools/shot_window.py container testdata/iron_farm.litematic out.png

开发自检用，正式功能里用不到。
"""

import os
import sys
import tkinter as tk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import formats, i18n  # noqa: E402


def main(argv: list) -> int:
    kind = argv[0] if argv else "step"
    path = argv[1] if len(argv) > 1 else os.path.join(ROOT, "testdata", "iron_farm.litematic")
    target = argv[2] if len(argv) > 2 else os.path.join(ROOT, "shot.png")
    layer = int(argv[3]) if len(argv) > 3 else 5

    i18n.install()
    structure = formats.load(path)

    root = tk.Tk()
    root.withdraw()

    if kind == "step":
        from lv.ui_step import StepChecker

        window = StepChecker(root, structure)
        window.layer = layer
        window.label_layer.config(text=f"Y={layer}")
        target_window = window.window
    else:
        from lv.ui_container import ContainerWindow

        target_window = ContainerWindow(root, structure).window

    def capture() -> None:
        from PIL import ImageGrab

        ImageGrab.grab().save(target)
        print(f"截图: {target}")
        root.destroy()

    target_window.after(2500, capture)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
