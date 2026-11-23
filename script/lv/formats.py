"""结构文件的读写，全部进出 model.Structure。

    .litematic    Litematica 模组       gzip + 大端 NBT，方块用位压缩存，交给 litemapy 处理
    .nbt          Java 原版结构方块      gzip + 大端 NBT，一个方块一条记录
    .mcstructure  基岩版结构方块         不压缩 + 小端 NBT，索引数组按 ZYX 排
    .schem        WorldEdit / Sponge v1–v3  gzip + 大端 NBT，调色板 + varint 字节流（能读能写，写 v2）
    .schematic    MCEdit / 老 WorldEdit  1.12 及以前，数字 ID（只读，见 legacy.py）

格式细节依据 minecraft.wiki 的 Structure file / Bedrock level format 条目。
基岩版索引换算是 ``index = SZ*SY*X + SZ*Y + Z``，值 -1 表示结构空位（读进来当空气）。
"""

import os

import amulet_nbt as nbt
import numpy as np

from . import blockmap, legacy
from .model import AIR, Block, Region, Structure, region_from_indices

LITEMATIC = "litematic"
JAVA_NBT = "nbt"
MCSTRUCTURE = "mcstructure"
SCHEM = "schem"
SCHEMATIC = "schematic"

EXTENSIONS = {".litematic": LITEMATIC, ".nbt": JAVA_NBT, ".mcstructure": MCSTRUCTURE,
              ".schem": SCHEM, ".schematic": SCHEMATIC}

FILE_TYPES = [
    ("All supported", "*.litematic *.nbt *.mcstructure *.schem *.schematic"),
    ("Litematica", "*.litematic"),
    ("Java structure", "*.nbt"),
    ("Bedrock structure", "*.mcstructure"),
    ("WorldEdit", "*.schem *.schematic"),
    ("All files", "*.*"),
]


class UnsupportedFormat(Exception):
    pass


def detect_format(path: str) -> str:
    fmt = EXTENSIONS.get(os.path.splitext(path)[1].lower())
    if fmt is None:
        raise UnsupportedFormat(os.path.basename(path))
    return fmt


# --------------------------------------------------------------------------- NBT 小工具

def to_python(tag):
    """把 amulet_nbt / nbtlib 的标签递归转成普通 dict/list/int/str。

    容器分析器、方块实体这些地方只想拿数据，不想关心是哪个 NBT 库的对象。
    """
    if hasattr(tag, "keys") and hasattr(tag, "__getitem__"):
        return {str(k): to_python(v) for k, v in tag.items()}
    if isinstance(tag, (list, tuple)) or (hasattr(tag, "__iter__") and not isinstance(tag, (str, bytes))):
        return [to_python(v) for v in tag]
    value = getattr(tag, "py_data", tag)
    if isinstance(value, (bytes, bytearray)):
        return list(value)
    return value


def _int_list(tag) -> list:
    return [int(v) for v in tag]


def _read_nbt(path: str, little_endian: bool):
    """读 NBT。压缩与否各家不一样，两种都试一遍。"""
    last = None
    for compressed in (True, False):
        try:
            return nbt.load(path, compressed=compressed, little_endian=little_endian)
        except Exception as exc:
            last = exc
    raise last


# --------------------------------------------------------------------------- .litematic

def _blockstate_props(state) -> dict:
    """litemapy 的 BlockState 没有公开属性字典，只能取私有字段，取不到就解析文本。"""
    props = getattr(state, "_BlockState__properties", None)
    if props is not None:
        return {str(k): str(v) for k, v in dict(props).items()}
    text = str(state)
    if "[" not in text:
        return {}
    inner = text[text.index("[") + 1 : text.rindex("]")]
    return dict(pair.split("=", 1) for pair in inner.split(",") if "=" in pair)


