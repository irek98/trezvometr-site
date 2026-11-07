# -*- coding: utf-8 -*-
"""Снимки страниц для визуальной проверки: python tools\\screenshots.py

Headless Edge с временным профилем, порт 9225, PNG в tools\\_shots\\.
Chrome пользователя и его профиль не затрагиваются.
"""
import base64
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_shots")
TOOLS = r"C:\Users\marsf\Desktop\Порядок\Софт 2026\_tools"
BASE = "http://127.0.0.1:8081"
PORT = 9225
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

sys.path.insert(0, TOOLS)
import _cdp  # noqa: E402

_cdp.PORT = PORT

PAGES = ["index.html", "pro.html", "dnevnik.html", "profil.html", "baza-znaniy.html"]


def main():
    os.makedirs(SHOTS, exist_ok=True)
    profile = os.path.join(tempfile.gettempdir(), "edge_trezvometr_shots")
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
    try:
        for page in PAGES:
            info = _cdp.new_tab(BASE + "/" + page)
            tab = _cdp.tab_for(info)
            tab.send("Page.enable")
            tab.send("Emulation.setDeviceMetricsOverride",
                     {"width": 1280, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            tab.wait_ready()
            time.sleep(0.8)
            tab.eval("(function(){var g=document.querySelector('[data-gate=\"yes\"]'); if(g) g.click();"
                     "var a=document.querySelector('#add-drink')||document.querySelector('#add-entry');"
                     "if(a) a.click(); return 1;})()")
            time.sleep(0.6)
            tab.send("Emulation.setDeviceMetricsOverride",
                     {"width": 1280, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
            shot = tab.send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
            data = ((shot or {}).get("result") or {}).get("data")
            out = os.path.join(SHOTS, page.replace(".html", ".png"))
            if data:
                with open(out, "wb") as f:
                    f.write(base64.b64decode(data))
                print("OK  " + out)
            else:
                print("FAIL " + page)
            tab.close()
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
