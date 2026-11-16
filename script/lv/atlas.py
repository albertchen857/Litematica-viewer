"""方块 / 物品图标：一律从贴图图集 atlas.png 里裁，不再单独存上千张 png。

图集和模型数据只有一份，放在 ``viewer/resource/``（网页版查看器和桌面版共用，
GitHub Pages 也直接用这一份）::

    assets.js   blockstates / models / textures（textures 是「贴图路径 → 图集里的 [u, v, 宽, 高]」）
    atlas.png   所有面贴图拼成的大图
    icons.json  「方块或物品名 → 图集里的框」，由本模块生成

atlas 里存的是面贴图（block/oak_planks），不是按方块 id 索引的（没有 block/oak_stairs）。
所以每个方块要顺着 blockstate → model → parent 链找到一张最能代表它的面贴图，
这一步在生成 icons.json 时算一次；桌面版和网页版都只查这张表，两边的图标保证一样。
"""

import functools
import json
import os
import re

from .config import res

RESOURCE = res("viewer", "resource")
ASSETS_JS = os.path.join(RESOURCE, "assets.js")
ATLAS_PNG = os.path.join(RESOURCE, "atlas.png")
ICONS_JSON = os.path.join(RESOURCE, "icons.json")
ICON_SIZE = 16

# 一个方块可能有好几张面贴图，按这个顺序挑一张最能代表它的
TEXTURE_PRIORITY = ("all", "texture", "side", "end", "top", "front", "cross", "fan",
                    "particle", "down", "bottom", "north", "0", "rail", "layer0")
# 不是真方块，不出图标
SKIP = {"air", "cave_air", "void_air", "moving_piston", "barrier", "light", "structure_void"}

# 放下去的方块和背包里的物品不同名的：图标用物品那张
ITEM_ALIAS = {"redstone_wire": "redstone", "tripwire": "string", "cave_vines": "glow_berries",
              "cave_vines_plant": "glow_berries", "sweet_berry_bush": "sweet_berries",
              "carrots": "carrot", "potatoes": "potato", "beetroots": "beetroot", "cocoa": "cocoa_beans",
              "pitcher_crop": "pitcher_pod", "torchflower_crop": "torchflower_seeds",
              "melon_stem": "melon_seeds", "pumpkin_stem": "pumpkin_seeds", "bamboo_sapling": "bamboo"}

# 图集里是灰的、游戏里按生物群系染色的贴图（取平原的颜色），图标上乘上这个颜色
FOLIAGE, GRASS = 0x48B518, 0x91BD59
TINTS = {"water": 0x3F76E4, "bubble_column": 0x3F76E4, "water_cauldron": 0x3F76E4,
         "birch_leaves": 0x80A755, "spruce_leaves": 0x619961, "lily_pad": 0x208030,
         "grass": GRASS, "short_grass": GRASS, "tall_grass": GRASS, "fern": GRASS, "large_fern": GRASS,
         "sugar_cane": GRASS, "potted_fern": GRASS, "vine": FOLIAGE, "attached_melon_stem": 0xE0C71C,
         "attached_pumpkin_stem": 0xE0C71C, "melon_stem": 0xE0C71C, "pumpkin_stem": 0xE0C71C}
for _leaf in ("oak", "jungle", "acacia", "dark_oak", "mangrove"):
    TINTS[f"{_leaf}_leaves"] = FOLIAGE


# --------------------------------------------------------------------------- 生成 icons.json

def load_assets(path: str = ASSETS_JS) -> dict:
    """assets.js 是 ``const assets = JSON.parse('...')``，里面的 \\ 和 ' 被转义过，反着解回来。"""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    inner = raw[raw.index("('") + 2: raw.rindex("')")]
    return json.loads(re.sub(r"\\(.)", r"\1", inner))


def _strip(name: str) -> str:
    return name.replace("minecraft:", "")


def _first_model(state: dict):
    variants = state.get("variants")
    if variants:
        entry = next(iter(variants.values()))
        entry = entry[0] if isinstance(entry, list) else entry
        return entry.get("model")
    for part in state.get("multipart", []) or []:
        apply = part.get("apply")
        apply = apply[0] if isinstance(apply, list) else apply
        if apply and "model" in apply:
            return apply["model"]
    return None


def _merged_textures(models: dict, model: str) -> dict:
    """顺着 parent 链把 textures 合并起来，子模型优先。"""
    textures, name, seen = {}, _strip(model), set()
    while name and name not in seen:
        seen.add(name)
        entry = models.get(name)
        if not entry:
            break
        for key, value in (entry.get("textures") or {}).items():
            textures.setdefault(key, value)
        name = _strip(entry["parent"]) if "parent" in entry else None
    return textures


