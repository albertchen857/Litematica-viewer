"""生成结构的等轴测缩略图，存成 PNG。

和左上角那个实时预览（thumbnail.py，走 OpenGL）不是一回事：这里是纯 PIL 软件渲染，
不依赖显卡也不依赖 pyopengltk，所以三个平台都能导出图片，macOS 上也能用。

画法：只取暴露在外的方块 -> 投影到标准等轴（yaw 45°、pitch 30°）-> 按深度从远到近画
-> 每个方块画三个可见面，顶面最亮、两个侧面依次压暗。
"""

import math

import numpy as np
from PIL import Image, ImageDraw

from .thumbnail import block_color
from .formats import flatten_regions

YAW = math.radians(45)    # 标准等轴：绕竖轴 45°
PITCH = math.radians(30)  # 俯角 30°
SHADES = (1.0, 0.76, 0.58)  # 顶面 / 两个侧面

# 立方体 8 个角，下标是 dx*4 + dy*2 + dz
_CORNERS = np.array(
    [(dx, dy, dz) for dx in (0, 1) for dy in (0, 1) for dz in (0, 1)], dtype=np.float32
)
# (四个角的下标, 面法线)
_FACES = (
    ((2, 6, 7, 3), (0, 1, 0)),   # 顶
    ((0, 1, 5, 4), (0, -1, 0)),  # 底
    ((4, 5, 7, 6), (1, 0, 0)),   # +X
    ((0, 2, 3, 1), (-1, 0, 0)),  # -X
    ((1, 3, 7, 5), (0, 0, 1)),   # +Z
    ((0, 4, 6, 2), (0, 0, -1)),  # -Z
)

# 超过这么多方块就等距抽稀，否则一张图要画几十万个多边形
MAX_CUBES = 40_000


def _surface(indices: np.ndarray) -> np.ndarray:
    """只留暴露在外的方块。实心内部画了也看不见。"""
    solid = indices != 0
    if not solid.any():
        return solid
    hidden = solid.copy()
    for axis in range(3):
        for shift in (1, -1):
            neighbour = np.roll(solid, shift, axis=axis)
            edge = [slice(None)] * 3
            edge[axis] = 0 if shift == 1 else -1
            neighbour[tuple(edge)] = False
            hidden &= neighbour
    return solid & ~hidden


def _project(points: np.ndarray) -> np.ndarray:
    """绕 Y 转 YAW，再绕 X 抬 PITCH，正交投影。返回 (屏幕x, 屏幕y, 深度)。"""
    cos_y, sin_y = math.cos(YAW), math.sin(YAW)
    cos_p, sin_p = math.cos(PITCH), math.sin(PITCH)
    x, y, z = points[..., 0], points[..., 1], points[..., 2]
    rx = x * cos_y - z * sin_y
    rz = x * sin_y + z * cos_y
    ry = y * cos_p - rz * sin_p
    depth = y * sin_p + rz * cos_p
    return np.stack([rx, -ry, depth], axis=-1)


def render(structure, size: int = 1024, background=(0, 0, 0, 0)) -> Image.Image:
    """渲染一张等轴测图。背景默认透明。"""
    region = flatten_regions(structure)
    indices = np.asarray(region.indices)
    mask = _surface(indices)
    if not mask.any():
        return Image.new("RGBA", (size, size), background)

    coords = np.argwhere(mask)
    if len(coords) > MAX_CUBES:
        coords = coords[:: int(np.ceil(len(coords) / MAX_CUBES))]
    palette_ids = indices[coords[:, 0], coords[:, 1], coords[:, 2]]
    colours = np.array(
        [block_color(region.palette[int(i)].id) for i in palette_ids], dtype=np.float32
    ) * 255.0

    centred = coords.astype(np.float32) - (coords.max(axis=0) + coords.min(axis=0)) / 2.0
    corners = _project(centred[:, None, :] + _CORNERS[None, :, :] - 0.5)
    screen, depth = corners[:, :, :2], corners[:, :, 2]

    margin = size * 0.04
    span = max(np.ptp(screen[:, :, 0]), np.ptp(screen[:, :, 1]), 1e-6)
    screen *= (size - 2 * margin) / span
    for axis in (0, 1):
        low, high = screen[:, :, axis].min(), screen[:, :, axis].max()
        screen[:, :, axis] += size / 2 - (low + high) / 2

    # 哪些面朝着相机：法线转到相机坐标系后深度分量为负
    normal_depth = _project(np.array([n for _i, n in _FACES], dtype=np.float32))[:, 2]
    visible = [i for i in range(len(_FACES)) if normal_depth[i] < -1e-6]
    shade = {f: SHADES[min(r, len(SHADES) - 1)]
             for r, f in enumerate(sorted(visible, key=lambda i: normal_depth[i]))}
    if 0 in visible:
        shade[0] = SHADES[0]

    image = Image.new("RGBA", (size, size), background)
    draw = ImageDraw.Draw(image)
    for cube in np.argsort(-depth.mean(axis=1)):  # 画家算法：远的先画
        base, points = colours[cube], screen[cube]
        for face in visible:
            idx, _normal = _FACES[face]
            factor = shade[face]
            draw.polygon(
                [tuple(points[i]) for i in idx],
                fill=(int(base[0] * factor), int(base[1] * factor), int(base[2] * factor), 255),
            )
    return image


def save(structure, path: str, size: int = 1024) -> int:
    """渲染并保存成 PNG，返回画了多少个方块。"""
    region = flatten_regions(structure)
    count = int(_surface(np.asarray(region.indices)).sum())
    render(structure, size).save(path)
    return count


# --------------------------------------------------------------------------- 写进投影文件

# Litematica 自己的预览图就是 140×140，照抄这个尺寸，不然它的投影浏览界面显示会不对
PREVIEW_SIZE = 140
# 预览图要不透明，用 Litematica 自己那种浅灰蓝打底
PREVIEW_BG = (240, 243, 247, 255)


def to_argb_ints(image: Image.Image) -> np.ndarray:
    """PIL 图 -> Litematica 要的 ARGB int32 数组（行优先）。

    打包方式是 (a<<24)|(r<<16)|(g<<8)|b。带 alpha 的值超过 2^31，
    NBT 的 int 是有符号的，astype(int32) 正好按补码回绕成负数，和 Java 一致。
    """
    pixels = np.asarray(image.convert("RGBA"), dtype=np.uint32)
    r, g, b, a = pixels[:, :, 0], pixels[:, :, 1], pixels[:, :, 2], pixels[:, :, 3]
    return ((a << 24) | (r << 16) | (g << 8) | b).reshape(-1).astype(np.int32)


def embed(structure, path: str) -> int:
    """把等轴缩略图写进 .litematic 的 Metadata.PreviewImageData，原地改文件。

    这是 Litematica 专有的字段（.nbt / .mcstructure 没有对应的地方），
    写进去之后在游戏里的投影浏览界面就能看到缩略图。
    返回渲染了多少个方块。
    """
    import amulet_nbt as nbt

    from .formats import LITEMATIC, detect_format

    if detect_format(path) != LITEMATIC:
        raise ValueError(path)

    image = render(structure, PREVIEW_SIZE, background=PREVIEW_BG)
    named = nbt.load(path, compressed=True)
    metadata = named.tag.get("Metadata")
    if metadata is None:
        metadata = named.tag["Metadata"] = nbt.CompoundTag({})
    metadata["PreviewImageData"] = nbt.IntArrayTag(to_argb_ints(image))
    named.save_to(path, compressed=True)

    region = flatten_regions(structure)
    return int(_surface(np.asarray(region.indices)).sum())
