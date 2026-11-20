"""各个投影网站怎么找作品、怎么从详情页里拿信息。

每个站：
  * discover(fetcher) → 作品详情页地址。先看站点有没有公开、robots.txt 允许的 API —— 这 15 个站里有 API 的
    都把 /api/ 禁了，所以实际都走 robots.txt 里声明的站点地图；
  * parse(url, html) → Item。先走通用解析（JSON-LD / Open Graph / <title>），再按站点补正文里的数字。
抓不到、被 robots 禁止的就跳过，不硬来。链接直接指向投影文件的（.litematic 之类）不碰。
"""

import json
import re
from urllib.parse import urljoin, urlparse

from .core import Item, generic_item, text_of, to_int, unescape, versions_in


def _stat(body, *labels):
    """正文里的统计数：「Downloads: 1,234」「1.2k downloads」「下载：12」。要求数字和标签紧挨着，
    免得把「3D preview」「Download 16 module…」这种当成下载量。"""
    for label in labels:
        m = (re.search(r"(?<![\w.])(\d[\d,.]*\s*[kKmM万]?)\s+" + label + r"s\b", body, re.I)
             or re.search(r"\b" + label + r"s?\s*[:：]\s*(\d[\d,.]*\s*[kKmM万]?)(?![\w.])", body, re.I))
        if m:
            return to_int(m.group(1))
    return None


def _text_after(body, label, stop=r"\s{2,}|$"):
    m = re.search(label + r"\s*[:：]?\s*(.{1,60}?)(?:" + stop + ")", body, re.I)
    return m.group(1).strip() if m else ""


SIZE_RE = re.compile(r"\b(\d{1,4})\s*[x×*]\s*(\d{1,4})\s*[x×*]\s*(\d{1,4})\b")


def _size_in(text):
    m = SIZE_RE.search(text or "")
    return f"{m.group(1)}×{m.group(2)}×{m.group(3)}" if m else ""


def _clean_title(name, *suffixes):
    """「Polish trap Minecraft Schematic | Donut」→「Polish trap」"""
    name = unescape(name)
    for s in suffixes:
        name = re.sub(s, "", name, flags=re.I)
    return name.strip(" -–—|·")


MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split()


def _date(text):
    """「07 Mar 2018」「2018-03-07」→ 2018-03-07"""
    m = re.search(r"\b(\d{4})-(\d{2})-(\d{2})", text or "")
    if m:
        return m.group(0)
    m = re.search(r"\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})\b", text or "", re.I)
    if m:
        mon = MONTHS.index(m.group(2)[:3].lower()) + 1
        return f"{m.group(3)}-{mon:02d}-{int(m.group(1)):02d}"
    return ""


class Site:
    key = ""
    name = ""
    url = ""
    note = ""                       # 给界面的提示：mostly_maps / unreachable / spa（见 web.sr.note.*）
    maps = None                     # 站点地图（不写就用 robots.txt 里声明的，再不行 /sitemap.xml）
    child = r"."                    # sitemap index 里读哪些子地图
    keep = r"."                     # 哪些地址是作品详情页
    drop = r"$^"                    # 排除
    title_suffix = ()
    body_versions = True            # 正文里找版本号（导航栏里堆满版本号的站要关掉）
    body_stats = True               # 正文里找下载量 / 点赞量
    search_url = ""                 # 站内搜索地址（{q} = 关键词）：搜索页顶上给个「去这个站搜」的跳转

    def discover(self, fetcher, limit=None):
        if self.note == "spa":
            return []
        maps = [urljoin(self.url, m) for m in self.maps] if self.maps else (fetcher.sitemaps(self.url) or [urljoin(self.url, "/sitemap.xml")])
        keep, drop, child = re.compile(self.keep, re.I), re.compile(self.drop, re.I), re.compile(self.child, re.I)
        out, seen = [], set()
        for m in maps:
            for u in fetcher.sitemap_urls(m, lambda u: bool(keep.search(u)) and not drop.search(u), lambda u: bool(child.search(u)), limit):
                if u not in seen:
                    seen.add(u)
                    out.append(u)
        return out[:limit] if limit else out

    def parse(self, url, html) -> Item:
        it = generic_item(self.key, url, html)
        it.name = _clean_title(it.name, *self.title_suffix)
        body = re.sub(r"\s+", " ", text_of(re.sub(r"<(script|style|nav|header|footer)\b.*?</\1>", " ", html, flags=re.S | re.I)))
        it.size = it.size or _size_in(body)
        if self.body_versions:
            it.versions = it.versions or versions_in(body)
        if self.body_stats:
            if it.downloads is None:
                it.downloads = _stat(body, r"downloads?", r"下载")
            if it.likes is None:
                it.likes = _stat(body, r"likes?", r"favou?rites?", r"点赞")
        self.extra(it, url, html, body)
        it.tags = list(dict.fromkeys(t for t in it.tags if t))[:20]
        return it

    def extra(self, it, url, html, body):
        pass


