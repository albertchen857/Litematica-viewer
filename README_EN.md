[简体中文](./README.md) | **English**

# LitematicaViewer v0.9.2

### Minecraft tool - A tool to easily check Minecraft structure files

[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/v/release/Albertchen857/LitematicaViewer)]()
[![三连](https://img.shields.io/badge/-一键三连-00A1D6?logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1H9ZVYtEta/)
[![转发](https://img.shields.io/badge/-转发-00A1D6?logo=bilibili&logoColor=white)](https://space.bilibili.com/3494373232741268)
[![YoutubeIntro](https://img.shields.io/badge/-Youtube-00A1D6?logo=youtube&logoColor=red)](https://www.youtube.com/watch?v=0nofWrfKJeg)

<a href="https://github.com/LitematicaViewer/Litematica-Nova">
  <img src="https://img.shields.io/badge/Pro%20Edition-Litematica%20Nova-7C3AED?style=for-the-badge&logo=github&logoColor=white" alt="Litematica Nova — the Pro edition of LitematicaViewer" />
</a>

> Want more? **[Litematica Nova](https://github.com/LitematicaViewer/Litematica-Nova)** is the Pro edition of LitematicaViewer.

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
> identically. Common renames and state mappings are built in (facing, waterlogging,
> upper/lower halves, double slabs, comparator mode, repeater delay, …); after a
> conversion the app tells you how many block types had no rule and were written
> through unchanged, so you know what to double-check in game.

## Features

### Viewing

- `Import` open a structure file, or drop a file onto the app icon
- `Material table` with four tabs: **Blocks / Entities / Items / Total**
  - Items = everything inside every container, summed up — no need to open them one by one
  - Total = blocks + entities + items, merged by name
  - Right-click a row: `Ignore` (hide it temporarily), `Quick replace block`
- `Stats panel` redstone ratio, machine type, fluids, density, author, version, description
- `Pie charts` block composition and category composition
- `3D thumbnail` a small always-on preview in the top-left; auto-rotation toggles in Settings
- `Manual 3D rendering` view the whole structure with the deepslate renderer in its own
  window, with drag-to-look and a Y-layer slider
- `Step Checker` walk the structure layer by layer with facing / half / waterlogged markers
- `Container Analysis` list container contents and draw the slot layout per container type

### Editing

- `Spawn Regular Shape` solid or hollow boxes; pick the block from a dropdown with textures
- `Replace Specific Block` one rule per row, `＋/−` to add and remove, with coordinate
  range and block state filters
- `Save as` convert between litematic / nbt / mcstructure
- `Transfer Schematic Version` convert litematic files down to 1.16 / 1.13

### Exporting

- `Output / Classified Output` export the material list (txt / csv)
- `Save snapshot` renders a standard isometric picture and **writes it into the schematic
  file's own preview field**, so Litematica shows the thumbnail in its schematic browser
  in game (`.litematic` only)

### Interface

- The right-hand "Schematic tools" sidebar collapses sideways, closed by default
- As the window narrows, panels give way in order: sidebar → charts column → left column,
  keeping the table visible longest
- Spawn shape / Replace block / REDENMC search / Info display can each be opened in
  **their own window** (under the Functions menu), so they stay reachable in a small window
- Theme colour, font, font size, language

> **Block pickers are "half-dropdowns":** pick from the textured list, or just type a
> block that isn't listed. For block states write it like `hopper{"facing":"west"}`.

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

> macOS users: see [README_MACOS.md](https://github.com/albertchen857/LitematicaViewer/blob/macos/README_MACOS.md) (the `macos` branch).
> The embedded 3D thumbnail relies on pyopengltk, which does not work on macOS — that
> corner is left empty there and everything else works; use Manual 3D rendering instead.

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
  make_testdata.py      generate test schematics with containers / entities / odd states
```

## Adding a language

1. Copy `lang/source/en_US.json` to `lang/source/<locale>.json`, translate the values,
   and set `lang.name` to the language's own name.
2. Restart. It shows up under `Help → Language`.

`.po` / `.mo` files are compiled automatically and are not committed.

## Branches

| Branch | Contents |
|---|---|
| `main` | mainline |
| `macos` | macOS packaging script, icon, release workflow |
| `original` | the pre-rewrite 0.8.0c build (with only the minimal fixes needed to launch), kept for comparison |

## Branch diagram

```
LitematicaViewer
|- formats
|  |- .litematic (litemapy)
|  |- .nbt Java structure block (amulet-nbt)
|  |- .mcstructure Bedrock (amulet-nbt, little-endian)
|  |- Java <-> Bedrock block id / state mapping (blockmap)
|- analysis
|  |- material list / categories / density / redstone ratio
|  |- container scan
|  |- container item totals
|- edit
|  |- box generation (solid / hollow)
|  |- bulk block replacement (range and state filters)
|  |- litematic version conversion
|- render
|  |- manual 3D rendering (deepslate WebGL, separate process)
|  |- embedded thumbnail (pyopengltk, non-macOS)
|  |- isometric snapshot written into the schematic file
|  |- step checker (layer-by-layer 2D)
|- ui
   |- collapsible sidebar / detachable panels / theme / font / i18n
```

## Star History

<a href="https://www.star-history.com/?repos=albertchen857%2FLitematica-viewer&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=albertchen857/Litematica-viewer&type=date&legend=top-left" />
 </picture>
</a>
