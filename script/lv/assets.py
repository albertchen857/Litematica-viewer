"""开机检查方块资源版本，和最新版对不上就自动拉一份。

资源指 ``script/JSrender/resource/`` 下的 atlas.png + assets.js，
本地版本记在同目录的 version.json 里。

两条必须守住的规矩：

* **atlas.png 和 assets.js 永远一起换。** assets.js 里是每张贴图在图集中的
  [u, v, 宽, 高]，只换其中一个会让所有贴图的 UV 对不上，渲染出来材质全是错的。
* **默认只认正式版。** mcmeta 跟的是最新快照（写这段时是 26.4-snapshot-3），
  静默把用户顶到快照版不合适。要快照把 STABLE_ONLY 改成 False。

检查走 GitHub API 读 atlas 分支最新提交的标题（"🚀 Update atlas for 26.3"），
只有一个很小的请求；真要下载才会去拉那 2MB。整个过程在后台线程里跑，
网络不通就安静跳过，不影响程序启动。
"""

import json
import os
import re
import threading

from .config import SAVE, res, save_settings

RESOURCE = res("script", "JSrender", "resource")
VERSION_JSON = os.path.join(RESOURCE, "version.json")

API_COMMITS = "https://api.github.com/repos/misode/mcmeta/commits"
RAW = "https://raw.githubusercontent.com/misode/mcmeta"

# 只升正式版。26.3 升，26.4-snapshot-3 / 26.4-pre-1 / 26.4-rc-2 都不升。
STABLE_ONLY = True
_STABLE = re.compile(r"^\d+(\.\d+)*$")
# 提交标题是 "🚀 Update <分支名> for 26.3" —— 分支名那段会变（atlas / summary / assets），
# 写死成 atlas 的话查 summary 分支永远匹配不上
_VERSION_IN_MESSAGE = re.compile(r"Update \w+ for (\S+)")


def local_version() -> str:
    try:
        with open(VERSION_JSON, encoding="utf-8") as f:
            return str(json.load(f).get("version", ""))
    except Exception:
        return ""


def write_local_version(version: str) -> None:
    os.makedirs(RESOURCE, exist_ok=True)
    with open(VERSION_JSON, "w", encoding="utf-8") as f:
        json.dump({"version": version}, f, ensure_ascii=False, indent=2)


def _branch_commit(session, branch: str, want: str):
    """在某个分支上找到对应版本的提交 sha。各分支是分开更新的，必须各找各的。"""
    response = session.get(f"{API_COMMITS}?sha={branch}&per_page=60", timeout=20)
    response.raise_for_status()
    for commit in response.json():
        title = commit["commit"]["message"].splitlines()[0]
        found = _VERSION_IN_MESSAGE.search(title)
        if found and found.group(1) == want:
            return commit["sha"]
    return None


def latest_version(session) -> str:
    """atlas 分支上最新的（按 STABLE_ONLY 过滤后的）版本号。"""
    response = session.get(f"{API_COMMITS}?sha=atlas&per_page=40", timeout=20)
    response.raise_for_status()
    for commit in response.json():
        found = _VERSION_IN_MESSAGE.search(commit["commit"]["message"].splitlines()[0])
        if not found:
            continue
        version = found.group(1)
        if not STABLE_ONLY or _STABLE.match(version):
            return version
    return ""


def download(session, version: str) -> bool:
    """下载并原子替换 atlas.png + assets.js。两个都拿到了才落盘。"""
    atlas_sha = _branch_commit(session, "atlas", version)
    summary_sha = _branch_commit(session, "summary", version)
    if not atlas_sha or not summary_sha:
        print(f"[assets] 找不到 {version} 对应的提交，跳过")
        return False

    def get(ref, path, binary=False):
        response = session.get(f"{RAW}/{ref}/{path}", timeout=180)
        response.raise_for_status()
        return response.content if binary else response.json()

    bundle = {
        "blockstates": get(summary_sha, "assets/block_definition/data.min.json"),
        "models": get(summary_sha, "assets/model/data.min.json"),
        "textures": get(atlas_sha, "all/data.min.json"),
    }
    atlas = get(atlas_sha, "all/atlas.png", binary=True)

    payload = json.dumps(bundle, sort_keys=True, separators=(",", ":"))
    payload = payload.replace("\\", "\\\\").replace("'", "\\'")

    # 先写临时文件再替换，中途断网/断电也不会留下半个文件
    for name, data, mode in (
        ("assets.js", f"const assets = JSON.parse('{payload}')", "w"),
        ("atlas.png", atlas, "wb"),
    ):
        target = os.path.join(RESOURCE, name)
        temp = target + ".part"
        with open(temp, mode, **({"encoding": "utf-8"} if mode == "w" else {})) as f:
            f.write(data)
        os.replace(temp, target)

    write_local_version(version)
    return True


def _worker(on_done) -> None:
    try:
        import requests

        session = requests.Session()
        latest = latest_version(session)
        current = local_version()
        if not latest or latest == current:
            print(f"[assets] 方块资源已是最新（{current or '未知'}）")
            return
        print(f"[assets] 发现新版本 {latest}（本地 {current or '未知'}），开始下载…")
        if download(session, latest):
            print(f"[assets] 已更新到 {latest}。"
                  f"新方块的图标可以跑 tools/make_block_icons.py 补齐。")
            if on_done:
                on_done(latest)
    except Exception as exc:
        # 断网、被墙、GitHub 限流都走这里。资源更新不是关键路径，安静跳过。
        print(f"[assets] 跳过资源更新：{exc}")


def check_in_background(on_done=None) -> None:
    """开机调一次。整个过程在后台线程里，不会拖慢启动，也不会弹窗打扰。"""
    if not SAVE.get("auto_update_assets", 1):
        return
    threading.Thread(target=_worker, args=(on_done,), daemon=True).start()


def set_enabled(enabled: bool) -> None:
    SAVE["auto_update_assets"] = int(bool(enabled))
    save_settings()
