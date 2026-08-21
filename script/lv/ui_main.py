"""主窗口。

和旧版最大的区别：
* 所有控件都挂在 self 上。旧版把控件建成局部变量、又在 __init__ 里把同名属性设成
  None，结果 self.progress / self.entry_times / self.canvas1 全是 None，一点就崩。
* 耗时的活（读文件、统计）放到工作线程，结果用 root.after 回主线程再更新界面。
  旧版写的是 threading.Thread(target=f())，括号一加函数当场就在主线程执行了，
  等于线程白开。
* 右侧三块小功能改成可收纳面板（见 ui_widgets.CollapsiblePanel）。
* 3D 渲染交给独立子进程里的网页渲染器，不再在 Tk 里塞 OpenGL 画布。
"""

import os
import threading
import tkinter as tk
import traceback
import webbrowser
from tkinter import filedialog, messagebox, ttk

import matplotlib
from customtkinter import CTkComboBox, CTkEntry, CTkFrame, CTkLabel, CTkScrollableFrame

from . import analysis, config, edit, formats, i18n, render, tools
from .config import APP_VERSION, colors, corner, font
from .i18n import _
from .ui_widgets import CollapsiblePanel, button, entry, field_row, label

matplotlib.use("TkAgg")
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

# 饼图标签会出现中文，matplotlib 默认字体画不出来（一堆方框），按语言挑一个能用的
matplotlib.rcParams["font.sans-serif"] = [
    "Microsoft YaHei", "SimHei", "PingFang SC", "Noto Sans CJK SC",
    "Segoe UI", "Helvetica Neue", "Arial", "DejaVu Sans",
]
matplotlib.rcParams["axes.unicode_minus"] = False

GITHUB_URL = "https://github.com/albertchen857/LitematicaViewer"
BILIBILI_URL = "https://space.bilibili.com/3494373232741268"
REDEN_URL = "https://redenmc.com/litematica"

SAVE_FORMATS = (
    (formats.LITEMATIC, ".litematic", "Litematica"),
    (formats.JAVA_NBT, ".nbt", "Java structure"),
    (formats.MCSTRUCTURE, ".mcstructure", "Bedrock structure"),
)


