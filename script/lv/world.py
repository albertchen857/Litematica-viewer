"""把结构导出成一个 Java 版存档：虚空世界，里面只有这个投影。

    world.export(structure, "D:/saves/MyBuild")

写出来的目录直接丢进 .minecraft/saves 就能进。结构放在 (0, 64, 0) 开始的位置，
玩家出生在结构南边上方，创造模式、飞行。

格式选择：存档按 1.18 ~ 1.21.4 的区块格式写（DataVersion 封顶 4189）。
Minecraft 打开旧版本存档时会自己用 DataFixer 升级，而**新版本才有的方块名**
DataFixer 不认识也不会动它，所以 26.x 的投影照样能完整进 26.x 的游戏；
反过来如果照抄一个比游戏还新的 DataVersion，旧游戏会拒绝打开。封顶是最稳的。

文件结构（minecraft.wiki: Java Edition level format / Region file format / Chunk format）::

    <world>/level.dat               gzip NBT，世界设置（虚空超平坦、游戏规则、玩家位置）
    <world>/icon.png                存档列表里的小图，用等轴缩略图
    <world>/region/r.X.Z.mca        方块和方块实体，32×32 个区块一个文件
    <world>/entities/r.X.Z.mca      1.17 起实体单独存一份
"""

import os
import struct
import time
import zlib

import amulet_nbt as nbt
import numpy as np

from .formats import MCSTRUCTURE, _entity_position, _from_python, flatten_regions

