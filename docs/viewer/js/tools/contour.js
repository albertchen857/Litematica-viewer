// 等高图：照搬桌面上的 litematic_contour.py。
//   1. 树木（原木/木头/菌柄/菌核）、树叶、竹子、地表小植物当空气
//   2. 只留地表裸露的方块（任意一面挨着天空）；洞穴内壁头顶有岩石，不算裸露
//   3. 按世界高度换色：Y=40 起每 5 格一档，陶瓦、羊毛交替往上，共 32 档（16 色 × 2）
// 投影文件不记录世界高度，所以要用户给出「最底层方块的世界 Y」。

export const CONTOUR = {
  startY: 40, endY: 200, band: 5,
  colors: ["purple", "blue", "light_blue", "cyan", "green", "lime", "yellow", "orange",
           "red", "pink", "magenta", "brown", "black", "gray", "light_gray", "white"],
  clamp: true,          // 超出范围的地表用最低 / 最高那档颜色；false 则留空
  waterIsSurface: true, // 水面按高度上色；false 则穿过水给水底上色
};

const SKIP_SUFFIXES = ["_log", "_wood", "_stem", "_hyphae", "_leaves", "_sapling"];
const SKIP_BLOCKS = new Set([
  "air", "cave_air", "void_air", "bamboo", "bamboo_sapling",
  "mangrove_roots", "mangrove_propagule", "bee_nest", "cocoa", "vine",
  "creaking_heart", "pale_hanging_moss", "azalea", "flowering_azalea",
  "short_grass", "grass", "tall_grass", "fern", "large_fern", "dead_bush",
  "bush", "firefly_bush", "short_dry_grass", "tall_dry_grass",
  "sweet_berry_bush", "sugar_cane", "cactus", "cactus_flower",
  "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet",
  "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy",
  "cornflower", "lily_of_the_valley", "wither_rose", "torchflower",
  "sunflower", "lilac", "rose_bush", "peony", "pitcher_plant",
  "open_eyeblossom", "closed_eyeblossom", "pink_petals", "wildflowers",
  "leaf_litter", "brown_mushroom", "red_mushroom", "lily_pad",
  "snow", "moss_carpet", "pale_moss_carpet", "glow_lichen",
  "seagrass", "tall_seagrass", "kelp", "kelp_plant",
]);
const WATER = new Set(["water", "bubble_column"]);

function skipped(id, opts) {
  const name = id.split(":").pop();
  if (SKIP_BLOCKS.has(name)) return true;
  if (!opts.waterIsSurface && WATER.has(name)) return true;
  return SKIP_SUFFIXES.some((s) => name.endsWith(s));
}

export function colorForY(worldY, opts = CONTOUR) {
  const bands = Math.floor((opts.endY - opts.startY) / opts.band);
  let k = Math.floor((worldY - opts.startY) / opts.band);
  if (k < 0 || k >= bands) {
    if (!opts.clamp) return null;
    k = Math.min(Math.max(k, 0), bands - 1);
  }
  return `minecraft:${opts.colors[Math.floor(k / 2) % opts.colors.length]}_${k % 2 === 0 ? "terracotta" : "wool"}`;
}

function contourRegion(region, baseY, opts) {
  const [sx, sy, sz] = region.size;
  const at = (x, y, z) => x * sy * sz + y * sz + z;
  const keep = region.palette.map((b) => !skipped(b.id, opts));
  const solid = (x, y, z) => keep[region.blocks[at(x, y, z)]];

  // 每一列最高的实心方块；它以上的格子才算「天空」，所以洞里的空气不算
  const top = new Int32Array(sx * sz).fill(-1);
  for (let x = 0; x < sx; x++)
    for (let z = 0; z < sz; z++)
      for (let y = sy - 1; y >= 0; y--) if (solid(x, y, z)) { top[x * sz + z] = y; break; }
  const sky = (x, y, z) => {
    if (x < 0 || z < 0 || x >= sx || z >= sz || y < 0) return false; // 投影边界外不算天空
    if (y >= sy) return true;                                          // 投影顶面以上是天空
    return y > top[x * sz + z];
  };

  const palette = [{ id: "minecraft:air", props: {} }];
  const index = new Map();
  const blocks = new Uint32Array(region.blocks.length);
  let placed = 0;
  for (let y = 0; y < sy; y++) {
    const id = colorForY(baseY + y, opts);
    if (!id) continue;
    for (let x = 0; x < sx; x++) {
      for (let z = 0; z < sz; z++) {
        if (!solid(x, y, z)) continue;
        const exposed = sky(x, y + 1, z) || sky(x, y - 1, z) || sky(x - 1, y, z) ||
                        sky(x + 1, y, z) || sky(x, y, z - 1) || sky(x, y, z + 1);
        if (!exposed) continue;
        if (!index.has(id)) { index.set(id, palette.length); palette.push({ id, props: {} }); }
        blocks[at(x, y, z)] = index.get(id);
        placed++;
      }
    }
  }
  // 方块全换了，箱子内容、告示牌、实体都清掉
  return { region: { ...region, palette, blocks, blockEntities: new Map(), entities: [] }, placed };
}

// baseY = 投影最底层方块的世界 Y。返回新结构，原结构不动
export function toContour(structure, baseY, opts = CONTOUR) {
  const minY = Math.min(...structure.regions.map((r) => r.origin[1]));
  let placed = 0;
  const regions = structure.regions.map((r) => {
    const out = contourRegion(r, baseY + (r.origin[1] - minY), opts);
    placed += out.placed;
    return out.region;
  });
  return { structure: { ...structure, name: structure.name + "_等高图", regions, declared: 0 }, placed };
}
