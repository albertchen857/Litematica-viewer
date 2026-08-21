[简体中文](./README.md) | **English**

# LitematicaViewer v0.9.0

### Minecraft tool - A tool to easily check Minecraft structure files

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/v/release/Albertchen857/LitematicaViewer)]()
[![三连](https://img.shields.io/badge/-一键三连-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1H9ZVYtEta/)
[![转发](https://img.shields.io/badge/-转发-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/3494373232741268)
[![YoutubeIntro](https://img.shields.io/badge/-Youtube-00A1D6?logo=youtube&logoColor=red)](https://www.youtube.com/watch?v=0nofWrfKJeg)

GITHUB Link: https://github.com/albertchen857/LitematicaViewer
Stable builds are under Releases; clone the repo for the latest preview.
Please give a star! Target 100 stars.

## Supported formats

| Format | Comes from | Read | Write |
|---|---|---|---|
| `.litematic` | Litematica mod | ✅ | ✅ |
| `.nbt` | Java Edition structure block | ✅ | ✅ |
| `.mcstructure` | Bedrock Edition structure block | ✅ | ✅ |

All three are converted to one internal model on import, so **every feature works on
every format**, and you can convert between them via `Data Analysis → Save as`.

> A note on conversion: Java and Bedrock do not name blocks and block states
> identically. Common renames and state mappings are built in; after a conversion the
> app tells you how many block types had no rule and were written through unchanged,
> so you know what to double-check in game.

## Features

- `Import` open a structure file, or drop a file onto the app icon
- `Simple Analysis` block counts, with double slabs, waterlogging and respawn-anchor
  charges resolved into real material amounts
- `Output / Classified Output` export the material list (txt / csv)
- `Save as` convert between litematic / nbt / mcstructure
- `Container Analysis` list container contents and draw the slot layout per container type
- `Step Checker` walk the structure layer by layer with facing / half / waterlogged markers
- `3D Rendering` view the whole structure with the deepslate renderer in its own window,
  with drag-to-look and a Y-layer slider
- `Spawn Regular Shape` generate solid or hollow boxes
- `Replace Specific Block` rule-based bulk replacement, optionally limited by coordinate
  range and block state
- `Transfer Schematic Version` convert litematic files down to 1.16 / 1.13
- `UI ColorMap / Font / Language` theme, font, and language switching

## Running

```bash
pip install -r requirements.txt
python script/LitematicaViewer.py
```

Open a file straight away:

```bash
python script/LitematicaViewer.py my_build.litematic
```

Build:

```bash
python tools/lang_build.py && pyinstaller --noconfirm LitematicaViewer.spec
```

## Layout

```
script/
  LitematicaViewer.py   entry point
  webview_host.py       subprocess entry for the 3D window
  lv/                   the actual code, see docs/ARCHITECTURE.md
  JSrender/             deepslate web renderer (adapted from Ending_Credits' litematic-viewer)
lang/
  source/*.json         the single source of truth for translations
  data.json             theme colours and user settings
  setting.json          block/item name tables and category table
tools/
  lang_build.py         compile po/mo
  lang_check.py         report missing translation keys
  selftest.py           round-trip every format through every other format
```

## Adding a language

1. Copy `lang/source/en_US.json` to `lang/source/<locale>.json`, translate the values,
   and set `lang.name` to the language's own name.
2. Restart. It shows up under `Help → Language`.

`.po` / `.mo` files are compiled automatically and are not committed.

## Branch diagram

```
LitematicaViewer
|- formats
|  |- .litematic (litemapy)
|  |- .nbt Java structure block (amulet-nbt)
|  |- .mcstructure Bedrock (amulet-nbt, little-endian)
|- analysis
|  |- material list / categories / density / redstone ratio
|  |- container scan
|- edit
|  |- box generation (solid / hollow)
|  |- bulk block replacement (range and state filters)
|  |- litematic version conversion
|- render
|  |- 3D rendering (deepslate WebGL, separate process)
|  |- step checker (layer-by-layer 2D)
|- ui
   |- collapsible side panels / theme / font / i18n
```