# --------------------------------------------------------------------------- 各站

class NineMinecraft(Site):
    key, name, url = "9minecraft", "9Minecraft Litematica", "https://litematica.9minecraft.net/"
    child = r"sitemap-bai"          # bai = 作品；the = 标签；tacgia = 作者
    keep = r"/s/[^/]+$"
    title_suffix = (r"\s*[|–-]\s*9Minecraft.*$", r"\s*Litematica\s*$", r"\s*Schematic\s*$")
    body_versions = body_stats = False   # 侧栏是「按版本 / 按分类」的计数，会被误认成版本和下载量

    def extra(self, it, url, html, body):
        m = re.search(r'class="bv-muc"[^>]*>([^<]+)', html)
        if m:
            it.tags = [unescape(m.group(1))]
        m = re.search(r"Dimensions\s+(\d+\s*×\s*\d+\s*×\s*\d+)", body)
        if m:
            it.size = _size_in(m.group(1))


class BuildSchematics(Site):
    key, name, url = "buildschematics", "BuildSchematics", "https://buildschematics.com/"
    child = r"schematic-builds"
    title_suffix = (r"\s*[|–-]\s*BuildSchem.*$", r"\s*Minecraft Schematic.*$")
    body_stats = False

    def extra(self, it, url, html, body):
        m = re.search(r"Build at a glance Category (.+?) Theme (.+?) Dimensions", body)
        if m:
            it.tags = [m.group(1)] + [t.strip() for t in m.group(2).split(",") if t.strip()]


class McMod(Site):
    key, name, url, note = "mcmod", "Mc-Mod.Net", "https://www.mc-mod.net/", "mostly_maps"
    child = r"post-sitemap"
    keep = r"schematic|litematic|-build|-map/"
    title_suffix = (r"\s*-\s*Mc-Mod\.Net\s*$",)
    body_versions = body_stats = False

    def extra(self, it, url, html, body):
        # 分类标签「Minecraft 1.9.4 Maps」里带着版本
        it.versions = versions_in(" ".join(it.tags))


class GrabCraft(Site):
    key, name, url = "grabcraft", "GrabCraft", "https://www.grabcraft.com/"
    keep = r"grabcraft\.com/minecraft/[^/]+/[^/]+/?$"
    title_suffix = (r"\s*[|–-]\s*GrabCraft.*$", r"\s*-\s*Blueprints for MineCraft.*$")
    body_stats = False

    def extra(self, it, url, html, body):
        it.author = it.author or _text_after(body, r"Author:", r"\s+Block count")
        m = re.search(r"Views:\s*([\d,]+)", body)
        it.downloads = to_int(m.group(1)) if m else None   # 没有下载量，拿浏览量顶
        m = re.search(r"Width (\d+) Height (\d+) Depth (\d+)", body)
        if m:
            it.size = f"{m.group(1)}×{m.group(2)}×{m.group(3)}"
        m = re.search(r"Tags (.+?) Block Count", body)
        tags = [t.strip() for t in m.group(1).split(",")][:15] if m else []
        cat = urlparse(url).path.strip("/").split("/")[-1].replace("-", " ")
        it.tags = [cat] + [t for t in tags if t and t != cat]
        m = re.search(r"Object added (\d{1,2} \w{3,9}\.? \d{4})", body)
        it.uploaded = it.uploaded or (_date(m.group(1)) if m else "")
        if it.description.startswith("This is page where"):
            it.description = ""
        if not it.image:
            m = re.search(r'(https://blueprints\.grabcraft\.com/[^"\']+\.(?:png|jpe?g))', html)
            it.image = m.group(1) if m else ""


