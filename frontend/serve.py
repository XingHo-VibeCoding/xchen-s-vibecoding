# -*- coding: utf-8 -*-
"""开发用静态服务 —— 带「不许缓存」头。

用法（在 cmd 里）：

    cd /d C:\\Users\\26629\\WorkBuddy\\VibeCoding\\frontend
    python serve.py            # 默认 8010
    python serve.py 8032       # 8010 被占用时换一个

然后浏览器打开：

    http://localhost:8010/pages/topics.html

--------------------------------------------------------------------------
为什么不用 `python -m http.server`

它只发 `Last-Modified`、**不发 `Cache-Control`**。Chrome 遇到这种响应会启用
「启发式缓存」——有效期约为「距上次修改时间的 10%」。后果是：

  · 几天没动过的 HTML 被判定「还新鲜」，浏览器**根本不发请求**，直接用本地副本；
  · 刚改过的 CSS 因为「太新」早就过期，浏览器老老实实去拿新的。

于是页面变成「新样式表 + 旧结构」的混搭。Day 13 用户报「暗场在、光球不在」
就是它；Day 14 用户报「自由对话显示成绿色卡片 + 标题写着『组 undefined』」
也是它（那是 FREE 刚进 topics.json、topics.js 还没改时的中间状态被缓存了）。

本脚本给每个响应都加三个头：

    Cache-Control: no-store, no-cache, must-revalidate, max-age=0
    Pragma:  no-cache          （HTTP/1.0 时代的写法，兜底用）
    Expires: 0

`no-store` 让浏览器**不存**，`no-cache` 保证即使存了也必须每次回服务器确认。
两者叠加后，改完文件刷新就能看到，不必再按 Ctrl+Shift+R，也不必换端口。

--------------------------------------------------------------------------
两点说明

· 只绑 `127.0.0.1`：只有本机能访问，不对外开端口，也不会弹 Windows 防火墙。
  需要局域网访问时把下面的 BIND 改成 '0.0.0.0'。
· 这是**开发用**服务，不进生产。上线时由托管平台自己发缓存头。
"""

import os
import socket
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# 服务根目录 = 本文件所在目录（即 frontend/），与 README 里的启动方式一致
ROOT = os.path.dirname(os.path.abspath(__file__))

BIND = '127.0.0.1'
DEFAULT_PORT = 8010


def port_in_use(port):
    """这个端口上是否已经有人在监听。

    为什么不能只靠「绑定失败就算被占用」：**Windows 允许 `0.0.0.0:8010` 与
    `127.0.0.1:8010` 同时绑定**（地址不同就算不同端点）。于是原生
    `python -m http.server` 占着 8010 时，本脚本仍能"成功"起来 ——
    可浏览器访问的其实是旧服务，页面自然还是旧的。

    所以改成「先连一下」：连得上就说明有人在那儿。300ms 超时，
    对已占用的端口只是一次立刻关闭的连接，不会打扰对方。
    """
    s = socket.socket()
    s.settimeout(0.3)
    try:
        return s.connect_ex((BIND, port)) == 0
    finally:
        s.close()


def first_free_port(start, tries=20):
    """从 start 往后找第一个空闲端口 —— 用来给出**真的能用**的替代命令。"""
    port = start
    while port < start + tries and port_in_use(port):
        port += 1
    return port


class NoStoreHandler(SimpleHTTPRequestHandler):
    """在 `end_headers()` 这个统一出口上加缓存头。

    为什么选这里：`send_head()` 会走好几个分支（200 / 304 / 404 / 目录列表），
    每个分支最终都要调 `end_headers()`。挂在这一处，所有响应都覆盖得到，
    不用逐个分支去改。
    """

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 默认实现往 stderr 写两行（时间 + 请求），这里压成一行，便于看是哪个文件被取了
        sys.stderr.write('%s  %s\n' % (self.log_date_time_string(), fmt % args))


class Server(ThreadingHTTPServer):
    """关掉地址重用 —— 让「同一地址被占」也能抛错。

    Windows 上 `SO_REUSEADDR` 的语义与 Unix 不同：不是「重启时跳过 TIME_WAIT」，
    而是「允许绑定**已被别的进程占用**的地址」。`ThreadingHTTPServer` 默认
    `allow_reuse_address = 1`，于是 `127.0.0.1:8010` 已被占时绑定仍会"成功"。

    关掉它只能挡住所绑地址**完全相同**的情况；`0.0.0.0:8010` 那种占用它还挡不住
    （Windows 认为两者是不同端点）。所以真正的判据是 `main()` 里绑之前的
    `port_in_use()` 探测 —— 这一道只是第二层保险。

    （Day 14 实测发现并修正：原先照抄默认值，README 里写的「端口被占用时会提示换端口」
      实际上不会发生。）
    """

    allow_reuse_address = False


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print('端口要给数字，例如：  python serve.py 8032')
            return 1

    # 先探测。这一步才是真正判「端口有没有人用」的地方（理由见 port_in_use 的注释）：
    # Windows 上「绑定成功」不等于「端口归我们」，所以不能等绑完再说。
    if port_in_use(port):
        nxt = first_free_port(port + 1)
        print('端口 %d 已经有人在用 —— 可能是另一个 serve.py，' % port)
        print('也可能是以前留下的 python -m http.server（那样页面会一直是旧的）。')
        print('换一个端口：  python serve.py %d' % nxt)
        return 1

    handler = partial(NoStoreHandler, directory=ROOT)

    try:
        httpd = Server((BIND, port), handler)
    except OSError as err:
        # 兜底：探测只覆盖 127.0.0.1，且在探测与实际绑定之间还有一个极小的窗口
        print('端口 %d 起不来：%s' % (port, err))
        print('换一个端口试试：  python serve.py %d' % (port + 1))
        return 1

    print('服务目录：%s' % ROOT)
    print('入口地址：http://localhost:%d/pages/topics.html' % port)
    print('缓存头已设为 no-store —— 改完文件直接刷新即可，不用强刷。')
    print('按 Ctrl+C 停止。')

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n已停止。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
