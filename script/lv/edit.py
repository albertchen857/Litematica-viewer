"""结构编辑：生成图形投影、批量替换方块、改 litematic 版本号。

替换方块这块和旧版思路完全不同：旧版对着每一个方块坐标做判断，一个大投影要跑几十秒；
现在只对调色板（几十条）算一次映射表，再把映射表套到索引数组上，几乎是瞬间完成。
"""

import json
import os

import numpy as np

from .model import AIR, Block, Region, Structure


# --------------------------------------------------------------------------- 生成

def create_cube(
    block_id: str,
    size: tuple,
    origin: tuple = (0, 0, 0),
    hollow: bool = False,
    thickness: int = 1,
    faces: tuple = (True, True, True, True, True, True),
) -> Structure:
    """生成一个长方体。

    :param size: (宽 x, 高 y, 长 z)
    :param hollow: 只留外壳
    :param thickness: 外壳厚度
    :param faces: 六个面开不开，顺序是 -X, +X, -Y, +Y, -Z, +Z
    """
    size_x, size_y, size_z = (max(1, int(v or 1)) for v in size)
    block = Block.make(block_id or "minecraft:cobblestone")

    filled = np.ones((size_x, size_y, size_z), dtype=bool)
    if hollow:
        thickness = max(1, int(thickness))
        shell = np.zeros_like(filled)
        axes = [(0, size_x), (1, size_y), (2, size_z)]
        for face_index, (axis, length) in enumerate(
            [axes[0], axes[0], axes[1], axes[1], axes[2], axes[2]]
        ):
            if not faces[face_index]:
                continue
            low_side = face_index % 2 == 0
            index = [slice(None)] * 3
            index[axis] = slice(0, thickness) if low_side else slice(max(0, length - thickness), length)
            shell[tuple(index)] = True
        filled = shell

    indices = filled.astype(np.int32)  # True -> 1（调色板 1 号），False -> 0（空气）
    region = Region("Cube", indices, [AIR, block], tuple(int(v or 0) for v in origin))
    return Structure(regions=[region], name="Cube", description=f"{block.id} {size_x}x{size_y}x{size_z}")


# --------------------------------------------------------------------------- 批量替换

class RuleError(ValueError):
    pass


def parse_rules(text: str, name_to_id=None) -> dict:
    """解析替换规则文本。

    格式（逗号分隔多条，属性部分是 JSON，可省略）::

        iron_block-dirt
        hopper{"facing":"west"}-hopper{"facing":"down"}

    返回 ``{原id: (新id, 需要匹配的属性, 要改成的属性)}``。
    旧版这里用的是 eval()，等于让规则框可以执行任意代码，换成 json.loads。
    """
    rules = {}
    for chunk in text.replace("\n", ",").split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" not in chunk:
            raise RuleError(chunk)
        source, target = chunk.split("-", 1)
        source_id, source_props = _split_rule(source, name_to_id)
        target_id, target_props = _split_rule(target, name_to_id)
        rules[source_id] = (target_id, source_props, target_props)
    if not rules:
        raise RuleError("")
    return rules


def _split_rule(text: str, name_to_id) -> tuple:
    text = text.strip()
    props = {}
    if "{" in text:
        head, raw = text[: text.index("{")], text[text.index("{") :]
        try:
            props = {str(k): str(v) for k, v in json.loads(raw).items()}
        except json.JSONDecodeError as exc:
            raise RuleError(raw) from exc
    else:
        head = text
    head = head.strip()
    if name_to_id:
        head = name_to_id(head)
    return (head if ":" in head else f"minecraft:{head}"), props


def replace_blocks(structure: Structure, rules: dict, limits: tuple = None) -> tuple:
    """按规则替换方块，返回 (新结构, 替换了多少个)。

    :param limits: ((xmin, xmax), (ymin, ymax), (zmin, zmax))，None 或空字符串表示不限。
    """
    regions, replaced = [], 0
    for region in structure.regions:
        # 先算调色板映射：哪些调色板条目要变成什么
        palette = list(region.palette)
        remap = np.arange(len(palette), dtype=np.int32)
        for index, block in enumerate(palette):
            rule = rules.get(block.id)
            if rule is None:
                continue
            target_id, need_props, set_props = rule
            if not need_props.items() <= block.properties.items():
                continue
            new_props = {**block.properties, **set_props}
            new_block = Block.make(target_id, new_props)
            if new_block in palette:
                remap[index] = palette.index(new_block)
            else:
                remap[index] = len(palette)
                palette.append(new_block)

        indices = region.indices.astype(np.int32)
        mask = _limit_mask(indices.shape, region.origin, limits)
        changed = mask & (remap[indices] != indices)
        replaced += int(np.count_nonzero(changed))
        indices = np.where(changed, remap[indices], indices)

        regions.append(
            Region(
                region.name,
                indices,
                palette,
                region.origin,
                dict(region.block_entities),
                list(region.entities),
            )
        )

    result = Structure(
        regions=regions,
        name=structure.name,
        author=structure.author,
        description=structure.description,
        source_format=structure.source_format,
        version_label=structure.version_label,
        meta=dict(structure.meta),
    )
    return result, replaced


def _limit_mask(shape: tuple, origin: tuple, limits) -> np.ndarray:
    """把坐标范围限制变成一个布尔掩码。限制是世界坐标，要减掉区域原点。"""
    mask = np.ones(shape, dtype=bool)
    if not limits:
        return mask
    for axis, bounds in enumerate(limits):
        low, high = (bounds or ("", ""))[:2]
        coords = np.arange(shape[axis]) + origin[axis]
        keep = np.ones(shape[axis], dtype=bool)
        if str(low).strip() not in ("", "None"):
            keep &= coords >= int(low)
        if str(high).strip() not in ("", "None"):
            keep &= coords <= int(high)
        view = [1, 1, 1]
        view[axis] = shape[axis]
        mask &= keep.reshape(view)
    return mask


# --------------------------------------------------------------------------- 跨版本

VERSION_CHOICES = ((7, "1.20.6+"), (6, "1.14 ~ 1.20.5"), (3, "1.13 (1.12 可能出错)"))


def change_litematic_version(path: str, version: int) -> str:
    """改 .litematic 的 Version 标签，另存成 xxx_v6.litematic，返回新文件路径。"""
    import amulet_nbt as nbt

    named = nbt.load(path, compressed=True)
    if "Version" not in named.tag:
        raise ValueError(path)
    named.tag["Version"] = nbt.IntTag(int(version))
    folder, filename = os.path.split(path)
    stem, extension = os.path.splitext(filename)
    target = os.path.join(folder, f"{stem}_v{version}{extension}")
    named.save_to(target, compressed=True)
    return target
