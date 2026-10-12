"""可复用的功能面板。

每个面板都能放进主窗口，也能单独开一个 Toplevel 装着（功能菜单里有入口），
所以窗口拉太小、主界面里的面板被挤掉之后，功能照样够得着。

面板本身只管画界面和收集输入，真正干活的方法都在 ui_main.App 上，
通过构造时传进来的 ``app`` 调用。
"""

import tkinter as tk
from tkinter import ttk

import matplotlib
from customtkinter import CTkComboBox, CTkEntry, CTkLabel, CTkFrame

from . import analysis, tools
from .config import colors, corner, font
from .i18n import _
from .ui_widgets import button, entry, field_row, label

matplotlib.use("TkAgg")
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

# 饼图标签会出现中文，matplotlib 默认字体画不出来（一堆方框）。
# 前四个是简中字体，中间三个是台繁字体（做逐字回退，简繁混排都不出方框）。
matplotlib.rcParams["font.sans-serif"] = [
    "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC",
    "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC",
    "Segoe UI", "Helvetica Neue", "Arial", "DejaVu Sans",
]
matplotlib.rcParams["axes.unicode_minus"] = False


class _Panel:
    """所有面板的公共部分：自己建一个 Frame，对外暴露 .frame。"""

    def __init__(self, parent, app):
        self.app = app
        self.theme = colors()
        self.frame = tk.Frame(parent, bg=self.theme["MC"])

    def pack(self, **kwargs):
        self.frame.pack(**kwargs)
        return self

    def destroy(self) -> None:
        self.frame.destroy()


# --------------------------------------------------------------------------- 生成图形投影

class CubePanel(_Panel):
    def __init__(self, parent, app):
        super().__init__(parent, app)
        body = self.frame

        label(body, _("litem.funcNew.1"), 1.5, bold=True).grid(
            row=0, column=0, columnspan=4, padx=5, pady=(6, 10)
        )
        label(body, _("litem.funcNew.2"), 1.1).grid(row=1, column=0, padx=5, pady=4, sticky="e")
        self.entry_id = entry(body, 18)
        self.entry_id.grid(row=1, column=1, columnspan=3, padx=2, pady=4, sticky="w")

        self.entry_origin = field_row(body, _("litem.funcNew.3"), 2, (5, 5, 5))
        self.entry_size = field_row(body, _("litem.funcNew.4"), 3, (5, 5, 5))

        self.hollow = tk.IntVar(value=0)
        tk.Checkbutton(
            body, text=_("cube.hollow"), variable=self.hollow, font=font(),
            bg=self.theme["MC"], fg=self.theme["TT"], selectcolor=self.theme["BG"],
            activebackground=self.theme["MC"],
        ).grid(row=4, column=0, columnspan=2, padx=5, pady=4, sticky="w")
        label(body, _("cube.thickness"), 1.0).grid(row=4, column=2, padx=2, pady=4, sticky="e")
        self.entry_thickness = entry(body, 4)
        self.entry_thickness.insert(0, "1")
        self.entry_thickness.grid(row=4, column=3, padx=2, pady=4)

        button(body, _("litem.funcNew.5"), lambda: app.spawn_cube(self), 1.3, accent=True).grid(
            row=5, column=0, columnspan=4, padx=4, pady=8, sticky="ew"
        )
        label(body, _("litem.funcNew.6"), 0.95, wraplength=300, justify="left").grid(
            row=6, column=0, columnspan=4, padx=5, pady=2, sticky="w"
        )
        body.grid_columnconfigure(3, weight=1)

    def values(self) -> dict:
        return {
            "block": self.entry_id.get().strip(),
            "size": [v.get() or 1 for v in self.entry_size],
            "origin": [v.get() or 0 for v in self.entry_origin],
            "hollow": bool(self.hollow.get()),
            "thickness": self.entry_thickness.get() or 1,
        }


# --------------------------------------------------------------------------- 替换特定方块

