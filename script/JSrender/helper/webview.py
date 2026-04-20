import webview
import os
import sys

class JSRender:
    def __init__(self):
        self.window = None
        # 获取index.html所在目录（假定为脚本上级目录）
        parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.html_path = os.path.join(parent_dir, 'index.html')

    def StartServer(self):
        if not os.path.exists(self.html_path):
            print(f"错误: 未找到HTML文件 {self.html_path}")
            sys.exit(1)

        self.window = webview.create_window(
            title='Litematica Viewer',  # 窗口标题
            url=f'file://{self.html_path}',  # 加载本地文件
            width=1200,
            height=800,
            # 可以在这里传递js_api对象，用于Python与JS通信
            # js_api=Api()
        )
        print(f"Serving at file://{self.html_path}")
        print("窗口已打开...")
        webview.start()  # 这会启动一个GUI事件循环，类似于 serve_forever()


    # 在pywebview中，关闭窗口通常由用户操作或调用 window.destroy() 完成
    # 可以不需要显式的 StopServer 方法

if __name__ == "__main__":
    app = JSRender()
    app.StartServer()