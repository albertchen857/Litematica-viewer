"""主窗口。

布局（从外往里 pack）::

    ┌────────────────────────────────────────────────────────────┐
    │ 菜单 / 顶栏                                                 │
    ├──────────┬─────────────────────────┬──────────┬──┤
    │ 左列     │ 中间：文件名 + 材料表格   │ 饼图列    │侧│
    │ 3D缩略图 │                         │ 倍数输入  │栏│
    │ 7个指标  │                         │ 饼图×2    │◀ │
    │ 手动3D   │                         │ 进度条    │  │
    │ REDENMC  │                         │ 对账/提示 │  │
    └──────────┴─────────────────────────┴──────────┴──┘

窗口拉窄时按「侧栏 → 饼图列 → 左列」的顺序让位，中间的表格留到最后。

四块功能面板（生成投影 / 替换方块 / REDENMC / 信息显示）都能单独开窗口，
入口在功能菜单里，所以窗口再小也不会点不到。面板代码在 ui_panels.py，
主窗口和独立窗口共用同一份。
"""

import os
import threading
import time
import tkinter as tk
import traceback
import webbrowser
from tkinter import filedialog, messagebox, ttk

from customtkinter import CTkFrame, CTkScrollableFrame

from . import analysis, config, edit, formats, i18n, render, snapshot, thumbnail, tools
from .config import APP_VERSION, colors, corner, font
from .i18n import _
from .ui_panels import ChartsPanel, CubePanel, RedenPanel, ReplacePanel, StatsPanel
from .ui_widgets import BlockPicker, SideCollapsible, button

GITHUB_URL = "https://github.com/albertchen857/LitematicaViewer"
BILIBILI_URL = "https://space.bilibili.com/3494373232741268"
REDEN_URL = "https://redenmc.com/litematica"

SAVE_FORMATS = (
    (formats.LITEMATIC, ".litematic", "Litematica"),
    (formats.JAVA_NBT, ".nbt", "Java structure"),
    (formats.MCSTRUCTURE, ".mcstructure", "Bedrock structure"),
)

# 窗口窄到这个宽度以下就把对应的一列收掉，优先保住中间的表格
WIDTH_FOR_SIDE = 1250
WIDTH_FOR_CHARTS = 1000
WIDTH_FOR_LEFT = 720