def _resolve(textures: dict, key: str, depth: int = 0):
    """把 "#side" 这种引用解开，指到真正的贴图路径。"""
    value = textures.get(key)
    if isinstance(value, dict):  # 新版模型里贴图可以写成 {"sprite": "...", ...}
        value = value.get("sprite") or value.get("texture")
    if not isinstance(value, str) or depth > 8:
        return None
    return _resolve(textures, value[1:], depth + 1) if value.startswith("#") else _strip(value)


def _pick_texture(textures: dict):
    for key in (*TEXTURE_PRIORITY, *textures):
        if key in textures:
            path = _resolve(textures, key)
            if path:
                return path
    return None


def build_icon_index(assets: dict) -> dict:
    """{名字: [u, v, 宽, 高]}。

    有物品贴图（item/<名字>）的优先用它 —— 门、告示牌、蜡烛、钟这类方块，
    背包里显示的就是这张平面图；没有物品贴图的（完整方块）再顺着模型链挑一张面贴图。
    动态贴图（水、火）在图集里是竖着排的长条，高度截成和宽一样，只取第一帧。
    """
    states, models, boxes = assets["blockstates"], assets["models"], assets["textures"]
    index = {}
    for path, (u, v, w, h) in boxes.items():
        if path.startswith("item/"):
            index[path[len("item/"):]] = [u, v, w, min(w, h)]
    for name, state in states.items():
        if name in index or name in SKIP:
            continue
        # 墙上的火把 / 告示牌、作物这类，背包里是另一个物品
        alias = ITEM_ALIAS.get(name) or name.replace("_wall_", "_")
        if alias != name and f"item/{alias}" in boxes:
            u, v, w, h = boxes[f"item/{alias}"]
            index[name] = [u, v, w, min(w, h)]
            continue
        model = _first_model(state)
        path = _pick_texture(_merged_textures(models, model)) if model else None
        box = boxes.get(path) if path else None
        if box:
            u, v, w, h = box
            index[name] = [u, v, w, min(w, h)]
    # 需要染色的追加第 5 个数：0xRRGGBB，用的时候乘到贴图上
    for name, tint in TINTS.items():
        if name in index and len(index[name]) == 4:
            index[name].append(tint)
    return dict(sorted(index.items()))


def write_icon_index(resource_dir: str = RESOURCE) -> int:
    """读 assets.js，写 icons.json。资源更新（手动或自动）之后都要调一次。"""
    index = build_icon_index(load_assets(os.path.join(resource_dir, "assets.js")))
    with open(os.path.join(resource_dir, "icons.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, separators=(",", ":"))
    _icon_index.cache_clear()
    _atlas.cache_clear()
    texture_image.cache_clear()
    return len(index)


# --------------------------------------------------------------------------- 取图

@functools.lru_cache(maxsize=1)
def _icon_index() -> dict:
    try:
        with open(ICONS_JSON, encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        # 老安装包里没有 icons.json：现场算一份，不写文件（打包目录可能只读）
        try:
            return build_icon_index(load_assets())
        except Exception as exc:
            print(f"[atlas] {exc}")
            return {}


@functools.lru_cache(maxsize=1)
def _atlas():
    from PIL import Image

    return Image.open(ATLAS_PNG).convert("RGBA")


def _missing():
    """缺贴图时的紫黑格子，和游戏里贴图丢失的样子一样，一眼能看出是缺图。"""
    from PIL import Image

    image = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 255))
    half = ICON_SIZE // 2
    for x0, y0 in ((0, 0), (half, half)):
        for x in range(x0, x0 + half):
            for y in range(y0, y0 + half):
                image.putpixel((x, y), (248, 0, 248, 255))
    return image


def lookup(name: str):
    """名字 → 图集里的框；实体名再试一下它的刷怪蛋。查不到返回 None。"""
    index = _icon_index()
    name = _strip(name).split("[")[0]
    return index.get(name) or index.get(f"{name}_spawn_egg")


@functools.lru_cache(maxsize=4096)
def texture_image(name: str):
    """16×16 的 PIL 图像（RGBA）。查不到就是紫黑格子。"""
    from PIL import Image

    box = lookup(name)
    if not box:
        return _missing()
    u, v, w, h = box[:4]
    try:
        tile = _atlas().crop((u, v, u + w, v + h))
    except OSError as exc:
        print(f"[atlas] {exc}")
        return _missing()
    if tile.size != (ICON_SIZE, ICON_SIZE):
        tile = tile.resize((ICON_SIZE, ICON_SIZE), Image.NEAREST)
    if len(box) > 4:  # 灰度贴图乘上群系色
        from PIL import ImageChops

        tint = Image.new("RGBA", tile.size, ((box[4] >> 16) & 255, (box[4] >> 8) & 255, box[4] & 255, 255))
        tile = ImageChops.multiply(tile, tint)
    return tile


def block_names() -> list:
    """有图标的方块名（不含纯物品），给方块选择下拉用。"""
    try:
        states = load_assets()["blockstates"]
    except Exception:
        return []
    index = _icon_index()
    return sorted(n for n in states if n in index)
