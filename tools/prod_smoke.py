# -*- coding: utf-8 -*-
"""Проверка боевого сайта в браузере: калькулятор считает, Метрика включена.

    python tools\\prod_smoke.py

Headless Edge с временным профилем, порт 9224 — Chrome пользователя не затрагивается.
Ходит на https://trezvometr.ru (нужен интернет).
"""
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

TOOLS = r"C:\Users\marsf\Desktop\Порядок\Софт 2026\_tools"
PORT = 9224
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
BASE = "https://trezvometr.ru"

sys.path.insert(0, TOOLS)
import _cdp  # noqa: E402

_cdp.PORT = PORT

results = []


def check(name, cond, extra=""):
    results.append((bool(cond), name, extra))


def main():
    profile = os.path.join(tempfile.gettempdir(), "edge_trezvometr_prod")
    proc = subprocess.Popen(
        [EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
         "--user-data-dir=" + profile, "--remote-debugging-port=%d" % PORT, "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(40):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PORT, timeout=2).read()
            break
        except Exception:
            time.sleep(0.5)
    try:
        info = _cdp.new_tab(BASE + "/index.html")
        tab = _cdp.tab_for(info)
        tab.send("Runtime.enable")
        tab.send("Page.enable")
        tab.wait_ready()
        time.sleep(4)
        data = tab.eval("""
            (function () {
              var gate = document.querySelector('[data-gate="yes"]');
              if (gate) gate.click();
              document.querySelector('#add-drink').click();
              return {
                metrics: document.querySelectorAll('#result-metrics .metric').length,
                chart: !!document.querySelector('#chart svg'),
                metrikaOn: !!(window.AL && window.AL.Metrika && window.AL.Metrika.on),
                ymLoaded: typeof window.ym === 'function',
                counter: (window.AL && window.AL.Metrika && window.AL.Metrika.id) || 0,
                canonical: (document.querySelector('link[rel=canonical]') || {}).href || ''
              };
            })()
        """)
        data = data or {}
        check("прод: калькулятор считает", data.get("metrics") == 3, str(data.get("metrics")))
        check("прод: график построен", data.get("chart") is True)
        check("прод: Метрика включена", data.get("metrikaOn") is True)
        check("прод: скрипт Метрики загрузился", data.get("ymLoaded") is True)
        check("прод: номер счётчика 114125326", data.get("counter") == 114125326, str(data.get("counter")))
        check("прод: canonical на домен", data.get("canonical") == BASE + "/",
              data.get("canonical"))
        tab.close()
    finally:
        proc.terminate()

    bad = [r for r in results if not r[0]]
    for passed, name, extra in results:
        print("%s %-44s %s" % ("OK  " if passed else "FAIL", name, extra))
    print("\nПройдено: %d из %d" % (len(results) - len(bad), len(results)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
