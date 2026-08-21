"""LitematicaViewer 入口。

具体实现都在 script/lv/ 包里，这里只做三件事：
1. 打包成单文件 exe 之后没有独立的 python 可执行文件，3D 渲染的子进程只能
   「再启动一次自己」，所以先认一下 --webview-host 参数；
2. 装好崩溃日志；
3. 初始化语言，开窗。
"""

import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _install_crash_log() -> None:
    from lv.config import user_file

    def handle(exc_type, exc_value, exc_traceback):
        text = "".join(traceback.format_exception(exc_type, exc_value, exc_traceback))
        sys.stderr.write(text)
        try:
            with open(user_file("error.log"), "w", encoding="utf-8") as f:
                f.write(text)
        except OSError:
            pass

    sys.excepthook = handle


def main(argv: list) -> int:
    # 3D 渲染子进程：打包后走 exe --webview-host，开发时直接跑 webview_host.py
    if argv and argv[0] == "--webview-host":
        from webview_host import main as host_main

        return host_main(argv[1:])

    _install_crash_log()

    from lv import i18n
    from lv.ui_main import App

    i18n.install()
    # 支持 LitematicaViewer.exe 结构文件路径（双击关联打开、拖文件到图标上都走这条）
    open_path = argv[0] if argv and os.path.isfile(argv[0]) else ""
    App(open_path).run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