class App:
    def __init__(self, open_path: str = ""):
        self.root = tk.Tk()
        self.theme = colors()

        self.structure = None  # model.Structure
        self.result = None  # analysis.Result
        self.file_path = ""
        self.busy = False

        self.do_entity = tk.IntVar(value=config.SAVE["panels"].get("entity", 1))
        self.show_func = tk.IntVar(value=config.SAVE["panels"].get("func", 1))
        self.show_stat = tk.IntVar(value=config.SAVE["panels"].get("stat", 1))
        self.show_analysis = tk.IntVar(value=config.SAVE["panels"].get("analysis", 1))
        self.auto_3d = tk.IntVar(value=config.SAVE["panels"].get("auto3d", 0))

        self._build()

        if open_path:  # 命令行带了文件（或者把文件拖到 exe 上），直接分析
            self.file_path = os.path.normpath(open_path)
            self.label_file.config(text=os.path.basename(self.file_path))
            self.root.after(120, self.start_analysis)

    # ------------------------------------------------------------------ 搭界面

    def _build(self) -> None:
        self.root.title(f'{_("litem.title")} v{APP_VERSION}')
        self.root.configure(bg=self.theme["BG"])
        config.set_icon(self.root)
        config.maximize(self.root)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._build_menu()
        self._build_topbar()
        self._build_right()
        self._build_left()
        self._build_center()

        if config.SAVE.get("First_open") == "0":
            messagebox.showinfo(_("litem.title"), _("litem.log"))
            config.SAVE["First_open"] = "1"
            config.save_settings()

        self.root.after(300, self._offer_last_file)

    def _build_menu(self) -> None:
        menu = tk.Menu(self.root)
        item_font = font()

        data_menu = tk.Menu(menu, tearoff=0)
        for key, command in (
            ("litem.menuAnalysis.1", self.import_file),
            ("litem.menuAnalysis.4", self.start_analysis),
            ("litem.menuAnalysis.2", lambda: self.export_text(False)),
            ("litem.menuAnalysis.3", lambda: self.export_text(True)),
        ):
            data_menu.add_command(label=_(key), command=command, font=item_font)
        data_menu.add_separator()
        save_menu = tk.Menu(data_menu, tearoff=0)
        data_menu.add_cascade(label=_("menu.saveas"), menu=save_menu, font=item_font)
        for fmt, extension, title in SAVE_FORMATS:
            save_menu.add_command(
                label=f"{title} ({extension})",
                command=lambda f=fmt: self.save_as(f),
                font=item_font,
            )
        menu.add_cascade(label=_("litem.menuAnalysis.title"), menu=data_menu)

        setting_menu = tk.Menu(menu, tearoff=0)
        setting_menu.add_checkbutton(label=_("litem.menuAnaSet.1"), variable=self.do_entity, font=item_font)
        setting_menu.add_separator()
        for key, variable, callback in (
            ("litem.menuAnaSet.2", self.show_func, self._layout_func),
            ("litem.menuAnaSet.3", self.show_stat, self._layout_left),
            ("litem.menuAnaSet.4", self.show_analysis, self._layout_center),
        ):
            setting_menu.add_checkbutton(
                label=_(key), variable=variable, command=callback, font=item_font
            )
        setting_menu.add_separator()
        setting_menu.add_checkbutton(label=_("litem.menu3d.1"), variable=self.auto_3d, font=item_font)
        setting_menu.add_separator()
        for key, command in (
            ("litem.menuSetting.1", self.choose_colormap),
            ("litem.menuSetting.2", self.choose_font),
            ("litem.menuSetting.3", self.choose_font_size),
        ):
            setting_menu.add_command(label=_(key), command=command, font=item_font)
        menu.add_cascade(label=_("litem.menuAnaSet.title"), menu=setting_menu)

        func_menu = tk.Menu(menu, tearoff=0)
        for version, title in edit.VERSION_CHOICES:
            func_menu.add_command(
                label=f"{_('menu.convert')} {title}",
                command=lambda v=version: self.convert_version(v),
                font=item_font,
            )
        func_menu.add_separator()
        for key, command in (
            ("litem.menuFunc.4", self.open_container),
            ("litem.menuFunc.5", self.open_3d),
            ("litem.menuFunc.6", self.open_step),
        ):
            func_menu.add_command(label=_(key), command=command, font=item_font)
        menu.add_cascade(label=_("litem.menuFunc.title"), menu=func_menu)

        help_menu = tk.Menu(menu, tearoff=0)
        for key, command in (
            ("litem.menuHelp.1", lambda: webbrowser.open(GITHUB_URL)),
            ("litem.menuHelp.2", lambda: webbrowser.open(BILIBILI_URL)),
            ("litem.menuHelp.3", self.check_update),
            ("litem.menuHelp.6", lambda: webbrowser.open(REDEN_URL)),
        ):
            help_menu.add_command(label=_(key), command=command, font=item_font)
        language_menu = tk.Menu(help_menu, tearoff=0)
        help_menu.add_cascade(label=_("litem.menuHelp.7"), menu=language_menu, font=item_font)
        for locale in i18n.available_locales():
            language_menu.add_command(
                label=i18n.display_name(locale),
                command=lambda code=locale: self.change_language(code),
                font=item_font,
            )
        menu.add_cascade(label=_("litem.menuHelp.title"), menu=help_menu)

        self.root.config(menu=menu, padx=8)

    def _build_topbar(self) -> None:
        bar = tk.Frame(self.root, bg=self.theme["BG"], bd=4)
        bar.pack(side=tk.TOP, fill=tk.X)

        for key, command in (
            ("litem.frameTop.1", self.import_file),
            ("litem.frameTop.2", self.start_analysis),
            ("litem.frameTop.3", self.open_step),
            ("litem.frameTop.4", self.open_container),
            ("litem.menuFunc.5", self.open_3d),
            ("litem.frameTop.5", lambda: messagebox.showinfo(_("litem.title"), _("litem.frameTop.hint"))),
        ):
            button(bar, _(key), command, 1.4, accent=True).pack(side=tk.LEFT, padx=4)

        for text, url, color in (
            ("GitHub", GITHUB_URL, "#24292f"),
            ("Bilibili", BILIBILI_URL, "#FF6699"),
        ):
            widget = button(bar, text, lambda u=url: webbrowser.open(u), 1.4)
            widget.configure(fg_color=color, text_color="#f8f9fa")
            widget.pack(side=tk.RIGHT, padx=4)

    # -- 右侧：可收纳的小功能 -------------------------------------------------

    def _build_right(self) -> None:
        self.func_column = CTkScrollableFrame(
            self.root, fg_color=self.theme["BG"], corner_radius=corner(), width=380
        )
        self._layout_func()

        self._build_panel_new()
        self._build_panel_replace()
        self._build_panel_output()

    def _panel(self, title_key: str, key: str) -> CollapsiblePanel:
        panel = CollapsiblePanel(self.func_column, _(title_key), key=key)
        panel.pack(side=tk.TOP, fill=tk.X, padx=6, pady=6)
        return panel

    def _build_panel_new(self) -> None:
        body = self._panel("litem.funcNew.1", "new").body

        label(body, _("litem.funcNew.2"), 1.1).grid(row=0, column=0, padx=5, pady=4, sticky="e")
        self.entry_id = entry(body, 18)
        self.entry_id.grid(row=0, column=1, columnspan=3, padx=2, pady=4, sticky="w")

        self.entry_origin = field_row(body, _("litem.funcNew.3"), 1, (5, 5, 5))
        self.entry_size = field_row(body, _("litem.funcNew.4"), 2, (5, 5, 5))

        self.cube_hollow = tk.IntVar(value=0)
        tk.Checkbutton(
            body,
            text=_("cube.hollow"),
            variable=self.cube_hollow,
            font=font(),
            bg=self.theme["MC"],
            fg=self.theme["TT"],
            selectcolor=self.theme["BG"],
            activebackground=self.theme["MC"],
        ).grid(row=3, column=0, columnspan=2, padx=5, pady=4, sticky="w")
        label(body, _("cube.thickness"), 1.0).grid(row=3, column=2, padx=2, pady=4, sticky="e")
        self.entry_thickness = entry(body, 4)
        self.entry_thickness.insert(0, "1")
        self.entry_thickness.grid(row=3, column=3, padx=2, pady=4)

        button(body, _("litem.funcNew.5"), self.spawn_cube, 1.3, accent=True).grid(
            row=4, column=0, columnspan=4, padx=2, pady=8, sticky="ew"
        )
        label(body, _("litem.funcNew.6"), 0.95, fg="TT", wraplength=320, justify="left").grid(
            row=5, column=0, columnspan=4, padx=5, pady=2, sticky="w"
        )
        body.grid_columnconfigure(3, weight=1)

    def _build_panel_replace(self) -> None:
        body = self._panel("litem.funcChange.1", "replace").body

        self.entry_min = field_row(body, _("litem.funcChange.2"), 0, (5, 5, 5))
        self.entry_max = field_row(body, _("litem.funcChange.3"), 1, (5, 5, 5))

        label(body, _("litem.funcChange.4"), 1.1).grid(row=2, column=0, padx=5, pady=4, sticky="ne")
        self.text_replace = tk.Text(
            body, width=22, height=5, bg=self.theme["BG"], fg=self.theme["PC"], font=font()
        )
        self.text_replace.grid(row=2, column=1, columnspan=3, padx=2, pady=4)

        button(body, _("litem.funcChange.5"), self.replace_blocks, 1.3, accent=True).grid(
            row=3, column=0, columnspan=4, padx=2, pady=8, sticky="ew"
        )
        label(body, _("litem.funcChange.6"), 0.95, wraplength=320, justify="left").grid(
            row=4, column=0, columnspan=4, padx=5, pady=2, sticky="w"
        )
        body.grid_columnconfigure(3, weight=1)

    def _build_panel_output(self) -> None:
        body = self._panel("litem.output.1", "output").body

        label(body, _("litem.times.1"), 1.2).grid(row=0, column=0, padx=5, pady=6, sticky="e")
        self.entry_times = entry(body, 8)
        self.entry_times.insert(0, "1")
        self.entry_times.grid(row=0, column=1, padx=5, pady=6, sticky="w")

        label(body, _("menu.saveas"), 1.0).grid(row=1, column=0, columnspan=2, padx=5, pady=(8, 2), sticky="w")
        for row, (fmt, extension, title) in enumerate(SAVE_FORMATS, start=2):
            button(body, f"{extension}   {title}", lambda f=fmt: self.save_as(f), 1.0).grid(
                row=row, column=0, columnspan=2, padx=4, pady=2, sticky="ew"
            )

        self.label_debug = label(body, _("litem.debug.1", "-"), 1.1)
        self.label_debug.grid(row=6, column=0, columnspan=2, padx=5, pady=(12, 2), sticky="w")
        label(body, _("litem.debug.2"), 0.95, wraplength=320, justify="left").grid(
            row=7, column=0, columnspan=2, padx=5, pady=2, sticky="w"
        )
        body.grid_columnconfigure(1, weight=1)

    # -- 左侧：统计 ----------------------------------------------------------

    def _build_left(self) -> None:
        self.left_column = tk.Frame(self.root, bg=self.theme["BG"])
        self._layout_left()

        stat_frame = CTkFrame(self.left_column, fg_color=self.theme["MC"], corner_radius=corner())
        stat_frame.pack(side=tk.TOP, fill=tk.X, padx=8, pady=8)
        inner = tk.Frame(stat_frame, bg=self.theme["MC"])
        inner.pack(fill=tk.BOTH, padx=14, pady=14)

        self.stat_values = {}
        rows = (
            ("red", "ui.stat.l1"), ("type", "ui.stat.l2"), ("liquid", "ui.stat.l3"),
            ("density", "ui.stat.l4"), ("author", "ui.stat.l5"), ("version", "ui.stat.l6"),
            ("desc", "ui.stat.l7"),
        )
        for row, (name, key) in enumerate(rows):
            line = CTkFrame(inner, fg_color=self.theme["PC"], corner_radius=corner())
            line.pack(fill=tk.X, side=tk.TOP, padx=4, pady=3)
            tk.Label(
                line, text=_(key), font=font(1.4, bold=True), bg=self.theme["PC"], fg=self.theme["BG"]
            ).pack(side=tk.LEFT, padx=8, pady=4)
            value = tk.Label(
                line, text="-", font=font(1.4), bg=self.theme["PC"], fg=self.theme["MC"],
                wraplength=200, justify="right",
            )
            value.pack(side=tk.RIGHT, padx=8, pady=4)
            self.stat_values[name] = value

        button(self.left_column, _("litem.menuFunc.5"), self.open_3d, 1.4, accent=True).pack(
            side=tk.TOP, fill=tk.X, padx=8, pady=4
        )

        reden = CTkFrame(self.left_column, fg_color=self.theme["MC"], corner_radius=corner())
        reden.pack(side=tk.TOP, fill=tk.X, padx=8, pady=8)
        CTkLabel(
            reden, text=_("litem.reden.title"), font=font(1.4),
            fg_color=self.theme["MC"], text_color=self.theme["BG"],
        ).pack(padx=6, pady=(8, 2))
        self.reden_entry = CTkEntry(
            reden, font=font(1.3), fg_color=self.theme["BG"], text_color=self.theme["MC"]
        )
        self.reden_entry.pack(padx=8, pady=4, fill=tk.X)
        self.reden_mode = CTkComboBox(
            reden,
            values=[_("litem.reden.select.1"), _("litem.reden.select.2"), _("litem.reden.select.3")],
            font=font(1.2), fg_color=self.theme["MC"], text_color=self.theme["BG"],
        )
        self.reden_mode.pack(padx=8, pady=4, fill=tk.X)
        button(reden, _("litem.reden.btn"), self.open_reden, 1.3, accent=True).pack(
            padx=8, pady=(4, 10), fill=tk.X
        )

    # -- 中间：标题 / 表格 / 饼图 --------------------------------------------

    def _build_center(self) -> None:
        self.center = CTkFrame(self.root, fg_color=self.theme["MC"], corner_radius=corner())
        self._layout_center()

        header = CTkFrame(self.center, fg_color=self.theme["BG"], corner_radius=corner())
        header.pack(side=tk.TOP, fill=tk.X, padx=10, pady=10)
        self.label_file = tk.Label(
            header, text=_("litem.midTop.1"), font=font(2.6, bold=True),
            bg=self.theme["BG"], fg=self.theme["TT"],
        )
        self.label_file.pack(fill=tk.X, pady=(6, 0))
        self.label_summary = tk.Label(
            header, text=_("litem.midTop.2"), font=font(1.3, bold=True),
            bg=self.theme["BG"], fg=self.theme["PC"],
        )
        self.label_summary.pack(side=tk.LEFT, padx=16, pady=6)

        self.progress = ttk.Progressbar(header, orient="horizontal", mode="determinate")
        self.progress.pack(side=tk.RIGHT, padx=16, pady=6, fill=tk.X, expand=True)

        charts = tk.Frame(self.center, bg=self.theme["MC"])
        charts.pack(side=tk.RIGHT, fill=tk.Y, padx=10, pady=10)
        self.figures, self.axes, self.canvases = [], [], []
        for title in (_("ui.chart.t1"), _("ui.chart.t2")):
            holder = CTkFrame(charts, fg_color=self.theme["BG"], corner_radius=corner())
            holder.pack(side=tk.TOP, fill=tk.BOTH, pady=6)
            figure = Figure(figsize=(3.6, 2.8), dpi=80)
            figure.patch.set_facecolor(self.theme["BG"])
            axis = figure.add_subplot(111)
            canvas = FigureCanvasTkAgg(figure, master=holder)
            canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
            self.figures.append(figure)
            self.axes.append(axis)
            self.canvases.append(canvas)
            self._clear_axis(axis, title)  # 没数据时别摆一副空坐标轴在那儿
            canvas.draw()

        table_area = tk.Frame(self.center, bg=self.theme["MC"])
        table_area.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10, pady=8)

        style = ttk.Style()
        style.configure("LV.Treeview", font=font(1.2), rowheight=26,
                        background=self.theme["PC"], fieldbackground=self.theme["PC"],
                        foreground=self.theme["BG"])
        style.configure("LV.Treeview.Heading", font=font(1.3, bold=True),
                        background=self.theme["PC"], foreground=self.theme["MC"])

        scroll = tk.Scrollbar(table_area, orient="vertical")
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        columns = ("name", "count", "unit", "id") if i18n.is_chinese() else ("name", "count", "unit")
        self.table = ttk.Treeview(
            table_area, columns=columns, yscrollcommand=scroll.set, style="LV.Treeview", height=20
        )
        scroll.config(command=self.table.yview)
        self.table.heading("name", text=_("litem.chart.1"), anchor="center")
        self.table.heading("count", text=_("litem.chart.2"), anchor="e")
        self.table.heading("unit", text=_("litem.chart.3"), anchor="w")
        self.table.column("#0", width=34, minwidth=34, stretch=False)
        self.table.column("name", width=200, anchor="w")
        self.table.column("count", width=80, anchor="e")
        self.table.column("unit", width=140, anchor="w")
        if "id" in columns:
            self.table.heading("id", text=_("litem.chart.4"), anchor="center")
            self.table.column("id", width=200, anchor="w")
        self.table.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

    # ------------------------------------------------------------------ 显隐

    def _layout_func(self) -> None:
        self._toggle(self.func_column, self.show_func, "func",
                     dict(side=tk.RIGHT, fill=tk.Y, padx=8, pady=8))

    def _layout_left(self) -> None:
        self._toggle(self.left_column, self.show_stat, "stat",
                     dict(side=tk.LEFT, fill=tk.Y, padx=8, pady=8))

    def _layout_center(self) -> None:
        self._toggle(self.center, self.show_analysis, "analysis",
                     dict(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=8, pady=8))

    def _toggle(self, widget, variable, key: str, pack_options: dict) -> None:
        if variable.get():
            widget.pack(**pack_options)
        else:
            widget.pack_forget()
        config.SAVE["panels"][key] = int(variable.get())

    # ------------------------------------------------------------------ 动作

    def import_file(self) -> bool:
        path = filedialog.askopenfilename(filetypes=formats.FILE_TYPES, title=_("litem.menuAnalysis.1"))
        if not path:
            return False
        self.file_path = os.path.normpath(path)
        self.label_file.config(text=os.path.basename(self.file_path))
        return True

    def _require_structure(self) -> bool:
        if self.structure is None:
            messagebox.showwarning(_("litem.title"), _("app.needfile"))
            return False
        return True

    def start_analysis(self) -> None:
        if self.busy:
            return
        if not self.file_path and not self.import_file():
            return
        self.busy = True
        self.progress.config(mode="indeterminate")
        self.progress.start(12)
        self.label_summary.config(text=_("app.busy"))
        # Tk 的变量和控件只能在主线程读，所以先在这里取好再丢给工作线程
        options = (bool(self.do_entity.get()), self._multiplier())
        threading.Thread(
            target=self._analysis_worker, args=(self.file_path, *options), daemon=True
        ).start()

    def _analysis_worker(self, path: str, count_entities: bool, multiplier: int) -> None:
        """在工作线程里读文件和统计，完事回主线程刷界面（Tk 不能跨线程碰控件）。"""
        try:
            structure = formats.load(path)
            result = analysis.analyse(
                structure, count_entities=count_entities, multiplier=multiplier
            )
            self.root.after(0, self._analysis_done, structure, result, path)
        except Exception as exc:
            traceback.print_exc()
            self.root.after(0, self._analysis_failed, exc)

    def _multiplier(self) -> int:
        try:
            return max(1, int(self.entry_times.get()))
        except (ValueError, AttributeError):
            return 1

    def _analysis_failed(self, exc: Exception) -> None:
        self.busy = False
        self.progress.stop()
        self.progress.config(mode="determinate", value=0)
        self.label_summary.config(text=_("litem.midTop.2"))
        messagebox.showerror(_("litem.title"), _("app.load.fail", exc))

    def _analysis_done(self, structure, result, path: str) -> None:
        self.busy = False
        self.progress.stop()
        self.progress.config(mode="determinate", maximum=100, value=100)
        self.structure = structure
        self.result = result
        self.file_path = path

        size_x, size_y, size_z = structure.size
        self.label_file.config(text=os.path.basename(path))
        self.label_summary.config(
            text=_("litem.midTop.2b", size_x, size_y, size_z, result.placed,
                   self._multiplier(), result.kinds)
        )

        self.stat_values["red"].config(text=f"{result.redstone_ratio * 100:.1f}%")
        self.stat_values["type"].config(text=result.machine_type)
        self.stat_values["liquid"].config(text=f"{result.fluid}u")
        self.stat_values["density"].config(text=f"{result.density:.1f}%")
        self.stat_values["author"].config(text=structure.author or "-")
        self.stat_values["version"].config(
            text=f"{structure.source_format} / {structure.version_label or '-'}"
        )
        self.stat_values["desc"].config(text=(structure.description or "-")[:120])

        matched = (not result.declared) or result.declared == structure.total_blocks
        self.label_debug.config(text=_("litem.debug.1", "OK" if matched else result.declared))

        self._fill_table(result)
        self._draw_charts(result)
        try:
            with open(config.user_file("log.txt"), "w", encoding="utf-8") as f:
                f.write(path)
        except OSError as exc:
            print(f"[log.txt] {exc}")

        if self.auto_3d.get():
            self.open_3d()

    def _fill_table(self, result) -> None:
        self.table.delete(*self.table.get_children())
        chinese = i18n.is_chinese()
        for block_id, count in result.sorted_blocks():
            name = block_id.split(":")[-1]
            if block_id.startswith(analysis.ENTITY_PREFIX):
                name = block_id[len(analysis.ENTITY_PREFIX):].split(":")[-1]
            values = (tools.display_name(block_id), count, tools.convert_units(count), name)
            self.table.insert(
                "", "end", image=tools.block_image(name), values=values if chinese else values[:3]
            )

    def _draw_charts(self, result) -> None:
        other_label = _("cat.other")
        self._pie(0, result.sorted_blocks(), _("ui.chart.t1"), tools.display_name, other_label)

        # 「其他」这一类不参与前五名排序，直接并进末尾的其他里，
        # 否则饼图上会出现两块都叫「其他」。
        totals = result.category_totals()
        misc = totals.pop(tools.OTHER, 0)
        ranked = sorted(totals.items(), key=lambda kv: -kv[1])
        self._pie(1, ranked, _("ui.chart.t2"), tools.category_label, other_label, extra=misc)

    def _clear_axis(self, axis, title: str) -> None:
        axis.clear()
        axis.set_axis_off()
        axis.set_title(title, fontsize=10)

    def _pie(self, index: int, pairs: list, title: str, name_of, other_label: str,
             extra: int = 0) -> None:
        axis = self.axes[index]
        self._clear_axis(axis, title)
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

    # -- 导出 ---------------------------------------------------------------

    def export_text(self, classified: bool) -> None:
        if not self._require_structure():
            return
        stem = os.path.splitext(os.path.basename(self.file_path))[0]
        path = filedialog.asksaveasfilename(
            defaultextension=".txt",
            filetypes=[("Text", "*.txt"), ("CSV", "*.csv")],
            initialfile=f"{stem}.txt",
            title=_("litem.menuAnalysis.2"),
        )
        if not path:
            return
        as_csv = os.path.splitext(path)[1].lower() == ".csv"
        with open(path, "w", encoding="utf-8-sig") as f:
            if classified:
                for category in tools.CATEGORY_ORDER:
                    items = self.result.categories.get(category)
                    if not items:
                        continue
                    f.write(f"\n{tools.category_label(category)}\n{'-' * 24}\n")
                    for count, block_id in items:
                        f.write(self._export_line(block_id, count, as_csv))
            else:
                for block_id, count in self.result.sorted_blocks():
                    f.write(self._export_line(block_id, count, as_csv))
        config.reveal(path)

    @staticmethod
    def _export_line(block_id: str, count: int, as_csv: bool) -> str:
        name = block_id.split(":")[-1]
        units = tools.convert_units(count)
        if as_csv:
            return f"{tools.display_name(block_id)},{name},{count},{units}\n"
        return f"{count}[{units}] | {tools.display_name(block_id)} [{name}]\n"

    def save_as(self, fmt: str) -> None:
        if not self._require_structure():
            return
        extension = next(e for f, e, _t in SAVE_FORMATS if f == fmt)
        title = next(t for f, _e, t in SAVE_FORMATS if f == fmt)
        stem = os.path.splitext(os.path.basename(self.file_path))[0]
        path = filedialog.asksaveasfilename(
            defaultextension=extension,
            filetypes=[(title, f"*{extension}"), ("All files", "*.*")],
            initialfile=f"{stem}{extension}",
            title=_("menu.saveas"),
        )
        if not path:
            return
        try:
            report = formats.save(self.structure, path, fmt)
        except Exception as exc:
            traceback.print_exc()
            messagebox.showerror(_("litem.title"), _("app.save.fail", exc))
            return
        message = _("app.save.done", os.path.basename(path))
        if report:
            message += "\n\n" + _("app.save.report", report.summary())
        messagebox.showinfo(_("litem.title"), message)
        config.reveal(os.path.dirname(path))

    # -- 功能 ---------------------------------------------------------------

    def spawn_cube(self) -> None:
        try:
            block_name = self.entry_id.get().strip()
            block_id = tools.translate(block_name, to_chinese=False) if block_name else "cobblestone"
            structure = edit.create_cube(
                f"minecraft:{block_id}" if ":" not in block_id else block_id,
                [v.get() or 1 for v in self.entry_size],
                [v.get() or 0 for v in self.entry_origin],
                hollow=bool(self.cube_hollow.get()),
                thickness=int(self.entry_thickness.get() or 1),
            )
        except ValueError as exc:
            messagebox.showerror(_("litem.title"), _("app.badnumber", exc))
            return
        self._save_structure_as(structure, "Cube")

    def replace_blocks(self) -> None:
        if not self._require_structure():
            return
        try:
            rules = edit.parse_rules(
                self.text_replace.get("1.0", tk.END),
                name_to_id=lambda n: tools.translate(n, to_chinese=False),
            )
        except edit.RuleError as exc:
            messagebox.showerror(_("litem.title"), _("app.replace.badrule", exc))
            return
        limits = (
            (self.entry_min[0].get(), self.entry_max[0].get()),
            (self.entry_min[1].get(), self.entry_max[1].get()),
            (self.entry_min[2].get(), self.entry_max[2].get()),
        )
        try:
            structure, replaced = edit.replace_blocks(self.structure, rules, limits)
        except ValueError as exc:
            messagebox.showerror(_("litem.title"), _("app.badnumber", exc))
            return
        if not replaced:
            messagebox.showinfo(_("litem.title"), _("app.replace.none"))
            return
        stem = os.path.splitext(os.path.basename(self.file_path))[0]
        self._save_structure_as(structure, f"{stem}_Modified", _("app.replace.done", replaced))

    def _save_structure_as(self, structure, stem: str, note: str = "") -> None:
        path = filedialog.asksaveasfilename(
            defaultextension=".litematic",
            filetypes=[("Litematica", "*.litematic"), ("Java structure", "*.nbt"),
                       ("Bedrock structure", "*.mcstructure")],
            initialfile=f"{stem}.litematic",
            title=_("menu.saveas"),
        )
        if not path:
            return
        try:
            report = formats.save(structure, path)
        except Exception as exc:
            traceback.print_exc()
            messagebox.showerror(_("litem.title"), _("app.save.fail", exc))
            return
        message = (note + "\n" if note else "") + _("app.save.done", os.path.basename(path))
        if report:
            message += "\n\n" + _("app.save.report", report.summary())
        messagebox.showinfo(_("litem.title"), message)
        config.reveal(os.path.dirname(path))

    def convert_version(self, version: int) -> None:
        path = self.file_path
        if not path:
            path = filedialog.askopenfilename(
                filetypes=[("Litematica", "*.litematic")], title=_("menu.convert")
            )
        if not path:
            return
        if formats.detect_format(path) != formats.LITEMATIC:
            messagebox.showwarning(_("litem.title"), _("app.convert.onlylitematic"))
            return
        try:
            target = edit.change_litematic_version(path, version)
        except Exception as exc:
            messagebox.showerror(_("litem.title"), _("app.save.fail", exc))
            return
        messagebox.showinfo(_("litem.title"), _("app.save.done", os.path.basename(target)))
        config.reveal(os.path.dirname(target))

    def open_3d(self) -> None:
        if not self._require_structure():
            return
        count = render.count_blocks(self.structure)
        if count > render.BLOCK_WARN_LIMIT and not messagebox.askyesno(
            _("litem.title"), _("app.render.big", count)
        ):
            return
        try:
            render.open_viewer(self.structure, os.path.basename(self.file_path))
        except Exception as exc:
            traceback.print_exc()
            messagebox.showerror(_("litem.title"), _("app.render.fail", exc))

    def open_step(self) -> None:
        if not self._require_structure():
            return
        from .ui_step import StepChecker

        StepChecker(self.root, self.structure)

    def open_container(self) -> None:
        if not self._require_structure():
            return
        from .ui_container import ContainerWindow

        ContainerWindow(self.root, self.structure)

    def open_reden(self) -> None:
        query = self.reden_entry.get().strip()
        mode = self.reden_mode.get()
        if mode == _("litem.reden.select.2") and query:
            webbrowser.open(f"https://redenmc.com/litematica/{query}")
        elif mode == _("litem.reden.select.3") and query:
            name, _sep, index = query.partition("/")
            webbrowser.open(
                f"https://redenmc.com/api/mc-services/yisibite/{name}/download/{index or 1}"
            )
        else:
            webbrowser.open(f"https://redenmc.com/litematica?q={query}")

    def check_update(self) -> None:
        import requests

        try:
            response = requests.get(
                "https://api.github.com/repos/albertchen857/LitematicaViewer/releases/latest",
                timeout=8,
            )
            response.raise_for_status()
            tag = str(response.json()["tag_name"])
        except Exception as exc:
            messagebox.showwarning(_("litem.title"), _("app.update.fail", exc))
            return
        if tag.replace("_", ".").endswith(APP_VERSION):
            messagebox.showinfo(_("litem.title"), _("func.update.ms2"))
        elif messagebox.askyesno(_("litem.title"), _("func.update.ms1", tag)):
            webbrowser.open(f"{GITHUB_URL}/releases/latest")

    # -- 设置 ---------------------------------------------------------------

    def choose_colormap(self) -> None:
        self._choose(
            _("setting.colormap") + config.UI["ColorMap"],
            list(config.DATA["Color_map"].keys()),
            lambda value: config.UI.__setitem__("ColorMap", value),
        )

    def choose_font(self) -> None:
        from tkinter import font as tkfont

        self._choose(
            _("setting.font", config.UI["Font"]),
            sorted(set(tkfont.families())),
            lambda value: config.UI.__setitem__("Font", value),
        )

    def choose_font_size(self) -> None:
        self._choose(
            _("setting.fontsize", config.UI["FontSize"]),
            [str(n) for n in range(6, 25)],
            lambda value: config.UI.__setitem__("FontSize", int(value)),
        )

    def _choose(self, prompt: str, options: list, apply) -> None:
        """一个简单的下拉选择框。旧版用的 easygui 在 macOS 上装不上，改用原生 Tk。"""
        top = tk.Toplevel(self.root)
        top.title(_("litem.menuAnaSet.title"))
        top.configure(bg=self.theme["BG"])
        top.transient(self.root)
        top.grab_set()
        tk.Label(
            top, text=prompt, font=font(1.2), bg=self.theme["BG"], fg=self.theme["TT"],
            justify="left",
        ).pack(padx=16, pady=(16, 8))

        listbox = tk.Listbox(top, width=40, height=14, font=font())
        for option in options:
            listbox.insert(tk.END, option)
        listbox.pack(padx=16, pady=8, fill=tk.BOTH, expand=True)

        def confirm() -> None:
            selection = listbox.curselection()
            if selection:
                apply(options[selection[0]])
                config.save_settings()
                top.destroy()
                messagebox.showinfo(_("litem.title"), _("func.exit"))
            else:
                top.destroy()

        button(top, "OK", confirm, 1.2, accent=True).pack(padx=16, pady=(0, 16), fill=tk.X)

    def change_language(self, locale: str) -> None:
        config.SAVE["Language"] = locale
        config.save_settings()
        messagebox.showinfo(_("litem.title"), _("setting.lang"))

    # ------------------------------------------------------------------ 生命周期

    def _offer_last_file(self) -> None:
        """上次分析过的文件还在的话，问一下要不要接着看。"""
        if self.file_path or self.busy:
            return  # 命令行已经带了文件，就别再问了
        try:
            with open(config.user_file("log.txt"), encoding="utf-8") as f:
                path = f.read().strip()
        except OSError:
            return
        if not path or not os.path.exists(path):
            return
        if messagebox.askyesno(_("litem.title"), _("litem.prev.ask") + "\n" + path):
            self.file_path = path
            self.start_analysis()

    def on_close(self) -> None:
        config.SAVE["panels"]["entity"] = int(self.do_entity.get())
        config.SAVE["panels"]["auto3d"] = int(self.auto_3d.get())
        config.save_settings()
        render.close_all()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()
