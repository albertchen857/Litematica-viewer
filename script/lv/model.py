"""统一结构模型。

三种文件格式（.litematic / .nbt / .mcstructure）读进来后一律转成这里的
``Structure``，后面的统计、分类、步骤查看器、3D 渲染只认这一种数据结构，
不需要知道文件原本长什么样。写回文件时再由 formats.py 按各自格式的规矩转出去。

存储方式和三种格式内部是一致的：一张调色板 + 一个索引三维数组。
好处是统计可以直接用 numpy 数它每个索引出现几次（O(调色板大小)），
而不是像旧版那样一个个 for 循环遍历几十万个方块。

约定：``palette[0]`` 永远是 ``minecraft:air``，索引 0 表示这里没方块。
"""

from dataclasses import dataclass, field

import numpy as np

AIR_IDS = frozenset({"minecraft:air", "minecraft:cave_air", "minecraft:void_air"})


@dataclass(frozen=True)
class Block:
    """一个方块状态，等价于 litematica 的 BlockState / mcstructure 的 block_palette 项。"""

    id: str = "minecraft:air"
    props: tuple = ()  # (("facing", "north"), ...) 用元组是为了能 hash 去重

    @staticmethod
    def make(block_id: str, props=None) -> "Block":
        props = props or {}
        return Block(block_id, tuple(sorted((str(k), str(v)) for k, v in props.items())))

    @property
    def properties(self) -> dict:
        return dict(self.props)

    @property
    def name(self) -> str:
        """去掉命名空间：minecraft:oak_stairs -> oak_stairs"""
        return self.id.split(":")[-1]

    @property
    def is_air(self) -> bool:
        return self.id in AIR_IDS

    def __str__(self) -> str:
        if not self.props:
            return self.id
        inner = ",".join(f"{k}={v}" for k, v in self.props)
        return f"{self.id}[{inner}]"


AIR = Block("minecraft:air", ())


@dataclass
class Region:
    """结构里的一块区域。litematic 可以有多块，nbt/mcstructure 只有一块。"""

    name: str
    indices: np.ndarray  # shape (sx, sy, sz)，值为 palette 下标
    palette: list  # list[Block]，palette[0] 恒为空气
    origin: tuple = (0, 0, 0)
    block_entities: dict = field(default_factory=dict)  # {(x, y, z): NBT dict}
    entities: list = field(default_factory=list)  # [{"id": ..., "nbt": {...}}, ...]

    @property
    def size(self) -> tuple:
        return tuple(int(n) for n in self.indices.shape)

    @property
    def volume(self) -> int:
        return int(self.indices.size)

    def block_at(self, x: int, y: int, z: int) -> Block:
        return self.palette[int(self.indices[x, y, z])]

    def palette_counts(self) -> np.ndarray:
        """每个调色板下标在区域里出现的次数。统计功能全都建立在这一个调用上。"""
        return np.bincount(self.indices.ravel(), minlength=len(self.palette))

    def non_air_count(self) -> int:
        counts = self.palette_counts()
        return int(sum(n for i, n in enumerate(counts) if not self.palette[i].is_air))


@dataclass
class Structure:
    """一个完整的结构文件。"""

    regions: list = field(default_factory=list)
    name: str = "Unnamed"
    author: str = ""
    description: str = ""
    source_format: str = "litematic"  # litematic / nbt / mcstructure
    version_label: str = ""  # 给界面显示的版本描述，如 "1.20.6+"
    meta: dict = field(default_factory=dict)  # 各格式特有的原始字段，写回时用得上

    @property
    def size(self) -> tuple:
        """所有区域的包围盒尺寸。"""
        if not self.regions:
            return (0, 0, 0)
        highs = [
            tuple(o + s for o, s in zip(r.origin, r.size)) for r in self.regions
        ]
        lows = [r.origin for r in self.regions]
        return tuple(
            max(h[i] for h in highs) - min(l[i] for l in lows) for i in range(3)
        )

    @property
    def total_blocks(self) -> int:
        return sum(r.non_air_count() for r in self.regions)

    @property
    def volume(self) -> int:
        return sum(r.volume for r in self.regions)


# --------------------------------------------------------------------------- 构造辅助

def build_region(name: str, size: tuple, lookup, origin=(0, 0, 0), **kwargs) -> Region:
    """从 ``lookup(x, y, z) -> Block`` 建一个 Region，自动去重生成调色板。

    各格式的 reader 都用它，省得每个 reader 都写一遍去重逻辑。
    """
    size_x, size_y, size_z = (int(n) for n in size)
    palette = [AIR]
    seen = {AIR: 0}
    indices = np.zeros((size_x, size_y, size_z), dtype=np.int32)
    for x in range(size_x):
        for y in range(size_y):
            for z in range(size_z):
                block = lookup(x, y, z)
                if block is None or block.is_air:
                    continue
                index = seen.get(block)
                if index is None:
                    index = seen[block] = len(palette)
                    palette.append(block)
                indices[x, y, z] = index
    return Region(name, shrink_dtype(indices, len(palette)), palette, tuple(origin), **kwargs)


def region_from_indices(name, indices, palette, origin=(0, 0, 0), **kwargs) -> Region:
    """已经拿到索引数组时用这个，顺便把 palette[0] 归一成空气。"""
    palette = list(palette)
    indices = np.asarray(indices)
    if not palette:
        palette = [AIR]
    if not palette[0].is_air:
        # 原格式的 0 号不是空气，整体后移一位给空气腾出 0 号
        palette.insert(0, AIR)
        indices = indices + 1
    indices = np.where(indices < 0, 0, indices)  # mcstructure 的 -1（结构空位）当空气
    return Region(name, shrink_dtype(indices, len(palette)), palette, tuple(origin), **kwargs)


def shrink_dtype(indices: np.ndarray, palette_size: int) -> np.ndarray:
    """调色板小的时候用小整数，几百万方块的结构能省一大半内存。"""
    if palette_size <= 0x7F:
        return indices.astype(np.int8, copy=False)
    if palette_size <= 0x7FFF:
        return indices.astype(np.int16, copy=False)
    return indices.astype(np.int32, copy=False)