class PhantomNode(Site):
    key, name, url = "phantom", "Phantom Market", "https://market.phantom-node.com/"
    child = r"sitemap-posts"
    keep = r"phantom-node\.com/post/"         # 不要 /de/post/、/fr/post/ 这些翻译版
    title_suffix = (r"\s*-\s*(?:Minecraft[- ]Schematic|Schematic Minecraft)\s*$", r"\s*[|–-]\s*Phantom.*$")


class McImg(Site):
    # 页面全靠浏览器里跑脚本拉 /api/ 的数据，而 robots.txt 禁了 /api/，没法礼貌地建索引
    key, name, url, note = "mcimg", "投影工坊 mcimg", "https://www.mcimg.com/", "spa"


class RedenMC(Site):
    # 同桌面版 RedenPanel 的写法：详情页 /litematica/{编号}，站内搜索 /litematica?q=关键词
    key, name, url = "redenmc", "RedenMC", "https://redenmc.com/"
    search_url = "https://redenmc.com/litematica?q={q}"
    child = r"zh-CN"                # 三种语言的地图列的是同一批作品，读中文那份
    keep = r"/litematica/[^/?#]+$"
    title_suffix = (r"\s*-\s*Reden投影蓝图在线生成器\s*$", r"\s*-\s*Reden.*$")
    body_versions = body_stats = False

    def extra(self, it, url, html, body):
        if it.image.endswith("/reden_256.png"):
            it.image = ""             # 站点 logo，不是作品图
        it.description = re.sub(r"[，,]?\s*生成我的世界红石机器投影.*$", "", it.description)
        # 作者优先级：详细信息里的「作者」> 介绍里写的「作者：」（搬运的作品）> 上传者
        m = (re.search(r"详细信息 作者 (\S+)", body) or re.search(r"介绍 作者[:：]\s*(\S+)", body)
             or re.search(r"上传者 (\S+)", body))
        it.author = m.group(1) if m else it.author
        m = re.search(r"更新时间 (\d{1,2})/(\d{1,2})/(\d{4})", body)
        if m:
            it.uploaded = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        m = re.search(r"支持版本[:：]\s*(.+?)\s+(?:分类|标签|\d+ 收藏)", body)
        if m:
            it.versions = [v.replace(".x", "") for v in re.findall(r"\d+\.\d+(?:\.\d+|\.x)?", m.group(1))]
        m = re.search(r"标签[:：]\s*(.+?)\s+(?:此设计|此机器|\d+ 收藏)", body)
        it.tags = m.group(1).split()[:15] if m else []
        m = re.search(r"分类[:：]\s*(\S+)", body)
        if m:
            it.tags.insert(0, m.group(1))
        m = re.search(r"(\d+) 收藏", body)
        it.likes = int(m.group(1)) if m else None
        m = re.search(r"(\d+) 次下载", body)
        it.downloads = int(m.group(1)) if m else None


class Shulkr(Site):
    key, name, url = "shulkr", "Shulkr", "https://www.shulkr.com/"
    keep = r"shulkr\.com/en/schematics/[A-Za-z0-9]{12}/[^/]+$"   # 每个作品有十几种语言版本，只要英文那份
    title_suffix = (r"\s*-\s*Minecraft Schematic\s*-\s*Shulkr\s*$", r"\s*[|–-]\s*Shulkr.*$")


class SchematIo(Site):
    # 没有站点地图，列表页也是浏览器里跑脚本才出内容
    key, name, url, note = "schematio", "schemat.io", "https://schemat.io/", "spa"


class MineMev(Site):
    key, name, url = "minemev", "MineMev", "https://www.minemev.com/"
    child = r"sitemap-posts"
    title_suffix = (r"\s*[|–-]\s*MineMev.*$",)