class ReplacePanel(_Panel):
    def __init__(self, parent, app):
        super().__init__(parent, app)
        body = self.frame

        label(body, _("litem.funcChange.1"), 1.5, bold=True).grid(
            row=0, column=0, columnspan=4, padx=5, pady=(6, 10)
        )
        self.entry_min = field_row(body, _("litem.funcChange.2"), 1, (5, 5, 5))
        self.entry_max = field_row(body, _("litem.funcChange.3"), 2, (5, 5, 5))

        label(body, _("litem.funcChange.4"), 1.1).grid(row=3, column=0, padx=5, pady=4, sticky="ne")
        self.text = tk.Text(
            body, width=22, height=5, bg=self.theme["BG"], fg=self.theme["PC"], font=font()
        )
        self.text.grid(row=3, column=1, columnspan=3, padx=2, pady=4, sticky="ew")

        button(body, _("litem.funcChange.5"), lambda: app.replace_blocks(self), 1.3,
               accent=True).grid(row=4, column=0, columnspan=4, padx=4, pady=8, sticky="ew")
        label(body, _("litem.funcChange.6"), 0.95, wraplength=300, justify="left").grid(
            row=5, column=0, columnspan=4, padx=5, pady=2, sticky="w"
        )
        body.grid_columnconfigure(3, weight=1)

    def values(self) -> dict:
        return {
            "rules": self.text.get("1.0", tk.END),
            "limits": (
                (self.entry_min[0].get(), self.entry_max[0].get()),
                (self.entry_min[1].get(), self.entry_max[1].get()),
                (self.entry_min[2].get(), self.entry_max[2].get()),
            ),
        }


# --------------------------------------------------------------------------- REDENMC 搜索

class RedenPanel(_Panel):
    def __init__(self, parent, app):
        super().__init__(parent, app)
        holder = CTkFrame(self.frame, fg_color=self.theme["MC"], corner_radius=corner())
        holder.pack(fill=tk.BOTH, expand=True)

        CTkLabel(
            holder, text=_("litem.reden.title"), font=font(1.4),
            fg_color=self.theme["MC"], text_color=self.theme["BG"],
        ).pack(padx=6, pady=(10, 4))
        self.query = CTkEntry(
            holder, font=font(1.3), fg_color=self.theme["BG"], text_color=self.theme["MC"]
        )
        self.query.pack(padx=10, pady=4, fill=tk.X)
        self.mode = CTkComboBox(
            holder,
            values=[_("litem.reden.select.1"), _("litem.reden.select.2"), _("litem.reden.select.3")],
            font=font(1.2), fg_color=self.theme["MC"], text_color=self.theme["BG"],
        )
        self.mode.pack(padx=10, pady=4, fill=tk.X)
        button(holder, _("litem.reden.btn"), lambda: app.open_reden(self), 1.3, accent=True).pack(
            padx=10, pady=(4, 12), fill=tk.X
        )

    def values(self) -> tuple:
        return self.query.get().strip(), str(self.mode.get())


# --------------------------------------------------------------------------- 信息：7 个指标

STAT_ROWS = (
    ("red", "ui.stat.l1"), ("type", "ui.stat.l2"), ("liquid", "ui.stat.l3"),
    ("density", "ui.stat.l4"), ("author", "ui.stat.l5"), ("version", "ui.stat.l6"),
    ("desc", "ui.stat.l7"),
)


class StatsPanel(_Panel):
    """左侧那 7 个指标。布局照旧：左边标题，右边数值。"""

    def __init__(self, parent, app):
        super().__init__(parent, app)
        holder = CTkFrame(self.frame, fg_color=self.theme["MC"], corner_radius=corner())
        holder.pack(fill=tk.BOTH, expand=True)
        inner = tk.Frame(holder, bg=self.theme["MC"])
        inner.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)

        self.values = {}
        for name, key in STAT_ROWS:
            line = CTkFrame(inner, fg_color=self.theme["PC"], corner_radius=corner())
            line.pack(fill=tk.X, side=tk.TOP, padx=4, pady=3)
            tk.Label(
                line, text=_(key), font=font(1.4, bold=True),
                bg=self.theme["PC"], fg=self.theme["BG"],
            ).pack(side=tk.LEFT, padx=8, pady=4)
            value = tk.Label(
                line, text="-", font=font(1.4), bg=self.theme["PC"], fg=self.theme["BG"],
                wraplength=200, justify="right",
            )
            value.pack(side=tk.RIGHT, padx=8, pady=4)
            self.values[name] = value

    def update(self, structure, result) -> None:
        if structure is None or result is None:
            return
        text = {
            "red": f"{result.redstone_ratio * 100:.1f}%",
            "type": result.machine_type,
            "liquid": f"{result.fluid}u",
            "density": f"{result.density:.1f}%",
            "author": structure.author or "-",
            "version": f"{structure.source_format} / {structure.version_label or '-'}",
            "desc": (structure.description or "-")[:120],
        }
        for name, value in text.items():
            self.values[name].config(text=value)


# --------------------------------------------------------------------------- 信息：饼图

