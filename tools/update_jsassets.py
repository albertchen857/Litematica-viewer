"""更新 JSrender 的方块资源（assets.js + atlas.png）和方块/物品名对照表。

    python tools/update_jsassets.py            # 拉默认版本（见 DEFAULT_VERSION）
    python tools/update_jsassets.py latest     # 拉 mcmeta 最新（可能是快照版）
    python tools/update_jsassets.py 26.3       # 拉指定正式版

资源来自 misode/mcmeta，这几个分支是分开更新的，所以按版本各自锁一个提交，
免得 atlas 和 blockstates 对不上。版本 -> 提交的查法：

    https://api.github.com/repos/misode/mcmeta/commits?sha=<分支>

相比旧版的改动：
* 路径写死成仓库根目录，不再依赖「先 cd 到脚本目录」
* 任何一步失败都不落盘。旧版即使下载抛异常也照样把 result 写出去，
  结果是一份残缺的 assets.js 覆盖掉本来好好的资源
* 顺带更新 lang/setting.json 里的方块名 / 物品名对照表
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOURCE = os.path.join(ROOT, "script", "JSrender", "resource")
SETTING_JSON = os.path.join(ROOT, "lang", "setting.json")

DEFAULT_VERSION = "26.3"

# 各分支上对应版本的提交。加新版本就在这里补一行。
PINS = {
    "26.3": {
        "atlas": "41de69bb75",
        "summary": "d96c75fec200c4580dd75e033a76341521165461",
        "assets": "79962f2b091fb6213b425b277a8725d737f3def8",
    },
}

RAW = "https://raw.githubusercontent.com/misode/mcmeta"


def _url(branch: str, ref: str, path: str) -> str:
    return f"{RAW}/{ref}/{path}"


def _refs(version: str) -> dict:
    if version == "latest":
        return {"atlas": "atlas", "summary": "summary", "assets": "assets"}
    pin = PINS.get(version)
    if pin is None:
        raise SystemExit(
            f"没有记录 {version} 的提交。已知版本：{', '.join(PINS)}，或者用 latest。\n"
            f"查提交：https://api.github.com/repos/misode/mcmeta/commits?sha=atlas"
        )
    return pin


def fetch(version: str) -> tuple:
    """把要写的东西全下完再返回，中途失败就抛，不碰磁盘上的旧资源。"""
    import requests

    refs = _refs(version)
    session = requests.Session()

    def get(ref: str, path: str, binary: bool = False):
        url = _url(ref, refs[ref], path)
        print(f"  下载 {path}")
        response = session.get(url, timeout=120)
        response.raise_for_status()
        return response.content if binary else response.json()

    assets = {
        "blockstates": get("summary", "assets/block_definition/data.min.json"),
        "models": get("summary", "assets/model/data.min.json"),
        "textures": get("atlas", "all/data.min.json"),
    }
    atlas = get("atlas", "all/atlas.png", binary=True)
    names = {
        "en_us": get("assets", "assets/minecraft/lang/en_us.json"),
        "zh_cn": get("assets", "assets/minecraft/lang/zh_cn.json"),
    }
    return assets, atlas, names


def update_name_tables(names: dict) -> tuple:
    """用官方语言文件刷新 lang/setting.json 的 Blocks / Items 中文名。

    官方 lang 的键是 ``block.minecraft.stone`` / ``item.minecraft.stick``，
    这里转成本程序用的 ``stone`` -> ``石头``。只增量补充和更新，
    不删已有条目 —— 表里有些键是历史遗留的方块名，删了反而会让老投影显示成英文。
    """
    with open(SETTING_JSON, encoding="utf-8") as f:
        setting = json.load(f)

    added = updated = 0
    for prefix, table in (("block.minecraft.", "Blocks"), ("item.minecraft.", "Items")):
        target = setting.setdefault(table, {})
        for key, chinese in names["zh_cn"].items():
            if not key.startswith(prefix):
                continue
            name = key[len(prefix):]
            if "." in name:        # block.minecraft.banner.black 这类子条目，不是方块本身
                continue
            if name not in target:
                target[name] = chinese
                added += 1
            elif target[name] != chinese:
                target[name] = chinese
                updated += 1

    with open(SETTING_JSON, "w", encoding="utf-8") as f:
        json.dump(setting, f, ensure_ascii=False, indent=1, sort_keys=True)
    return added, updated


def main(argv: list) -> int:
    version = argv[0] if argv else DEFAULT_VERSION
    print(f"目标版本：{version}")

    try:
        assets, atlas, names = fetch(version)
    except Exception as exc:
        print(f"\n下载失败：{exc}\n磁盘上的资源没有改动。网络不稳的话挂代理再试。")
        return 1

    os.makedirs(RESOURCE, exist_ok=True)
    assets_path = os.path.join(RESOURCE, "assets.js")
    atlas_path = os.path.join(RESOURCE, "atlas.png")

    payload = json.dumps(assets, sort_keys=True, separators=(",", ":")).replace("\\", "\\\\").replace("'", "\\'")
    with open(assets_path, "w", encoding="utf-8") as f:
        f.write(f"const assets = JSON.parse('{payload}')")
    with open(atlas_path, "wb") as f:
        f.write(atlas)

    added, updated = update_name_tables(names)

    print(f"\n完成（{version}）")
    print(f"  assets.js  {os.path.getsize(assets_path):>9,} bytes  "
          f"blockstates {len(assets['blockstates'])} / models {len(assets['models'])} / "
          f"textures {len(assets['textures'])}")
    print(f"  atlas.png  {os.path.getsize(atlas_path):>9,} bytes")
    print(f"  名称对照表 新增 {added} 条，更新 {updated} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
