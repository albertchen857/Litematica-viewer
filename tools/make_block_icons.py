"""从 atlas.png 切出 block/ 里的方块图标。

    python tools/make_block_icons.py            # 只补缺的，不动已有的
    python tools/make_block_icons.py --all      # 全部重新生成（会覆盖）
    python tools/make_block_icons.py --dry-run  # 只看会生成什么，不写文件

背景：block/ 里存的是 16×16 的平面贴图（oak_log.png 就是原木侧面那张图），
不是渲染好的立体图标。而 atlas.png 里正好就是这些平面贴图，所以这个目录
完全可以从 atlas 生成出来，不用再手工收集。

缺的那层是「方块 id -> 贴图路径」的映射：
    blockstates[id] -> 取一个 variant 的 model
    models[model]   -> 顺着 parent 往上合并 textures
    textures[路径]  -> atlas.png 里的 [u, v, 宽, 高]

注意 atlas 里**没有**按方块 id 索引的条目（没有 block/oak_stairs 这种），
它存的是面贴图（block/oak_planks）。所以必须走上面这条链，不能直接按名字查。
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_JS = os.path.join(ROOT, "script", "JSrender", "resource", "assets.js")
ATLAS_PNG = os.path.join(ROOT, "script", "JSrender", "resource", "atlas.png")
BLOCK_DIR = os.path.join(ROOT, "block")

ICON_SIZE = 16
# 一个方块可能有好几张面贴图，按这个顺序挑一张最能代表它的
TEXTURE_PRIORITY = ("all", "texture", "side", "end", "top", "front", "cross", "fan",
                    "particle", "down", "bottom", "north", "0", "rail", "layer0")
# 这些不是真方块，没必要出图标
SKIP = {"air", "cave_air", "void_air", "water", "lava", "moving_piston", "barrier",
        "light", "structure_void"}


def strip(name: str) -> str:
    return name.replace("minecraft:", "")


def load_assets() -> dict:
    with open(ASSETS_JS, encoding="utf-8") as f:
        raw = f.read()
    return json.loads(raw[raw.index("'") + 1 : raw.rindex("'")])


def first_model(state: dict):
    """从 blockstate 里取一个代表性的 model 名。"""
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


def merged_textures(models: dict, model: str) -> dict:
    """顺着 parent 链把 textures 合并起来。子模型优先。"""
    textures, name, seen = {}, strip(model), set()
    while name and name not in seen:
        seen.add(name)
        entry = models.get(name)
        if not entry:
            break
        for key, value in (entry.get("textures") or {}).items():
            textures.setdefault(key, value)
        name = strip(entry["parent"]) if "parent" in entry else None
    return textures


def resolve(textures: dict, key: str, depth: int = 0):
    """把 "#side" 这种引用解开，指到真正的贴图路径。"""
    value = textures.get(key)
    if value is None or depth > 8:
        return None
    return resolve(textures, value[1:], depth + 1) if value.startswith("#") else strip(value)


def pick_texture(textures: dict) -> str:
    for key in TEXTURE_PRIORITY:
        if key in textures:
            path = resolve(textures, key)
            if path:
                return path
    for key in textures:
        path = resolve(textures, key)
        if path:
            return path
    return None


def main(argv: list) -> int:
    from PIL import Image

    overwrite = "--all" in argv
    dry_run = "--dry-run" in argv

    data = load_assets()
    states, models, atlas_map = data["blockstates"], data["models"], data["textures"]
    atlas = Image.open(ATLAS_PNG).convert("RGBA")
    os.makedirs(BLOCK_DIR, exist_ok=True)
    existing = {os.path.splitext(f)[0] for f in os.listdir(BLOCK_DIR) if f.endswith(".png")}

    written = skipped = unresolved = 0
    missing_names = []
    for block_id in sorted(states):
        if block_id in SKIP:
            continue
        if block_id in existing and not overwrite:
            skipped += 1
            continue

        model = first_model(states[block_id])
        path = pick_texture(merged_textures(models, model)) if model else None
        box = atlas_map.get(path) if path else None
        if box is None:
            unresolved += 1
            missing_names.append(block_id)
            continue

        u, v, width, height = box
        # 动态贴图（水、火、传送门）在图集里是竖着排的一长条，只取第一帧
        height = min(height, width)
        if not dry_run:
            tile = atlas.crop((u, v, u + width, v + height))
            if tile.size != (ICON_SIZE, ICON_SIZE):
                tile = tile.resize((ICON_SIZE, ICON_SIZE), Image.NEAREST)
            tile.save(os.path.join(BLOCK_DIR, f"{block_id}.png"))
        written += 1

    print(f"{'（预演）' if dry_run else ''}生成 {written} 个，跳过已有 {skipped} 个，"
          f"解析不出贴图 {unresolved} 个")
    if missing_names:
        print("  解析不出的:", ", ".join(missing_names[:12]),
              "..." if len(missing_names) > 12 else "")
    print(f"block/ 现在共 {len(os.listdir(BLOCK_DIR))} 个文件")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
