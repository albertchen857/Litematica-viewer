"""开一次主程序，等界面画完截个图，用来肉眼检查布局。

    python tools/shot.py [截图输出路径] [等待秒数] [要预先分析的结构文件]

纯粹是开发时自检用的，正式功能里用不到。
"""

import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv: list) -> int:
    target = argv[0] if argv else os.path.join(ROOT, "shot.png")
    delay = float(argv[1]) if len(argv) > 1 else 6.0
    preload = argv[2] if len(argv) > 2 else ""

    command = [sys.executable, os.path.join(ROOT, "script", "LitematicaViewer.py")]
    if preload:
        command.append(preload)

    process = subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        time.sleep(delay)
        from PIL import ImageGrab

        ImageGrab.grab().save(target)
        print(f"截图: {target}")
    finally:
        process.terminate()
        try:
            output = process.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            process.kill()
            output = process.communicate()[0]
    if output and output.strip():
        print("--- 程序输出 ---")
        print(output.strip()[:3000])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
