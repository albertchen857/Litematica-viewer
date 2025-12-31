from http.server import HTTPServer, SimpleHTTPRequestHandler
import os

class JSRender:
    def __init__(self):
        self.server = HTTPServer(('localhost', 8000), self.CORSRequestHandler)
    class CORSRequestHandler(SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Access-Control-Allow-Origin', '*')
            SimpleHTTPRequestHandler.end_headers(self)
    def StartServer(self):
        parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        os.chdir(parent_dir)
        print("Serving at http://localhost:8000")
        self.server.serve_forever()
    def StopServer(self):
        self.server.shutdown()
        self.server.server_close()

if __name__=="__main__":
    JSRender().StartServer()