DATA_VERSION_MIN = 2860   # 1.18：区块改成 sections + block_states 调色板的第一版
DATA_VERSION_MAX = 4189   # 1.21.4：见模块说明，封顶交给游戏自己升级
DATA_VERSION_DEFAULT = 3953  # 1.21
WORLD_BOTTOM, WORLD_TOP = -64, 320
SECTIONS = range(WORLD_BOTTOM // 16, WORLD_TOP // 16)   # -4 .. 19

# 方块实体 id 和方块 id 不一致的几类。没写 id 的方块实体游戏会直接丢掉。
_BLOCK_ENTITY_IDS = (
    ("_hanging_sign", "minecraft:hanging_sign"), ("_sign", "minecraft:sign"),
    ("_banner", "minecraft:banner"), ("_bed", "minecraft:bed"),
    ("_head", "minecraft:skull"), ("_skull", "minecraft:skull"),
    ("shulker_box", "minecraft:shulker_box"), ("command_block", "minecraft:command_block"),
)


def export(structure, folder: str) -> dict:
    """写出存档，返回 {"chunks": 区块数, "entities": 实体数, "clipped": 是否超高被裁}。"""
    region = flatten_regions(structure)
    data_version = _data_version(structure)
    indices = np.asarray(region.indices)
    size_x, size_y, size_z = indices.shape

    # 不高于 256 就从 y=64 开始放，太高就贴着世界底部放；还放不下的部分只能裁掉
    base_y = 64 if size_y <= WORLD_TOP - 64 else WORLD_BOTTOM
    clipped = size_y > WORLD_TOP - base_y
    indices = indices[:, : WORLD_TOP - base_y, :]

    os.makedirs(os.path.join(folder, "region"), exist_ok=True)
    os.makedirs(os.path.join(folder, "entities"), exist_ok=True)

    # ---- 方块 + 方块实体，按区块切
    block_entities = {}
    for (x, y, z), data in region.block_entities.items():
        if y + base_y < WORLD_TOP:
            block_entities.setdefault((x >> 4, z >> 4), []).append(
                _block_entity_tag(data, region.palette[int(region.indices[x, y, z])].id,
                                  (x, y + base_y, z))
            )

    chunk_files = {}
    for cx in range((size_x + 15) // 16):
        for cz in range((size_z + 15) // 16):
            tag = _chunk_tag(indices, region.palette, cx, cz, base_y,
                             block_entities.get((cx, cz), []), data_version)
            chunk_files.setdefault((cx >> 5, cz >> 5), {})[(cx & 31, cz & 31)] = tag

    for (rx, rz), chunks in chunk_files.items():
        _write_region(os.path.join(folder, "region", f"r.{rx}.{rz}.mca"), chunks)

    # ---- 实体，1.17 起放 entities/ 下面
    entity_chunks = {}
    count = 0
    for tag, (x, _y, z) in _entity_tags(structure, base_y):
        entity_chunks.setdefault((int(x) >> 4, int(z) >> 4), []).append(tag)
        count += 1
    entity_files = {}
    for (cx, cz), tags in entity_chunks.items():
        entity_files.setdefault((cx >> 5, cz >> 5), {})[(cx & 31, cz & 31)] = nbt.CompoundTag({
            "DataVersion": nbt.IntTag(data_version),
            "Position": nbt.IntArrayTag(np.array([cx, cz], dtype=np.int32)),
            "Entities": nbt.ListTag(tags, 10),
        })
    for (rx, rz), chunks in entity_files.items():
        _write_region(os.path.join(folder, "entities", f"r.{rx}.{rz}.mca"), chunks)

    name = os.path.basename(os.path.normpath(folder))
    _write_level(folder, name, data_version, (size_x, min(size_y, WORLD_TOP - base_y), size_z), base_y)
    _write_icon(structure, folder)
    return {"chunks": sum(len(c) for c in chunk_files.values()), "entities": count, "clipped": clipped}


# --------------------------------------------------------------------------- 区块

def _data_version(structure) -> int:
    meta = structure.meta
    version = int(meta.get("mc_version") or meta.get("DataVersion") or DATA_VERSION_DEFAULT)
    return max(DATA_VERSION_MIN, min(DATA_VERSION_MAX, version))


def _pack(values: np.ndarray, palette_size: int) -> np.ndarray:
    """4096 个调色板下标压进 long 数组。

    1.16 起的规则：每个下标占 max(4, 位数) 位，一个 long 里能放几个就放几个，
    剩下的位空着，不跨 long。
    """
    bits = max(4, (palette_size - 1).bit_length())
    per_long = 64 // bits
    count = -(-len(values) // per_long)
    padded = np.zeros(count * per_long, dtype=np.uint64)
    padded[: len(values)] = values
    shifts = (np.arange(per_long, dtype=np.uint64) * np.uint64(bits))
    longs = (padded.reshape(count, per_long) << shifts).sum(axis=1, dtype=np.uint64)
    return longs.view(np.int64)


def _block_tag(block):
    tag = nbt.CompoundTag({"Name": nbt.StringTag(block.id)})
    if block.props:
        tag["Properties"] = nbt.CompoundTag({k: nbt.StringTag(v) for k, v in block.props})
    return tag


def _chunk_tag(indices, palette, cx, cz, base_y, block_entities, data_version):
    void = nbt.CompoundTag({"palette": nbt.ListTag([nbt.StringTag("minecraft:the_void")], 8)})
    air = nbt.ListTag([_block_tag(palette[0])], 10)
    sections = []
    for section_y in SECTIONS:
        # 这个 16³ 小块在结构数组里对应的范围，结构外面的部分补空气
        cube = np.zeros((16, 16, 16), dtype=np.int32)
        y0 = section_y * 16 - base_y
        lo_y, hi_y = max(0, y0), min(indices.shape[1], y0 + 16)
        if lo_y < hi_y:
            part = indices[cx * 16: cx * 16 + 16, lo_y:hi_y, cz * 16: cz * 16 + 16]
            cube[: part.shape[0], lo_y - y0: hi_y - y0, : part.shape[2]] = part

        states = nbt.CompoundTag({"palette": air})
        if cube.any():
            used, local = np.unique(cube, return_inverse=True)
            # 区块里的顺序是 y*256 + z*16 + x，我们的数组是 [x, y, z]
            order = local.reshape(cube.shape).transpose(1, 2, 0).reshape(-1)
            states = nbt.CompoundTag({
                "palette": nbt.ListTag([_block_tag(palette[int(i)]) for i in used], 10),
                "data": nbt.LongArrayTag(_pack(order, len(used))),
            })
        sections.append(nbt.CompoundTag({
            "Y": nbt.ByteTag(section_y), "block_states": states, "biomes": void,
        }))

    return nbt.CompoundTag({
        "DataVersion": nbt.IntTag(data_version),
        "xPos": nbt.IntTag(cx), "zPos": nbt.IntTag(cz), "yPos": nbt.IntTag(SECTIONS[0]),
        "Status": nbt.StringTag("minecraft:full"),
        "LastUpdate": nbt.LongTag(0), "InhabitedTime": nbt.LongTag(0),
        # 光照和高度图都不写，isLightOn=0 让游戏进图时自己重算
        "isLightOn": nbt.ByteTag(0),
        "sections": nbt.ListTag(sections, 10),
        "block_entities": nbt.ListTag(block_entities, 10),
        "structures": nbt.CompoundTag({"References": nbt.CompoundTag({}), "starts": nbt.CompoundTag({})}),
    })


def _block_entity_tag(data: dict, block_id: str, position: tuple):
    payload = dict(data)
    if not payload.get("id"):
        payload["id"] = next((v for k, v in _BLOCK_ENTITY_IDS if k in block_id), block_id)
    payload["x"], payload["y"], payload["z"] = (int(v) for v in position)
    payload["keepPacked"] = False
    return _from_python(payload)


def _entity_tags(structure, base_y: int):
    """所有实体换成世界坐标。区域偏移要自己加，flatten_regions 不管实体坐标。"""
    lows = [min(r.origin[i] for r in structure.regions) for i in range(3)]
    bedrock = structure.source_format == MCSTRUCTURE
    for region in structure.regions:
        offset = [region.origin[i] - lows[i] for i in range(3)]
        offset[1] += base_y
        for entity in region.entities:
            x, y, z = (p + o for p, o in zip(_entity_position(entity), offset))
            if not WORLD_BOTTOM <= y < WORLD_TOP:
                continue
            # 基岩实体的 NBT 和 Java 完全两套，只保留 id 和位置
            payload = {} if bedrock else dict(entity.get("nbt") or {})
            payload["id"] = entity.get("id") or payload.get("id") or "minecraft:pig"
            payload["Pos"] = [float(x), float(y), float(z)]
            payload.pop("UUID", None)   # 类型转不回 int[4]，让游戏重新生成
            tag = _from_python(payload)
            rotation = payload.get("Rotation")
            if isinstance(rotation, list) and len(rotation) == 2:
                tag["Rotation"] = nbt.ListTag([nbt.FloatTag(float(v)) for v in rotation], 5)
            yield tag, (x, y, z)


def _write_region(path: str, chunks: dict) -> None:
    """Anvil 区域文件：8 KiB 文件头（位置表 + 时间戳），后面每个区块按 4 KiB 对齐。"""
    header = bytearray(8192)
    body = bytearray()
    sector = 2
    now = int(time.time())
    for (lx, lz), tag in sorted(chunks.items()):
        raw = nbt.NamedTag(tag, "").to_nbt(compressed=False, little_endian=False)
        compressed = zlib.compress(raw)
        payload = struct.pack(">IB", len(compressed) + 1, 2) + compressed   # 2 = zlib
        payload += b"\0" * (-len(payload) % 4096)
        sectors = len(payload) // 4096
        slot = 4 * (lx + lz * 32)
        header[slot: slot + 4] = struct.pack(">I", (sector << 8) | min(sectors, 255))
        header[4096 + slot: 4096 + slot + 4] = struct.pack(">I", now)
        body += payload
        sector += sectors
    with open(path, "wb") as f:
        f.write(header + body)


# --------------------------------------------------------------------------- level.dat

def _rules(**rules):
    return nbt.CompoundTag({k: nbt.StringTag(v) for k, v in rules.items()})


def _write_level(folder: str, name: str, data_version: int, size: tuple, base_y: int) -> None:
    size_x, size_y, size_z = size
    flat = nbt.CompoundTag({
        "type": nbt.StringTag("minecraft:flat"),
        "settings": nbt.CompoundTag({
            # 「虚空」预设：一层空气 + the_void 群系，不生成任何结构和装饰
            "layers": nbt.ListTag([nbt.CompoundTag({
                "block": nbt.StringTag("minecraft:air"), "height": nbt.IntTag(1),
            })], 10),
            "biome": nbt.StringTag("minecraft:the_void"),
            "features": nbt.ByteTag(0), "lakes": nbt.ByteTag(0),
            "structure_overrides": nbt.ListTag([], 8),
        }),
    })
    dimensions = nbt.CompoundTag({
        "minecraft:overworld": nbt.CompoundTag({"type": nbt.StringTag("minecraft:overworld"), "generator": flat}),
        "minecraft:the_nether": nbt.CompoundTag({
            "type": nbt.StringTag("minecraft:the_nether"),
            "generator": nbt.CompoundTag({
                "type": nbt.StringTag("minecraft:noise"), "settings": nbt.StringTag("minecraft:nether"),
                "biome_source": nbt.CompoundTag({"type": nbt.StringTag("minecraft:multi_noise"),
                                                 "preset": nbt.StringTag("minecraft:nether")}),
            }),
        }),
        "minecraft:the_end": nbt.CompoundTag({
            "type": nbt.StringTag("minecraft:the_end"),
            "generator": nbt.CompoundTag({
                "type": nbt.StringTag("minecraft:noise"), "settings": nbt.StringTag("minecraft:end"),
                "biome_source": nbt.CompoundTag({"type": nbt.StringTag("minecraft:the_end")}),
            }),
        }),
    })
    # 玩家悬在结构南侧上方，朝北略向下看，正好能看到全貌
    player = nbt.CompoundTag({
        "Pos": nbt.ListTag([nbt.DoubleTag(size_x / 2), nbt.DoubleTag(base_y + size_y + 2.0),
                            nbt.DoubleTag(size_z + 4.0)], 6),
        "Rotation": nbt.ListTag([nbt.FloatTag(180.0), nbt.FloatTag(30.0)], 5),
        "Dimension": nbt.StringTag("minecraft:overworld"),
        "playerGameType": nbt.IntTag(1),
        "abilities": nbt.CompoundTag({
            "flying": nbt.ByteTag(1), "mayfly": nbt.ByteTag(1), "instabuild": nbt.ByteTag(1),
            "invulnerable": nbt.ByteTag(1), "mayBuild": nbt.ByteTag(1),
            "flySpeed": nbt.FloatTag(0.05), "walkSpeed": nbt.FloatTag(0.1),
        }),
    })
    data = nbt.CompoundTag({
        "DataVersion": nbt.IntTag(data_version),
        "version": nbt.IntTag(19133),
        "Version": nbt.CompoundTag({"Id": nbt.IntTag(data_version), "Name": nbt.StringTag("LitematicaViewer"),
                                    "Series": nbt.StringTag("main"), "Snapshot": nbt.ByteTag(0)}),
        "LevelName": nbt.StringTag(name),
        "GameType": nbt.IntTag(1), "Difficulty": nbt.ByteTag(0), "hardcore": nbt.ByteTag(0),
        "allowCommands": nbt.ByteTag(1), "initialized": nbt.ByteTag(1),
        "LastPlayed": nbt.LongTag(int(time.time() * 1000)),
        "SpawnX": nbt.IntTag(size_x // 2), "SpawnY": nbt.IntTag(base_y + size_y + 1),
        "SpawnZ": nbt.IntTag(size_z + 4),
        "Time": nbt.LongTag(0), "DayTime": nbt.LongTag(6000),
        "raining": nbt.ByteTag(0), "thundering": nbt.ByteTag(0),
        # 投影展示用：永远正午、不下雨、不刷怪、不随机刻（作物和火不会自己变）
        "GameRules": _rules(doDaylightCycle="false", doWeatherCycle="false", doMobSpawning="false",
                            doFireTick="false", mobGriefing="false", randomTickSpeed="0",
                            doTraderSpawning="false", doPatrolSpawning="false", doInsomnia="false",
                            spawnRadius="0"),
        "WorldGenSettings": nbt.CompoundTag({
            "seed": nbt.LongTag(0), "generate_features": nbt.ByteTag(0),
            "bonus_chest": nbt.ByteTag(0), "dimensions": dimensions,
        }),
        "DataPacks": nbt.CompoundTag({"Enabled": nbt.ListTag([nbt.StringTag("vanilla")], 8),
                                      "Disabled": nbt.ListTag([], 8)}),
        "enabled_features": nbt.ListTag([nbt.StringTag("minecraft:vanilla")], 8),
        "Player": player,
    })
    nbt.NamedTag(nbt.CompoundTag({"Data": data}), "").save_to(
        os.path.join(folder, "level.dat"), compressed=True, little_endian=False
    )


def _write_icon(structure, folder: str) -> None:
    try:
        from . import snapshot

        snapshot.render(structure, 64).convert("RGB").save(os.path.join(folder, "icon.png"))
    except Exception as exc:   # 图标可有可无
        print(f"[world] icon: {exc}")
