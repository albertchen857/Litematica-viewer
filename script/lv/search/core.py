"""投影搜索的底层：礼貌抓取、robots.txt、sitemap、本地索引（SQLite）、排序。

全部在用户自己的电脑上跑：
  * 只读各站 robots.txt 允许的页面（站点地图、作品详情页），不碰它们的搜索页 / 禁止的 API；
  * 同一个站两次请求之间至少隔 MIN_DELAY 秒（站点写了 Crawl-delay 就按它的）；
  * 抓到的只是目录信息（名字、作者、图片地址、链接……），存在本地 search_index.sqlite；不下载投影文件，
    搜索结果点开就是跳到原站。
"""

import json
import math
import re
import sqlite3
import threading
import time
import urllib.robotparser
from dataclasses import asdict, dataclass, field
from urllib.parse import urljoin, urlparse

from ..config import user_file

UA = "LitematicaViewer-Search/0.9 (+https://lite-viewer.com)"
MIN_DELAY = 2.0
TIMEOUT = 20
MAX_PAGE = 8 << 20            # 一页最多读 8 MB（有的站点地图好几 MB）
FILE_EXT = re.compile(r"\.(?:litematic|schem|schematic|nbt|mcstructure|bp|vschem|zip|rar|7z|mcworld|jar)(?:$|\?)", re.I)


class NotAPage(Exception):
    """地址指向的不是网页（是文件之类），不读"""
DB_PATH = user_file("search_index.sqlite")


@dataclass
class Item:
    """统一格式。必填：site / url / name / author / size；其余可选（站点没有就空着）。"""
    site: str
    url: str                      # 目标页面（点击跳转）
    name: str = ""
    author: str = ""
    size: str = ""                # 「宽×高×长」或方块数，站点给什么写什么
    image: str = ""               # 图片地址（原站的，不下载）
    tags: list = field(default_factory=list)
    uploaded: str = ""            # ISO 日期
    downloads: int = None
    likes: int = None
    versions: list = field(default_factory=list)  # 适配的游戏版本
    description: str = ""


# --------------------------------------------------------------------------- 抓取

class Fetcher:
    """每个站一个 robots.txt 解析器 + 上次请求时间；所有请求都过 can_fetch 和限速。"""

    def __init__(self):
        import requests

        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA, "Accept-Language": "en,zh;q=0.8"})
        self.robots = {}
        self.declared = set()     # robots.txt 里 Sitemap: 声明的站点地图（及其子地图）：站点主动提供的，可以读
        self.last = {}
        self.locks = {}
        self.lock = threading.Lock()

    def _robots(self, url):
        host = urlparse(url).scheme + "://" + urlparse(url).netloc
        with self.lock:
            rp = self.robots.get(host)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.session.get(host + "/robots.txt", timeout=TIMEOUT)
                text = r.text if r.ok else ""
            except Exception:
                text = ""             # 读不到 robots.txt：按「全部允许」处理（标准做法）
            rp.parse(text.splitlines())
            with self.lock:
                self.robots[host] = rp
                self.declared.update(re.findall(r"(?im)^\s*sitemap:\s*(\S+)", text))
        return rp

    def sitemaps(self, url):
        """robots.txt 里声明的站点地图"""
        self._robots(url)
        host = urlparse(url).netloc
        return [m for m in self.declared if urlparse(m).netloc == host]

    def allowed(self, url) -> bool:
        return url in self.declared or self._robots(url).can_fetch(UA, url)

    def get(self, url, **kw):
        """返回 Response；robots 不允许的直接抛 PermissionError。同一个站排队、间隔 MIN_DELAY 秒（不同站互不影响）。"""
        rp = self._robots(url)
        if not self.allowed(url):
            raise PermissionError(f"robots.txt disallows {url}")
        host = urlparse(url).netloc
        delay = max(MIN_DELAY, float(rp.crawl_delay(UA) or 0))
        with self.lock:
            lock = self.locks.setdefault(host, threading.Lock())
        with lock:
            wait = delay - (time.time() - self.last.get(host, 0))
            if wait > 0:
                time.sleep(wait)
            try:
                # stream：先只看响应头。不是网页 / 站点地图（比如链接直接指向 .litematic 文件）就不读内容，
                # 保证「只建目录、不下载投影」
                r = self.session.get(url, timeout=TIMEOUT, stream=True, **kw)
                kind = r.headers.get("content-type", "").lower()
                if r.ok and not any(k in kind for k in ("html", "xml", "json", "text/plain")):
                    r.close()
                    raise NotAPage(f"{kind or 'unknown type'}: {url}")
                r.raise_for_status()
                r._content = r.raw.read(MAX_PAGE, decode_content=True)
                r.close()
            finally:
                self.last[host] = time.time()
        if not r.encoding or r.encoding.lower() == "iso-8859-1":
            r.encoding = r.apparent_encoding or "utf-8"
        return r

    def sitemap_urls(self, sitemap, keep=lambda u: True, child=lambda u: True, limit=None, depth=0):
        """读 sitemap（包括 sitemap index），返回符合 keep 的页面地址；child 挑 index 里要读的子地图。"""
        try:
            text = self.get(sitemap).text
        except Exception:
            return []
        locs = [unescape(u) for u in re.findall(r"<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)", text)]
        if "<sitemapindex" in text:
            if depth >= 2:
                return []
            kids = [u for u in locs if child(u)]
            if sitemap in self.declared:      # 站点主动给的地图，它列出的子地图也算
                self.declared.update(kids)
            out = []
            for k in kids:
                out += self.sitemap_urls(k, keep, child, None if limit is None else limit - len(out), depth + 1)
                if limit is not None and len(out) >= limit:
                    break
            return out
        out = [u for u in locs if keep(u) and not FILE_EXT.search(u)]
        return out[:limit] if limit else out


