// 主页 → 查看器 传文件。
//
// 文件没法塞进网址，所以主页把它暂存进浏览器自己的 IndexedDB，再跳到 viewer/?from=home；
// 查看器打开后取出来、随即删掉。全程只在这台电脑的浏览器里，不经过任何服务器。
// 用 IndexedDB 而不是 sessionStorage：后者只有 5 MB 左右，还只能存字符串，大投影放不下。

(function (root) {
  "use strict";
  const DB = "lv-handoff", STORE = "files", KEY = "pending";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(out && out.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }

  root.LVHandoff = {
    // 存一个文件（只存一个：新的覆盖旧的）
    put(file) {
      return file.arrayBuffer().then((data) => run("readwrite", (s) => s.put({ name: file.name, data }, KEY)));
    },
    // 取出并删掉；没有就返回 null
    take() {
      return run("readwrite", (s) => {
        const req = s.get(KEY);
        s.delete(KEY);
        return req;
      }).then((v) => (v ? new File([v.data], v.name) : null));
    },
  };
})(this);
