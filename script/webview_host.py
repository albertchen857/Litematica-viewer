"""3D 渲染窗口的子进程入口。

由 script/lv/render.py 启动，命令行是::

    python script/webview_host.py <viewer/index.html 路径> <窗口标题>
    python script/webview_host.py --search <viewer/search.html 路径> <窗口标题>   （投影搜索）

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

    search = argv[0] == "--search"
    if search:
        argv = argv[1:]
    html_path, title = argv[0], (argv[1] if len(argv) > 1 else "LitematicaViewer 3D")
    if not os.path.exists(html_path):
        print(f"找不到页面: {html_path}")
        return 1

    try:
        import webview
    except ImportError:
        print("没装 pywebview，3D 渲染用不了。执行: pip install pywebview")
        return 1

    if search:
        # 投影搜索：页面通过 js_api 调本地索引；勾选的网站、样式这些偏好也存在 Python 那边（search_prefs.json），
        # 所以照样 private_mode=True，不怕缓存住旧脚本
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from lv.search import Api

        webview.create_window(title, url=html_path, js_api=Api(), width=1280, height=860, background_color="#f8f9fa")
        webview.start(http_server=True, private_mode=True)
        return 0

    # #desktop：告诉网页版查看器「数据在 payload.json，别等用户拖文件」。
    # pywebview 算 http 服务根目录时会去掉 # 后面的部分，所以加在这里不影响找文件
    webview.create_window(title, url=html_path + "#desktop", width=1400, height=860, background_color="#f8f9fa")
    # private_mode=True：每次开窗用全新的配置目录，不留持久缓存。
    # 之前用 False（本来是想让 localStorage 存下鼠标操作偏好），结果 webview 把
    # viewer.html / bridge.js 一起缓存住了 —— 主程序写了新格式的结构数据，页面却还在
    # 跑旧脚本，报 "Cannot read properties of undefined (reading 'length')"。
    # 那点偏好 bridge.js 每次都会填默认值，丢了也没影响，不值得为它冒版本错配的风险。
    webview.start(http_server=True, private_mode=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
