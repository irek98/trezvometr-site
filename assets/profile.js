// Страница профиля: параметры, скорость метаболизма, калибровка, данные.
(function (global) {
  'use strict';
  var E = global.AL.Engine;
  var UI = global.AL.UI;
  var S = global.AL.Store;

  function p() { return S.get().profile; }

  function rateModeOf(rate) {
    if (!Number(rate)) return '0';
    if ([0.10, 0.15, 0.20].indexOf(Number(rate)) >= 0) return '1';
    return '2';
  }

  function fill() {
    var pr = p();
    var cfg = global.AL_CONFIG.defaults;
    UI.qs('#sex').value = pr.sex || 'male';
    UI.qs('#age').value = pr.age || 35;
    UI.qs('#height').value = pr.heightCm || 175;
    UI.qs('#weight').value = pr.weightKg || 75;

    var rate = Number(pr.eliminationRate) || cfg.eliminationRate;
    UI.qs('#rate-mode').value = rateModeOf(pr.eliminationRate);
    UI.qs('#rate-preset').value = String(rate);
    UI.qs('#rate').value = rate.toFixed(2);   // в поле number — точка, иначе браузер не примет
    UI.qs('#rate-current').value = UI.num(rate, 2) + ' ‰/ч' + (pr.calibrated ? ' (калибровано)' : '');

    UI.qs('#model').value = pr.model || cfg.model;
    UI.qs('#peak').value = String(Number(pr.peakMinutes) || cfg.peakMinutes);
    UI.qs('#units').value = UI.units();
    UI.qs('#standard').value = UI.standard();
    UI.qs('#sleep-from').value = pr.sleepFrom || '23:30';
    UI.qs('#sleep-to').value = pr.sleepTo || '07:00';
    UI.qs('#goal').value = pr.goal || 'health';
    syncRateInputs();
    renderReadings();
    storageNote();
  }

  function syncRateInputs() {
    var mode = UI.qs('#rate-mode').value;
    UI.qs('#rate-preset').disabled = mode !== '1';
    UI.qs('#rate').disabled = mode !== '2';
  }

  function applyRate() {
    var mode = UI.qs('#rate-mode').value;
    var rate = 0;
    if (mode === '1') rate = Number(UI.qs('#rate-preset').value) || 0;
    if (mode === '2') rate = Number(UI.qs('#rate').value) || 0;
    S.patchProfile({ eliminationRate: rate, calibrated: false });
    UI.qs('#rate-current').value = UI.num(rate || global.AL_CONFIG.defaults.eliminationRate, 2) + ' ‰/ч';
    syncRateInputs();
  }

  function storageNote() {
    var ok = true;
    try { localStorage.setItem('trezvometr.probe', '1'); localStorage.removeItem('trezvometr.probe'); }
    catch (e) { ok = false; }
    UI.qs('#storage-note').textContent = ok
      ? 'Хранилище доступно. Резервная копия — кнопкой «Экспорт JSON».'
      : 'Браузер блокирует локальное хранилище (приватный режим?). Профиль и дневник сохраняться не будут.';
  }

  function renderReadings() {
    var box = UI.qs('#readings');
    var list = S.get().readings;
    if (!list.length) {
      box.innerHTML = '<p class="small muted" style="padding:12px">Замеров пока нет.</p>';
      return;
    }
    box.innerHTML = '<table><thead><tr><th>Когда</th><th class="num">Замер</th><th class="num">Источник</th><th></th></tr></thead><tbody>' +
      list.slice().reverse().map(function (r) {
        return '<tr><td>' + UI.fmtDateTime(r.tMs) + '</td><td class="num">' + UI.num(r.valueGL, 2) + ' ‰</td>' +
               '<td class="num">' + (r.source === 'device' ? 'прибор' : 'вручную') + '</td>' +
               '<td class="num"><button class="icon-btn" data-rid="' + r.id + '">×</button></td></tr>';
      }).join('') + '</tbody></table>';
    UI.qsa('[data-rid]', box).forEach(function (b) {
      UI.on(b, 'click', function () {
        var data = S.get();
        data.readings = data.readings.filter(function (r) { return r.id !== b.getAttribute('data-rid'); });
        S.save();
        renderReadings();
      });
    });
  }

  // Калибровка: пары замеров без напитков между ними
  function calibrate() {
    var list = S.get().readings.slice().sort(function (a, b) { return a.tMs - b.tMs; });
    if (list.length < 2) { UI.toast('Нужно минимум два замера', 'warn'); return; }
    var entries = S.get().entries;
    var rates = [];
    for (var i = 1; i < list.length; i++) {
      var a = list[i - 1], b = list[i];
      var hours = (b.tMs - a.tMs) / 3600000;
      if (hours < 0.5) continue;
      var drankBetween = entries.some(function (e) { return e.tMs > a.tMs && e.tMs <= b.tMs; });
      if (drankBetween) continue;
      var rate = (a.valueGL - b.valueGL) / hours;
      if (rate > 0.03 && rate < 0.40) rates.push(rate);
    }
    if (!rates.length) {
      UI.toast('Не нашлось пар замеров без алкоголя между ними. Добавьте ещё замеры.', 'warn');
      return;
    }
    var avg = rates.reduce(function (s, r) { return s + r; }, 0) / rates.length;
    avg = Math.round(avg * 100) / 100;
    S.patchProfile({ eliminationRate: avg, calibrated: true });
    fill();
    UI.toast('Ваша скорость: ' + UI.num(avg, 2) + ' ‰/ч — по ' + rates.length + ' паре(ам) замеров');
  }

  function bind() {
    var simple = ['#sex', '#age', '#height', '#weight'];
    simple.forEach(function (sel) {
      UI.on(UI.qs(sel), 'change', function () {
        S.patchProfile({
          sex: UI.qs('#sex').value,
          age: Number(UI.qs('#age').value) || 35,
          heightCm: Number(UI.qs('#height').value) || 175,
          weightKg: Number(UI.qs('#weight').value) || 75
        });
        UI.toast('Сохранено');
      });
    });

    UI.on(UI.qs('#rate-mode'), 'change', applyRate);
    UI.on(UI.qs('#rate-preset'), 'change', applyRate);
    UI.on(UI.qs('#rate'), 'change', applyRate);

    UI.on(UI.qs('#model'), 'change', function () {
      S.patchProfile({ model: UI.qs('#model').value });
    });
    UI.on(UI.qs('#peak'), 'change', function () {
      S.patchProfile({ peakMinutes: Number(UI.qs('#peak').value) });
    });
    UI.on(UI.qs('#units'), 'change', function () {
      S.patchProfile({ units: UI.qs('#units').value });
    });
    UI.on(UI.qs('#standard'), 'change', function () {
      S.patchProfile({ standard: UI.qs('#standard').value });
    });
    UI.on(UI.qs('#sleep-from'), 'change', function () {
      S.patchProfile({ sleepFrom: UI.qs('#sleep-from').value });
    });
    UI.on(UI.qs('#sleep-to'), 'change', function () {
      S.patchProfile({ sleepTo: UI.qs('#sleep-to').value });
    });
    UI.on(UI.qs('#goal'), 'change', function () {
      S.patchProfile({ goal: UI.qs('#goal').value });
    });

    UI.on(UI.qs('#add-reading'), 'click', function () {
      var raw = Number(UI.qs('#reading-value').value);
      if (!(raw > 0)) { UI.toast('Введите значение замера', 'warn'); return; }
      var units = UI.qs('#reading-units').value;
      var valueGL = units === 'breath' ? E.fromBreath(raw)
                  : units === 'percent' ? E.fromPercent(raw) : raw;
      var tMs = UI.timeToMs(UI.qs('#reading-time').value || UI.msToTimeInput(Date.now()),
                            Number(UI.qs('#reading-day').value) || 0);
      S.addReading({ tMs: tMs, valueGL: valueGL, source: 'manual' });
      UI.qs('#reading-value').value = '';
      renderReadings();
      UI.toast('Замер добавлен: ' + UI.num(valueGL, 2) + ' ‰');
    });

    UI.on(UI.qs('#calibrate'), 'click', calibrate);

    UI.on(UI.qs('#export'), 'click', function () {
      UI.download('trezvometr-backup-' + UI.fmtDate(Date.now()).replace(/\./g, '-') + '.json',
                  S.exportJSON(), 'application/json');
    });

    UI.on(UI.qs('#import'), 'change', function (ev) {
      UI.readFile(ev.target, function (text) {
        var res = S.importJSON(text);
        if (!res.ok) { UI.toast(res.error, 'stop'); return; }
        fill();
        UI.toast('Импортировано записей: ' + res.entries);
      });
    });

    UI.on(UI.qs('#wipe'), 'click', function () {
      if (!confirm('Удалить профиль, дневник и замеры из этого браузера? Отменить будет нельзя.')) return;
      S.wipe();
      fill();
      UI.toast('Данные удалены');
    });
  }

  function init() {
    UI.init();
    fill();
    UI.qs('#reading-time').value = UI.msToTimeInput(Date.now());
    bind();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);

