# -*- coding: utf-8 -*-
"""Обложка для соцсетей: og-image.html → assets\\og-image.png (1200×630).

    python tools\\og_image.py

Headless Edge с временным профилем и портом 9226: Chrome пользователя не затрагивается.
Файл читается по file:// — сервер на 8081 не нужен.
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
OUT = os.path.join(SITE, "assets", "og-image.png")
SRC = os.path.join(SITE, "og-image.html")

sys.path.insert(0, TOOLS)
import _cdp  # noqa: E402

_cdp.PORT = PORT


def main():
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
    try:
        url = "file:///" + SRC.replace("\\", "/")
        info = _cdp.new_tab(url)
        tab = _cdp.tab_for(info)
        tab.send("Page.enable")
        tab.send("Emulation.setDeviceMetricsOverride",
                 {"width": 1200, "height": 630, "deviceScaleFactor": 1, "mobile": False})
        tab.wait_ready()
        time.sleep(1.0)
        shot = tab.send("Page.captureScreenshot",
                        {"format": "png", "clip": {"x": 0, "y": 0, "width": 1200, "height": 630, "scale": 1}})
        data = ((shot or {}).get("result") or {}).get("data")
        if not data:
            print("FAIL: скриншот не получен")
            return 1
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "wb") as f:
            f.write(base64.b64decode(data))
        print("OK  %s (%d байт)" % (OUT, os.path.getsize(OUT)))
        tab.close()
        return 0
    finally:
        proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
