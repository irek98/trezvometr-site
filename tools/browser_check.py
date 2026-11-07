# -*- coding: utf-8 -*-
"""Проверка сайта «Трезвометр» в браузере: страницы, скрипты, интерактив, автотесты.

Запуск (из папки сайта, при живом http.server на 8081):

    python tools\\browser_check.py

Поднимает headless Edge с ОТДЕЛЬНЫМ временным профилем и портом 9223 — Chrome пользователя,
его профиль и вкладки не затрагиваются.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from html.parser import HTMLParser

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = r"C:\Users\marsf\Desktop\Порядок\Софт 2026\_tools"
BASE = "http://127.0.0.1:8081"
PORT = 9223
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

sys.path.insert(0, TOOLS)
import _cdp  # noqa: E402

_cdp.PORT = PORT

results = []


def ok(name, cond, extra=""):
    results.append((bool(cond), name, extra))


class Balance(HTMLParser):
    """Проверка вложенности парных тегов: ловит забытые </div> и </section>."""

    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
            "meta", "param", "source", "track", "wbr", "path", "circle", "stop"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        if not self.stack:
            self.errors.append("лишний </%s>" % tag)
            return
        if self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.errors.append("не закрыт <%s>" % self.stack.pop())
            if self.stack:
                self.stack.pop()
        else:
            self.errors.append("лишний </%s>" % tag)


DOMAIN = "https://trezvometr.ru"
SERVICE_PAGES = {"tests.html", "og-image.html"}


def read_text(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def png_size(path):
    """Ширина и высота PNG из заголовка IHDR (без сторонних библиотек)."""
    with open(path, "rb") as f:
        head = f.read(24)
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width = int.from_bytes(head[16:20], "big")
    height = int.from_bytes(head[20:24], "big")
    return width, height


def check_html():
    for name in sorted(os.listdir(SITE)):
        if not name.endswith(".html"):
            continue
        text = read_text(os.path.join(SITE, name))
        b = Balance()
        b.feed(text)
        problems = b.errors + ["не закрыт <%s>" % t for t in b.stack if t not in ("html",)]
        ok("HTML %s: вложенность тегов" % name, not problems, "; ".join(problems[:3]) if problems else "")
        if name in SERVICE_PAGES:
            ok("HTML %s: служебная страница закрыта от индексации" % name, "noindex" in text)
            continue
        ok("HTML %s: есть дисклеймер 18+" % name, "18+" in text)
        ok("HTML %s: открыт для индексации" % name, "noindex" not in text)
        ok("HTML %s: canonical на домен" % name,
           ('rel="canonical" href="%s' % DOMAIN) in text)
        ok("HTML %s: og:url на домен" % name,
           ('property="og:url" content="%s' % DOMAIN) in text)
        ok("HTML %s: og:image" % name,
           ('property="og:image" content="%s/assets/og-image.png"' % DOMAIN) in text,
           "")


def check_seo_files():
    cfg = read_text(os.path.join(SITE, "assets", "config.js"))
    ok("config.js: боевой домен указан", ('site: "%s"' % DOMAIN) in cfg)

    sm = read_text(os.path.join(SITE, "sitemap.xml"))
    ok("sitemap.xml: домен в адресах", DOMAIN + "/" in sm and "example.ru" not in sm)
    ok("sitemap.xml: схема sitemaps.org",
       'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' in sm)
    ok("sitemap.xml: восемь адресов", sm.count("<loc>") == 8, str(sm.count("<loc>")))
    ok("sitemap.xml: без служебных страниц", "tests.html" not in sm and "og-image" not in sm)

    rb = read_text(os.path.join(SITE, "robots.txt"))
    ok("robots.txt: Sitemap указан", ("Sitemap: %s/sitemap.xml" % DOMAIN) in rb)
    ok("robots.txt: tests.html закрыт", "Disallow: /tests.html" in rb)

    img = os.path.join(SITE, "assets", "og-image.png")
    size = png_size(img) if os.path.exists(img) else None
    ok("assets/og-image.png: 1200×630", size == (1200, 630), str(size))

    for name in ("CNAME", ".nojekyll"):
        ok("деплой: есть %s" % name, os.path.exists(os.path.join(SITE, name)))
    if os.path.exists(os.path.join(SITE, "CNAME")):
        ok("CNAME: домен без схемы", read_text(os.path.join(SITE, "CNAME")).strip() == "trezvometr.ru")


def start_edge():
    profile = os.path.join(tempfile.gettempdir(), "edge_trezvometr_cdp")
    proc = subprocess.Popen(
        [EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
         "--user-data-dir=" + profile, "--remote-debugging-port=%d" % PORT, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    for _ in range(40):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2).read()
            return proc
        except Exception:
            time.sleep(0.5)
    proc.kill()
    raise SystemExit("Не удалось запустить headless Edge на порту %d" % PORT)


def open_page(url, console_js=None):
    tab_info = _cdp.new_tab(url)
    tab = _cdp.tab_for(tab_info)
    tab.send("Runtime.enable")
    tab.send("Log.enable")
    tab.send("Page.enable")
    tab.wait_ready()
    time.sleep(0.6)
    errors = []
    for ev in tab.drain():
        method = ev.get("method", "")
        if method == "Runtime.exceptionThrown":
            errors.append(str(ev.get("params", {}).get("exceptionDetails", {}).get("text"))[:160])
        if method == "Log.entryAdded":
            entry = ev.get("params", {}).get("entry", {})
            if entry.get("level") == "error":
                errors.append(str(entry.get("text"))[:160])
    if console_js:
        console_js(tab)
    tab.close()
    return errors


def main():
    check_html()
    check_seo_files()
    proc = start_edge()
    try:
        # --- главная: калькулятор + обратный расчёт + сохранение в дневник ---
        def index_js(tab):
            data = tab.eval("""
                (function () {
                  var gate = document.querySelector('[data-gate="yes"]');
                  if (gate) gate.click();
                  document.querySelector('#add-drink').click();
                  return {
                    metrics: document.querySelectorAll('#result-metrics .metric').length,
                    listItems: document.querySelectorAll('#drink-list li').length,
                    chart: !!document.querySelector('#chart svg'),
                    advice: document.querySelectorAll('#advice .advice-item').length,
                    reverse: document.querySelector('#reverse-result').innerText.replace(/\\s+/g, ' ').slice(0, 140),
                    hasEngine: typeof window.AL === 'object' && !!window.AL.Engine
                  };
                })()
            """)
            ok("index: движок загружен", data and data.get("hasEngine"))
            ok("index: три метрики результата", data and data.get("metrics") == 3, str(data and data.get("metrics")))
            ok("index: напиток попал в список", data and data.get("listItems") == 1)
            ok("index: график построен", data and data.get("chart") is True)
            ok("index: рекомендации появились", data and (data.get("advice") or 0) > 0)
            rev = (data or {}).get("reverse") or ""
            ok("index: обратный расчёт посчитан",
               "Максимум" in rev or "нет запаса" in rev or "Время уже прошло" in rev, rev)
            saved = tab.eval("""
                (function () {
                  var gate = document.querySelector('[data-gate="yes"]');
                  if (gate) gate.click();
                  var read = function () {
                    var raw = localStorage.getItem('trezvometr.data');
                    return raw ? JSON.parse(raw).entries.length : 0;
                  };
                  var before = read();
                  document.querySelector('#save-diary').click();
                  return { before: before, after: read() };
                })()
            """)
            ok("index: «В дневник» добавляет ровно одну запись",
               saved and saved.get("after") == saved.get("before") + 1,
               "было %s, стало %s" % ((saved or {}).get("before"), (saved or {}).get("after")))

            rem = tab.eval("""
                (function () {
                  var t = new Date(Date.now() + 2 * 60000);
                  var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
                  document.querySelector('#rem-stop-time').value = hh;
                  var raw = localStorage.getItem('trezvometr.data');
                  var before = raw ? (JSON.parse(raw).settings.reminders || []).length : 0;
                  document.querySelector('#rem-stop-btn').click();
                  var after = (JSON.parse(localStorage.getItem('trezvometr.data')).settings.reminders || []).length;
                  var listText = document.querySelector('#rem-list').innerText.trim();
                  return { before: before, after: after, list: listText.slice(0, 80) };
                })()
            """)
            ok("index: напоминание сохраняется",
               rem and rem.get("after") == rem.get("before") + 1,
               "было %s, стало %s" % ((rem or {}).get("before"), (rem or {}).get("after")))
            ok("index: напоминание видно в списке",
               rem and 'нет' not in (rem.get("list") or '').lower()[:40], (rem or {}).get("list"))

        errors = open_page(BASE + "/index.html", index_js)
        ok("index: нет ошибок JS", not errors, "; ".join(errors))
        # --- режим 0,00 ---
        def pro_js(tab):
            data = tab.eval("""
                (function () {
                  var gate = document.querySelector('[data-gate="yes"]');
                  if (gate) gate.click();
                  document.querySelector('#add-drink').click();
                  return {
                    verdict: document.querySelector('#verdict').innerText.replace(/\\s+/g, ' ').slice(0, 200),
                    rows: document.querySelectorAll('#scenario-rows tr').length,
                    chart: !!document.querySelector('#chart svg')
                  };
                })()
            """)
            ok("pro: вердикт содержит «Не ранее чем»", data and "Не ранее чем" in (data.get("verdict") or ""))
            ok("pro: три сценария в таблице", data and data.get("rows") == 3, str(data and data.get("rows")))
            ok("pro: график построен", data and data.get("chart") is True)

        errors = open_page(BASE + "/pro.html", pro_js)
        ok("pro: нет ошибок JS", not errors, "; ".join(errors))

        # --- дневник ---
        def diary_js(tab):
            data = tab.eval("""
                (function () {
                  var gate = document.querySelector('[data-gate="yes"]');
                  if (gate) gate.click();
                  document.querySelector('#add-entry').click();
                  return {
                    stats: document.querySelectorAll('#stats .stat').length,
                    bars: !!document.querySelector('#chart-days svg'),
                    rows: document.querySelectorAll('#entries tbody tr').length,
                    advice: document.querySelectorAll('#advice .advice-item').length
                  };
                })()
            """)
            ok("дневник: пять показателей недели", data and data.get("stats") == 5, str(data and data.get("stats")))
            ok("дневник: столбики по дням", data and data.get("bars") is True)
            ok("дневник: запись в таблице", data and (data.get("rows") or 0) >= 1)
            ok("дневник: рекомендации есть", data and (data.get("advice") or 0) > 0)

        errors = open_page(BASE + "/dnevnik.html", diary_js)
        ok("дневник: нет ошибок JS", not errors, "; ".join(errors))
        # --- профиль: сохранение веса и калибровка ---
        def profile_js(tab):
            data = tab.eval("""
                (function () {
                  var gate = document.querySelector('[data-gate="yes"]');
                  if (gate) gate.click();
                  window.AL.Store.clearEntries();   // замеры калибруются только без алкоголя между ними
                  var data0 = window.AL.Store.get();
                  data0.readings = [];
                  window.AL.Store.save();
                  var w = document.querySelector('#weight');
                  w.value = '92';
                  w.dispatchEvent(new Event('change'));
                  var p1 = JSON.parse(localStorage.getItem('trezvometr.data')).profile;
                  // два замера без алкоголя между ними: 1,10 -> 0,80 за 2 часа = 0,15 ‰/ч
                  var now = Date.now();
                  window.AL.Store.addReading({ tMs: now - 2 * 3600000, valueGL: 1.10 });
                  window.AL.Store.addReading({ tMs: now, valueGL: 0.80 });
                  document.querySelector('#calibrate').click();
                  var p2 = JSON.parse(localStorage.getItem('trezvometr.data')).profile;
                  return { weight: p1.weightKg, rate: p2.eliminationRate, calibrated: p2.calibrated,
                           readings: document.querySelectorAll('#readings tbody tr').length };
                })()
            """)
            ok("профиль: вес сохраняется", data and data.get("weight") == 92, str(data and data.get("weight")))
            ok("профиль: калибровка дала 0,15 ‰/ч",
               data and abs((data.get("rate") or 0) - 0.15) < 0.005, str(data and data.get("rate")))
            ok("профиль: отметка о калибровке", data and data.get("calibrated") is True)
            ok("профиль: замеры в таблице", data and (data.get("readings") or 0) == 2,
               str(data and data.get("readings")))

        errors = open_page(BASE + "/profil.html", profile_js)
        ok("профиль: нет ошибок JS", not errors, "; ".join(errors))

        # --- автотесты в браузере ---
        def tests_js(tab):
            data = tab.eval("window.__TESTS__ ? {p: window.__TESTS__.passed, f: window.__TESTS__.failed} : null")
            ok("tests.html: тесты выполнились", data is not None)
            ok("tests.html: нет провалов", data and data.get("f") == 0,
               ("провалено %s из %s" % (data.get("f"), (data.get("p") or 0) + (data.get("f") or 0))) if data else "")

        errors = open_page(BASE + "/tests.html", tests_js)
        ok("tests.html: нет ошибок JS", not errors, "; ".join(errors))

        # --- статические страницы ---
        for page in ("baza-znaniy.html", "o-proekte.html", "politika.html", "disclaimer.html"):
            errors = open_page(BASE + "/" + page)
            ok("%s: нет ошибок JS" % page, not errors, "; ".join(errors))
    finally:
        try:
            proc.terminate()
        except Exception:
            pass

    passed = sum(1 for r in results if r[0])
    failed = [r for r in results if not r[0]]
    print("Пройдено: %d" % passed)
    if failed:
        print("Провалено: %d" % len(failed))
        for _, name, extra in failed:
            print("  FAIL - %s %s" % (name, ("(" + extra + ")") if extra else ""))
        sys.exit(1)
    print("Все проверки пройдены.")


if __name__ == "__main__":
    main()