# --------------------------------------------------------------------------- 页面通用解析

def meta_tags(html):
    """<meta property|name=… content=…> → dict（两种属性顺序都认）"""
    out = {}
    for tag in re.findall(r"<meta\b[^>]*>", html, re.I):
        k = re.search(r'(?:property|name|itemprop)\s*=\s*["\']([^"\']+)', tag, re.I)
        v = re.search(r'content\s*=\s*"([^"]*)"', tag, re.I) or re.search(r"content\s*=\s*'([^']*)'", tag, re.I)
        if k and v:
            out.setdefault(k.group(1).lower(), unescape(v.group(1)))
    return out


def json_ld(html):
    """页面里所有 JSON-LD 对象（@graph 展开）"""
    out = []
    for raw in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            data = json.loads(raw.strip())
        except Exception:
            continue
        stack = data if isinstance(data, list) else [data]
        for d in stack:
            if isinstance(d, dict) and "@graph" in d:
                out += [x for x in d["@graph"] if isinstance(x, dict)]
            elif isinstance(d, dict):
                out.append(d)
    return out


def unescape(s):
    import html as _h
    return _h.unescape(s or "").strip()


def text_of(html_fragment):
    return unescape(re.sub(r"<[^>]+>", " ", html_fragment or "")).strip()


def to_int(s):
    """「1.2k」「3,456」「12 万」这类写法 → 整数"""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return int(s)
    m = re.search(r"([\d.,]+)\s*([kKmMwW万千]?)", str(s))
    if not m:
        return None
    try:
        v = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    mult = {"k": 1e3, "K": 1e3, "千": 1e3, "m": 1e6, "M": 1e6, "w": 1e4, "W": 1e4, "万": 1e4}.get(m.group(2), 1)
    return int(v * mult)


SITE_TYPES = {"Organization", "WebSite", "WebPage", "BreadcrumbList", "SoftwareApplication", "WebApplication", "Person",
              "ImageObject", "FAQPage", "ItemList", "SearchAction", "CollectionPage", "SiteNavigationElement", "Question",
              "Answer", "ListItem", "Offer", "AggregateRating", "VideoObject", "VideoGame", "GameServer"}


