// Яндекс.Метрика: загрузка счётчика и цели. Номер счётчика — в assets/config.js (metrikaId).
// На localhost, 127.0.0.1 и file:// счётчик НЕ загружается: тесты и разработка не попадают в статистику.
// Вебвизор выключен намеренно: на сайте вводят вес, пол и алкоголь — записывать это нельзя.
(function (global) {
  'use strict';

  var cfg = global.AL_CONFIG || {};
  var id = Number(cfg.metrikaId) || 0;
  var host = (global.location && global.location.hostname) || '';
  var proto = (global.location && global.location.protocol) || '';
  var isProd = id > 0 && !!host && host !== 'localhost' && host !== '127.0.0.1' && proto !== 'file:';

  var queue = [];
  var last = {};

  function load() {
    /* официальный сниппет Метрики, только асинхронно и после загрузки страницы */
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      for (var j = 0; j < document.scripts.length; j++) {
        if (document.scripts[j].src === r) return;
      }
      k = e.createElement(t);
      a = e.getElementsByTagName(t)[0];
      k.async = 1;
      k.src = r;
      a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');

    global.ym(id, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
      ecommerce: false
    });

    queue.forEach(function (item) { global.ym(id, 'reachGoal', item[0], item[1] || {}); });
    queue = [];
  }

  // Цель: цель Метрики по имени. Пока счётчик не загрузился — складываем в очередь.
  function goal(name, params) {
    if (!isProd || !name) return;
    if (global.ym) {
      try { global.ym(id, 'reachGoal', name, params || {}); } catch (e) { /* счётчик заблокирован — не мешаем работе */ }
    } else {
      queue.push([name, params]);
    }
  }

  // Цель не чаще одного раза в interval мс: расчёт пересчитывается на каждый ввод.
  function goalOnce(name, interval) {
    var now = Date.now();
    if (last[name] && now - last[name] < (interval || 30000)) return;
    last[name] = now;
    goal(name);
  }

  if (isProd) {
    if (document.readyState === 'complete') {
      setTimeout(load, 1200);
    } else {
      global.addEventListener('load', function () { setTimeout(load, 1200); });
    }
    // Переход в режим «0,00» — самая важная цель после расчёта.
    document.addEventListener('click', function (e) {
      var node = e.target;
      while (node && node !== document) {
        if (node.tagName === 'A' && (node.getAttribute('href') || '').indexOf('pro.html') >= 0) {
          goal('pro-open');
          return;
        }
        node = node.parentNode;
      }
    }, true);
  }

  global.AL = global.AL || {};
  global.AL.Metrika = { id: id, on: isProd, goal: goal, goalOnce: goalOnce };
})(window);
