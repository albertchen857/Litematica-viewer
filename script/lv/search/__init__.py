"""投影搜索：在用户自己电脑上建索引、搜索。界面是 viewer/search.html，由 webview_host.py --search 开窗，
通过 pywebview 的 js_api 调这里的 Api。

更新索引：每个站一个线程（不同站并行，同一个站请求间隔 ≥ 2 秒），每次每站最多抓 PER_RUN 个新页面，
抓过的记在 seen 表里下次跳过；可以多点几次「更新索引」慢慢补全。
"""

import json
import os
import threading
import webbrowser

from ..config import user_file

from .core import Fetcher, Index, NotAPage, search
from .sites import BY_KEY, SITES

PER_RUN = 150
PREFS = user_file("search_prefs.json")


class Crawler:
    def __init__(self, index: Index):
        self.index = index
        self.fetcher = Fetcher()
        self.lock = threading.Lock()
        self.state = {"running": False, "finished": False, "sites": {}, "errors": []}

    def start(self, keys):
        with self.lock:
            if self.state["running"]:
                return False
            keys = [k for k in keys if k in BY_KEY]
            self.state = {"running": True, "finished": False, "errors": [],
                          "sites": {k: {"done": 0, "total": 0, "added": 0, "running": True} for k in keys}}
        threads = [threading.Thread(target=self._run_site, args=(BY_KEY[k],), daemon=True) for k in keys]
        for t in threads:
            t.start()
        threading.Thread(target=self._join, args=(threads,), daemon=True).start()
        return True

    def _join(self, threads):
        for t in threads:
            t.join()
        with self.lock:
            self.state["running"] = False
            self.state["finished"] = True

    def _err(self, site, msg):
        with self.lock:
            self.state["errors"].append(f"{site.name}: {msg}"[:300])

    def _run_site(self, site):
        st = self.state["sites"][site.key]
        if site.note == "spa":
            self._err(site, "skipped: pages are script-rendered and the data API is disallowed by robots.txt")
            st["running"] = False
            return
        try:
            known = self.index.known(site.key)
            urls = [u for u in site.discover(self.fetcher) if u not in known]
            if not urls and not known:
                self._err(site, "no pages found (sitemap missing or blocked by robots.txt)")
            urls = urls[:PER_RUN]
            st["total"] = len(urls)
            fails = 0
            for u in urls:
                try:
                    r = self.fetcher.get(u)
                    it = site.parse(u, r.text)
                    if it.name:
                        self.index.put(it)
                        st["added"] += 1
                    else:
                        self.index.mark(u, site.key, "empty")
                    fails = 0
                except PermissionError:
                    self.index.mark(u, site.key, "robots")
                except NotAPage:
                    self.index.mark(u, site.key, "file")   # 是文件不是网页：不读、以后也不再碰
                except Exception as e:
                    fails += 1
                    self.index.mark(u, site.key, "error")
                    if fails >= 5:        # 连着失败：多半是站点挡了或者挂了，别再敲
                        self._err(site, f"stopped after repeated errors: {e}")
                        break
                st["done"] += 1
        except Exception as e:
            self._err(site, str(e))
        finally:
            st["running"] = False

    def status(self):
        with self.lock:
            s = self.state
            active = [BY_KEY[k].name for k, v in s["sites"].items() if v["running"]]
            return {
                "running": s["running"], "finished": s["finished"], "errors": list(s["errors"]),
                "site": "、".join(active[:3]) + ("…" if len(active) > 3 else ""),
                "done": sum(v["done"] for v in s["sites"].values()),
                "total": sum(v["total"] for v in s["sites"].values()),
                "added": sum(v["added"] for v in s["sites"].values()),
            }


class Api:
    """给 search.html 用（window.pywebview.api.*）。返回值都是能转 JSON 的东西。"""

    def __init__(self):
        self.index = Index()
        self.crawler = Crawler(self.index)

    def sites(self):
        counts = self.index.counts()
        return [{"key": s.key, "name": s.name, "url": s.url, "note": s.note, "search": s.search_url, "count": counts.get(s.key, 0)} for s in SITES]

    def search(self, req):
        req = req or {}
        if "sites" in req and not req["sites"]:
            return []                 # 一个站都没勾
        res = search(self.index, req.get("q", ""), req.get("sites"), req.get("filters"), req.get("sort", "mixed"))
        for r in res:
            r.pop("fetched", None)
            r["score"] = round(r.pop("_score", 0), 3)
            r.pop("_rel", None)
        return res

    def facets(self):
        """筛选框的候选：常见标签、版本"""
        tags, vers = {}, {}
        for it in self.index.all():
            for t in it["tags"]:
                tags[t] = tags.get(t, 0) + 1
            for v in it["versions"]:
                vers[v] = vers.get(v, 0) + 1
        top = lambda d, n: [k for k, _ in sorted(d.items(), key=lambda x: -x[1])[:n]]
        return {"tags": top(tags, 80), "versions": sorted(top(vers, 40), key=lambda v: [int(x) for x in v.split(".")], reverse=True)}

    def crawl(self, keys):
        return self.crawler.start(keys or [])

    def status(self):
        return self.crawler.status()

    def prefs(self):
        try:
            with open(PREFS, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            d = {}
        d.setdefault("lang", os.environ.get("LV_LANG") or "zh_CN")   # 第一次打开跟桌面版语言走
        return d

    def save_prefs(self, d):
        try:
            with open(PREFS, "w", encoding="utf-8") as f:
                json.dump(d or {}, f, ensure_ascii=False)
        except OSError:
            pass
        return True

    def start_query(self):
        """主界面左下角搜索框带过来的关键词（只给一次）"""
        q, os.environ["LV_QUERY"] = os.environ.get("LV_QUERY", ""), ""
        return q

    def icon(self):
        """顶栏图标：pywebview 的本地服务以 viewer/ 为根，读不到仓库根目录的 icon.ico，所以从这里给 data URL"""
        import base64

        from ..config import res
        try:
            with open(res("icon.ico"), "rb") as f:
                return "data:image/x-icon;base64," + base64.b64encode(f.read()).decode()
        except OSError:
            return ""

    def open(self, url):
        # 只跳转到原站，不下载
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            webbrowser.open(url)
            return True
        return False