def generic_item(site, url, html):
    """不认识的站也能拿到个大概：JSON-LD（CreativeWork / Product…）> Open Graph > <title>"""
    meta = meta_tags(html)
    it = Item(site=site, url=url)
    for d in json_ld(html):
        t = d.get("@type")
        types = t if isinstance(t, list) else [t]
        # 站点自己的介绍（Organization / WebSite / 面包屑…）不是作品，跳过
        if not types or all(x in SITE_TYPES or not isinstance(x, str) for x in types):
            continue
        own = d.get("url") or d.get("@id")
        if isinstance(own, str) and urlparse(urljoin(url, own)).path.strip("/") == "":
            continue                  # url 指向首页：说的是网站本身
        it.name = it.name or unescape(str(d.get("name") or d.get("headline") or ""))
        a = d.get("author") or d.get("creator") or d.get("brand")
        if isinstance(a, list):
            a = a[0] if a else None
        if isinstance(a, dict):
            a = a.get("name")
        it.author = it.author or unescape(str(a or ""))
        img = d.get("image") or d.get("thumbnailUrl")
        if isinstance(img, list):
            img = img[0] if img else ""
        if isinstance(img, dict):
            img = img.get("url", "")
        it.image = it.image or str(img or "")
        it.uploaded = it.uploaded or str(d.get("datePublished") or d.get("uploadDate") or d.get("dateCreated") or "")[:10]
        kw = d.get("keywords")
        if kw and not it.tags:
            it.tags = [k.strip() for k in (kw if isinstance(kw, list) else str(kw).split(",")) if k.strip()]
        it.description = it.description or unescape(str(d.get("description") or ""))[:300]
        for stat in d.get("interactionStatistic") or []:
            if not isinstance(stat, dict):
                continue
            kind = str(stat.get("interactionType", ""))
            n = to_int(stat.get("userInteractionCount"))
            if "Download" in kind:
                it.downloads = n
            elif "Like" in kind or "Favorite" in kind:
                it.likes = n
        rating = d.get("aggregateRating")
        if isinstance(rating, dict) and it.likes is None:
            it.likes = to_int(rating.get("ratingCount") or rating.get("reviewCount"))
    it.name = it.name or meta.get("og:title") or text_of((re.search(r"<title>(.*?)</title>", html, re.S | re.I) or [None, ""])[1])
    it.image = urljoin(url, it.image or meta.get("og:image") or meta.get("twitter:image") or "") if (it.image or meta.get("og:image") or meta.get("twitter:image")) else ""
    it.author = it.author or meta.get("article:author") or meta.get("author") or ""
    it.uploaded = it.uploaded or (meta.get("article:published_time") or "")[:10]
    it.description = it.description or (meta.get("og:description") or meta.get("description") or "")[:300]
    if not it.tags and meta.get("article:tag"):
        it.tags = [meta["article:tag"]]
    return it


VERSION_RE = re.compile(r"\b1\.(?:[5-9]|1\d|2\d)(?:\.\d{1,2})?\b|\b2[6-9]\.\d(?:\.\d)?\b")


def versions_in(text):
    """正文里出现的 Minecraft 版本号（1.12 / 1.20.1 / 26.3 …），去重保序"""
    seen = []
    for v in VERSION_RE.findall(text or ""):
        if v not in seen:
            seen.append(v)
    return seen[:8]


# --------------------------------------------------------------------------- 本地索引

