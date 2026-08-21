"""通用控件。

最主要的是 CollapsiblePanel：右侧那几个小功能（生成投影 / 替换方块 / 导出设置）
以前是一直摊在那儿的，窗口小一点就挤没了。现在每块都带一个小三角标题栏，
点一下收起，展开状态会记进 lang/data.json，下次打开还是你上次的样子。
"""

import tkinter as tk

from customtkinter import CTkButton, CTkFrame

from .config import SAVE, colors, corner, font, save_settings

ARROW_OPEN = "▼"
ARROW_CLOSED = "▶"
ARROW_LEFT = "◀"
ARROW_RIGHT = "▶"


def _panel_states() -> dict:
    return SAVE.setdefault("collapsed", {})


class CollapsiblePanel(CTkFrame):
    """一块可以收起来的面板。内容都往 ``panel.body`` 里放。"""

    def __init__(self, master, title: str, key: str = None, expanded: bool = True, **kwargs):
        theme = colors()
        kwargs.setdefault("fg_color", theme["MC"])
        kwargs.setdefault("corner_radius", corner())
        super().__init__(master, **kwargs)

        self.key = key
        if key is not None:
            expanded = not _panel_states().get(key, not expanded)
        self._expanded = bool(expanded)

        self.header = tk.Frame(self, bg=theme["BG"], cursor="hand2")
        self.header.pack(side=tk.TOP, fill=tk.X, padx=6, pady=(6, 0))
        self.arrow = tk.Label(
            self.header,
            text=ARROW_OPEN if self._expanded else ARROW_CLOSED,
            font=font(1.2, bold=True),
            bg=theme["BG"],
            fg=theme["PC"],
            width=2,
        )
        self.arrow.pack(side=tk.LEFT, padx=(6, 2), pady=4)
        self.title_label = tk.Label(
            self.header, text=title, font=font(1.5, bold=True), bg=theme["BG"], fg=theme["TT"]
        )
        self.title_label.pack(side=tk.LEFT, padx=4, pady=4)

        for widget in (self.header, self.arrow, self.title_label):
            widget.bind("<Button-1>", lambda _event: self.toggle())

        self.body = tk.Frame(self, bg=theme["MC"])
        if self._expanded:
            self.body.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=10, pady=8)

    def toggle(self) -> None:
        self.set_expanded(not self._expanded)

    def set_expanded(self, expanded: bool) -> None:
        self._expanded = bool(expanded)
        self.arrow.config(text=ARROW_OPEN if self._expanded else ARROW_CLOSED)
        if self._expanded:
            self.body.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=10, pady=8)
        else:
            self.body.pack_forget()
        if self.key is not None:
            _panel_states()[self.key] = not self._expanded
            save_settings()

    @property
    def expanded(self) -> bool:
        return self._expanded


class SideCollapsible(tk.Frame):
    """靠右的侧栏，左右方向收起。

    收起时只剩窗口右边一条竖条（三角 + 竖排标题），点一下往左展开。
    和上面按高度收起的 CollapsiblePanel 不一样，这个不占横向空间，
    窗口拉窄的时候中间的表格能多留一点地方。内容往 ``panel.body`` 里放。
    """

    STRIP_WIDTH = 28

    def __init__(self, parent, title: str, key: str = None, expanded: bool = False,
                 width: int = 380):
        theme = colors()
        super().__init__(parent, bg=theme["BG"])
        self.theme = theme
        self.key = key
        self.body_width = width
        if key is not None:
            expanded = not _panel_states().get(key, not expanded)
        self._expanded = bool(expanded)

        self.strip = tk.Canvas(
            self, width=self.STRIP_WIDTH, bg=theme["MC"], highlightthickness=0, cursor="hand2"
        )
        self.strip.pack(side=tk.RIGHT, fill=tk.Y)
        self.strip.bind("<Button-1>", lambda _event: self.toggle())
        self.strip.bind("<Configure>", lambda _event: self._paint_strip())
        self._title = title

        self.body = tk.Frame(self, bg=theme["MC"], width=width)
        self.body.pack_propagate(False)
        if self._expanded:
            self.body.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

    def _paint_strip(self) -> None:
        """竖条上画一个三角和竖排标题。Canvas 的 angle 参数可以把文字转 90 度。"""
        self.strip.delete("all")
        height = max(self.strip.winfo_height(), 1)
        arrow = ARROW_RIGHT if self._expanded else ARROW_LEFT
        self.strip.create_text(
            self.STRIP_WIDTH / 2, 14, text=arrow, fill=self.theme["BG"], font=font(1.1, bold=True)
        )
        self.strip.create_text(
            self.STRIP_WIDTH / 2, height / 2, text=self._title, fill=self.theme["BG"],
            font=font(1.2, bold=True), angle=90,
        )

    def toggle(self) -> None:
        self.set_expanded(not self._expanded)

    def set_expanded(self, expanded: bool) -> None:
        self._expanded = bool(expanded)
        if self._expanded:
            self.body.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)
        else:
            self.body.pack_forget()
        self._paint_strip()
        if self.key is not None:
            _panel_states()[self.key] = not self._expanded
            save_settings()

    @property
    def expanded(self) -> bool:
        return self._expanded


# --------------------------------------------------------------------------- 省事的小工厂

def label(master, text: str, scale: float = 1.0, bold: bool = False, bg: str = "MC", fg: str = "TT", **kwargs):
    theme = colors()
    return tk.Label(
        master, text=text, font=font(scale, bold), bg=theme[bg], fg=theme[fg], **kwargs
    )


def entry(master, width: int = 8, **kwargs):
    theme = colors()
    return tk.Entry(
        master,
        width=width,
        bg=theme["BG"],
        fg=theme["PC"],
        insertbackground=theme["PC"],
        font=font(),
        **kwargs,
    )


def button(master, text: str, command, scale: float = 1.2, accent: bool = False, **kwargs):
    theme = colors()
    widget = CTkButton(master, text=text, command=command, font=font(scale), **kwargs)
    widget.configure(
        fg_color=theme["PC"] if accent else theme["BG"],
        text_color=theme["BG"] if accent else theme["TT"],
        hover_color=theme["MC"],
        corner_radius=corner(),
    )
    return widget


def field_row(master, text: str, row: int, widths, scale: float = 1.1) -> list:
    """一行「标签 + 若干输入框」，投影生成和方块替换那几组坐标框都用它。"""
    label(master, text, scale).grid(row=row, column=0, padx=5, pady=4, sticky="e")
    entries = []
    for column, width in enumerate(widths, start=1):
        widget = entry(master, width)
        widget.grid(row=row, column=column, padx=2, pady=4, sticky="w")
        # 每列固定同样的最小宽度，不然同一个面板里几行输入框会左右错位
        master.grid_columnconfigure(column, minsize=54)
        entries.append(widget)
    return entries