class App:
    def __init__(self, open_path: str = ""):
        self.root = tk.Tk()
        self.theme = colors()

        self.structure = None
        self.result = None
        self.file_path = ""
        self.busy = False
        self.ignored = set()   # 右键「忽略」掉的条目，只影响显示
        self.row_ids = {}      # Treeview 行 -> 条目 id，右键菜单要用

        panels = config.SAVE["panels"]
        self.do_entity = tk.IntVar(value=panels.get("entity", 1))
        self.show_side = tk.IntVar(value=panels.get("func", 1))
        self.show_left = tk.IntVar(value=panels.get("stat", 1))
        self.show_charts = tk.IntVar(value=panels.get("analysis", 1))
        self.thumb_rotate = tk.IntVar(value=panels.get("thumb_rotate", 1))
        self.thumb_large = tk.IntVar(value=panels.get("thumb_large", 0))

        # 独立窗口里的信息面板也要跟着刷新，所以统一登记在这两个表里
        self.stats_panels = []
        self.charts_panels = []
        self._layout_job = None

        self._build()

        if open_path:
            self.file_path = os.path.normpath(open_path)
            self.label_file.config(text=os.path.basename(self.file_path))
            self.root.after(150, self.start_analysis)

    # ------------------------------------------------------------------ 搭界面

    def _build(self) -> None:
        self.root.title(f'{_("litem.title")} v{APP_VERSION}')
        self.root.configure(bg=self.theme["BG"])
        config.set_icon(self.root)
        config.maximize(self.root)
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)

        self._build_menu()
        self._build_topbar()
        # pack 顺序决定谁先占地方：侧栏最右，左列最左，饼图列贴着中间的右边
        self._build_side()
        self._build_left()
        self._build_charts()
        self._build_center()

        self.root.bind("<Configure>", self._on_resize)
        self._apply_layout()

        if config.SAVE.get("First_open") == "0":
            messagebox.showinfo(_("litem.title"), _("litem.log"))
            config.SAVE["First_open"] = "1"
            config.save_settings()

        # 刚打开先摆个工作台在缩略图里，不然左上角是空的
        self.root.after(400, self._show_default_thumbnail)
        self.root.after(800, self._offer_last_file)

    def _build_menu(self) -> None:
        menu = tk.Menu(self.root)
        item_font = font()

        data_menu = tk.Menu(menu, tearoff=0)
        for key, command in (
            ("litem.menuAnalysis.1", self.import_file),
            ("litem.menuAnalysis.4", self.start_analysis),
            ("litem.menuAnalysis.2", lambda: self.export_text(False)),
            ("litem.menuAnalysis.3", lambda: self.export_text(True)),
            ("menu.snapshot", self.save_snapshot),
        ):
            data_menu.add_command(label=_(key), command=command, font=item_font)
        data_menu.add_separator()
        save_menu = tk.Menu(data_menu, tearoff=0)
        data_menu.add_cascade(label=_("menu.saveas"), menu=save_menu, font=item_font)
        for fmt, extension, title in SAVE_FORMATS:
            save_menu.add_command(
                label=f"{title} ({extension})", command=lambda f=fmt: self.save_as(f), font=item_font
            )
        menu.add_cascade(label=_("litem.menuAnalysis.title"), menu=data_menu)

        setting_menu = tk.Menu(menu, tearoff=0)
        setting_menu.add_checkbutton(label=_("litem.menuAnaSet.1"), variable=self.do_entity, font=item_font)
        setting_menu.add_separator()
        for key, variable in (
            ("litem.menuAnaSet.2", self.show_side),
            ("litem.menuAnaSet.3", self.show_left),
            ("litem.menuAnaSet.4", self.show_charts),
        ):
            setting_menu.add_checkbutton(
                label=_(key), variable=variable, command=self._apply_layout, font=item_font
            )
        setting_menu.add_separator()
        setting_menu.add_checkbutton(
            label=_("thumb.rotate"), variable=self.thumb_rotate,
            command=lambda: self.thumb.set_rotate(bool(self.thumb_rotate.get())), font=item_font,
        )
        setting_menu.add_checkbutton(
            label=_("thumb.large"), variable=self.thumb_large,
            command=self._refresh_thumbnail, font=item_font,
        )
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
                command=lambda v=version: self.convert_version(v), font=item_font,
            )
        func_menu.add_separator()
        for key, command in (
            ("litem.menuFunc.4", self.open_container),
            ("litem.menuFunc.5", self.open_3d),
            ("litem.menuFunc.6", self.open_step),
        ):
            func_menu.add_command(label=_(key), command=command, font=item_font)
        func_menu.add_separator()
        # 四块面板的独立窗口入口。窗口拉太小时主界面里的面板会被收掉，从这里照样打得开。
        for key, kind in (
            ("litem.funcNew.1", "cube"),
            ("litem.funcChange.1", "replace"),
            ("litem.reden.title", "reden"),
            ("menu.window.info", "info"),
        ):
            func_menu.add_command(
                label=f'{_(key)}  ({_("menu.window.suffix")})',
                command=lambda k=kind: self.open_panel_window(k), font=item_font,
            )
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
                command=lambda code=locale: self.change_language(code), font=item_font,
            )
        menu.add_cascade(label=_("litem.menuHelp.title"), menu=help_menu)

        self.root.config(menu=menu, padx=8)

    def _build_topbar(self) -> None:
        bar = tk.Frame(self.root, bg=self.theme["BG"], bd=4)
        bar.pack(side=tk.TOP, fill=tk.X)
        for key, command in (
            ("litem.frameTop.1", self.import_file),
            ("menu.analyse", self.start_analysis),
            ("litem.frameTop.3", self.open_step),
            ("litem.frameTop.4", self.open_container),
            ("litem.menuFunc.5", self.open_3d),
            ("menu.snapshot", self.save_snapshot),
            ("litem.frameTop.5", lambda: messagebox.showinfo(_("litem.title"), _("litem.frameTop.hint"))),
        ):
            button(bar, _(key), command, 1.4, accent=True).pack(side=tk.LEFT, padx=4)

        for text, url, colour in (("GitHub", GITHUB_URL, "#24292f"), ("Bilibili", BILIBILI_URL, "#FF6699")):
            widget = button(bar, text, lambda u=url: webbrowser.open(u), 1.4)
            widget.configure(fg_color=colour, text_color="#f8f9fa")
            widget.pack(side=tk.RIGHT, padx=4)

    def _build_side(self) -> None:
        """右边那条侧栏：生成投影 + 替换方块，左右方向收起，默认收起。"""
        # key=None：不记住展开状态，每次打开程序都是收起的。
        # 这块占地方又不是常用功能，默认让位给中间的表格。
        self.side = SideCollapsible(
            self.root, _("side.tools"), key=None, expanded=False, width=390
        )
        scroller = CTkScrollableFrame(
            self.side.body, fg_color=self.theme["MC"], corner_radius=corner()
        )
        scroller.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
        self.panel_cube = CubePanel(scroller, self).pack(fill=tk.X, padx=6, pady=(6, 14))
        ttk.Separator(scroller, orient="horizontal").pack(fill=tk.X, padx=10, pady=4)
        self.panel_replace = ReplacePanel(scroller, self).pack(fill=tk.X, padx=6, pady=(14, 6))

    def _build_left(self) -> None:
        self.left = tk.Frame(self.root, bg=self.theme["BG"])

        holder = CTkFrame(self.left, fg_color=self.theme["PC"], corner_radius=corner())
        holder.pack(side=tk.TOP, fill=tk.X, padx=8, pady=8)
        self.thumb = thumbnail.create(holder, 250)
        self.thumb.widget.pack(padx=10, pady=10)

        stats = StatsPanel(self.left, self)
        stats.pack(side=tk.TOP, fill=tk.X, padx=8, pady=4)
        self.stats_panels.append(stats)

        button(self.left, _("litem.menuFunc.5"), self.open_3d, 1.4, accent=True).pack(
            side=tk.TOP, fill=tk.X, padx=8, pady=4
        )
        # REDENMC 搜索钉在左下角
        RedenPanel(self.left, self).pack(side=tk.BOTTOM, fill=tk.X, padx=8, pady=8)

    def _build_charts(self) -> None:
        self.charts_column = tk.Frame(self.root, bg=self.theme["MC"])
        charts = ChartsPanel(self.charts_column, self, extras=True)
        charts.pack(fill=tk.BOTH, expand=True, padx=8, pady=8)
        self.charts = charts
        self.charts_panels.append(charts)

    def _build_center(self) -> None:
        self.center = CTkFrame(self.root, fg_color=self.theme["MC"], corner_radius=corner())

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

        # 表格上方的切换页签：方块 / 实体 / 物品 / 总数。
        # 直角、彼此不留缝，连成一条，所以用 tk.Label 自己画，不用 CTkButton（它带圆角）
        tabs = tk.Frame(self.center, bg=self.theme["MC"])
        tabs.pack(side=tk.TOP, fill=tk.X, padx=10, pady=(0, 6))
        self.table_view = tk.StringVar(value="blocks")
        self.tab_buttons = {}
        for view, key in (("blocks", "tab.blocks"), ("entities", "tab.entities"),
                          ("items", "tab.items"), ("all", "tab.all")):
            widget = tk.Label(
                tabs, text=_(key), font=font(1.3, bold=True), cursor="hand2",
                padx=22, pady=7, bd=0, relief="flat",
            )
            widget.pack(side=tk.LEFT)
            widget.bind("<Button-1>", lambda _e, v=view: self.switch_table(v))
            self.tab_buttons[view] = widget
        self.tab_count = tk.Label(
            tabs, text="", font=font(1.1), bg=self.theme["MC"], fg=self.theme["BG"]
        )
        self.tab_count.pack(side=tk.LEFT, padx=12)

        table_area = tk.Frame(self.center, bg=self.theme["MC"])
        table_area.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        style = ttk.Style()
        style.configure("LV.Treeview", font=font(1.2), rowheight=28,
                        background=self.theme["PC"], fieldbackground=self.theme["PC"],
                        foreground=self.theme["BG"])
        style.configure("LV.Treeview.Heading", font=font(1.3, bold=True),
                        background=self.theme["PC"], foreground=self.theme["MC"])

        scroll = ttk.Scrollbar(table_area, orient="vertical")
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        columns = ("name", "count", "unit", "id") if i18n.is_chinese() else ("name", "count", "unit")
        self.table = ttk.Treeview(
            table_area, columns=columns, yscrollcommand=scroll.set, style="LV.Treeview", height=20
        )
        scroll.config(command=self.table.yview)
        self.table.heading("name", text=_("litem.chart.1"), anchor="center")
        self.table.heading("count", text=_("litem.chart.2"), anchor="e")
        self.table.heading("unit", text=_("litem.chart.3"), anchor="w")
        # #0 只放图标。宽度要给够，不然图标会压到「名字」列上去。
        self.table.column("#0", width=46, minwidth=46, stretch=False, anchor="center")
        self.table.column("name", width=200, anchor="w")
        self.table.column("count", width=80, anchor="e")
        self.table.column("unit", width=140, anchor="w")
        if "id" in columns:
            self.table.heading("id", text=_("litem.chart.4"), anchor="center")
            self.table.column("id", width=200, anchor="w")
        self.table.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.table.bind("<Button-3>", self._on_table_right_click)
        self.switch_table("blocks")

    # ------------------------------------------------------------------ 布局

    def _on_resize(self, event) -> None:
        if event.widget is not self.root:
            return
        # 拖窗口时 <Configure> 会连发几十次，停下来再算一次就行
        if self._layout_job is not None:
            self.root.after_cancel(self._layout_job)
        self._layout_job = self.root.after(120, self._apply_layout)

    def _apply_layout(self) -> None:
        """按当前窗口宽度决定哪几列还留得住。

        顺序是：先让侧栏走，再让饼图列走，最后才是左列 —— 中间的表格保到最后。
        菜单里手动关掉的列，宽度够了也不会自己回来。
        """
        self._layout_job = None
        width = self.root.winfo_width()
        if width <= 1:
            width = self.root.winfo_screenwidth()

        show_side = bool(self.show_side.get()) and width >= WIDTH_FOR_SIDE
        show_charts = bool(self.show_charts.get()) and width >= WIDTH_FOR_CHARTS
        show_left = bool(self.show_left.get()) and width >= WIDTH_FOR_LEFT

        # 每次都重新 pack 一遍，保证左中右的先后关系不会被反复显隐打乱
        for widget in (self.side, self.left, self.charts_column, self.center):
            widget.pack_forget()
        if show_side:
            self.side.pack(side=tk.RIGHT, fill=tk.Y, padx=(4, 6), pady=8)
        if show_left:
            self.left.pack(side=tk.LEFT, fill=tk.Y, padx=(6, 4), pady=8)
        if show_charts:
            self.charts_column.pack(side=tk.RIGHT, fill=tk.Y, padx=4, pady=8)
        self.center.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=4, pady=8)

        config.SAVE["panels"].update(
            {"func": int(self.show_side.get()), "stat": int(self.show_left.get()),
             "analysis": int(self.show_charts.get())}
        )

    # ------------------------------------------------------------------ 缩略图

    def _show_default_thumbnail(self) -> None:
        """没导入文件时先渲染一个工作台。

        注意别覆盖已经分析出来的结构：命令行带文件时分析会先跑完，
        这个定时器要是无条件设回工作台，缩略图就一直是个工作台了。
        """
        if self.structure is None:
            self.thumb.set_structure(
                edit.create_cube("minecraft:crafting_table", (1, 1, 1)), render_large=True
            )
        self.thumb.set_rotate(bool(self.thumb_rotate.get()))
        self.thumb.start()

    def _refresh_thumbnail(self) -> None:
        if self.structure is not None:
            self.thumb.set_structure(self.structure, bool(self.thumb_large.get()))
        else:
            self._show_default_thumbnail()

    # ------------------------------------------------------------------ 独立窗口

    def open_panel_window(self, kind: str) -> None:
        """把某块面板单独开一个窗口。布局和主界面里那份一样，代码也是同一份。"""
        titles = {
            "cube": _("litem.funcNew.1"), "replace": _("litem.funcChange.1"),
            "reden": _("litem.reden.title"), "info": _("menu.window.info"),
        }
        window = tk.Toplevel(self.root)
        window.title(f'{titles.get(kind, "")} - {_("litem.title")}')
        window.configure(bg=self.theme["MC"])
        config.set_icon(window)

        if kind == "cube":
            CubePanel(window, self).pack(fill=tk.BOTH, expand=True, padx=16, pady=16)
        elif kind == "replace":
            ReplacePanel(window, self).pack(fill=tk.BOTH, expand=True, padx=16, pady=16)
        elif kind == "reden":
            RedenPanel(window, self).pack(fill=tk.BOTH, expand=True, padx=16, pady=16)
        else:
            # 信息显示：左边 7 个指标，右边 2 张饼图，和主界面的摆法一致
            window.geometry("980x760")
            stats = StatsPanel(window, self)
            stats.pack(side=tk.LEFT, fill=tk.BOTH, padx=(16, 8), pady=16)
            charts = ChartsPanel(window, self, extras=False)
            charts.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=(8, 16), pady=16)
            self.stats_panels.append(stats)
            self.charts_panels.append(charts)
            stats.update(self.structure, self.result)
            charts.update(self.structure, self.result)

            def forget() -> None:
                for registry, panel in ((self.stats_panels, stats), (self.charts_panels, charts)):
                    if panel in registry:
                        registry.remove(panel)
                window.destroy()

            window.protocol("WM_DELETE_WINDOW", forget)

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
        self.ignored.clear()   # 「分析/重置」：重新分析就把忽略的条目放出来
        self.charts.start_progress()
        self.label_summary.config(text=_("app.busy"))
        # Tk 的变量和控件只能在主线程读，先取好再丢给工作线程
        options = (bool(self.do_entity.get()), self.charts.multiplier())
        threading.Thread(
            target=self._analysis_worker, args=(self.file_path, *options), daemon=True
        ).start()

    def _analysis_worker(self, path: str, count_entities: bool, multiplier: int) -> None:
        started = time.time()
        try:
            structure = formats.load(path)
            result = analysis.analyse(structure, count_entities=count_entities, multiplier=multiplier)
            self.root.after(0, self._analysis_done, structure, result, path, time.time() - started)
        except Exception as exc:
            traceback.print_exc()
            self.root.after(0, self._analysis_failed, exc)

    def _analysis_failed(self, exc: Exception) -> None:
        self.busy = False
        self.charts.reset_progress()
        self.label_summary.config(text=_("litem.midTop.2"))
        messagebox.showerror(_("litem.title"), _("app.load.fail", exc))

    def _analysis_done(self, structure, result, path: str, seconds: float) -> None:
        self.busy = False
        self.structure = structure
        self.result = result
        self.file_path = path

        size_x, size_y, size_z = structure.size
        self.label_file.config(text=os.path.basename(path))
        self.label_summary.config(
            text=_("litem.midTop.2b", size_x, size_y, size_z, result.placed,
                   self.charts.multiplier(), result.kinds)
        )
        self.charts.finish_progress(result.placed, seconds)

        for panel in self.stats_panels:
            panel.update(structure, result)
        for panel in self.charts_panels:
            panel.update(structure, result)

        self.switch_table(self.table_view.get())
        self.thumb.set_structure(structure, bool(self.thumb_large.get()))
        try:
            with open(config.user_file("log.txt"), "w", encoding="utf-8") as f:
                f.write(path)
        except OSError as exc:
            print(f"[log.txt] {exc}")

    def switch_table(self, view: str) -> None:
        self.table_view.set(view)
        for name, widget in self.tab_buttons.items():
            active = name == view
            widget.configure(
                bg=self.theme["PC"] if active else self.theme["BG"],
                fg=self.theme["BG"] if active else self.theme["TT"],
            )
        self._fill_table(self.result)

    def _table_rows(self, result) -> list:
        """当前页要显示哪些行。四份数据都来自同一次分析。"""
        view = self.table_view.get()
        if view == "all":
            # 总数：方块 + 实体 + 容器里的物品，合并同名条目
            merged = {}
            for entry_id, count in result.sorted_only_blocks():
                merged[entry_id] = merged.get(entry_id, 0) + count
            for entry_id, count in result.sorted_entities():
                merged[entry_id] = merged.get(entry_id, 0) + count
            for entry_id, count in result.sorted_items():
                merged[entry_id] = merged.get(entry_id, 0) + count
            return sorted(merged.items(), key=lambda kv: kv[1], reverse=True)
        return {
            "blocks": result.sorted_only_blocks,
            "entities": result.sorted_entities,
            "items": result.sorted_items,
        }[view]()

    def _fill_table(self, result) -> None:
        self.table.delete(*self.table.get_children())
        self.row_ids = {}
        if result is None:
            self.tab_count.config(text="")
            return

        rows = [r for r in self._table_rows(result) if r[0] not in self.ignored]
        chinese = i18n.is_chinese()
        for entry_id, count in rows:
            name = entry_id.split(":")[-1]
            values = (tools.display_name(entry_id), count, tools.convert_units(count), name)
            item = self.table.insert(
                "", "end", image=tools.block_image(name), values=values if chinese else values[:3]
            )
            self.row_ids[item] = entry_id   # 右键菜单要知道点的是哪一条
        hidden = _("tab.hidden", len(self.ignored)) if self.ignored else ""
        self.tab_count.config(
            text=_("tab.count", len(rows), sum(n for _k, n in rows)) + hidden
        )

    # -- 表格右键菜单 --------------------------------------------------------

    def _on_table_right_click(self, event) -> None:
        item = self.table.identify_row(event.y)
        if not item or item not in self.row_ids:
            return
        self.table.selection_set(item)
        entry_id = self.row_ids[item]

        menu = tk.Menu(self.root, tearoff=0)
        menu.add_command(
            label=_("row.ignore", tools.display_name(entry_id)),
            command=lambda: self.ignore_entry(entry_id), font=font(),
        )
        menu.add_command(
            label=_("row.replace"),
            command=lambda: self.quick_replace(entry_id), font=font(),
        )
        if self.ignored:
            menu.add_separator()
            menu.add_command(label=_("row.unignore"), command=self.clear_ignored, font=font())
        menu.tk_popup(event.x_root, event.y_root)

    def ignore_entry(self, entry_id: str) -> None:
        """把这一条从表格里藏起来。只影响显示，不动文件，「分析/重置」可以还原。"""
        self.ignored.add(entry_id)
        self._fill_table(self.result)

    def clear_ignored(self) -> None:
        self.ignored.clear()
        self._fill_table(self.result)

    def quick_replace(self, entry_id: str) -> None:
        """右键某一行直接换方块：弹个小窗选目标，确认后另存。"""
        if not self._require_structure():
            return
        top = tk.Toplevel(self.root)
        top.title(_("row.replace"))
        top.configure(bg=self.theme["MC"])
        top.transient(self.root)
        config.set_icon(top)

        tk.Label(
            top, text=_("row.replace.from", tools.display_name(entry_id)), font=font(1.3),
            bg=self.theme["MC"], fg=self.theme["BG"],
        ).pack(padx=20, pady=(18, 6))
        picker = BlockPicker(top, width=24)
        picker.pack(padx=20, pady=6, fill=tk.X)
        picker.entry.focus_set()

        def confirm() -> None:
            target = picker.get()
            if not target:
                return
            top.destroy()
            source = entry_id.split(":")[-1]
            try:
                rules = edit.parse_rules(
                    f"{source}-{target}",
                    name_to_id=lambda n: tools.translate(n, to_chinese=False),
                )
                structure, replaced = edit.replace_blocks(self.structure, rules)
            except (edit.RuleError, ValueError) as exc:
                messagebox.showerror(_("litem.title"), _("app.replace.badrule", exc))
                return
            if not replaced:
                messagebox.showinfo(_("litem.title"), _("app.replace.none"))
                return
            stem = os.path.splitext(os.path.basename(self.file_path))[0]
            self._save_structure_as(structure, f"{stem}_Modified", _("app.replace.done", replaced))

        button(top, _("litem.funcChange.5"), confirm, 1.3, accent=True).pack(
            padx=20, pady=(10, 18), fill=tk.X
        )
        top.bind("<Return>", lambda _e: confirm())

    # -- 导出 ---------------------------------------------------------------

    def export_text(self, classified: bool) -> None:
        if not self._require_structure():
            return
        stem = os.path.splitext(os.path.basename(self.file_path))[0]
        path = filedialog.asksaveasfilename(
            defaultextension=".txt", filetypes=[("Text", "*.txt"), ("CSV", "*.csv")],
            initialfile=f"{stem}.txt", title=_("litem.menuAnalysis.2"),
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
            initialfile=f"{stem}{extension}", title=_("menu.saveas"),
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

    def spawn_cube(self, panel) -> None:
        values = panel.values()
        try:
            name = values["block"]
            block_id = tools.translate(name, to_chinese=False) if name else "cobblestone"
            structure = edit.create_cube(
                block_id if ":" in block_id else f"minecraft:{block_id}",
                values["size"], values["origin"],
                hollow=values["hollow"], thickness=int(values["thickness"] or 1),
            )
        except ValueError as exc:
            messagebox.showerror(_("litem.title"), _("app.badnumber", exc))
            return
        self._save_structure_as(structure, "Cube")

    def replace_blocks(self, panel) -> None:
        if not self._require_structure():
            return
        values = panel.values()
        try:
            rules = edit.parse_rules(
                values["rules"], name_to_id=lambda n: tools.translate(n, to_chinese=False)
            )
        except edit.RuleError as exc:
            messagebox.showerror(_("litem.title"), _("app.replace.badrule", exc))
            return
        try:
            structure, replaced = edit.replace_blocks(self.structure, rules, values["limits"])
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
            initialfile=f"{stem}.litematic", title=_("menu.saveas"),
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

    def save_snapshot(self) -> None:
        """按标准等轴渲染一张缩略图，写进投影文件自己的预览图字段。

        写的是 Litematica 的 Metadata.PreviewImageData（140×140 的 ARGB 数组），
        所以存完在游戏里的投影浏览界面就能看到缩略图。
        这个字段是 .litematic 专有的，另外两种格式没有对应的地方。
        """
        if not self._require_structure():
            return
        if formats.detect_format(self.file_path) != formats.LITEMATIC:
            messagebox.showwarning(_("litem.title"), _("app.snapshot.onlylitematic"))
            return
        # 要原地改用户的文件，先问一声
        if not messagebox.askyesno(
            _("litem.title"), _("app.snapshot.ask", os.path.basename(self.file_path))
        ):
            return
        try:
            count = snapshot.embed(self.structure, self.file_path)
        except Exception as exc:
            traceback.print_exc()
            messagebox.showerror(_("litem.title"), _("app.save.fail", exc))
            return
        messagebox.showinfo(
            _("litem.title"),
            _("app.snapshot.done", count, os.path.basename(self.file_path)),
        )

    def open_3d(self) -> None:
        """手动 3D 渲染 = 打开全屏的网页渲染器（和左上角那个只能看的缩略图是两回事）。"""
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

    def open_reden(self, panel) -> None:
        query, mode = panel.values()
        if mode == _("litem.reden.select.2") and query:
            webbrowser.open(f"https://redenmc.com/litematica/{query}")
        elif mode == _("litem.reden.select.3") and query:
            name, _sep, index = query.partition("/")
            webbrowser.open(f"https://redenmc.com/api/mc-services/yisibite/{name}/download/{index or 1}")
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
        """一个简单的列表选择框。旧版用的 easygui 在 macOS 上装不上，改用原生 Tk。"""
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
        if self.file_path or self.busy:
            return
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
        config.SAVE["panels"].update(
            {"entity": int(self.do_entity.get()),
             "thumb_rotate": int(self.thumb_rotate.get()),
             "thumb_large": int(self.thumb_large.get())}
        )
        config.save_settings()
        self.thumb.stop()
        render.close_all()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()
