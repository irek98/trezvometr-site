# -*- coding: utf-8 -*-
"""Проверка сайта «Трезвометр» в браузере: страницы, скрипты, интерактив, автотесты.

Запуск (из папки сайта, при живом http.server на 8081):

    python tools\\browser_check.py

Поднимает headless Edge с ОТДЕЛЬНЫМ временным профилем и портом 9223 — Chrome пользователя,
его профиль и вкладки не затрагиваются.
"""
import json
import os
import re
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
YANDEX_VERIFICATION = "53d8635f9bacb7ce"


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
        ok("HTML %s: подключён favicon" % name,
           '<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">' in text)
        ok("HTML %s: иконка для iOS" % name,
           '<link rel="apple-touch-icon" href="assets/icon-180.png">' in text)
        ok("HTML %s: манифест и favicon.ico" % name,
           '<link rel="manifest" href="site.webmanifest">' in text
           and '<link rel="icon" href="favicon.ico"' in text)
        ok("HTML %s: og:url на домен" % name,
           ('property="og:url" content="%s' % DOMAIN) in text)
        m = re.search(r'property="og:image" content="%s/assets/(og-[a-z0-9-]+\.png)"' % re.escape(DOMAIN), text)
        ok("HTML %s: og:image на домене" % name, bool(m), m.group(1) if m else "нет")
        if m:
            ok("HTML %s: og:image шириной 1200" % name,
               'property="og:image:width" content="1200"' in text)
        ok("HTML %s: подключён счётчик Метрики" % name,
           '<script src="assets/metrika.js?v=1"></script>' in text)
        ok("HTML %s: метатег подтверждения Яндекса" % name,
           ('<meta name="yandex-verification" content="%s">' % YANDEX_VERIFICATION) in text)


def check_seo_files():
    cfg = read_text(os.path.join(SITE, "assets", "config.js"))
    ok("config.js: боевой домен указан", ('site: "%s"' % DOMAIN) in cfg)

    sm = read_text(os.path.join(SITE, "sitemap.xml"))
    ok("sitemap.xml: домен в адресах", DOMAIN + "/" in sm and "example.ru" not in sm)
    ok("sitemap.xml: схема sitemaps.org",
       'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' in sm)
    ok("sitemap.xml: девять адресов", sm.count("<loc>") == 9, str(sm.count("<loc>")))
    ok("sitemap.xml: статья про пиво включена", "/vytrezvlenie-piva.html" in sm)
    ok("sitemap.xml: без служебных страниц", "tests.html" not in sm and "og-image" not in sm)

    rb = read_text(os.path.join(SITE, "robots.txt"))
    ok("robots.txt: Sitemap указан", ("Sitemap: %s/sitemap.xml" % DOMAIN) in rb)
    ok("robots.txt: tests.html закрыт", "Disallow: /tests.html" in rb)

    img = os.path.join(SITE, "assets", "og-image.png")
    size = png_size(img) if os.path.exists(img) else None
    ok("assets/og-image.png: 1200×630", size == (1200, 630), str(size))

    fav = os.path.join(SITE, "assets", "favicon.svg")
    ok("assets/favicon.svg: файл есть", os.path.exists(fav), "нет файла" if not os.path.exists(fav) else "")

    # Иконки: iOS, PWA (обычная + maskable), favicon.ico для поисковиков и старых браузеров.
    man_path = os.path.join(SITE, "site.webmanifest")
    man = read_text(man_path) if os.path.exists(man_path) else ""
    ok("site.webmanifest: три иконки", man.count('"src"') == 3, str(man.count('"src"')))
    ok("site.webmanifest: maskable-иконка", "icon-512-maskable.png" in man)
    for fname, want in (("icon-180.png", (180, 180)), ("icon-192.png", (192, 192)),
                        ("icon-512.png", (512, 512)), ("icon-512-maskable.png", (512, 512))):
        p = os.path.join(SITE, "assets", fname)
        got = png_size(p) if os.path.exists(p) else None
        ok("assets/%s: %d×%d" % (fname, want[0], want[1]), got == want, str(got))
    ico = os.path.join(SITE, "favicon.ico")
    ico_size = os.path.getsize(ico) if os.path.exists(ico) else 0
    ok("favicon.ico: файл есть", ico_size > 600, "%d байт" % ico_size)

    mjs = read_text(os.path.join(SITE, "assets", "metrika.js"))
    ok("metrika.js: Вебвизор выключен", "webvisor: false" in mjs)
    ok("metrika.js: локальные хосты не считаются",
       "'localhost'" in mjs and "'127.0.0.1'" in mjs and "'file:'" in mjs)
    counter = re.search(r"metrikaId:\s*(\d+)", cfg)
    ok("config.js: номер счётчика Метрики задан", bool(counter and int(counter.group(1)) > 0),
       counter.group(1) if counter else "нет")
    if counter and int(counter.group(1)) > 0:
        ok("politika.html: номер счётчика совпадает с config",
           counter.group(1) in read_text(os.path.join(SITE, "politika.html")), counter.group(1))

    for name in ("CNAME", ".nojekyll"):
        ok("деплой: есть %s" % name, os.path.exists(os.path.join(SITE, name)))
    if os.path.exists(os.path.join(SITE, "CNAME")):
        ok("CNAME: домен без схемы", read_text(os.path.join(SITE, "CNAME")).strip() == "trezvometr.ru")


