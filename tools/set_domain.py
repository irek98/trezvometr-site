# -*- coding: utf-8 -*-
"""Перевод сайта на боевой домен: canonical, og:url, og:image, robots.txt, sitemap.xml.

    python tools\\set_domain.py                      # домен по умолчанию https://trezvometr.ru
    python tools\\set_domain.py --domain https://x.ru
    python tools\\set_domain.py --check               # ничего не менять, только показать состояние

Скрипт идемпотентный: теги вставляются один раз, повторный запуск только обновляет домен
внутри блока `<!-- domain-block -->`. Служебная tests.html остаётся закрытой от индексации.
"""
import argparse
import datetime
import io
import os
import re
import sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DOMAIN = "https://trezvometr.ru"
STYLE_LINK = '<link rel="stylesheet" href="assets/style.css?v=1">'
NOINDEX = '<meta name="robots" content="noindex,nofollow">'
KEEP_NOINDEX = {"tests.html", "og-image.html"}
START = "  <!-- domain-block -->"
END = "  <!-- /domain-block -->"


def read(path):
    with io.open(path, "rb") as f:
        raw = f.read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    return raw.decode("utf-8-sig"), bom


def write(path, text, bom):
    data = text.encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    with io.open(path, "wb") as f:
        f.write(data)


def page_url(domain, name):
    return domain + "/" if name == "index.html" else domain + "/" + name


def block_for(domain, name):
    url = page_url(domain, name)
    img = domain + "/assets/og-image.png"
    return "\n".join([
        START,
        '  <link rel="canonical" href="%s">' % url,
        '  <meta property="og:url" content="%s">' % url,
        '  <meta property="og:image" content="%s">' % img,
        '  <meta property="og:image:width" content="1200">',
        '  <meta property="og:image:height" content="630">',
        '  <meta name="twitter:card" content="summary_large_image">',
        '  <meta name="twitter:image" content="%s">' % img,
        END,
    ])


def process_html(path, name, domain, apply_changes, report):
    text, bom = read(path)
    has_noindex = NOINDEX in text
    has_block = START in text
    changed = False

    if name in KEEP_NOINDEX:
        if not has_noindex:
            report.append("%-22s нет noindex (служебная — должна быть закрыта)" % name)
        return False

    if has_noindex:
        text = re.sub(r"[ \t]*" + re.escape(NOINDEX) + r"[ \t]*\r?\n?", "", text)
        changed = True
        report.append("%-22s убран noindex" % name)

    new_block = block_for(domain, name)
    if has_block:
        text = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda m: new_block, text, flags=re.S)
        changed = True
    elif STYLE_LINK in text:
        text = text.replace("  " + STYLE_LINK, new_block + "\n  " + STYLE_LINK, 1)
        changed = True
        report.append("%-22s добавлены canonical, og:url, og:image" % name)
    else:
        report.append("%-22s не нашёл строку подключения стилей" % name)
        return False

    if apply_changes and changed:
        write(path, text, bom)
    return changed


def process_sitemap(path, domain, apply_changes, report):
    text, bom = read(path)
    today = datetime.date.today().isoformat()
    # Меняем только <loc>…</loc>: xmlns схемы трогать нельзя, иначе sitemap невалиден.
    new = re.sub(r"(<loc>)https?://[^/<\s]+", lambda m: m.group(1) + domain, text)
    new = re.sub(r"<lastmod>[^<]*</lastmod>", "<lastmod>%s</lastmod>" % today, new)
    new = re.sub(r"(<\?xml[^>]*\?>\s*)<!--.*?-->\s*", lambda m: m.group(1), new, flags=re.S)
    if new != text:
        report.append("sitemap.xml            домен %s, lastmod %s" % (domain, today))
        if apply_changes:
            write(path, new, bom)
        return True
    return False


ROBOTS = """User-agent: *
Disallow: /tests.html
Disallow: /og-image.html
Allow: /

Sitemap: %s/sitemap.xml
"""


def process_robots(path, domain, apply_changes, report):
    text, bom = read(path)
    new = ROBOTS % domain
    if text.strip() != new.strip():
        report.append("robots.txt             Sitemap %s/sitemap.xml" % domain)
        if apply_changes:
            write(path, new, bom)
        return True
    return False


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", default=DEFAULT_DOMAIN)
    ap.add_argument("--check", action="store_true", help="только показать, ничего не менять")
    args = ap.parse_args(argv)

    domain = args.domain.rstrip("/")
    if not domain.startswith("http"):
        print("домен должен быть с http:// или https://")
        return 2

    apply_changes = not args.check
    report = []
    changed = 0
    for name in sorted(os.listdir(SITE)):
        if not name.endswith(".html"):
            continue
        if process_html(os.path.join(SITE, name), name, domain, apply_changes, report):
            changed += 1
    for name, fn in (("sitemap.xml", process_sitemap), ("robots.txt", process_robots)):
        path = os.path.join(SITE, name)
        if os.path.exists(path) and fn(path, domain, apply_changes, report):
            changed += 1

    print("домен: %s   режим: %s" % (domain, "проверка" if args.check else "запись"))
    for line in report:
        print("  " + line)
    if not report:
        print("  всё уже на месте")
    print("изменено файлов: %d" % (changed if apply_changes else 0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