def _load_litematic(path: str) -> Structure:
    from litemapy import Schematic

    schematic = Schematic.load(path)
    regions = []
    for name, region in schematic.regions.items():
        palette = [Block.make(state.id, _blockstate_props(state)) for state in region.palette]
        indices = np.asarray(region._Region__blocks)
        block_entities = {
            tuple(int(v) for v in te.position): to_python(te.data) for te in region.tile_entities
        }
        # 尺寸可以是负的（区域从 Position 往负方向长）：litemapy 的方块数组从最小角开始，
        # 原点要用最小角（region.x + min_x()），不然多区域对不齐；实体坐标是相对 Position 的，也换成相对最小角
        lo = (region.min_x(), region.min_y(), region.min_z())
        # raw 留着原始标签，同格式另存时原样写回去（坐标按 pos 改），不会丢精度
        entities = [
            {"id": str(e.id), "nbt": to_python(e.data), "raw": e.data,
             "pos": [float(p) - float(m) for p, m in zip(e.position, lo)]}
            for e in region.entities
        ]
        regions.append(
            region_from_indices(
                str(name),
                indices,
                palette,
                origin=(int(region.x) + lo[0], int(region.y) + lo[1], int(region.z) + lo[2]),
                block_entities=block_entities,
                entities=entities,
            )
        )

    version = int(schematic.lm_version)
    if version <= 3:
        label = "1.12 / 1.13"
    elif version <= 6:
        label = "1.14 ~ 1.20.5"
    else:
        label = "1.20.6+"

    declared = 0
    try:  # Metadata.TotalBlocks 只用来和自己数出来的对账，读不到就算了
        declared = int(_read_nbt(path, False).tag["Metadata"]["TotalBlocks"])
    except Exception:
        pass

    return Structure(
        regions=regions,
        name=str(schematic.name),
        author=str(schematic.author),
        description=str(schematic.description),
        source_format=LITEMATIC,
        version_label=label,
        meta={"lm_version": version, "mc_version": int(schematic.mc_version), "declared_blocks": declared},
    )