def check_articles():
    """Статья про пиво: страница, разметка Article, обложка, перелинковка."""
    path = os.path.join(SITE, "vytrezvlenie-piva.html")
    if not os.path.exists(path):
        ok("статья: страница есть", False, "нет файла")
        return
    text = read_text(path)
    ok("статья: H1 про выветривание пива", "Сколько выветривается пиво" in text)
    ok("статья: таблица 4,5% есть", "пиво 4,5%" in text)
    ok("статья: таблица 6% есть", "пиво 6%" in text)
    ok("статья: ссылка на калькулятор", 'href="index.html"' in text)
    ok("статья: ссылка на режим 0,00", 'href="pro.html"' in text)
    ok("статья: ссылка на базу знаний", 'href="baza-znaniy.html"' in text)

    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', text, re.S)
    ok("статья: JSON-LD найден", len(blocks) == 1, str(len(blocks)))
    parsed = None
    if blocks:
        try:
            parsed = json.loads(blocks[0])
            ok("статья: JSON-LD валиден", True)
        except Exception as e:
            ok("статья: JSON-LD валиден", False, str(e)[:80])
    if isinstance(parsed, dict) and "@graph" in parsed:
        types = [n.get("@type") for n in parsed["@graph"] if isinstance(n, dict)]
        ok("статья: Article в разметке", "Article" in types, str(types))
        ok("статья: хлебные крошки в разметке", "BreadcrumbList" in types, str(types))

    for fname, want in (("og-vytrezvlenie-piva.png", (1200, 630)),
                        ("og-image.png", (1200, 630))):
        p = os.path.join(SITE, "assets", fname)
        got = png_size(p) if os.path.exists(p) else None
        ok("assets/%s: %d×%d" % (fname, want[0], want[1]), got == want, str(got))

    bz = read_text(os.path.join(SITE, "baza-znaniy.html"))
    ok("baza-znaniy → статья: перелинковка", 'href="vytrezvlenie-piva.html"' in bz)


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
    # Кэш выключен: проверки должны видеть текущие файлы, а не версию из кэша Edge.
    tab.send("Network.enable")
    tab.send("Network.setCacheDisabled", {"cacheDisabled": True})
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
    check_articles()
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
                    hasEngine: typeof window.AL === 'object' && !!window.AL.Engine,
                    metrikaOff: !!(window.AL && window.AL.Metrika) && window.AL.Metrika.on === false,
                    ymAbsent: typeof window.ym === 'undefined'
                  };
                })()
            """)
            ok("index: движок загружен", data and data.get("hasEngine"))
            ok("index: метрика на localhost выключена", data and data.get("metrikaOff") is True)
            ok("index: скрипт Метрики на localhost не грузится", data and data.get("ymAbsent") is True)
            ok("index: три метрики результата", data and data.get("metrics") == 3, str(data and data.get("metrics")))
            ok("index: напиток попал в список", data and data.get("listItems") == 1)
            ok("index: график построен", data and data.get("chart") is True)
            ok("index: рекомендации появились", data and (data.get("advice") or 0) > 0)
            rev = (data or {}).get("reverse") or ""
            ok("index: обратный расчёт посчитан",
               "Максимум" in rev or "нет запаса" in rev or "Время уже прошло" in rev, rev)
            quick = tab.eval("""
                (function () {
                  var gate = document.querySelector('[data-gate="yes"]');
                  if (gate) gate.click();
                  // начинаем с пустого списка: от него зависят и счётчики позиций, и текст-подсказка
                  var resetFirst = document.querySelector('#reset-list');
                  if (resetFirst) resetFirst.click();
                  var hint = (document.querySelector('#drink-hint').textContent || '').trim();
                  var noteEmpty = (document.querySelector('#now-note').textContent || '').trim();
                  var rows = function () { return document.querySelectorAll('#drink-list li').length; };
                  var gramsOf = function (i) {
                    var li = document.querySelectorAll('#drink-list li')[i];
                    var m = li ? li.textContent.match(/([\\d.,]+)\\s*г/) : null;
                    return m ? parseFloat(m[1].replace(',', '.')) : 0;
                  };
                  var btn = document.querySelector('#add-drink');
                  // двойной клик по «Рассчитать» не должен удваивать дозировку
                  btn.click(); btn.click();
                  var sameTwice = rows();
                  var gramsOnce = gramsOf(0);
                  var noteFresh = (document.querySelector('#now-note').textContent || '').trim();
                  // смена объёма пересчитывает последнюю позицию сразу, без нажатий
                  var vol = document.querySelector('#volume');
                  vol.value = String(Number(vol.value) * 2);
                  vol.dispatchEvent(new Event('input', { bubbles: true }));
                  var afterVolume = rows();
                  var gramsDoubled = gramsOf(0);
                  var zeroText = '';
                  var metrics = document.querySelectorAll('#result-metrics .metric');
                  if (metrics.length > 1) zeroText = metrics[1].innerText.replace(/\\s+/g, ' ').slice(0, 80);
                  // второй напиток добавляется к первому, а не заменяет его
                  var sel = document.querySelector('#drink');
                  var other = null;
                  for (var i = 0; i < sel.options.length; i++) {
                    if (sel.options[i].value && sel.options[i].value !== sel.value) { other = sel.options[i].value; break; }
                  }
                  sel.value = other;
                  sel.dispatchEvent(new Event('change', { bubbles: true }));
                  btn.click();
                  var afterSecond = rows();
                  // «Когда»: по умолчанию «сейчас», время открывается кнопкой «другое время»
                  var whenInput = document.querySelector('#when');
                  var whenHidden = whenInput.hidden;
                  document.querySelector('#when-other').click();
                  var whenShown = !whenInput.hidden;
                  document.querySelector('#when-other').click();
                  var whenHiddenAgain = whenInput.hidden;
                  // объём и крепость должны быть на виду, а не спрятаны в «Рассчитать точнее»
                  var volumeInDetails = !!document.querySelector('#volume').closest('details');
                  // «Рассчитать точнее» раскрывает блок с ростом/возрастом
                  document.querySelector('#more-precise').click();
                  var preciseOpen = document.querySelector('#precise').open;
                  // возвращаем одну позицию: проверка «В дневник» ниже ждёт ровно одну запись
                  document.querySelector('#reset-list').click();
                  btn.click();
                  // подпись напитка — «Пиво светлое — 4,5 %»: без мл, объём вводится полем ниже
                  var optText = sel.options[sel.selectedIndex].textContent;
                  var vodkaCount = 0;
                  for (var j = 0; j < sel.options.length; j++) {
                    if ((sel.options[j].value || '').indexOf('vodka') === 0) vodkaCount++;
                  }
                  // подсказка считается по полям: меняем объём — меняются граммы
                  var hintBefore = document.querySelector('#drink-hint').textContent;
                  var vol2 = document.querySelector('#volume');
                  vol2.value = '250';
                  vol2.dispatchEvent(new Event('input', { bubbles: true }));
                  var hintAfter = document.querySelector('#drink-hint').textContent;
                  // «Желудок»: полный — всасывание 60 мин, пустой — 20, «не учитывать» — 40
                  var stomach = document.querySelector('#stomach');
                  var peak = document.querySelector('#peak');
                  var setStomach = function (v) {
                    stomach.value = v;
                    stomach.dispatchEvent(new Event('change', { bubbles: true }));
                  };
                  setStomach('full');
                  var peakFull = peak.value;
                  var breakdownText = document.querySelector('#breakdown').innerText;
                  setStomach('empty');
                  var peakEmpty = peak.value;
                  setStomach('any');
                  var peakAny = peak.value;
                  var stomachHint = document.querySelector('#stomach-hint').textContent;
                  // «Сейчас в крови»: пояснение должно объяснять, почему цифра меняется —
                  // свежая порция ещё всасывается, а порция 3 часа назад уже прошла пик.
                  var when2 = document.querySelector('#when');
                  document.querySelector('#when-other').click();
                  var back = new Date(Date.now() - 3 * 3600 * 1000);
                  var daySel = document.querySelector('#day');
                  daySel.value = (back.getDate() === new Date().getDate()) ? '0' : '-1';
                  daySel.dispatchEvent(new Event('change', { bubbles: true }));
                  when2.value = ('0' + back.getHours()).slice(-2) + ':' + ('0' + back.getMinutes()).slice(-2);
                  when2.dispatchEvent(new Event('input', { bubbles: true }));
                  var noteAfterPeak = (document.querySelector('#now-note').textContent || '').trim();
                  daySel.value = '0';
                  daySel.dispatchEvent(new Event('change', { bubbles: true }));
                  document.querySelector('#when-other').click();
                  return { hint: hint, hintBefore: hintBefore, hintAfter: hintAfter,
                           optText: optText, vodkaCount: vodkaCount,
                           noteEmpty: noteEmpty, noteFresh: noteFresh, noteAfterPeak: noteAfterPeak,
                           peakFull: peakFull, peakEmpty: peakEmpty, peakAny: peakAny,
                           breakdownText: breakdownText, stomachHint: stomachHint,
                           sameTwice: sameTwice, gramsOnce: gramsOnce,
                           afterVolume: afterVolume, gramsDoubled: gramsDoubled,
                           afterSecond: afterSecond, zero: zeroText,
                           whenHidden: whenHidden, whenShown: whenShown,
                           whenHiddenAgain: whenHiddenAgain, volumeInDetails: volumeInDetails,
                           preciseOpen: preciseOpen };
                })()
            """)
            ok("index: подсказка под напитком заполнена",
               "г чистого спирта" in ((quick or {}).get("hint") or ""), (quick or {}).get("hint"))
            ok("index: повторный «Рассчитать» не удваивает дозировку",
               quick and quick.get("sameTwice") == 1, str((quick or {}).get("sameTwice")))
            ok("index: смена объёма пересчитывает последнюю позицию сразу",
               quick and quick.get("afterVolume") == 1 and
               (quick.get("gramsDoubled") or 0) > (quick.get("gramsOnce") or 0) * 1.8,
               "позиций %s, г %s → %s" % ((quick or {}).get("afterVolume"),
                                          (quick or {}).get("gramsOnce"), (quick or {}).get("gramsDoubled")))
            ok("index: второй напиток суммируется с первым",
               quick and quick.get("afterSecond") == 2, str((quick or {}).get("afterSecond")))
            ok("index: после смены объёма «До 0,00» пересчитано",
               "ч" in ((quick or {}).get("zero") or ""), (quick or {}).get("zero"))
            ok("index: «Когда» по умолчанию — «сейчас»",
               quick and quick.get("whenHidden") is True, str((quick or {}).get("whenHidden")))
            ok("index: «другое время» открывает и прячет поле времени",
               quick and quick.get("whenShown") is True and quick.get("whenHiddenAgain") is True,
               "открылось %s, спряталось %s" % ((quick or {}).get("whenShown"), (quick or {}).get("whenHiddenAgain")))
            ok("index: объём и крепость в основной форме, не в «точнее»",
               quick and quick.get("volumeInDetails") is False, str((quick or {}).get("volumeInDetails")))
            ok("index: «Рассчитать точнее» раскрывает параметры",
               (quick or {}).get("preciseOpen") is True)
            opt = (quick or {}).get("optText") or ""
            ok("index: в подписи напитка нет объёма, только крепость",
               "%" in opt and "мл" not in opt, opt)
            ok("index: в базе один пункт «Водка»",
               (quick or {}).get("vodkaCount") == 1, str((quick or {}).get("vodkaCount")))
            ok("index: подсказка считается по введённому объёму",
               (quick or {}).get("hintBefore") != (quick or {}).get("hintAfter") and
               "г чистого спирта" in ((quick or {}).get("hintAfter") or ""),
               "%s → %s" % ((quick or {}).get("hintBefore"), (quick or {}).get("hintAfter")))
            ok("index: «Желудок»: полный — 60 мин, пустой — 20, не учитывать — 40",
               (quick or {}).get("peakFull") == "60" and (quick or {}).get("peakEmpty") == "20" and
               (quick or {}).get("peakAny") == "40",
               "полный %s, пустой %s, любой %s" % ((quick or {}).get("peakFull"),
                                                   (quick or {}).get("peakEmpty"),
                                                   (quick or {}).get("peakAny")))
            ok("index: всасывание 60 мин попало в расчёт",
               "60 мин" in ((quick or {}).get("breakdownText") or ""),
               str((quick or {}).get("breakdownText"))[:120])
            ok("index: у «Желудка» есть пояснение",
               bool((quick or {}).get("stomachHint")), str((quick or {}).get("stomachHint")))
            ok("index: под «Сейчас в крови» есть пояснение",
               "всасыва" in ((quick or {}).get("noteEmpty") or "").lower(),
               (quick or {}).get("noteEmpty"))
            ok("index: пояснение объясняет рост показателя (порция ещё всасывается)",
               "всасыва" in ((quick or {}).get("noteFresh") or "").lower(),
               (quick or {}).get("noteFresh"))
            note_after = (quick or {}).get("noteAfterPeak") or ""
            ok("index: пояснение после пика — про выведение, а не про всасывание",
               ("выведен" in note_after.lower() or "вышел" in note_after.lower()) and
               note_after != (quick or {}).get("noteFresh"), note_after)
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

        # --- статья про пиво: таблицы, ссылки, разметка ---
        def article_js(tab):
            data = tab.eval("""
                (function () {
                  return {
                    tables: document.querySelectorAll('.prose table').length,
                    rows: document.querySelectorAll('.prose table tbody tr').length,
                    calc: document.querySelectorAll('a[href="index.html"]').length,
                    ld: (function () { try { return !!JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph']; } catch (e) { return false; } })(),
                    h1: (document.querySelector('h1') || {}).innerText || ''
                  };
                })()
            """)
            ok("статья: две таблицы", data and data.get("tables") == 2, str(data and data.get("tables")))
            ok("статья: шесть строк в таблицах", data and data.get("rows") == 6, str(data and data.get("rows")))
            ok("статья: ссылки на калькулятор", data and (data.get("calc") or 0) >= 2, str(data and data.get("calc")))
            ok("статья: JSON-LD разбирается в браузере", data and data.get("ld") is True)
            ok("статья: H1 на месте", bool(data and "выветривается пиво" in (data.get("h1") or "").lower()))

        errors = open_page(BASE + "/vytrezvlenie-piva.html", article_js)
        ok("статья: нет ошибок JS", not errors, "; ".join(errors))

        # --- статья на 390 px: страница не «разъезжается», таблица прокручивается внутри блока ---
        def article_mobile_js(tab):
            tab.send("Emulation.setDeviceMetricsOverride",
                     {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
            tab.send("Page.reload")
            time.sleep(1.6)
            tab.wait_ready()
            tab.eval("(function(){var g=document.querySelector('[data-gate=\"yes\"]');if(g)g.click();})()")
            time.sleep(0.4)
            data = tab.eval("""
                (function () {
                  var w = document.querySelector('.table-wrap');
                  return {
                    doc: document.documentElement.scrollWidth,
                    vw: window.innerWidth,
                    tw: w ? w.scrollWidth : 0,
                    cw: w ? w.clientWidth : 0
                  };
                })()
            """)
            ok("статья 390: нет горизонтальной прокрутки страницы",
               data and data.get("doc", 0) <= data.get("vw", 0) + 1, str(data))
            ok("статья 390: таблица прокручивается внутри блока",
               data and data.get("tw", 0) > data.get("cw", 0) and data.get("cw", 9999) <= data.get("vw", 0),
               str(data))

        errors = open_page(BASE + "/vytrezvlenie-piva.html", article_mobile_js)
        ok("статья 390: нет ошибок JS", not errors, "; ".join(errors))

        # --- статические страницы ---
        for page in ("baza-znaniy.html", "o-proekte.html", "politika.html", "disclaimer.html"):
            errors = open_page(BASE + "/" + page)
            ok("%s: нет ошибок JS" % page, not errors, "; ".join(errors))

        # --- мобильная вёрстка 390 px: нет горизонтальной прокрутки и обрезанного меню ---
        def mobile_js(tab):
            tab.send("Emulation.setDeviceMetricsOverride",
                     {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
            tab.send("Page.reload")
            time.sleep(1.5)
            tab.wait_ready()
            data = tab.eval("""
                (function () {
                  var links = Array.prototype.map.call(document.querySelectorAll('.nav a'), function (a) {
                    var r = a.getBoundingClientRect();
                    return { t: (a.innerText || '').trim(), left: Math.round(r.left), right: Math.round(r.right) };
                  });
                  var cut = links.filter(function (l) {
                    return l.right > window.innerWidth + 1 || l.left < -1;
                  });
                  var btn = document.querySelector('#add-drink');
                  var navFirst = document.querySelector('.nav a');
                  var calc = document.querySelector('.calc-top');
                  var meta = document.querySelector('.hero-meta');
                  return {
                    innerWidth: window.innerWidth,
                    scrollWidth: document.documentElement.scrollWidth,
                    navCut: cut.map(function (l) { return l.t; }).join(', '),
                    navCount: links.length,
                    navLeft: navFirst ? Math.round(navFirst.getBoundingClientRect().left) : 0,
                    btnWidth: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
                    calcTop: calc ? Math.round(calc.getBoundingClientRect().top + window.scrollY) : -1,
                    metaTop: meta ? Math.round(meta.getBoundingClientRect().top + window.scrollY) : -1
                  };
                })()
            """)
            tab.send("Emulation.clearDeviceMetricsOverride")
            ok("мобильная вёрстка: нет горизонтальной прокрутки",
               data and data.get("scrollWidth") <= data.get("innerWidth") + 1,
               "%s против %s px" % ((data or {}).get("scrollWidth"), (data or {}).get("innerWidth")))
            ok("мобильная вёрстка: все пункты меню видны",
               data and data.get("navCount", 0) >= 4 and not data.get("navCut"),
               "обрезано: %s" % ((data or {}).get("navCut") or "нет"))
            ok("мобильная вёрстка: «Рассчитать» во всю ширину карточки",
               data and data.get("btnWidth", 0) >= (data.get("innerWidth") or 390) * 0.7,
               "%s px" % ((data or {}).get("btnWidth")))
            ok("мобильная вёрстка: контент не прижат к краю экрана",
               data and data.get("navLeft", 0) >= 8,
               "первый пункт меню на %s px от края" % ((data or {}).get("navLeft")))
            ok("мобильная вёрстка: калькулятор выше описания и бейджей",
               data and 0 <= data.get("calcTop", -1) < data.get("metaTop", -1),
               "калькулятор %s px, описание %s px" % ((data or {}).get("calcTop"), (data or {}).get("metaTop")))
            ok("мобильная вёрстка: форма видна на первом экране",
               data and 0 <= data.get("calcTop", -1) <= 480,
               "форма начинается на %s px от верха страницы" % ((data or {}).get("calcTop")))

        errors = open_page(BASE + "/index.html", mobile_js)
        ok("мобильная вёрстка: нет ошибок JS", not errors, "; ".join(errors))

        # --- десктоп 1280 px: описание и бейджи остаются выше калькулятора ---
        def desktop_js(tab):
            tab.send("Emulation.setDeviceMetricsOverride",
                     {"width": 1280, "height": 900, "deviceScaleFactor": 1, "mobile": False})
            tab.send("Page.reload")
            time.sleep(1.5)
            tab.wait_ready()
            data = tab.eval("""
                (function () {
                  var calc = document.querySelector('.calc-top');
                  var meta = document.querySelector('.hero-meta');
                  return {
                    innerWidth: window.innerWidth,
                    calcTop: calc ? Math.round(calc.getBoundingClientRect().top + window.scrollY) : -1,
                    metaTop: meta ? Math.round(meta.getBoundingClientRect().top + window.scrollY) : -1
                  };
                })()
            """)
            tab.send("Emulation.clearDeviceMetricsOverride")
            ok("десктоп: описание и бейджи выше калькулятора",
               data and 0 <= data.get("metaTop", -1) < data.get("calcTop", -1),
               "описание %s px, калькулятор %s px" % ((data or {}).get("metaTop"), (data or {}).get("calcTop")))

        errors = open_page(BASE + "/index.html", desktop_js)
        ok("десктоп 1280 px: нет ошибок JS", not errors, "; ".join(errors))
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