class Index:
    """search_index.sqlite：items（统一格式）+ crawl（每个站抓到哪了）。可以在多个线程里用（每次连接自己开）。"""

    def __init__(self, path=DB_PATH):
        self.path = path
        with self.conn() as c:
            c.execute("""CREATE TABLE IF NOT EXISTS items (
                url TEXT PRIMARY KEY, site TEXT, name TEXT, author TEXT, size TEXT, image TEXT,
                tags TEXT, uploaded TEXT, downloads INTEGER, likes INTEGER, versions TEXT, description TEXT,
                fetched REAL)""")
            c.execute("CREATE INDEX IF NOT EXISTS items_site ON items(site)")
            c.execute("CREATE TABLE IF NOT EXISTS seen (url TEXT PRIMARY KEY, site TEXT, status TEXT, fetched REAL)")

    def conn(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        return c

    def put(self, it: Item):
        d = asdict(it)
        d["tags"] = json.dumps(d["tags"], ensure_ascii=False)
        d["versions"] = json.dumps(d["versions"])
        d["fetched"] = time.time()
        with self.conn() as c:
            c.execute("INSERT OR REPLACE INTO items VALUES (:url,:site,:name,:author,:size,:image,:tags,:uploaded,:downloads,:likes,:versions,:description,:fetched)", d)
            c.execute("INSERT OR REPLACE INTO seen VALUES (?,?,?,?)", (it.url, it.site, "ok", d["fetched"]))

    def mark(self, url, site, status):
        with self.conn() as c:
            c.execute("INSERT OR REPLACE INTO seen VALUES (?,?,?,?)", (url, site, status, time.time()))

    def known(self, site):
        with self.conn() as c:
            return {r[0] for r in c.execute("SELECT url FROM seen WHERE site=?", (site,))}

    def counts(self):
        with self.conn() as c:
            return {r[0]: r[1] for r in c.execute("SELECT site, COUNT(*) FROM items GROUP BY site")}

    def all(self, sites=None):
        with self.conn() as c:
            q = "SELECT * FROM items"
            args = ()
            if sites:
                q += f" WHERE site IN ({','.join('?' * len(sites))})"
                args = tuple(sites)
            rows = c.execute(q, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["tags"] = json.loads(d["tags"] or "[]")
            d["versions"] = json.loads(d["versions"] or "[]")
            out.append(d)
        return out


# --------------------------------------------------------------------------- 排序

def relevance(item, words):
    """名字里命中最重要，其次标签、作者、简介。没有搜索词时都是 1。"""
    if not words:
        return 1.0
    name, tags = item["name"].lower(), " ".join(item["tags"]).lower()
    author, desc = (item["author"] or "").lower(), (item["description"] or "").lower()
    score = 0.0
    for w in words:
        if w in name:
            score += 3 + (2 if name.startswith(w) else 0)
        if w in tags:
            score += 2
        if w in author:
            score += 1
        if w in desc:
            score += 0.5
    return score


def search(index, query="", sites=None, filters=None, sort="mixed", limit=500):
    """返回排好序的结果。sort：mixed（综合）/ relevance / downloads / likes / newest。
    综合 = 搜索相关度、下载量、点赞量三项各自归一化（对数）后加权平均：0.5 / 0.3 / 0.2。"""
    f = filters or {}
    words = [w for w in re.split(r"\s+", (query or "").lower().strip()) if w]
    items = index.all(sites)
    res = []
    for it in items:
        rel = relevance(it, words)
        if words and rel <= 0:
            continue
        if f.get("tag") and not any(f["tag"].lower() in t.lower() for t in it["tags"]):
            continue
        if f.get("version") and not any(v.startswith(f["version"]) for v in it["versions"]):
            continue
        if f.get("after") and (it["uploaded"] or "") < f["after"]:
            continue
        if f.get("minDownloads") and (it["downloads"] or 0) < int(f["minDownloads"]):
            continue
        if f.get("minLikes") and (it["likes"] or 0) < int(f["minLikes"]):
            continue
        if f.get("author") and f["author"].lower() not in (it["author"] or "").lower():
            continue
        it["_rel"] = rel
        res.append(it)
    if not res:
        return []
    max_rel = max(x["_rel"] for x in res) or 1
    max_dl = max(math.log1p(x["downloads"] or 0) for x in res) or 1
    max_lk = max(math.log1p(x["likes"] or 0) for x in res) or 1
    for x in res:
        x["_score"] = 0.5 * x["_rel"] / max_rel + 0.3 * math.log1p(x["downloads"] or 0) / max_dl + 0.2 * math.log1p(x["likes"] or 0) / max_lk
    key = {
        "relevance": lambda x: x["_rel"],
        "downloads": lambda x: x["downloads"] or 0,
        "likes": lambda x: x["likes"] or 0,
        "newest": lambda x: x["uploaded"] or "",
    }.get(sort, lambda x: x["_score"])
    res.sort(key=key, reverse=True)
    return res[:limit]
