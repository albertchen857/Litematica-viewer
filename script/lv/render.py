"""3D 渲染桥：把结构喂给 JSrender（deepslate WebGL），在独立子进程里开窗。

为什么要独立子进程：pywebview 和 tkinter 都要占着主线程跑各自的事件循环，
放在同一个进程里必冲突（macOS 上更是直接崩）。旧版试过在线程里起 OpenGL 窗口
和 http 服务，都会和 Tk 打架。开子进程之后两边各跑各的，关掉 3D 窗口也不影响主程序。

数据怎么过去：写一个 ``script/JSrender/payload.json``，页面用 fetch 读。
走 http 而不是 file://，一来 canvas.getImageData 读贴图图集不会被安全限制挡住，
二来 fetch 能带 cache:"no-store"，不会出现「新 payload 配旧脚本」的版本错配。
http 服务由 pywebview 自带的那个提供。
"""

import base64
import json
import os
import subprocess
import sys

import numpy as np

from .config import res
from .formats import flatten_regions
from .i18n import _

VIEWER_HTML = res("script", "JSrender", "viewer.html")
# 用 .json 而不是 .js：页面拿 fetch(cache:"no-store") 去读，彻底避开缓存。
# 之前用 <script src="payload.js"> 时，webview 的持久缓存会留着旧的 bridge.js，
# 拿它去读新格式的 payload 就会报 "Cannot read properties of undefined (reading 'length')"。
PAYLOAD_JSON = res("script", "JSrender", "payload.json")

# payload 结构变了就把这个加一。页面发现对不上会直接说清楚，而不是抛一个看不懂的 TypeError。
PAYLOAD_FORMAT = 2

# 超过这个数量就先问一下用户。deepslate 是逐面建网格的，几百万方块会卡很久。
BLOCK_WARN_LIMIT = 400_000

_processes = []


class RenderError(Exception):
    pass


def count_blocks(structure) -> int:
    return sum(int(np.count_nonzero(r.indices)) for r in structure.regions)


def build_payload(structure, title: str = None) -> dict:
    """结构 -> 给 JS 用的 dict。索引用线性下标 x*sy*sz + y*sz + z。"""
    region = flatten_regions(structure)
    size_x, size_y, size_z = region.size
    flat = region.indices.reshape(-1)
    filled = np.nonzero(flat)[0]

    counts = {}
    for index, occurrences in enumerate(region.palette_counts()):
        block = region.palette[index]
        if occurrences and not block.is_air:
            counts[block.id] = counts.get(block.id, 0) + int(occurrences)

    # 坐标和调色板下标用 base64 的 Int32Array 传，不用 JSON 数字数组。
    # 40 万方块的话，JSON 文本要好几 MB、解析还慢；二进制只有 3.2MB 且一次性解完，
    # 这是「浏览器加载超时」的主因之一。
    return {
        "format": PAYLOAD_FORMAT,
        "name": title or structure.name or "structure",
        "size": [size_x, size_y, size_z],
        "palette": [{"name": b.id, "props": b.properties} for b in region.palette],
        "count": int(len(filled)),
        # 调色板一般只有几十到几百条，16 位够用，数组直接小一半
        "state_bits": 16 if len(region.palette) < 0xFFFF else 32,
        "idx_b64": base64.b64encode(filled.astype("<i4").tobytes()).decode("ascii"),
        "state_b64": base64.b64encode(
            flat[filled].astype("<u2" if len(region.palette) < 0xFFFF else "<i4").tobytes()
        ).decode("ascii"),
        "counts": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "labels": {
            "blocks": _("render.hud.blocks"),
            "layer": _("render.hud.layer"),
            "building": _("render.hud.building"),
            "controls": _("render.hud.controls"),
            "empty": _("render.empty"),
            "stale": _("render.stale"),
        },
    }


def write_payload(structure, title: str = None) -> int:
    payload = build_payload(structure, title)
    os.makedirs(os.path.dirname(PAYLOAD_JSON), exist_ok=True)
    with open(PAYLOAD_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    return payload["count"]


def _host_command(title: str) -> list:
    """子进程命令行。打包成 exe 之后没有单独的 python 可执行文件，
    所以走「自己带 --webview-host 参数再启动一次自己」这条路。"""
    if getattr(sys, "frozen", False):
        return [sys.executable, "--webview-host", VIEWER_HTML, title]
    host = res("script", "webview_host.py")
    return [sys.executable, host, VIEWER_HTML, title]


def open_viewer(structure, title: str = None) -> int:
    """写好数据并开窗。返回渲染的方块数。"""
    if not os.path.exists(VIEWER_HTML):
        raise RenderError(f"找不到 {VIEWER_HTML}")
    count = write_payload(structure, title)
    window_title = f"{title or structure.name} - LitematicaViewer 3D"
    process = subprocess.Popen(_host_command(window_title))
    _processes.append(process)
    return count


def close_all() -> None:
    """主程序退出时把还开着的 3D 窗口一起收掉。"""
    for process in _processes:
        if process.poll() is None:
            process.terminate()
    _processes.clear()
