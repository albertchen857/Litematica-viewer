"""3D 渲染窗口的子进程入口。

由 script/lv/render.py 启动，命令行是::

    python script/webview_host.py <viewer.html 路径> <窗口标题>

单独跑一个进程是有意为之：pywebview 要独占主线程，和 tkinter 的 mainloop
放一起必然打架。这里 http_server=True 让 pywebview 自己起一个本地 http 服务，
页面就有了正常的 http 源，canvas 读贴图图集才不会触发跨域安全限制。
"""

import os
import sys


def main(argv: list) -> int:
    if len(argv) < 2:
        print("用法: webview_host.py <viewer.html> [标题]")
        return 2

    html_path, title = argv[0], (argv[1] if len(argv) > 1 else "LitematicaViewer 3D")
    if not os.path.exists(html_path):
        print(f"找不到页面: {html_path}")
        return 1

    try:
        import webview
    except ImportError:
        print("没装 pywebview，3D 渲染用不了。执行: pip install pywebview")
        return 1

    webview.create_window(title, url=html_path, width=1280, height=800, background_color="#111111")
    webview.start(http_server=True, private_mode=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
