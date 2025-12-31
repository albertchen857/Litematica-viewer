var deepslateResources;

function upperPowerOfTwo(x) {
	x -= 1
	x |= x >> 1
	x |= x >> 2
	x |= x >> 4
	x |= x >> 8
	x |= x >> 18
	x |= x >> 32
	return x + 1
}

// Load Deepslate resources from texture atlas image
// Taken from Deepslate examples
function loadDeepslateResources(textureImage) {
  console.log("loading resources...")
  const blockDefinitions = {};
  Object.keys(assets.blockstates).forEach(id => {
    blockDefinitions['minecraft:' + id] = deepslate.BlockDefinition.fromJson(id, assets.blockstates[id]);
  })

  const blockModels = {};
  Object.keys(assets.models).forEach(id => {
    blockModels['minecraft:' + id] = deepslate.BlockModel.fromJson(id, assets.models[id]);
  })
  Object.values(blockModels).forEach(m => m.flatten({ getBlockModel: id => blockModels[id] }));

  const atlasCanvas = document.createElement('canvas');
  const atlasSize = upperPowerOfTwo((textureImage.width >= textureImage.height) ? textureImage.width : textureImage.height);
  atlasCanvas.width = textureImage.width;
  atlasCanvas.height = textureImage.height;

  const atlasCtx = atlasCanvas.getContext('2d');
  atlasCtx.drawImage(textureImage, 0, 0);

  const atlasData = atlasCtx.getImageData(0, 0, atlasSize, atlasSize);

  const idMap = {};

  Object.keys(assets.textures).forEach(id => {
		const [u, v, du, dv] = assets.textures[id]
		const dv2 = (du !== dv && id.startsWith('block/')) ? du : dv
		idMap['minecraft:' + id] = [u / atlasSize, v / atlasSize, (u + du) / atlasSize, (v + dv2) / atlasSize]
	})

  const textureAtlas = new deepslate.TextureAtlas(atlasData, idMap);

  deepslateResources = {
    getBlockDefinition(id) { return blockDefinitions[id] },
    getBlockModel(id) { return blockModels[id] },
    getTextureUV(id) { return textureAtlas.getTextureUV(id) },
    getTextureAtlas() { return textureAtlas.getTextureAtlas() },
    getBlockFlags(id) {
      return {
        opaque: OPAQUE_BLOCKS.has(id.toString()),
        self_culling: !NON_SELF_CULLING.has(id.toString()),
        semi_transparent: TRANSPARENT_BLOCKS.has(id.toString()),
      };
    },
    getBlockProperties(id) { return null },
    getDefaultBlockProperties(id) { return null },
  }

  return deepslateResources;
}

function structureFromLitematic(litematic, y_min=0, y_max=-1) {
  var blocks = litematic.regions[0].blocks;
  var blockPalette = litematic.regions[0].blockPalette;

  // Could probably make an intermediate block array type for this
  // Does js have good 3D arrays?
  width = blocks.length;
  height = blocks[0].length;
  depth = blocks[0][0].length;

  if (y_max == -1) { y_max = height; } // there's probably a nicer expression here
  y_max = Math.min(y_max, height);

  const structure = new deepslate.Structure([width, height, depth]);

  // Add blocks manually from the blocks loaded from the NBT
  var blockCount = 0;
  console.log("Building blocks...");
  for (let x=0; x < width; x++) {
    for (let y=y_min; y < y_max; y++) {
      for (let z=0; z < depth; z++) {
        blockID = blocks[x][y][z];

        if (blockID > 0) { // Skip air-blocks

          if(blockID < blockPalette.length) {
            blockInfo = blockPalette[blockID];
            blockName = blockInfo.Name;
            blockCount++;

            if (blockInfo.hasOwnProperty("Properties")) {
              structure.addBlock([x, y, z], blockName, blockInfo.Properties);
            } else {
              structure.addBlock([x, y, z], blockName);
            }

          } else {
            // Something obvious so we know when things go wrong
            structure.addBlock([x, y, z], "minecraft:cake")
          }
        }
      }
    }
  }
  console.log("Done!", blockCount, " blocks created");

  return structure;
}
