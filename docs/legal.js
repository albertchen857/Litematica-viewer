// 使用条款 / 隐私政策页（terms.html、privacy.html）共用：按 ?lang= 显示对应语言那一份，站内链接带上语言。
// 三种语言各写一个 <article data-lang="en|cn|tw">，只显示一个；没写 ?lang= 默认英文（和主页一样）
(function () {
  var CODES = ["en", "cn", "tw"];
  var HTML_LANG = { en: "en", cn: "zh-CN", tw: "zh-TW" };
  var lang = new URLSearchParams(location.search).get("lang");
  if (CODES.indexOf(lang) < 0) lang = "en";

  function apply() {
    document.documentElement.lang = HTML_LANG[lang];
    document.querySelectorAll("article[data-lang]").forEach(function (a) { a.hidden = a.dataset.lang !== lang; });
    document.querySelectorAll("[data-en]").forEach(function (el) {
      el.textContent = lang === "en" ? el.dataset.en : lang === "tw" ? el.dataset.tw : el.dataset.zh;
    });
    // 带锚点的（viewer/#tour）：?lang= 要插在 # 前面
    document.querySelectorAll("[data-lang-href]").forEach(function (a) {
      var parts = a.dataset.langHref.split("#");
      a.href = parts[0] + "?lang=" + lang + (parts[1] ? "#" + parts[1] : "");
    });
    var title = document.querySelector('article[data-lang="' + lang + '"] h1');
    if (title) document.title = title.textContent + " · Litematica Viewer";
    document.getElementById("lang-switch").value = lang;
    history.replaceState(null, "", location.pathname + "?lang=" + lang);
  }
  document.getElementById("lang-switch").addEventListener("change", function (e) { lang = e.target.value; apply(); });
  apply();
})();
