# -*- coding: utf-8 -*-
"""Проверка боевого сайта https://trezvometr.ru после деплоя.

    python tools\\deploy_check.py

Ничего не меняет: ходит по сети, сверяет домен, canonical, robots, sitemap, обложку,
редирект www → без www и HTTPS-сертификат. Возвращает 1, если есть провалы.
"""
import os
import re
import socket
import ssl
import sys
import urllib.error
import urllib.request

# Консоль Windows по умолчанию cp1251 — без этого печать «→» в отчёте падает
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

DOMAIN = "trezvometr.ru"
BASE = "https://" + DOMAIN
HTTP = "http://" + DOMAIN
PAGES = ["/", "/pro.html", "/dnevnik.html", "/profil.html", "/baza-znaniy.html",
         "/o-proekte.html", "/politika.html", "/disclaimer.html"]
UA = "trezvometr-deploy-check/1.0"
HERE = os.path.dirname(os.path.abspath(__file__))
LOCAL_SITEMAP = os.path.abspath(os.path.join(HERE, "..", "sitemap.xml"))

results = []


def ok(name, cond, extra=""):
    results.append((bool(cond), name, extra, "ok"))


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers, r.read().decode("utf-8", "replace")


def head(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA}, method="GET")
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, r.headers, r.read(400).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, ""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_dns():
    try:
        ips = sorted({ai[4][0] for ai in socket.getaddrinfo(DOMAIN, 443, socket.AF_INET)})
    except Exception as e:
        ok("DNS: имя разворачивается", False, str(e))
        return
    ok("DNS: четыре адреса GitHub Pages", len(ips) == 4 and all(i.startswith("185.199.") for i in ips),
       ", ".join(ips))
    try:
        w = sorted({ai[4][0] for ai in socket.getaddrinfo("www." + DOMAIN, 80, socket.AF_INET)})
    except Exception as e:
        ok("DNS: www разворачивается", False, str(e))
        return
    ok("DNS: www ведёт на GitHub Pages", all(i.startswith("185.199.") for i in w), ", ".join(w))


def check_http_redirect():
    status, headers, _ = head(HTTP + "/")
    loc = headers.get("Location", "") if headers else ""
    ok("http → https редирект", status in (301, 302, 308) and loc.startswith(BASE),
       "%s → %s" % (status, loc))
    status, headers, _ = head("http://www." + DOMAIN + "/")
    loc = headers.get("Location", "") if headers else ""
    ok("www → без www редирект", status in (301, 302, 308) and DOMAIN in loc, "%s → %s" % (status, loc))


def check_tls():
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((DOMAIN, 443), timeout=20) as sock:
            with ctx.wrap_socket(sock, server_hostname=DOMAIN) as ssock:
                cert = ssock.getpeercert()
    except Exception as e:
        ok("TLS: сертификат на домен", False, str(e)[:160])
        return
    names = [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"]
    ok("TLS: сертификат на домен", DOMAIN in names or ("*." + DOMAIN) in names, ", ".join(names[:4]))


def local_sitemap():
    """Адреса из локального sitemap.xml — эталон для сверки с продом."""
    with open(LOCAL_SITEMAP, encoding="utf-8") as f:
        return re.findall(r"<loc>([^<]+)</loc>", f.read())


def pages_to_check():
    """Страницы для проверки — из локального sitemap (новые статьи попадают сами).

    Раньше список был жёстко вписан, поэтому после появления статьи проверка
    падала на «восемь адресов» и не смотрела саму статью.
    """
    try:
        locs = local_sitemap()
    except Exception:
        return PAGES
    pages = []
    for url in locs:
        path = url.replace(BASE, "") or "/"
        if path not in pages:
            pages.append(path)
    return pages or PAGES


def check_pages():
    for path in pages_to_check():
        url = BASE + path
        try:
            status, _, body = fetch(url)
        except Exception as e:
            ok("страница %s отдаётся" % path, False, str(e)[:160])
            continue
        ok("страница %s отдаётся" % path, status == 200, str(status))
        canonical = re.search(r'<link rel="canonical" href="([^"]+)"', body)
        expected = BASE + path
        ok("%s: canonical" % path, canonical and canonical.group(1).rstrip("/") == expected.rstrip("/"),
           canonical.group(1) if canonical else "нет тега")
        ok("%s: открыт для индексации" % path, 'content="noindex' not in body)


def check_files():
    try:
        status, _, body = fetch(BASE + "/robots.txt")
        ok("robots.txt: Sitemap и закрытые служебные",
           status == 200 and ("Sitemap: %s/sitemap.xml" % BASE) in body and "/tests.html" in body)
    except Exception as e:
        ok("robots.txt отдаётся", False, str(e)[:160])

    try:
        status, _, body = fetch(BASE + "/sitemap.xml")
        locs = re.findall(r"<loc>([^<]+)</loc>", body)
        try:
            local = local_sitemap()
        except Exception:
            local = []
        same = sorted(locs) == sorted(local) and bool(local)
        ok("sitemap.xml: адреса совпадают с локальным",
           status == 200 and same and all(u.startswith(BASE) for u in locs),
           "%d адресов на домене, %d локально" % (len(locs), len(local)))
        ok("sitemap.xml: без служебных страниц", "tests.html" not in body and "og-image" not in body)
        ok("sitemap.xml: схема sitemaps.org", 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' in body)
    except Exception as e:
        ok("sitemap.xml отдаётся", False, str(e)[:160])

    try:
        status, headers, _ = head(BASE + "/assets/og-image.png")
        length = int((headers or {}).get("Content-Length", 0) or 0)
        ok("обложка og-image.png", status == 200 and length > 100000,
           "%s, %d байт" % (status, length))
    except Exception as e:
        ok("обложка og-image.png", False, str(e)[:160])

    try:
        status, _, body = fetch(BASE + "/tests.html")
        ok("tests.html закрыт от индексации", status == 200 and "noindex" in body)
    except Exception as e:
        ok("tests.html закрыт от индексации", False, str(e)[:160])


def main():
    check_dns()
    check_http_redirect()
    check_tls()
    check_pages()
    check_files()

    bad = [r for r in results if not r[0]]
    for passed, name, extra, kind in results:
        mark = "OK  " if passed else ("WARN" if kind == "warn" else "FAIL")
        print("%s %-52s %s" % (mark, name, extra))
    print("\nПройдено: %d из %d" % (len(results) - len(bad), len(results)))
    if bad:
        print("Провалы: %d" % len(bad))
        return 1
    print("Боевой сайт в порядке.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