class ChartsPanel(_Panel):
    """两张饼图。带 extras 时上面是倍数输入，下面是进度条和对账信息。

    这三样原来散在「分析设置」面板里，现在按要求并到饼图这一栏。
    """

    def __init__(self, parent, app, extras: bool = False):
        super().__init__(parent, app)
        self.extras = extras
        body = self.frame

        if extras:
            top = tk.Frame(body, bg=self.theme["MC"])
            top.pack(side=tk.TOP, fill=tk.X, padx=6, pady=(4, 6))
            label(top, _("litem.times.1"), 1.2).pack(side=tk.LEFT, padx=(4, 6))
            self.entry_times = entry(top, 8)
            self.entry_times.insert(0, "1")
            self.entry_times.pack(side=tk.LEFT)

        self.figures, self.axes, self.canvases = [], [], []
        for title in (_("ui.chart.t1"), _("ui.chart.t2")):
            holder = CTkFrame(body, fg_color=self.theme["BG"], corner_radius=corner())
            holder.pack(side=tk.TOP, fill=tk.BOTH, expand=True, pady=5)
            figure = Figure(figsize=(3.6, 2.8), dpi=80)
            figure.patch.set_facecolor(self.theme["BG"])
            axis = figure.add_subplot(111)
            canvas = FigureCanvasTkAgg(figure, master=holder)
            canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
            self.figures.append(figure)
            self.axes.append(axis)
            self.canvases.append(canvas)
            self._blank(axis, title)
            canvas.draw()

        if extras:
            # 进度条沿用旧版的样式，放在饼图下面
            bar = tk.Frame(body, bg=self.theme["MC"])
            bar.pack(side=tk.TOP, fill=tk.X, padx=6, pady=(6, 2))
            self.progress = ttk.Progressbar(
                bar, orient="horizontal", length=300, mode="determinate"
            )
            self.progress.pack(side=tk.TOP, fill=tk.X, pady=3)
            self.progress_text = tk.Label(
                bar, text=_("litem.procbar.1").format(0, 0, 0), font=font(),
                bg=self.theme["MC"], fg=self.theme["BG"],
            )
            self.progress_text.pack(side=tk.TOP, fill=tk.X)

            self.label_debug = label(body, _("litem.debug.1", "-"), 1.1, fg="BG")
            self.label_debug.pack(side=tk.TOP, padx=6, pady=(6, 0))
            label(body, _("litem.debug.2"), 0.95, fg="BG", wraplength=320,
                  justify="left").pack(side=tk.TOP, padx=6, pady=(0, 6))

    # -- 对外 --------------------------------------------------------------

    def multiplier(self) -> int:
        try:
            return max(1, int(self.entry_times.get()))
        except (ValueError, AttributeError):
            return 1

    def start_progress(self) -> None:
        if not self.extras:
            return
        self.progress.config(mode="indeterminate")
        self.progress.start(12)
        self.progress_text.config(text=_("app.busy"))

    def finish_progress(self, placed: int, seconds: float) -> None:
        if not self.extras:
            return
        self.progress.stop()
        self.progress.config(mode="determinate", maximum=max(1, placed), value=placed)
        self.progress_text.config(text=_("litem.procbar.1").format(placed, placed, seconds))

    def reset_progress(self) -> None:
        if not self.extras:
            return
        self.progress.stop()
        self.progress.config(mode="determinate", value=0)
        self.progress_text.config(text=_("litem.procbar.1").format(0, 0, 0))

    def update(self, structure, result) -> None:
        if result is None:
            return
        other = _("cat.other")
        self._pie(0, result.sorted_blocks(), _("ui.chart.t1"), tools.display_name, other)

        # 「其他」这一类不参与前五名排序，直接并进末尾，否则饼图上会出现两块「其他」
        totals = result.category_totals()
        misc = totals.pop(tools.OTHER, 0)
        ranked = sorted(totals.items(), key=lambda kv: -kv[1])
        self._pie(1, ranked, _("ui.chart.t2"), tools.category_label, other, extra=misc)

        if self.extras and structure is not None:
            matched = (not result.declared) or result.declared == structure.total_blocks
            self.label_debug.config(
                text=_("litem.debug.1", "OK" if matched else result.declared)
            )

    # -- 内部 --------------------------------------------------------------

    @staticmethod
    def _blank(axis, title: str) -> None:
        axis.clear()
        axis.set_axis_off()
        axis.set_title(title, fontsize=10)

    def _pie(self, index, pairs, title, name_of, other_label, extra: int = 0) -> None:
        axis = self.axes[index]
        self._blank(axis, title)
        top = pairs[:5]
        rest = sum(value for _key, value in pairs[5:]) + extra
        labels = [name_of(key) for key, _value in top]
        sizes = [value for _key, value in top]
        if rest > 0:
            labels.append(other_label)
            sizes.append(rest)
        if sizes:
            axis.pie(sizes, labels=labels, autopct="%1.1f%%", startangle=90,
                     textprops={"fontsize": 8})
        self.figures[index].tight_layout()
        self.canvases[index].draw()
