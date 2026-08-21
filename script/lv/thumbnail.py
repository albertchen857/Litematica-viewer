"""左上角那个不能操作的 3D 缩略图（内嵌 OpenGL）。

沿用旧版 LitRender 的思路：取每个方块贴图的主色，画成彩色立方体。
但有两处按旧版写法会很卡，这里换了做法：

* 旧版在**每一帧、每一个方块**都 ``Image.open()`` 读一次贴图去算主色。
  现在主色按方块 id 缓存，而且只在换结构时算一次。
* 旧版用三层 Python 循环逐个面 ``glVertex3fv``，几万次 PyOpenGL 调用一帧。
  现在加载时用 numpy 一次把所有可见面的顶点/颜色摊平成两个数组，
  每帧只要一个 ``glDrawArrays``。

平台支持：pyopengltk 的 macOS(Cocoa) 后端基本没人维护，导入就会失败
（见 issue #7），所以 macOS 上这个缩略图直接不出现，位置留空。
Windows / Linux 上正常工作。
"""

import sys
import tkinter as tk

import numpy as np
from PIL import Image

from .config import colors, font
from .i18n import _
from .tools import texture_path

# 可见面超过这个数就抽稀，再多显卡也画得动但建数组会慢
MAX_FACES = 120_000
# 表面方块超过这个数才算「大体积」，要看设置里让不让渲染
LARGE_THRESHOLD = 60_000

# 六个方向的单位立方体面：(轴, 正方向?, 四个角的偏移, 明暗)
_FACES = (
    (1, True, ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)), 1.00),   # 顶
    (1, False, ((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), 0.45),  # 底
    (0, True, ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)), 0.78),   # +X
    (0, False, ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)), 0.62),  # -X
    (2, True, ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)), 0.70),   # +Z
    (2, False, ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)), 0.55),  # -Z
)

_color_cache = {}


def available() -> bool:
    """这台机器能不能画内嵌缩略图。"""
    if sys.platform == "darwin":
        return False  # pyopengltk 的 Cocoa 后端导入即失败
    try:
        import OpenGL.GL  # noqa: F401
        import pyopengltk  # noqa: F401
    except Exception:
        return False
    return True


def block_color(block_id: str) -> tuple:
    """方块贴图的平均色（忽略透明像素），对应旧版的 CCrgb，但带缓存。"""
    if block_id not in _color_cache:
        try:
            pixels = np.asarray(
                Image.open(texture_path(block_id.split(":")[-1])).convert("RGBA"),
                dtype=np.float32,
            )
            visible = pixels[pixels[:, :, 3] > 24][:, :3]
            rgb = visible.mean(axis=0) / 255.0 if len(visible) else np.full(3, 0.5)
            _color_cache[block_id] = tuple(float(v) for v in rgb)
        except Exception:
            _color_cache[block_id] = (0.5, 0.5, 0.5)
    return _color_cache[block_id]


