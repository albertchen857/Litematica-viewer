"""容器分析器：列出结构里所有装了东西的方块实体，并画出槽位排布。

旧版是 tk.Tk() 建的第二个根窗口、还放在子线程里跑 mainloop，Tcl 不是线程安全的，
点两下就会崩。这里改成主窗口的 Toplevel，数据也不再自己去读 NBT，
统一走 analysis.containers()，所以 litematic / nbt / mcstructure 都能分析。
"""

import tkinter as tk
from tkinter import ttk

from . import analysis, config, tools
from .config import colors, font
from .i18n import _

EMPTY_SLOT = "·"


class ContainerWindow:
    def __init__(self, master, structure):
        self.theme = colors()
        self.structure = structure

        self.window = tk.Toplevel(master)
        self.window.title(_("litem.frameTop.4"))
        self.window.geometry("720x820")
        self.window.configure(bg=self.theme["BG"])
        config.set_icon(self.window)

        header = tk.Frame(self.window, bg=self.theme["MC"])
        header.pack(side=tk.TOP, fill=tk.X)
        tk.Label(
            header, text=_("con.title"), font=font(1.6, bold=True),
            bg=self.theme["MC"], fg=self.theme["TT"],
        ).pack(side=tk.LEFT, padx=12, pady=8)
        tk.Label(
            header, text=_("con.hint"), font=font(),
            bg=self.theme["MC"], fg=self.theme["TT"],
        ).pack(side=tk.LEFT, padx=8)

        scroll = ttk.Scrollbar(self.window, orient="vertical")
        scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.text = tk.Text(
            self.window, bg=self.theme["BG"], fg=self.theme["TT"], font=("Consolas", 11),
            yscrollcommand=scroll.set, wrap="none", padx=10, pady=10,
        )
        scroll.config(command=self.text.yview)
        self.text.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.text.tag_configure("head", foreground=self.theme["PC"], font=("Consolas", 12, "bold"))
        self.text.tag_configure("slot", foreground="#888888")

        self.fill()

    def fill(self) -> None:
        found = analysis.containers(self.structure)
        self.text.config(state=tk.NORMAL)
        self.text.delete("1.0", tk.END)

        if not found:
            self.text.insert(tk.END, _("con.none"))
            self.text.config(state=tk.DISABLED)
            return

        self.text.insert(tk.END, _("con.count", len(found)) + "\n\n")
        for container in found:
            name = tools.display_name(container.block_id)
            self.text.insert(tk.END, f"{name}  {tuple(container.position)}\n", "head")

            letters = {}
            for order, (item_id, count, slot) in enumerate(container.items):
                letter = chr(ord("a") + order) if order < 26 else "?"
                letters[slot] = letter
                self.text.insert(
                    tk.END,
                    f"  {letter}  {tools.display_name(item_id):<22} x{count:<5} slot {slot}\n",
                )
            if container.note:
                self.text.insert(tk.END, f"  * {container.note}\n")

            for line in self._slot_map(container.block_id, letters):
                self.text.insert(tk.END, f"     {line}\n", "slot")
            self.text.insert(tk.END, "-" * 46 + "\n")

        self.text.config(state=tk.DISABLED)

    @staticmethod
    def _slot_map(block_id: str, letters: dict) -> list:
        """按容器类型画出槽位方格，比如箱子是 3 行 9 列。"""
        rows, columns = analysis.slot_layout(block_id)
        if not rows or not columns:
            return []
        lines = []
        for row in range(rows):
            cells = [letters.get(row * columns + column, EMPTY_SLOT) for column in range(columns)]
            lines.append("|" + "|".join(cells) + "|")
        return lines