def _to_nbtlib(value):
    """普通 python 数据转 nbtlib 标签（litemapy 用的是 nbtlib，不是 amulet_nbt）。"""
    import nbtlib

    if isinstance(value, dict):
        return nbtlib.Compound({str(k): _to_nbtlib(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        return nbtlib.List([_to_nbtlib(v) for v in value])
    if isinstance(value, bool):
        return nbtlib.Byte(int(value))
    if isinstance(value, int):
        return nbtlib.Int(value)
    if isinstance(value, float):
        return nbtlib.Double(value)
    return nbtlib.String(str(value))


def _save_litematic(structure: Structure, path: str, report=None) -> None:
    import nbtlib
    from litemapy import BlockState, Region as LitRegion, Schematic
    from litemapy.minecraft import Entity, TileEntity

    regions = {}
    for index, region in enumerate(structure.regions):
        size_x, size_y, size_z = region.size
        target = LitRegion(*region.origin, size_x, size_y, size_z)
        states = [BlockState(b.id, **b.properties) for b in region.palette]
        for x, y, z in zip(*np.nonzero(region.indices)):  # 空气是 0，跳过能快很多
            target[int(x), int(y), int(z)] = states[int(region.indices[x, y, z])]

        for entity in region.entities:
            raw = entity.get("raw")
            if isinstance(raw, nbtlib.Compound) and "id" in raw:
                tag = raw  # 同样来自 litematic，原样写回最保险
                if entity.get("pos"):  # 读的时候换算到最小角了，新区域尺寸是正的，坐标就是这个
                    tag = nbtlib.Compound(dict(raw))
                    tag["Pos"] = nbtlib.List[nbtlib.Double]([nbtlib.Double(v) for v in entity["pos"]])
            else:
                # 基岩版实体用的是 identifier，litemapy 要求必须有 id，这里补上
                payload = dict(entity.get("nbt") or {})
                payload["id"] = entity.get("id") or payload.get("identifier") or "minecraft:pig"
                tag = _to_nbtlib(payload)
            try:
                target.entities.append(Entity(tag))
            except Exception as exc:  # 单个实体转不过去不该让整个保存失败
                print(f"[litematic] 跳过实体 {entity.get('id')}: {exc}")
        for position, data in region.block_entities.items():
            payload = dict(data)
            payload.setdefault("id", region.block_at(*position).id)
            payload["x"], payload["y"], payload["z"] = (int(v) for v in position)
            target.tile_entities.append(TileEntity(_to_nbtlib(payload)))

        regions[region.name or f"Region{index}"] = target

    schematic = Schematic(
        name=structure.name or "Unnamed",
        author=structure.author,
        description=structure.description,
        regions=regions,
        lm_version=int(structure.meta.get("lm_version", 6)),
        mc_version=int(structure.meta.get("mc_version", 2975)),
    )
    schematic.save(path)


def set_litematic_description(path: str, text: str) -> None:
    """只改 Metadata.Description，其它字段（含预览图）原样保留，所以不走 litemapy 整体重写。"""
    named = nbt.load(path, compressed=True)
    metadata = named.tag.get("Metadata")
    if metadata is None:
        metadata = named.tag["Metadata"] = nbt.CompoundTag({})
    metadata["Description"] = nbt.StringTag(text)
    named.save_to(path, compressed=True)


# --------------------------------------------------------------------------- .nbt (Java)

def _load_java_nbt(path: str) -> Structure:
    root = _read_nbt(path, little_endian=False).tag
    size_x, size_y, size_z = _int_list(root["size"])

    raw_palette = root.get("palette")
    if raw_palette is None and "palettes" in root:
        raw_palette = root["palettes"][0]  # 多调色板变体（沉船之类），用第一套
    palette = [AIR]
    for entry in raw_palette or []:
        props = {str(k): str(v) for k, v in entry.get("Properties", {}).items()} if "Properties" in entry else {}
        palette.append(Block.make(str(entry["Name"]), props))

    indices = np.zeros((size_x, size_y, size_z), dtype=np.int32)
    block_entities = {}
    for entry in root.get("blocks", []):
        x, y, z = _int_list(entry["pos"])
        if not (0 <= x < size_x and 0 <= y < size_y and 0 <= z < size_z):
            continue
        indices[x, y, z] = int(entry["state"]) + 1  # +1 因为我们在 0 号插了空气
        if "nbt" in entry:
            block_entities[(x, y, z)] = to_python(entry["nbt"])

    entities = []
    for entry in root.get("entities", []):
        data = to_python(entry.get("nbt", {}))
        entities.append(
            {
                "id": str(data.get("id", "minecraft:unknown")),
                "nbt": data,
                "pos": [float(v) for v in entry["pos"]] if "pos" in entry else None,
            }
        )

    data_version = int(root.get("DataVersion", 0) or 0)
    region = region_from_indices(
        "structure", indices, palette, block_entities=block_entities, entities=entities
    )
    return Structure(
        regions=[region],
        name=os.path.splitext(os.path.basename(path))[0],
        author=str(root.get("author", "")),
        source_format=JAVA_NBT,
        version_label=f"DataVersion {data_version}" if data_version else "",
        meta={"DataVersion": data_version},
    )


def _save_java_nbt(structure: Structure, path: str, report=None) -> None:
    region = flatten_regions(structure)
    size_x, size_y, size_z = region.size

    # palette[0] 是我们自己加的空气，Java 格式里空气也要占一个调色板位才好写
    palette_tags = []
    for block in region.palette:
        entry = nbt.CompoundTag({"Name": nbt.StringTag(block.id)})
        if block.props:
            entry["Properties"] = nbt.CompoundTag(
                {k: nbt.StringTag(v) for k, v in block.props}
            )
        palette_tags.append(entry)

    blocks = []
    for x, y, z in zip(*np.nonzero(region.indices)):
        x, y, z = int(x), int(y), int(z)
        entry = nbt.CompoundTag(
            {
                "state": nbt.IntTag(int(region.indices[x, y, z])),
                "pos": nbt.ListTag([nbt.IntTag(x), nbt.IntTag(y), nbt.IntTag(z)]),
            }
        )
        block_entity = region.block_entities.get((x, y, z))
        if block_entity:
            entry["nbt"] = _from_python(block_entity)
        blocks.append(entry)

    root = nbt.CompoundTag(
        {
            "DataVersion": nbt.IntTag(int(structure.meta.get("DataVersion", 3953))),
            "size": nbt.ListTag([nbt.IntTag(size_x), nbt.IntTag(size_y), nbt.IntTag(size_z)]),
            "palette": nbt.ListTag(palette_tags, 10),
            "blocks": nbt.ListTag(blocks, 10),
            "entities": nbt.ListTag(_java_entity_tags(region), 10),
        }
    )
    nbt.NamedTag(root, "").save_to(path, compressed=True, little_endian=False)


def _entity_position(entity: dict) -> list:
    """从实体 NBT 里掏出坐标。Java 用 Pos，基岩用 Pos，字段名一样但类型不同。"""
    if entity.get("pos"):
        return [float(v) for v in entity["pos"]]
    raw = entity.get("nbt") or {}
    for key in ("Pos", "pos"):
        value = raw.get(key)
        if isinstance(value, list) and len(value) >= 3:
            try:
                return [float(v) for v in value[:3]]
            except (TypeError, ValueError):
                break
    return [0.0, 0.0, 0.0]


def _java_entity_tags(region: Region) -> list:
    tags = []
    for entity in region.entities:
        x, y, z = _entity_position(entity)
        payload = dict(entity.get("nbt") or {})
        payload.setdefault("id", entity.get("id", "minecraft:unknown"))
        tags.append(
            nbt.CompoundTag(
                {
                    "pos": nbt.ListTag([nbt.DoubleTag(x), nbt.DoubleTag(y), nbt.DoubleTag(z)]),
                    "blockPos": nbt.ListTag(
                        [nbt.IntTag(int(x)), nbt.IntTag(int(y)), nbt.IntTag(int(z))]
                    ),
                    "nbt": _from_python(payload),
                }
            )
        )
    return tags


# --------------------------------------------------------------------------- .mcstructure (基岩)

def _bedrock_entity_tags(region: Region) -> list:
    """基岩实体用 identifier 而不是 id，其余字段尽量原样带过去。"""
    tags = []
    for entity in region.entities:
        x, y, z = _entity_position(entity)
        payload = dict(entity.get("nbt") or {})
        payload.pop("id", None)
        payload["identifier"] = entity.get("id", "minecraft:unknown")
        payload["Pos"] = [x, y, z]
        tags.append(_from_python(payload))
    return tags


def _load_mcstructure(path: str) -> Structure:
    root = _read_nbt(path, little_endian=True).tag
    size_x, size_y, size_z = _int_list(root["size"])
    body = root["structure"]

    default = body["palette"]["default"]
    # 读进来就换成 Java 命名。内部模型统一用 Java 口径，贴图、中文名、分类表
    # 全都是按 Java id 建的，这样 mcstructure 也能直接享受到。
    palette = [AIR]
    for entry in default["block_palette"]:
        states = {str(k): str(to_python(v)) for k, v in entry.get("states", {}).items()}
        palette.append(blockmap.bedrock_to_java(Block.make(str(entry["name"]), states)))

    layers = body["block_indices"]
    primary = np.array(_int_list(layers[0]), dtype=np.int32)
    # ZYX 序：index = SZ*SY*X + SZ*Y + Z，正好是 (x, y, z) 的 C 序，直接 reshape
    primary = primary.reshape((size_x, size_y, size_z))
    indices = np.where(primary < 0, -1, primary + 1)  # -1 是结构空位，其余 +1 给空气腾位

    # 第二层通常只放水，用来表示 Java 的 waterlogged
    waterlogged = np.zeros_like(indices, dtype=bool)
    if len(layers) > 1:
        second = np.array(_int_list(layers[1]), dtype=np.int32).reshape(indices.shape)
        water_ids = {
            i for i, entry in enumerate(default["block_palette"]) if "water" in str(entry["name"])
        }
        for water_id in water_ids:
            waterlogged |= second == water_id

    block_entities = {}
    for key, value in default.get("block_position_data", {}).items():
        flat = int(key)
        x, y, z = flat // (size_z * size_y), flat // size_z % size_y, flat % size_z
        if "block_entity_data" in value:
            block_entities[(x, y, z)] = to_python(value["block_entity_data"])

    entities = []
    for entry in body.get("entities", []):
        data = to_python(entry)
        entities.append(
            {"id": str(data.get("identifier") or data.get("id") or "minecraft:unknown"), "nbt": data}
        )

    region = region_from_indices(
        "structure",
        indices,
        palette,
        origin=tuple(_int_list(root.get("structure_world_origin", nbt.ListTag([nbt.IntTag(0)] * 3)))),
        block_entities=block_entities,
        entities=entities,
    )
    # 基岩转 Java 语义：把第二层的水折回 waterlogged 属性
    _apply_waterlogged(region, waterlogged)
    return Structure(
        regions=[region],
        name=os.path.splitext(os.path.basename(path))[0],
        source_format=MCSTRUCTURE,
        version_label=f"format_version {int(root.get('format_version', 1))}",
        meta={"format_version": int(root.get("format_version", 1))},
    )


def _apply_waterlogged(region: Region, waterlogged: np.ndarray) -> None:
    """把「这个坐标第二层是水」变成方块自身的 waterlogged=true 属性。"""
    if not waterlogged.any():
        return
    extra = {}
    indices = region.indices.astype(np.int32)
    for x, y, z in zip(*np.nonzero(waterlogged)):
        old = int(indices[x, y, z])
        block = region.palette[old]
        if block.is_air:
            continue
        new = extra.get(old)
        if new is None:
            wet = Block.make(block.id, {**block.properties, "waterlogged": "true"})
            new = extra[old] = len(region.palette)
            region.palette.append(wet)
        indices[x, y, z] = new
    region.indices = indices


def _save_mcstructure(structure: Structure, path: str, report=None) -> None:
    region = flatten_regions(structure)
    size_x, size_y, size_z = region.size

    # 转成基岩 ID / 状态，含水方块拆出第二层
    converted, water_flags = [], []
    for block in region.palette:
        converted.append(blockmap.java_to_bedrock(block, report) if block is not AIR else AIR)
        water_flags.append(blockmap.is_waterlogged(block))

    palette_tags, remap = [], {}
    for index, block in enumerate(converted):
        if block.is_air:
            remap[index] = -1  # 基岩用 -1 表示这里没方块
            continue
        remap[index] = len(palette_tags)
        palette_tags.append(
            nbt.CompoundTag(
                {
                    "name": nbt.StringTag(block.id),
                    "states": nbt.CompoundTag(
                        {k: nbt.StringTag(v) for k, v in block.props}
                    ),
                    "version": nbt.IntTag(int(structure.meta.get("block_version", 18168865))),
                }
            )
        )

    water_index = -1
    if any(water_flags):  # 第二层要放水，先确保调色板里有水
        water_index = len(palette_tags)
        palette_tags.append(
            nbt.CompoundTag(
                {
                    "name": nbt.StringTag("minecraft:water"),
                    "states": nbt.CompoundTag({"liquid_depth": nbt.IntTag(0)}),
                    "version": nbt.IntTag(int(structure.meta.get("block_version", 18168865))),
                }
            )
        )

    flat = region.indices.reshape(-1).astype(np.int32)  # C 序即 ZYX 序
    lookup = np.array([remap[i] for i in range(len(converted))], dtype=np.int32)
    primary = lookup[flat]
    water_lookup = np.array([water_index if w else -1 for w in water_flags], dtype=np.int32)
    secondary = water_lookup[flat]

    position_data = nbt.CompoundTag({})
    for (x, y, z), data in region.block_entities.items():
        flat_index = size_z * size_y * x + size_z * y + z
        position_data[str(flat_index)] = nbt.CompoundTag(
            {"block_entity_data": _from_python(data)}
        )

    body = nbt.CompoundTag(
        {
            "block_indices": nbt.ListTag(
                [
                    nbt.ListTag([nbt.IntTag(int(v)) for v in primary], 3),
                    nbt.ListTag([nbt.IntTag(int(v)) for v in secondary], 3),
                ],
                9,
            ),
            "entities": nbt.ListTag(_bedrock_entity_tags(region), 10),
            "palette": nbt.CompoundTag(
                {
                    "default": nbt.CompoundTag(
                        {
                            "block_palette": nbt.ListTag(palette_tags, 10),
                            "block_position_data": position_data,
                        }
                    )
                }
            ),
        }
    )
    root = nbt.CompoundTag(
        {
            "format_version": nbt.IntTag(1),
            "size": nbt.ListTag([nbt.IntTag(size_x), nbt.IntTag(size_y), nbt.IntTag(size_z)]),
            "structure": body,
            "structure_world_origin": nbt.ListTag([nbt.IntTag(int(v)) for v in region.origin]),
        }
    )
    nbt.NamedTag(root, "").save_to(path, compressed=False, little_endian=True)


# --------------------------------------------------------------------------- 公共

def _from_python(value):
    """普通 python 数据转回 amulet NBT，写方块实体时用。"""
    if isinstance(value, dict):
        return nbt.CompoundTag({str(k): _from_python(v) for k, v in value.items()})
    if isinstance(value, (list, tuple)):
        tags = [_from_python(v) for v in value]
        return nbt.ListTag(tags, tags[0].tag_id if tags else 1)
    if isinstance(value, bool):
        return nbt.ByteTag(int(value))
    if isinstance(value, int):
        return nbt.IntTag(value)
    if isinstance(value, float):
        return nbt.DoubleTag(value)
    return nbt.StringTag(str(value))


def flatten_regions(structure: Structure) -> Region:
    """.nbt 和 .mcstructure 只支持单区域，多区域的 litematic 要先合并成一块。"""
    if len(structure.regions) == 1 and structure.regions[0].origin == (0, 0, 0):
        return structure.regions[0]

    lows = [min(r.origin[i] for r in structure.regions) for i in range(3)]
    highs = [max(r.origin[i] + r.size[i] for r in structure.regions) for i in range(3)]
    shape = tuple(highs[i] - lows[i] for i in range(3))

    palette, seen = [AIR], {AIR: 0}
    indices = np.zeros(shape, dtype=np.int32)
    for region in structure.regions:
        remap = []
        for block in region.palette:
            if block not in seen:
                seen[block] = len(palette)
                palette.append(block)
            remap.append(seen[block])
        remap = np.array(remap, dtype=np.int32)
        offset = [region.origin[i] - lows[i] for i in range(3)]
        size_x, size_y, size_z = region.size
        window = indices[
            offset[0] : offset[0] + size_x,
            offset[1] : offset[1] + size_y,
            offset[2] : offset[2] + size_z,
        ]
        moved = remap[region.indices.astype(np.int32)]
        np.copyto(window, moved, where=moved != 0)  # 空气不覆盖已有方块

    merged = Region("merged", indices, palette, tuple(lows))
    for region in structure.regions:
        offset = tuple(region.origin[i] - lows[i] for i in range(3))
        for (x, y, z), data in region.block_entities.items():
            merged.block_entities[(x + offset[0], y + offset[1], z + offset[2])] = data
        merged.entities.extend(region.entities)
    return merged


# --------------------------------------------------------------------------- .schem（WorldEdit / Sponge v1–v3）

def _varints(data, count: int) -> np.ndarray:
    """varint 字节流 → 调色板下标（每个数 7 位一组，最高位 1 表示后面还有）。"""
    raw = np.asarray(data, dtype=np.int16).astype(np.uint8)
    if raw.size and not (raw & 0x80).any():          # 调色板不到 128 种：一个字节一个数，直接用
        return raw[:count].astype(np.int32)
    out = np.zeros(count, dtype=np.int32)
    i = p = 0
    n = raw.size
    while i < count and p < n:
        v = shift = 0
        while True:
            b = int(raw[p])
            p += 1
            v |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80 or p >= n:
                break
        out[i] = v
        i += 1
    return out


def _relative_pos(pos, size, offsets):
    """实体坐标：规范是相对结构；有的工具写的是世界坐标，落在结构外面就试着减掉 offset。"""
    if pos is None or len(pos) < 3:
        return None
    pos = [float(v) for v in pos[:3]]

    def inside(p):
        return all(-1 <= v <= size[a] + 1 for a, v in enumerate(p))

    if inside(pos):
        return pos
    for off in offsets:
        if off is not None:
            p = [v - off[a] for a, v in enumerate(pos)]
            if inside(p):
                return p
    return pos


def _load_schem(path: str) -> Structure:
    root = to_python(_read_nbt(path, little_endian=False).tag)
    s = root["Schematic"] if isinstance(root.get("Schematic"), dict) else root
    version = int(s.get("Version", 1))
    size = [int(s.get(k, 0)) & 0xFFFF for k in ("Width", "Height", "Length")]
    w, h, l = size
    box = s.get("Blocks", {}) if version >= 3 else s
    palette_map = box.get("Palette", {})
    ordered = [legacy.parse_state(name) for name, _ in sorted(palette_map.items(), key=lambda kv: int(kv[1]))]
    data = box.get("Data", box.get("BlockData", s.get("BlockData", [])))
    raw = _varints(data, w * h * l)
    # 下标 (y * Length + z) * Width + x → numpy (x, y, z)
    flat = np.zeros(w * h * l, dtype=np.int32)
    flat[: raw.size] = raw
    lookup = np.zeros(max(int(v) for v in palette_map.values()) + 1 if palette_map else 1, dtype=np.int32)
    for name, i in palette_map.items():
        lookup[int(i)] = int(i) + 1                       # +1：0 号让给空气
    indices = lookup[np.clip(flat, 0, lookup.size - 1)].reshape(h, l, w).transpose(2, 0, 1)
    palette = [AIR] + [None] * (lookup.size)
    for name, i in palette_map.items():
        palette[int(i) + 1] = legacy.parse_state(name)
    palette = [b if b is not None else AIR for b in palette]

    block_entities = {}
    for be in box.get("BlockEntities", s.get("BlockEntities", s.get("TileEntities", []))):
        pos = be.get("Pos")
        if pos is None or len(pos) < 3:
            continue
        content = dict(be.get("Data", be))
        content.pop("Pos", None)
        content["id"] = be.get("Id", be.get("id"))
        content.pop("Id", None)
        block_entities[tuple(int(v) for v in pos[:3])] = content

    meta = s.get("Metadata", {}) or {}
    we = [meta.get(k) for k in ("WEOffsetX", "WEOffsetY", "WEOffsetZ")]
    we = we if all(v is not None for v in we) else None
    entities = []
    for e in s.get("Entities", []):
        nbt_data = dict(e.get("Data", e))
        nbt_data["id"] = e.get("Id", e.get("id", "minecraft:unknown"))
        entities.append({"id": str(nbt_data["id"]), "nbt": nbt_data,
                         "pos": _relative_pos(e.get("Pos"), size, [s.get("Offset"), we])})

    data_version = int(s.get("DataVersion", 3953) or 3953)
    region = region_from_indices("schematic", indices, palette, block_entities=block_entities, entities=entities)
    return Structure(
        regions=[region], name=str(meta.get("Name") or os.path.splitext(os.path.basename(path))[0]),
        author=str(meta.get("Author", "")), source_format=SCHEM, version_label=f"Sponge v{version}",
        meta={"DataVersion": data_version},
    )


def _save_schem(structure: Structure, path: str, report=None) -> None:
    """写 Sponge Schematic v2（WorldEdit / FAWE / Axiom 都能读）。"""
    region = flatten_regions(structure)
    indices = np.asarray(region.indices)
    w, h, l = indices.shape
    used = sorted(set(int(v) for v in np.unique(indices)) | {0})
    remap = np.zeros(len(region.palette), dtype=np.int32)
    names = []
    for new, old in enumerate(used):
        remap[old] = new
        b = region.palette[old] if old else AIR
        props = ",".join(f"{k}={v}" for k, v in sorted(b.properties.items()))
        names.append(b.id + (f"[{props}]" if props else ""))
    flat = remap[indices].transpose(1, 2, 0).reshape(-1)    # (x, y, z) → 下标 (y * Length + z) * Width + x
    out = bytearray()
    for v in flat.tolist():
        while True:
            b = v & 0x7F
            v >>= 7
            if v:
                out.append(b | 0x80)
            else:
                out.append(b)
                break

    block_entities = []
    for (x, y, z), data in region.block_entities.items():
        content = {k: v for k, v in (data or {}).items() if k not in ("x", "y", "z", "id")}
        tag = nbt.CompoundTag({k: _from_python(v) for k, v in content.items()})
        tag["Pos"] = nbt.IntArrayTag([x, y, z])
        tag["Id"] = nbt.StringTag(str((data or {}).get("id") or region.palette[int(indices[x, y, z])].id))
        block_entities.append(tag)
    entities = []
    for entity in region.entities:
        content = {k: v for k, v in (entity.get("nbt") or {}).items() if k not in ("id", "identifier")}
        tag = nbt.CompoundTag({k: _from_python(v) for k, v in content.items()})
        tag["Pos"] = nbt.ListTag([nbt.DoubleTag(float(v)) for v in _entity_position(entity)], 6)
        tag["Id"] = nbt.StringTag(str((entity.get("nbt") or {}).get("id") or entity.get("id") or "minecraft:unknown"))
        entities.append(tag)

    root = nbt.CompoundTag({
        "Version": nbt.IntTag(2),
        "DataVersion": nbt.IntTag(int(structure.meta.get("DataVersion") or structure.meta.get("mc_version") or 3953)),
        "Width": nbt.ShortTag(w), "Height": nbt.ShortTag(h), "Length": nbt.ShortTag(l),
        "Offset": nbt.IntArrayTag([0, 0, 0]),
        "Metadata": nbt.CompoundTag({"Name": nbt.StringTag(structure.name or ""), "Author": nbt.StringTag(structure.author or "")}),
        "PaletteMax": nbt.IntTag(len(names)),
        "Palette": nbt.CompoundTag({name: nbt.IntTag(i) for i, name in enumerate(names)}),
        "BlockData": nbt.ByteArrayTag(np.frombuffer(bytes(out), dtype=np.int8)),
        "BlockEntities": nbt.ListTag(block_entities, 10),
        "Entities": nbt.ListTag(entities, 10),
    })
    nbt.NamedTag(root, "Schematic").save_to(path, compressed=True, little_endian=False)


# --------------------------------------------------------------------------- .schematic（MCEdit / 老 WorldEdit，1.12 及以前）

def _load_schematic(path: str) -> Structure:
    s = to_python(_read_nbt(path, little_endian=False).tag)
    if isinstance(s.get("Schematic"), dict):
        s = s["Schematic"]
    w, h, l = (int(s.get(k, 0)) & 0xFFFF for k in ("Width", "Height", "Length"))
    ids = np.asarray(s.get("Blocks", []), dtype=np.int16).astype(np.int32) & 0xFF
    datas = np.asarray(s.get("Data", []), dtype=np.int16).astype(np.int32) & 0x0F
    add = s.get("AddBlocks")
    if add:   # ID 超过 255 的高 4 位：两格共用一个字节，偶数格取低 4 位、奇数格取高 4 位
        add = np.asarray(add, dtype=np.int16).astype(np.int32) & 0xFF
        nib = np.zeros(ids.size, dtype=np.int32)
        nib[0::2] = (add[: (ids.size + 1) // 2] & 0x0F)[: nib[0::2].size]
        nib[1::2] = ((add >> 4) & 0x0F)[: nib[1::2].size]
        ids = ids | (nib << 8)
    keys = ids * 16 + datas
    unique, inverse = np.unique(keys, return_inverse=True)
    unknown = set()
    palette = [legacy.legacy_block(int(k) // 16, int(k) % 16, unknown) for k in unique]
    indices = inverse.astype(np.int32).reshape(h, l, w).transpose(2, 0, 1).copy()
    # 空气挪到 0 号
    air = next((i for i, b in enumerate(palette) if b.is_air), None)
    if air is None:
        palette = [AIR] + palette
        indices += 1
    elif air != 0:
        palette[0], palette[air] = palette[air], palette[0]
        a, z0 = indices == air, indices == 0
        indices[a], indices[z0] = 0, air
    palette = legacy.fix_neighbors(indices, palette)

    def fix_items(items):
        if not isinstance(items, list):
            return items
        return [{**it, "id": legacy.legacy_item(it.get("id"), it.get("Damage", 0))} for it in items if isinstance(it, dict)]

    block_entities = {}
    for te in s.get("TileEntities", []):
        if all(k in te for k in ("x", "y", "z")):
            x, y, z = int(te["x"]), int(te["y"]), int(te["z"])
            if not (0 <= x < w and 0 <= y < h and 0 <= z < l):
                continue
            # 老版本的方块实体 id 是 "Chest"、"Trap" 这种，换成那一格方块的名字
            block_entities[(x, y, z)] = {**te, "id": palette[int(indices[x, y, z])].id, "Items": fix_items(te.get("Items"))}
    origin = [s.get(k) for k in ("WEOriginX", "WEOriginY", "WEOriginZ")]
    origin = origin if all(v is not None for v in origin) else None
    entities = [{"id": str(e.get("id", "minecraft:unknown")), "nbt": e, "pos": _relative_pos(e.get("Pos"), (w, h, l), [origin])}
                for e in s.get("Entities", [])]
    if unknown:
        print(f"[schematic] 认不出的数字 ID（当空气）: {sorted(unknown)[:20]}")
    region = region_from_indices("schematic", indices, palette, block_entities=block_entities, entities=entities)
    return Structure(
        regions=[region], name=os.path.splitext(os.path.basename(path))[0],
        source_format=SCHEMATIC, version_label=f"MCEdit {s.get('Materials', 'Alpha')}",
        meta={"DataVersion": 3953, "unknown_legacy": sorted(unknown)},   # 名字已经换成现在的了
    )


_LOADERS = {LITEMATIC: _load_litematic, JAVA_NBT: _load_java_nbt, MCSTRUCTURE: _load_mcstructure,
            SCHEM: _load_schem, SCHEMATIC: _load_schematic}
_SAVERS = {LITEMATIC: _save_litematic, JAVA_NBT: _save_java_nbt, MCSTRUCTURE: _save_mcstructure, SCHEM: _save_schem}


def load(path: str) -> Structure:
    """按扩展名读一个结构文件。"""
    return _LOADERS[detect_format(path)](path)


def save(structure: Structure, path: str, fmt: str = None):
    """写出结构文件。

    内部模型永远是 Java 口径（mcstructure 在读的时候就换算过了），所以只有
    写 mcstructure 时需要再换回基岩命名，这一步在 ``_save_mcstructure`` 里做。
    返回的 ConversionReport 记录哪些方块的状态没有对应规则，界面上会提示。
    """
    fmt = fmt or detect_format(path)
    report = blockmap.ConversionReport()
    _SAVERS[fmt](structure, path, report)
    return report
