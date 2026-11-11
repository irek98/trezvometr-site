# -*- coding: utf-8 -*-
"""Обложки статей для соцсетей: assets\\og-<slug>.png (1200×630).

    python tools\\og_pages.py                       # все статьи из ARTICLES
    python tools\\og_pages.py vytrezvlenie-piva    # только одна

Headless Edge с временным профилем и портом 9226 — Chrome пользователя не затрагивается.
Шаблон — в этом файле: тёмный фон, знак «Трезвометр», заголовок в 2–3 строки, подзаголовок.
"""
import base64
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = r"C:\Users\marsf\Desktop\Порядок\Софт 2026\_tools"
PORT = 9226
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

sys.path.insert(0, TOOLS)
import _cdp  # noqa: E402

_cdp.PORT = PORT

# slug -> (строки заголовка, подзаголовок)
ARTICLES = {
    "vytrezvlenie-piva": (
        ["Сколько выветривается", "пиво"],
        "Таблица: 0,5 / 1 / 1,5 / 2 л по весу и крепости",
    ),
    "cherez-skolko-mozhno-za-rul": (
        ["Через сколько", "можно за руль"],
        "Таблица: водка, вино, пиво — порог 0,16 мг/л и полный ноль",
    ),
}

TPL = """<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<style>
  html, body {{ margin: 0; padding: 0; width: 1200px; height: 630px; }}
  body {{
    background: radial-gradient(900px 520px at 88% 8%, #10312c 0%, #060c11 62%);
    color: #e9f6f2; font-family: "Segoe UI", Roboto, Arial, sans-serif;
    box-sizing: border-box; padding: 64px 72px; position: relative; overflow: hidden;
  }}
  .brand {{ display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 600;
    letter-spacing: .2px; color: #dff5ef; }}
  .mark {{ width: 62px; height: 62px; }}
  h1 {{ font-size: 74px; line-height: 1.06; margin: 64px 0 0; font-weight: 700; letter-spacing: -1px; }}
  h1 span {{ display: block; }}
  h1 span.accent {{ color: #34d8b3; }}
  .sub {{ margin-top: 26px; font-size: 31px; line-height: 1.35; color: #a9c7c0; max-width: 900px; }}
  .domain {{ position: absolute; right: 72px; bottom: 54px; font-size: 27px; color: #34d8b3;
    letter-spacing: .4px; }}
  .rule {{ position: absolute; left: 0; bottom: 0; height: 10px; width: 100%;
    background: linear-gradient(90deg, #34d8b3 0%, #34d8b3 38%, rgba(52,216,179,0) 100%); }}
</style></head>
<body>
  <div class="brand">
    <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="#34d8b3" stroke-width="2.2"
        stroke-dasharray="60 22" stroke-linecap="round" transform="rotate(-90 16 16)"/>
      <path d="M16 8.5c3.6 2.6 5.6 5.2 5.6 8a5.6 5.6 0 0 1-11.2 0c0-2.8 2-5.4 5.6-8z"
        fill="rgba(52,216,179,.22)" stroke="#34d8b3" stroke-width="1.6"/>
    </svg>
    <span>Трезвометр</span>
  </div>
  <h1>{title_html}</h1>
  <div class="sub">{subtitle}</div>
  <div class="domain">trezvometr.ru</div>
  <div class="rule"></div>
</body></html>
"""


def build_html(lines, subtitle):
    parts = []
    for i, line in enumerate(lines):
        cls = ' class="accent"' if i == len(lines) - 1 else ""
        parts.append("<span%s>%s</span>" % (cls, line))
    return TPL.format(title_html="".join(parts), subtitle=subtitle)


def render(tab, html, out):
    fd, path = tempfile.mkstemp(suffix=".html")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    tab.goto("file:///" + path.replace("\\", "/"))
    tab.wait_ready()
    time.sleep(0.8)
    shot = tab.send("Page.captureScreenshot",
                    {"format": "png", "clip": {"x": 0, "y": 0, "width": 1200, "height": 630, "scale": 1}})
    data = ((shot or {}).get("result") or {}).get("data")
    os.remove(path)
    if not data:
        return False
    with open(out, "wb") as f:
        f.write(base64.b64decode(data))
    return True


def main():
    wanted = [a for a in sys.argv[1:] if not a.startswith("-")] or list(ARTICLES)
    profile = os.path.join(tempfile.gettempdir(), "edge_trezvometr_og")
    proc = subprocess.Popen(
        [EDGE, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
         "--user-data-dir=" + profile, "--remote-debugging-port=%d" % PORT, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2).read()
            break
        except Exception:
            time.sleep(0.5)
    bad = 0
    try:
        info = _cdp.new_tab("about:blank")
        tab = _cdp.tab_for(info)
        tab.send("Page.enable")
        tab.send("Emulation.setDeviceMetricsOverride",
                 {"width": 1200, "height": 630, "deviceScaleFactor": 1, "mobile": False})
        for slug in wanted:
            if slug not in ARTICLES:
                print("нет такой статьи:", slug)
                bad += 1
                continue
            lines, subtitle = ARTICLES[slug]
            out = os.path.join(SITE, "assets", "og-%s.png" % slug)
            okk = render(tab, build_html(lines, subtitle), out)
            print("%-24s %s%s" % (slug, "OK" if okk else "FAIL",
                                  "" if not okk else " (%d байт)" % os.path.getsize(out)))
            bad += 0 if okk else 1
        tab.close()
    finally:
        proc.kill()
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
