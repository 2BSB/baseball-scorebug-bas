"""本地直播叠加层服务（可选）：只监听 127.0.0.1，供 OBS 浏览器源加载。

用法：python serve_overlay.py
然后 OBS 浏览器源填 http://127.0.0.1:8765/live-overlay.html
同源后主页面与叠加层可通过 BroadcastChannel 实时同步状态与视频秒数。

不写访问日志、不收集任何数据；按 Ctrl+C 停止。
"""
import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('SCOREBUG_PORT', '8765'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass  # 本地工具不落访问日志

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
        print('本地叠加层服务已启动：http://127.0.0.1:%d/live-overlay.html' % PORT)
        print('同源主页面：http://127.0.0.1:%d/棒球计分弹幕生成器.html' % PORT)
        print('仅监听 127.0.0.1，外部设备无法访问；按 Ctrl+C 停止。')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('已停止。')
