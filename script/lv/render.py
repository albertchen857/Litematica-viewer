"""3D 渲染桥：桌面版的「手动3D渲染」直接用网页版查看器（docs/viewer/），两边一套代码。

在独立子进程里用 pywebview 开窗（webview_host.py）。为什么要独立子进程：pywebview 和
tkinter 都要占着主线程跑各自的事件循环，放在同一个进程里必冲突（macOS 上更是直接崩）。

数据怎么过去：写 ``docs/viewer/payload.json``，页面用 ``#desktop`` 打开，看到这个标记
就不等用户拖文件，而是 fetch(cache:"no-store") 读这份结构。走 pywebview 自带的 http 服务
而不是 file://，canvas 读贴图图集才不会被安全限制挡住。
渲染、相机、按层显示、分步拆解、等高图这些全是网页版的功能，桌面版不再自己维护一份。
"""

import base64
import json
import os
import subprocess
import sys

import numpy as np

from .config import language, res

VIEWER_HTML = res("docs", "viewer", "index.html")
PAYLOAD_JSON = res("docs", "viewer", "payload.json")

# payload 结构变了就把这个加一，和 docs/viewer/js/formats.js 的 fromPayload 对应。
# 3：按区域分开传（多子区域的投影在网页里也能分区域看），带作者 / 简介 / 版本
PAYLOAD_FORMAT = 3

# 超过这个数量就先问一下用户。deepslate 是逐面建网格的，几百万方块会卡很久。
BLOCK_WARN_LIMIT = 400_000

_processes = []


class RenderError(Exception):
    pass


def count_blocks(structure) -> int:
    return sum(int(np.count_nonzero(r.indices)) for r in structure.regions)


def _b64(array: np.ndarray, dtype: str) -> str:
    return base64.b64encode(array.astype(dtype).tobytes()).decode("ascii")


def _entity(entity: dict, region, structure) -> dict:
    """实体坐标统一成相对区域原点。基岩版的 Pos 是世界坐标，要减掉结构原点。"""
    from .formats import MCSTRUCTURE, _entity_position

    pos = _entity_position(entity)
    if structure.source_format == MCSTRUCTURE:
        pos = [p - o for p, o in zip(pos, region.origin)]
    return {"id": str(entity.get("id", "")), "pos": [float(v) for v in pos], "nbt": entity.get("nbt") or {}}


def build_payload(structure, title: str = None) -> dict:
    """结构 -> 给网页用的 dict。

    每个区域只传非空气的格子：线性下标 x*sy*sz + y*sz + z（Int32）和对应的调色板下标。
    用 base64 的二进制而不是 JSON 数字数组：40 万方块时文本小一个数量级，解析也快得多。
    """
    regions = []
    for region in structure.regions:
        flat = np.asarray(region.indices).reshape(-1)
        filled = np.nonzero(flat)[0]
        wide = len(region.palette) >= 0xFFFF
        regions.append({
            "name": region.name,
            "origin": [int(v) for v in region.origin],
            "size": [int(v) for v in region.size],
            "palette": [{"id": b.id, "props": b.properties} for b in region.palette],
            "count": int(len(filled)),
            "state_bits": 32 if wide else 16,
            "idx_b64": _b64(filled, "<i4"),
            "state_b64": _b64(flat[filled], "<i4" if wide else "<u2"),
            # 实体：id + 相对区域原点的坐标 + 原始数据（点选时看得到展示框里的东西、矿车里的箱子）
            "entities": [_entity(e, region, structure) for e in region.entities],
            # 方块实体（箱子、漏斗、告示牌……），键是区域内坐标 "x,y,z"
            "block_entities": {",".join(str(int(v)) for v in pos): data
                               for pos, data in region.block_entities.items()},
        })
    return {
        "format": PAYLOAD_FORMAT,
        "lang": language(),
        "name": title or structure.name or "structure",
        "author": structure.author,
        "description": structure.description,
        "source": structure.source_format,
        "version": structure.version_label,
        "regions": regions,
    }


def write_payload(structure, title: str = None) -> int:
    payload = build_payload(structure, title)
    os.makedirs(os.path.dirname(PAYLOAD_JSON), exist_ok=True)
    with open(PAYLOAD_JSON, "w", encoding="utf-8") as f:
        # 方块实体 / 实体的 NBT 里偶尔有 numpy 数、字节串，default=str 兜底，别让整个 3D 窗口打不开
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), default=str)
    return sum(r["count"] for r in payload["regions"])


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
