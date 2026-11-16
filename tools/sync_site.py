"""把查看器同步到网站（web 分支）。

main 分支只放桌面版，网站放在 web 分支的 docs/。查看器两边各一份：
在 main 的 viewer/ 里改、测，改完用这个脚本复制到网站那边，再到 web 分支提交。

    git worktree add ../LitematicaViewer-web web       # 第一次：把 web 分支检出到旁边的文件夹
    python tools/build_web_data.py                     # 翻译 / 方块名有改动时先重新生成数据
    python tools/sync_site.py ../LitematicaViewer-web/docs

做两件事：
  1. viewer/ → <网站>/viewer/，整个覆盖（不复制桌面版运行时写的 payload.json）。
     网站那边 viewer/ 里多出来的旧文件会删掉，保证两边一致。
  2. 主页（index.html、main.js）用到的几张方块小图，从图集裁到 <网站>/assets/blocks/
     （只写不删：那个文件夹里可能有手动放的图）。
"""

import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "script"))

from lv import atlas  # noqa: E402

VIEWER = os.path.join(ROOT, "viewer")
SKIP = {"payload.json"}  # 桌面版「手动3D渲染」运行时写的，不是网站的东西


def sync_viewer(site: str) -> int:
    target = os.path.join(site, "viewer")
    if os.path.isdir(target):
        shutil.rmtree(target)
    shutil.copytree(VIEWER, target, ignore=lambda _d, names: [n for n in names if n in SKIP or n == "__pycache__"])
    return sum(len(files) for _r, _d, files in os.walk(target))


def homepage_icons(site: str) -> set:
    """主页里出现的方块图：HTML 里的 assets/blocks/<名>.png，加 main.js 材料表演示数据的贴图名。"""
    names = set()
    with open(os.path.join(site, "index.html"), encoding="utf-8") as f:
        names.update(re.findall(r"assets/blocks/([a-z0-9_]+)\.png", f.read()))
    with open(os.path.join(site, "main.js"), encoding="utf-8") as f:
        # 演示数据的行长这样：["grass_block", "草方块", "Grass Block", 9922, ...]
        names.update(re.findall(r'\["([a-z0-9_]+)", "[^"]+", "[^"]+", \d+', f.read()))
    return names


def write_homepage_icons(site: str) -> list:
    folder = os.path.join(site, "assets", "blocks")
    os.makedirs(folder, exist_ok=True)
    wanted = sorted(homepage_icons(site))
    for name in wanted:
        atlas.texture_image(name).save(os.path.join(folder, f"{name}.png"))
    return wanted


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    site = os.path.abspath(sys.argv[1])
    # 防手滑：目标必须像网站目录（有主页），也不能是本仓库自己
    if not os.path.isfile(os.path.join(site, "index.html")) or os.path.commonpath([site, ROOT]) == ROOT:
        print(f"不像网站目录（要有 index.html，且不在本仓库里）：{site}")
        return 1
    print(f"viewer/ → {os.path.join(site, 'viewer')}：{sync_viewer(site)} 个文件")
    icons = write_homepage_icons(site)
    print(f"assets/blocks/：{len(icons)} 张（{', '.join(icons)}）")
    print("记得到网站那边（web 分支）检查改动并提交。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
