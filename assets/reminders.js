// Напоминания: «остановись к 22:30» и «проверь трезвость». Работают, пока открыта вкладка.
(function (global) {
  'use strict';
  var UI = global.AL.UI;
  var S = global.AL.Store;

  var LABELS = {
    stop: { title: 'Пора остановиться', body: 'Достигнуто время, после которого лучше не пить.' },
    check: { title: 'Время проверить трезвость', body: 'Проверьте состояние алкотестером или пересчитайте в калькуляторе.' }
  };

  function render() {
    var box = UI.qs('#rem-list');
    if (!box) return;
    var list = S.listReminders();
    if (!list.length) {
      box.innerHTML = '<li class="muted small">Напоминаний нет. Время проверяется, пока вкладка открыта.</li>';
      return;
    }
    box.innerHTML = list.map(function (r) {
      var label = r.kind === 'check' ? 'проверить трезвость' : 'остановиться';
      var status = r.fired ? 'сработало' : UI.fmtTime(r.tMs) + ' · ' + UI.relative(r.tMs);
      return '<li><span>' + r.hhmm + ' — ' + label + '</span><b>' + status +
        ' <button class="icon-btn" data-rid="' + r.id + '" aria-label="Убрать">×</button></b></li>';
    }).join('');
    UI.qsa('[data-rid]', box).forEach(function (b) {
      UI.on(b, 'click', function () {
        S.removeReminder(b.getAttribute('data-rid'));
        render();
        UI.toast('Напоминание убрано');
      });
    });
  }

  function add(kind, timeInput) {
    var hhmm = (timeInput && timeInput.value) || '22:30';
    var tMs = UI.timeToMs(hhmm, 0);
    if (tMs <= Date.now()) {
      UI.toast('Это время уже прошло — выберите более позднее', 'warn');
      return;
    }
    var r = S.addReminder({ kind: kind, hhmm: hhmm, tMs: tMs });
    if (kind === 'stop') {
      UI.notify(LABELS.stop.title, LABELS.stop.body); // сразу спрашиваем разрешение на уведомления
    }
    render();
    UI.toast('Напомню в ' + UI.fmtTime(r.tMs) + ' (' + UI.relative(r.tMs) + ')');
  }

  // Проверка раз в 15 секунд: так работает и в фоновой вкладке
  function tick() {
    var list = S.listReminders();
    var now = Date.now();
    list.forEach(function (r) {
      if (r.fired || !r.tMs) return;
      if (now >= r.tMs) {
        var meta = LABELS[r.kind] || LABELS.stop;
        UI.notify(meta.title, meta.body);
        UI.toast(meta.title + ' — ' + meta.body, r.kind === 'check' ? 'info' : 'warn');
        S.markReminderFired(r.id);
      }
    });
    render();
  }

  function init() {
    var stopInput = UI.qs('#rem-stop-time');
    var checkInput = UI.qs('#rem-check-time');
    if (!stopInput || !checkInput) return;
    var sleepFrom = S.get().profile.sleepFrom || '22:30';
    stopInput.value = sleepFrom;                     // «остановиться за 1 час до сна»
    checkInput.value = S.get().profile.sleepTo || '07:00';
    UI.on(UI.qs('#rem-stop-btn'), 'click', function () { add('stop', stopInput); });
    UI.on(UI.qs('#rem-check-btn'), 'click', function () { add('check', checkInput); });
    render();
    setInterval(tick, 15000);
  }

  global.AL = global.AL || {};
  global.AL.Reminders = { init: init, render: render, tick: tick };
})(window);