class DonutSmp(Site):
    key, name, url = "donutsmp", "DonutSMP", "https://donutsmp-mc.com/"
    keep = r"/schematics/[^/]+$"
    title_suffix = (r"\s*[|–—-]\s*Minecraft Schematic Download.*$", r"\s*[|–—-]\s*DonutSMP.*$")
    body_stats = False

    def extra(self, it, url, html, body):
        m = re.search(r"\bby (\S+) for DonutSMP", it.description)   # meta author 是网站作者，不是投影作者
        it.author = m.group(1) if m else ""


class DonutBuild(Site):
    key, name, url = "donutbuild", "donut.build", "https://www.donut.build/"
    keep = r"/schematic/[^/]+$"
    title_suffix = (r"\s*Minecraft Schematic\s*$", r"\s*[|–-]\s*donut.*$")
    body_stats = False              # 页面里「相关作品」的下载数混在一起，分不清是哪个的


class StorageCatalog(Site):
    key, name, url = "storagecatalog", "Storage Catalog", "https://storagecatalog.org/"
    keep = r"/archives/[^/]+/$"
    title_suffix = (r"\s*\|\s*Minecraft Storage Catalog\s*$",)
    body_stats = False

    def extra(self, it, url, html, body):
        it.tags = it.tags or ["storage tech"]
        code = re.match(r"([A-Z]+)\d+", urlparse(url).path.rstrip("/").split("/")[-1])
        if code and code.group(1) not in it.tags:
            it.tags.append(code.group(1))


class Abfielder(Site):
    key, name, url = "abfielder", "Abfielder", "https://abfielder.com/"
    keep = r"/schematicdetail/"     # /schematics/xxx.litematic 是文件本身，不碰
    title_suffix = (r"\s*[|–-]\s*Abfielder.*$",)

    def extra(self, it, url, html, body):
        if not it.author:
            parts = urlparse(url).path.strip("/").split("/")
            it.author = parts[1].replace("-", " ") if len(parts) > 2 else ""


class MineSchematic(Site):
    key, name, url = "mineschematic", "MineSchematic", "https://mineschematic.com/"
    keep = r"mineschematic\.com/s/[^/]+$"
    title_suffix = (r"\s*[|–-]\s*MineSchematic.*$",)
    body_versions = body_stats = False   # 下面「相关作品」的统计会混进来

    def extra(self, it, url, html, body):
        m = re.search(r'title="Downloads">([\d,.]+\s*[kKmM]?)<', html)   # 第一个就是本作品的
        it.downloads = to_int(m.group(1)) if m else it.downloads
        if it.likes is not None and not re.search(r"interactionStatistic|aggregateRating", html):
            it.likes = None           # 点赞数是浏览器里再拉的，页面里没有
        # 页面里的 Next 数据带 version / size
        m = re.search(r'\\?"version\\?":\\?"([\d.]+)\\?"', html)
        it.versions = [m.group(1)] if m else []
        m = re.search(r'\\?"size\\?":\\?"(\d+ x \d+ x \d+)\\?"', html)
        if m:
            it.size = _size_in(m.group(1))


SITES = [NineMinecraft(), BuildSchematics(), McMod(), GrabCraft(), PhantomNode(), McImg(), RedenMC(), Shulkr(),
         SchematIo(), MineMev(), DonutSmp(), DonutBuild(), StorageCatalog(), Abfielder(), MineSchematic()]
BY_KEY = {s.key: s for s in SITES}


# --------------------------------------------------------------------------- 调试：python -m lv.search.sites [站 key…]
if __name__ == "__main__":
    import sys
    from dataclasses import asdict

    from .core import Fetcher

    f = Fetcher()
    for s in SITES:
        if sys.argv[1:] and s.key not in sys.argv[1:]:
            continue
        print("=" * 60, s.key, flush=True)
        try:
            urls = s.discover(f, limit=400)
        except Exception as e:
            print("  discover error", e)
            continue
        print(f"  {len(urls)} urls", urls[:3], flush=True)
        for u in urls[len(urls) // 3: len(urls) // 3 + 3]:
            try:
                h = f.get(u).text
                d = asdict(s.parse(u, h))
                d["description"] = d["description"][:60]
                print("  ", json.dumps(d, ensure_ascii=False), flush=True)
            except Exception as e:
                print("   parse error", u, type(e).__name__, e, flush=True)
