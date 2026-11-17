"""更新方块资源（viewer/resource/ 的 assets.js + atlas.png + icons.json）和方块/物品名对照表。

桌面版和网页版共用这一份资源，图标也是从 atlas 现场裁，所以更新完不用再补图标。

    python tools/update_jsassets.py            # 拉默认版本（见 DEFAULT_VERSION）
    python tools/update_jsassets.py latest     # 拉 mcmeta 最新（可能是快照版）
    python tools/update_jsassets.py 26.3       # 拉指定正式版
    python tools/update_jsassets.py tags       # 只更新方块标签（tags.json），按默认版本

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
RESOURCE = os.path.join(ROOT, "viewer", "resource")
sys.path.insert(0, os.path.join(ROOT, "script"))
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
    tags = get("summary", "data/tag/block/data.min.json")
    return assets, atlas, names, tags


# 方块标签里很多是按「玩法」分的（镐可挖、可被替换、能在上面刷怪……），成员五花八门，
# 对「换成同类方块」没参考价值。只留两种：
#   1. 标签名就是成员的共同部分：planks → *_planks、wool → *_wool、logs → *_log（六成以上成员带这个词）
#   2. 下面这些明确是「同一类东西」的标签（花、树苗、树叶、珊瑚……成员名字不一定带标签名）
SEMANTIC_TAGS = {
    "flowers", "small_flowers", "saplings", "leaves", "crops", "dirt", "sand", "corals", "coral_plants",
    "coral_blocks", "wall_corals", "ice", "snow", "terracotta", "base_stone_overworld", "base_stone_nether",
    "beds", "banners", "candles", "candle_cakes", "flower_pots", "shulker_boxes", "anvil", "cauldrons",
    "rails", "nylium", "wart_blocks", "cave_vines", "beacon_base_blocks",
}
NOT_SIMILAR = {"air", "fire", "portals", "villager_babies_can_jump_on_bed", "villagers_can_sleep_on_bed",
               "mob_interactable_doors"}
MAX_TAG_SIZE = 80


def _similar(name: str, ids: list) -> bool:
    if name in NOT_SIMILAR or "/" in name:
        return False
    if name in SEMANTIC_TAGS:
        return True
    word = name.split("_")[-1]
    for w in {word, word[:-1] if word.endswith("s") else word, word[:-2] if word.endswith("es") else word}:
        if len(w) >= 3 and sum(w in i for i in ids) >= 0.6 * len(ids):
            return True
    return False


def write_block_tags(raw: dict) -> int:
    """展开标签里的 #引用，只留「同一类东西」的标签（见 _similar），写 viewer/resource/tags.json：{标签: [方块名…]}。

    网页版「替换方块」的下拉框靠它把同类方块排在最前面。
    """
    def members(name: str, seen=()) -> list:
        out = []
        for v in raw.get(name, {}).get("values", []):
            v = v["id"] if isinstance(v, dict) else v
            if v.startswith("#"):
                ref = v[1:].replace("minecraft:", "")
                if ref not in seen:
                    out += members(ref, seen + (name,))
            else:
                out.append(v.replace("minecraft:", ""))
        return list(dict.fromkeys(out))

    tags = {}
    for name in sorted(raw):
        ids = members(name)
        if 2 <= len(ids) <= MAX_TAG_SIZE and _similar(name, ids):
            tags[name] = ids
    with open(os.path.join(RESOURCE, "tags.json"), "w", encoding="utf-8") as f:
        json.dump(tags, f, ensure_ascii=False, separators=(",", ":"))
    return len(tags)


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
    if argv and argv[0] == "tags":
        import requests

        url = _url("summary", _refs(DEFAULT_VERSION)["summary"], "data/tag/block/data.min.json")
        response = requests.get(url, timeout=120)
        response.raise_for_status()
        print(f"tags.json：{write_block_tags(response.json())} 个标签（{DEFAULT_VERSION}）")
        return 0

    version = argv[0] if argv else DEFAULT_VERSION
    print(f"目标版本：{version}")

    try:
        assets, atlas, names, tags = fetch(version)
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
    tag_count = write_block_tags(tags)

    from lv.atlas import write_icon_index  # 图标索引跟着新图集重建
    icons = write_icon_index(RESOURCE)

    # 记下版本，开机自动检查（script/lv/assets.py）靠它判断要不要更新
    with open(os.path.join(RESOURCE, "version.json"), "w", encoding="utf-8") as f:
        json.dump({"version": version}, f, ensure_ascii=False, indent=2)

    print(f"\n完成（{version}）")
    print(f"  assets.js  {os.path.getsize(assets_path):>9,} bytes  "
          f"blockstates {len(assets['blockstates'])} / models {len(assets['models'])} / "
          f"textures {len(assets['textures'])}")
    print(f"  atlas.png  {os.path.getsize(atlas_path):>9,} bytes")
    print(f"  icons.json {icons} 个图标")
    print(f"  名称对照表 新增 {added} 条，更新 {updated} 条")
    print(f"  tags.json  {tag_count} 个方块标签")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
