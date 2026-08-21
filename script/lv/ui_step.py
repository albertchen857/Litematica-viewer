"""步骤查看器：一层一层看方块怎么摆。

数据来源从旧版的 Block_pos（一个几十万项的 list）换成了区域的索引数组，
取某一层直接 ``indices[:, y, :]`` 切片，再用 numpy 找出非空气的格子，
所以大投影翻层不会再卡住。
"""

import time
import tkinter as tk
from tkinter import messagebox

import numpy as np
from PIL import Image, ImageEnhance, ImageTk

from . import config, formats, tools
from .config import colors, font
from .i18n import _

MARGIN = 100  # 画布四周留给坐标轴的空白

FACING_SYMBOL = {
    "north": "∧", "south": "∨", "west": "<", "east": ">", "up": "7", "down": "L",
    "x": "<", "y": "7", "z": "∧",
}
HALF_SYMBOL = {"top": "∧", "upper": "∧", "bottom": "∨", "lower": "∨", "left": "<", "right": ">"}


class StepChecker:
    def __init__(self, master, structure):
        self.theme = colors()
        self.region = formats.flatten_regions(structure)
        self.size_x, self.size_y, self.size_z = self.region.size
        self.large = self.size_x > 99 or self.size_z > 99

        self.layer = 0
        self.block_side = 20
        self.images = []  # 必须留引用，否则 Tk 里的图会变空白
        self.hover_cell = None
        self.hover_images = []
        self._resize_job = None

        self.show_below = tk.IntVar(value=0 if self.large else 1)
        self.show_grid = tk.IntVar(value=0 if self.large else 1)
        self.show_props = tk.IntVar(value=0 if self.large else 1)

        self.window = tk.Toplevel(master)
        self.window.title(_("ui.ls.title"))
        self.window.configure(bg=self.theme["BG"])
        config.set_icon(self.window)
        config.maximize(self.window)

        self._build()
        self.window.after(200, self.redraw)

    def _build(self) -> None:
        bar = tk.Frame(self.window, bg=self.theme["BG"])
        bar.pack(side=tk.TOP, fill=tk.X, pady=4)

        for text, step in (("⇈", 10), ("↑", 1), ("↓", -1), ("⇊", -10)):
            tk.Button(
                bar, text=text, width=4, font=font(1.1),
                command=lambda d=step: self.change_layer(d),
            ).pack(side=tk.LEFT, padx=2)

        for key, variable in (
            ("ui.ls.label1", self.show_below),
            ("ui.ls.label2", self.show_grid),
            ("ui.ls.label3", self.show_props),
        ):
            tk.Checkbutton(
                bar, text=_(key), variable=variable, font=font(),
                bg=self.theme["BG"], fg=self.theme["TT"], selectcolor=self.theme["MC"],
                activebackground=self.theme["BG"], command=self.redraw,
            ).pack(side=tk.LEFT, padx=4)

        tk.Button(bar, text=_("ui.ls.label4"), font=font(), command=self.redraw).pack(side=tk.LEFT, padx=4)
        tk.Button(
            bar, text=_("ui.ls.label5"), font=font(),
            command=lambda: messagebox.showinfo(_("ui.ls.title"), _("ui.ls.notice")),
        ).pack(side=tk.LEFT, padx=4)

        self.label_layer = tk.Label(bar, text="Y=0", font=font(1.2, bold=True),
                                    bg=self.theme["BG"], fg=self.theme["PC"])
        self.label_layer.pack(side=tk.LEFT, padx=12)
        self.label_stat = tk.Label(bar, text="", font=font(), bg=self.theme["BG"], fg=self.theme["TT"])
        self.label_stat.pack(side=tk.LEFT, padx=8)

        self.label_block = tk.Label(
            self.window, text=_("ui.ls.label7"), font=font(1.1),
            bg=self.theme["BG"], fg=self.theme["TT"],
        )
        self.label_block.pack(side=tk.TOP, fill=tk.X, pady=2)

        self.canvas = tk.Canvas(self.window, bg=self.theme["MC"], highlightthickness=0)
        self.canvas.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.canvas.bind("<Motion>", self.on_motion)
        self.canvas.bind("<Configure>", self._on_resize)
        self.window.bind("<Prior>", lambda _event: self.change_layer(1))   # PageUp
        self.window.bind("<Next>", lambda _event: self.change_layer(-1))   # PageDown

    # ------------------------------------------------------------------ 绘制

    def _offset(self) -> tuple:
        """结构在画布上的左上角位置（居中摆放）。"""
        width = self.canvas.winfo_width()
        height = self.canvas.winfo_height()
        return (
            MARGIN + (width - 2 * MARGIN - self.size_x * self.block_side) // 2,
            MARGIN + (height - 2 * MARGIN - self.size_z * self.block_side) // 2,
        )

    def _on_resize(self, _event) -> None:
        """拖窗口时 <Configure> 会连发几十次，等它停下来再重画一次就够了。"""
        if self._resize_job is not None:
            self.window.after_cancel(self._resize_job)
        self._resize_job = self.window.after(150, self._do_resize)

    def _do_resize(self) -> None:
        self._resize_job = None
        self.redraw()

    def change_layer(self, delta: int) -> None:
        self.layer = max(0, min(self.size_y - 1, self.layer + delta))
        self.label_layer.config(text=f"Y={self.layer}")
        self.redraw()

    def redraw(self) -> None:
        started = time.time()
        width, height = self.canvas.winfo_width(), self.canvas.winfo_height()
        if width < 50 or height < 50:
            return

        span = max(self.size_x, self.size_z)
        self.block_side = max(1, int((min(width, height) - MARGIN * 2) / span))
        self.images.clear()
        self.hover_images.clear()
        self.hover_cell = None
        self.canvas.delete("all")

        self._draw_axes()
        drawn = 0
        if self.layer > 0 and self.show_below.get():
            drawn += self._draw_layer(self.layer - 1, dim=True)
        drawn += self._draw_layer(self.layer, dim=False)
        if self.show_props.get():
            self._draw_properties()
        self.label_stat.config(text=_("ui.ls.render", drawn, time.time() - started))

    def _draw_axes(self) -> None:
        accent = self.theme["PC"]
        left, top = self._offset()
        # 坐标轴贴着结构本身画，不是贴着窗口边，不然结构居中之后轴和刻度会错开
        axis_x, axis_y = left - 26, top - 26
        right = left + self.size_x * self.block_side
        bottom = top + self.size_z * self.block_side

        self.canvas.create_line(axis_x, axis_y, right + 20, axis_y, fill=accent, arrow="last", width=3)
        self.canvas.create_line(axis_x, axis_y, axis_x, bottom + 20, fill=accent, arrow="last", width=3)
        self.canvas.create_text(axis_x, axis_y - 10, text="X", fill=accent, anchor=tk.SE, font=font(1.4, bold=True))
        self.canvas.create_text(axis_x - 10, axis_y, text="Z", fill=accent, anchor=tk.NE, font=font(1.4, bold=True))

        # 格子太多就只标关键刻度，不然线糊成一片还特别慢
        step = 1
        for limit, value in ((500, 100), (100, 20), (50, 5)):
            if max(self.size_x, self.size_z) > limit:
                step = value
                break
        grid = bool(self.show_grid.get())
        tick_font = font(max(0.6, min(1.0, self.block_side / 20)))

        for i in range(0, self.size_x + 1, step):
            x = left + i * self.block_side
            self.canvas.create_line(x, axis_y, x, bottom if grid else top, fill=accent, width=1)
            self.canvas.create_text(x, axis_y - 8, text=str(i), fill=accent, font=tick_font, anchor=tk.S)
        for j in range(0, self.size_z + 1, step):
            y = top + j * self.block_side
            self.canvas.create_line(axis_x, y, right if grid else left, y, fill=accent, width=1)
            self.canvas.create_text(axis_x - 6, y, text=str(j), fill=accent, font=tick_font, anchor=tk.E)

    def _draw_layer(self, layer: int, dim: bool) -> int:
        """把一层拼成一张大图再贴上去，比一个方块一次 create_image 快得多。"""
        plane = np.asarray(self.region.indices[:, layer, :])
        cells = np.nonzero(plane)
        if not len(cells[0]):
            return 0

        side = self.block_side
        canvas_image = Image.new("RGBA", (side * self.size_x, side * self.size_z), (0, 0, 0, 0))
        cache = {}
        for x, z in zip(*cells):
            index = int(plane[x, z])
            tile = cache.get(index)
            if tile is None:
                block = self.region.palette[index]
                tile = Image.open(tools.texture_path(block.name)).convert("RGBA")
                tile = tile.resize((side, side), Image.NEAREST)
                if dim:  # 下面一层压暗压透，用来对位
                    tile = ImageEnhance.Brightness(tile).enhance(0.6)
                    tile.putalpha(tile.getchannel("A").point(lambda a: min(a, 90)))
                cache[index] = tile
            canvas_image.paste(tile, (int(x) * side, int(z) * side), tile)

        photo = ImageTk.PhotoImage(canvas_image)
        self.images.append(photo)
        left, top = self._offset()
        self.canvas.create_image(left, top, anchor=tk.NW, image=photo)
        return len(cells[0])

    def _draw_properties(self) -> None:
        """右上角绿字标朝向，右下角黄字标上下半，左上角圆点标含水。"""
        side = self.block_side
        if side < 10:  # 太小了画了也看不清
            return
        left, top = self._offset()
        plane = np.asarray(self.region.indices[:, self.layer, :])
        symbol_font = font(max(0.6, side / 28), bold=True)

        for x, z in zip(*np.nonzero(plane)):
            props = self.region.palette[int(plane[x, z])].properties
            if not props:
                continue
            px, py = left + int(x) * side, top + int(z) * side
            facing = FACING_SYMBOL.get(props.get("facing") or props.get("axis", ""), "")
            half = HALF_SYMBOL.get(props.get("half") or props.get("type", ""), "")

            if "waterlogged" in props:
                fill = "#0680FA" if props["waterlogged"] == "true" else "#8a8a8a"
                self.canvas.create_oval(px + side * 0.08, py + side * 0.08,
                                        px + side * 0.3, py + side * 0.3, fill=fill, outline="")
            if facing:
                self.canvas.create_text(px + side, py, text=facing, fill="#39FF14",
                                        font=symbol_font, anchor="ne")
            if half:
                self.canvas.create_text(px + side, py + side, text=half, fill="#FFE000",
                                        font=symbol_font, anchor="se")

    # ------------------------------------------------------------------ 鼠标

    def on_motion(self, event) -> None:
        left, top = self._offset()
        x = (event.x - left) // max(1, self.block_side)
        z = (event.y - top) // max(1, self.block_side)
        if not (0 <= x < self.size_x and 0 <= z < self.size_z) or (x, z) == self.hover_cell:
            return
        self.hover_cell = (x, z)

        block = self.region.block_at(int(x), self.layer, int(z))
        if block.is_air:
            self.label_block.config(text=_("ui.ls.label7"))
            return
        props = block.properties
        self.label_block.config(
            text=_(
                "ui.ls.palette",
                tools.display_name(block.id),
                (int(x), self.layer, int(z)),
                props.get("facing") or props.get("axis", "N/A"),
                props.get("powered", "N/A"),
                props.get("half") or props.get("type", "N/A"),
                props.get("waterlogged", "N/A"),
                props or "-",
            )
        )

        self.canvas.delete("hover")
        self.hover_images.clear()
        px, py = left + int(x) * self.block_side, top + int(z) * self.block_side
        self.canvas.create_rectangle(
            px, py, px + self.block_side, py + self.block_side,
            outline="#FFFFFF", width=2, tags="hover",
        )
        preview = Image.open(tools.texture_path(block.name)).convert("RGBA")
        preview = preview.resize((MARGIN - 40, MARGIN - 40), Image.NEAREST)
        photo = ImageTk.PhotoImage(preview)
        self.hover_images.append(photo)
        self.canvas.create_image(20, 20, anchor=tk.NW, image=photo, tags="hover")