def build_mesh(region):
    """把区域摊成 (顶点 N×3, 颜色 N×3, 表面方块数)，N 是可见面数 × 4。

    只留「邻居是空气」的面：实心结构内部那些面画了也看不见。
    """
    indices = np.asarray(region.indices)
    solid = indices != 0
    if not solid.any():
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.float32), 0

    palette_rgb = np.array(
        [block_color(block.id) for block in region.palette], dtype=np.float32
    )
    size = np.array(indices.shape, dtype=np.float32)
    centre = size / 2.0

    vertex_chunks, colour_chunks, surface = [], [], np.zeros_like(solid)

    for axis, positive, corners, shade in _FACES:
        # 沿 axis 方向挪一格看邻居；结构边界外当空气，所以最外层的面会保留
        neighbour = np.roll(solid, -1 if positive else 1, axis=axis)
        edge = [slice(None)] * 3
        edge[axis] = -1 if positive else 0
        neighbour[tuple(edge)] = False

        visible = solid & ~neighbour
        if not visible.any():
            continue
        surface |= visible

        cells = np.argwhere(visible).astype(np.float32)          # (M, 3)
        offsets = np.array(corners, dtype=np.float32)            # (4, 3)
        quads = cells[:, None, :] + offsets[None, :, :] - centre  # (M, 4, 3)
        vertex_chunks.append(quads.reshape(-1, 3))

        ids = indices[visible]
        rgb = palette_rgb[ids] * shade                            # (M, 3)
        colour_chunks.append(np.repeat(rgb, 4, axis=0))

    if not vertex_chunks:
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.float32), 0

    vertices = np.concatenate(vertex_chunks).astype(np.float32)
    colours = np.concatenate(colour_chunks).astype(np.float32)

    if len(vertices) > MAX_FACES * 4:  # 抽稀按「面」抽，别把一个面拆散
        keep = np.arange(len(vertices) // 4)
        step = int(np.ceil(len(keep) / MAX_FACES))
        keep = keep[::step]
        picks = (keep[:, None] * 4 + np.arange(4)[None, :]).reshape(-1)
        vertices, colours = vertices[picks], colours[picks]

    return vertices, colours, int(surface.sum())


def create(parent, size: int = 250):
    """建一个缩略图控件。这台机器画不了就返回一个占位标签。"""
    if available():
        return _GLThumbnail(parent, size)
    return _Placeholder(parent, size)


class _Placeholder:
    """macOS 之类装不了 pyopengltk 的平台上，位置留个说明就好。"""

    def __init__(self, parent, size: int):
        theme = colors()
        self.widget = tk.Label(
            parent, text=_("thumb.unavailable"), font=font(),
            bg=theme["PC"], fg=theme["BG"], width=max(10, size // 10), height=max(4, size // 26),
            wraplength=size - 20, justify="center",
        )

    def set_structure(self, *_args, **_kwargs) -> None:
        pass

    def set_rotate(self, *_args) -> None:
        pass

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass


class _GLThumbnail:
    def __init__(self, parent, size: int = 250):
        from OpenGL.GL import glClearColor, glEnable, GL_DEPTH_TEST
        from pyopengltk import OpenGLFrame

        theme = colors()
        background = tuple(int(theme["PC"][i:i + 2], 16) / 255.0 for i in (1, 3, 5))
        owner = self

        class _View(OpenGLFrame):
            def initgl(self):
                glEnable(GL_DEPTH_TEST)
                glClearColor(*background, 1.0)
                owner._ready = True
                owner._apply_projection()

            def redraw(self):
                owner._paint()

        self.widget = _View(parent, width=size, height=size)
        self.size = size
        self._ready = False
        self._vertices = np.zeros((0, 3), np.float32)
        self._colours = np.zeros((0, 3), np.float32)
        self._distance = 3.0
        self._angle = 35.0
        self._rotate = True
        self._blocked = False
        self._job = None

    # -- 对外 --------------------------------------------------------------

    def set_structure(self, structure, render_large: bool = False) -> None:
        from .formats import flatten_regions

        try:
            region = flatten_regions(structure)
            vertices, colours, surface = build_mesh(region)
        except Exception as exc:
            print(f"[thumbnail] {exc}")
            return

        self._blocked = surface > LARGE_THRESHOLD and not render_large
        if self._blocked:
            self._vertices = np.zeros((0, 3), np.float32)
            self._colours = np.zeros((0, 3), np.float32)
        else:
            self._vertices, self._colours = vertices, colours
            # 相机拉到刚好装得下整个结构
            self._distance = float(max(region.size)) * 1.6 + 3.0
        self._paint()

    def set_rotate(self, rotate: bool) -> None:
        self._rotate = bool(rotate)
        self._schedule()

    def start(self) -> None:
        self._schedule()

    def stop(self) -> None:
        if self._job is not None:
            try:
                self.widget.after_cancel(self._job)
            except Exception:
                pass
            self._job = None

    # -- 内部 --------------------------------------------------------------

    def _schedule(self) -> None:
        self.stop()
        if self._rotate and not self._blocked and self.widget.winfo_exists():
            self._job = self.widget.after(120, self._tick)

    def _tick(self) -> None:
        self._angle = (self._angle + 1.5) % 360
        self._paint()
        self._schedule()

    def _apply_projection(self) -> None:
        from OpenGL.GL import glLoadIdentity, glMatrixMode, GL_MODELVIEW, GL_PROJECTION
        from OpenGL.GLU import gluPerspective

        glMatrixMode(GL_PROJECTION)
        glLoadIdentity()
        gluPerspective(45.0, 1.0, 0.1, 4000.0)
        glMatrixMode(GL_MODELVIEW)

    def _paint(self) -> None:
        """画一帧。

        旧版这里最大的毛病是：控件还没被 Tk 映射到屏幕上、GL 上下文还没建好就画，
        glClear 抛 GLError 1282，然后每次定时器都刷一遍栈。这里先确认就绪再画，
        外面再兜一层，驱动打嗝也不会刷屏。
        """
        if not self._ready or not self.widget.winfo_ismapped():
            return
        from OpenGL.GL import (
            glClear, glColorPointer, glDisableClientState, glDrawArrays,
            glEnableClientState, glLoadIdentity, glRotatef, glVertexPointer,
            GL_COLOR_ARRAY, GL_COLOR_BUFFER_BIT, GL_DEPTH_BUFFER_BIT, GL_FLOAT,
            GL_QUADS, GL_VERTEX_ARRAY,
        )
        from OpenGL.GLU import gluLookAt

        try:
            self.widget.tkMakeCurrent()
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
            glLoadIdentity()
            distance = self._distance
            gluLookAt(distance, distance * 0.75, distance, 0, 0, 0, 0, 1, 0)
            glRotatef(self._angle, 0, 1, 0)

            if len(self._vertices):
                glEnableClientState(GL_VERTEX_ARRAY)
                glEnableClientState(GL_COLOR_ARRAY)
                glVertexPointer(3, GL_FLOAT, 0, self._vertices)
                glColorPointer(3, GL_FLOAT, 0, self._colours)
                glDrawArrays(GL_QUADS, 0, len(self._vertices))
                glDisableClientState(GL_COLOR_ARRAY)
                glDisableClientState(GL_VERTEX_ARRAY)

            self.widget.tkSwapBuffers()
        except Exception as exc:
            print(f"[thumbnail] skip frame: {exc}")
