from amulet_nbt import load, NamedTag, IntTag, StringTag, ByteTag
import tkinter as tk
import json, os
from tkinter import filedialog, ttk
from Litmatool import cn_translate, id_tran_name, grs
from tkinter import messagebox

data = json.load(open(grs(os.path.join('lang', 'data.json')), 'r', encoding='utf-8'))
color_map = data["Color_map"][data["Save"]["ui"]["ColorMap"]]

class LitCon:
    def __init__(self):
        self.path : str = ""
        self.rootc = tk.Tk()
        self.rootc.title("Containers")
        self.rootc.iconbitmap(grs("icon.ico"))
        self.rootc.geometry("500x800")
        self.rootc.configure(bg=color_map["MC"])
        Clable = tk.Label(self.rootc,text="容器探测", font=("Arial", 14, "bold"), bg=color_map["MC"], fg=color_map["TT"])
        Clable.pack()
        CBP = tk.Frame(self.rootc, bg=color_map["PC"])
        CBP.pack()
        Cbutton = tk.Button(CBP,text="Analysis",command=self.LitContainer, font=("Arial", 10), bg=color_map["PC"], fg=color_map["BG"])
        Cbutton.grid(row=0,column = 0)
        Cbutton = tk.Button(CBP,text="ChooseFile",command=lambda :self.LitConImport(True), font=("Arial", 10), bg=color_map["PC"], fg=color_map["BG"])
        Cbutton.grid(row=0,column = 1)
        tk.Label(CBP,text="容器查找可结合[步骤查看器]使用", font=("Arial", 10), bg=color_map["PC"], fg=color_map["BG"]).grid(row=0,column = 2)
        Csroll = tk.Scrollbar(self.rootc, orient="vertical")
        Csroll.pack(side=tk.RIGHT, fill=tk.Y, padx=10)
        self.cmd_table = tk.Text(self.rootc, bg=color_map["BG"], fg=color_map["TT"], font=("Arial", 12), yscrollcommand=Csroll.set)
        Csroll.config(command=self.cmd_table.yview)
        self.cmd_table.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=5, pady=10)

        self.LitConImport()
        self.rootc.mainloop()

    def LitConImport(self,localmode = False):
        with open(grs('log.txt'), 'r', encoding='utf-8') as file:
            file_text = os.path.normpath(str(file.read()))
            print("Selected file:", file_text)
            print(file_text)
            if localmode:
                self.path = filedialog.askopenfilename(filetypes=[("Litematic File", "*.litematic"), ("All File", "*.*")], title="选择 Litematic 文件")
                if not self.path: return
            else:
                self.path = file_text
                if not self.path: return
                del file_text
            print("Selected file path:", self.path)
            self.LitContainer()

    def cn_id(self,cid):
        cd = cn_translate(id_tran_name(cid))
        if cd == id_tran_name(cid):
            return cn_translate(id_tran_name(cid), types="Items")
        return cd

    def LitContainer(self) -> None:
        print(self.path)
        l = 1
        self.cmd_table.delete("1.0", tk.END)
        nbt_file: NamedTag = load(self.path, compressed=True)
        container = list(nbt_file.tag['Regions'].values())[0]
        if not len(container['TileEntities']):
            self.cmd_table.insert("1.0" , "Litematic file has no Container")
            return
        container = container['TileEntities']
        for nt in container:
            x = int(IntTag(nt['x']))
            y = int(IntTag(nt['y']))
            z = int(IntTag(nt['z']))
            try:
                id = str(nt['id'])
            except KeyError:
                continue
            if 'item' in nt:
                item = nt['item']
                self.cmd_table.insert(f"{l}.0" ,f"{self.cn_id(id)} Pos:{(x,y,z)}\n")
                self.cmd_table.insert(f"{l+1}.0", f"----{self.cn_id(str(StringTag(item['id'])))} X{int(IntTag(item['count']))}\n")
                l+=2
            elif 'RecordItem' in nt:
                item = nt['RecordItem']
                self.cmd_table.insert(f"{l}.0" ,f"{self.cn_id(id)} Pos:{(x,y,z)}\n")
                self.cmd_table.insert(f"{l+1}.0", f"-disk-{str(StringTag(item['id']))}\n")
                l+=2
            elif 'Command' in nt:
                self.cmd_table.insert(f"{l}.0" ,f"{self.cn_id(id)} Pos:{(x,y,z)}\n")
                self.cmd_table.insert(f"{l+1}.0", f"指令:{str(StringTag(nt['Command']))}\n")
                l+=2
            elif 'primary_effect' in nt:
                self.cmd_table.insert(f"{l}.0", f"{self.cn_id(id)} Pos:{(x, y, z)}\n")
                self.cmd_table.insert(f"{l + 1}.0", f"指令:{cn_translate(str(StringTag(nt['primary_effect'])))} LEVEL{str(StringTag(nt['Levels']))}\n")
                l += 2
            elif 'Items' in nt:
                item = nt['Items']
                if len(item) == 0:
                    continue
                it : list = []
                asc = 97
                self.cmd_table.insert(f"{l}.0", f"{self.cn_id(id)} Pos:{(x, y, z)}\n")
                l += 1
                for i in item:
                    cd = self.cn_id(str(StringTag(i['id'])))
                    try:
                        nm = int(IntTag(i['count']))
                    except:
                        nm = 1
                    st = int(ByteTag(i['Slot']))
                    self.cmd_table.insert(f"{l}.0" , f"----{cd} X{nm}|位置:{st}    UI:{chr(asc)}\n")
                    it.append((cd,st))
                    l+=1
                    asc += 1

                if "chest" in id or "minecraft:barrel" == id or "box" in id:
                    mode=[['_'] * 9 for _ in range(3)] # 9*3
                    asc = 97
                    for _,d in it:
                        mode[d//9][d%9] = chr(asc)
                        asc+=1

                    for ix in mode:
                        item_out = "|"
                        for iy in ix:
                            item_out += f"{iy}|"
                        item_out += "\n"
                        self.cmd_table.insert(f"{l}.0", item_out)
                        l+=1
                elif "furnace" in id or "smoker" in id:
                    mode=['_' for _ in range(3)] # 3*1
                    asc = 97
                    for _,d in it:
                        mode[d] = chr(asc)
                        asc += 1
                    self.cmd_table.insert(f"{l}.0", f"进口:{mode[0]}|出口:{mode[2]}|燃料:{mode[1]}\n")
                    l += 1
                elif "minecraft:brewing_stand" == id:
                    mode = ['_' for _ in range(4)] # 4*1
                    asc = 97
                    for _,d in it:
                        mode[d] = chr(asc)
                        asc += 1
                    self.cmd_table.insert(f"{l}.0", f"|{mode[0]} {mode[1]} {mode[2]}|燃料:{mode[3]}\n")
                    l += 1
                elif "minecraft:chiseled_bookshelf" == id:
                    mode = ['_' for _ in range(6)] # 6*1
                    asc = 97
                    for _,d in it:
                        print(d)
                        mode[d] = chr(asc)
                        asc += 1
                    self.cmd_table.insert(f"{l}.0", f"|{mode[0]}|{mode[1]}|{mode[2]}|\n")
                    self.cmd_table.insert(f"{l+1}.0", f"|{mode[3]}|{mode[4]}|{mode[5]}|\n")
                    l += 2
                    print(mode)
                elif "minecraft:crafter" == id or "minecraft:dropper" == id or "minecraft:dispenser" == id:
                    mode = [['_'] * 3 for _ in range(3)]  # 9*3
                    asc = 97
                    for _, d in it:
                        mode[d // 3][d % 3] = chr(asc)
                        asc += 1

                    for ix in mode:
                        item_out = "|"
                        for iy in ix:
                            item_out += f"{iy}|"
                        item_out += "\n"
                        self.cmd_table.insert(f"{l}.0", item_out)
                        l += 1
            else:
                continue
            self.cmd_table.insert(f"{l}.0" , "=================\n")
            l+=1
            self.rootc.update_idletasks()

if __name__ == "__main__":
    lc = LitCon()




