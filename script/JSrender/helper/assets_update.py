# To use: change directory into this file's dir and run it with Python command line
class JSUpdate:
  def __init__(self):
    import requests, json
    ASSETS_FILE_PATH  = "../resource/assets.js"
    ATLAS_FILE_PATH   = "../resource/atlas.png"
    BLOCK_DEF_URL     = "https://raw.githubusercontent.com/misode/mcmeta/summary/assets/block_definition/data.min.json"
    MODELS_URL        = "https://raw.githubusercontent.com/misode/mcmeta/summary/assets/model/data.min.json"
    ATLAS_MAPPING_URL = "https://raw.githubusercontent.com/misode/mcmeta/atlas/all/data.min.json"
    ATLAS_IMAGE_URL   = "https://raw.githubusercontent.com/misode/mcmeta/atlas/all/atlas.png"

    try:
      result = dict()

      print("Processing: blockstates")

      result["blockstates"] = requests.get(BLOCK_DEF_URL).json()

      print("Processing: models")

      result["models"] = requests.get(MODELS_URL).json()

      print("Processing: textures")

      result["textures"] = requests.get(ATLAS_MAPPING_URL).json()
    except Exception as e:
      print(f"{e}\nGithub connect unstable.Try to use VPN or try again")

    with open(ASSETS_FILE_PATH, 'w') as f:
      f.write(f"""const assets = JSON.parse('{ json.dumps(result, sort_keys=True, separators=(',', ':')) }')""")

    print("Written into:", ASSETS_FILE_PATH)

    # with open("./assets_debug.json", 'w') as f:
    #   f.write(json.dumps(result, sort_keys=True, indent=2))

    # print("Written into debug file")

    with open(ATLAS_FILE_PATH, 'wb') as f:
      f.write(requests.get(ATLAS_IMAGE_URL).content)

if __name__ == "__main__":
  JSUpdate()