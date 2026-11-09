// Общий интерфейс: мелкие помощники, возрастной гейт, уведомления, файлы.
(function (global) {
  'use strict';
  var UI = {};

  UI.qs = function (sel, root) { return (root || document).querySelector(sel); };
  UI.qsa = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  UI.on = function (el, ev, fn, opts) {
    if (el) el.addEventListener(ev, fn, opts || false);
    return el;
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  UI.fmtTime = function (ms) {
    var d = new Date(ms);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };

  UI.fmtDate = function (ms) {
    var d = new Date(ms);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
  };

  UI.fmtDateTime = function (ms) { return UI.fmtDate(ms) + ' ' + UI.fmtTime(ms); };

  // «через 2 ч 15 мин» / «13 минут назад»
  UI.relative = function (ms, nowMs) {
    var now = nowMs || Date.now();
    var diff = Math.round((ms - now) / 60000);
    var t = global.AL.Engine.duration(Math.abs(diff)).text;
    if (diff === 0) return 'сейчас';
    return diff > 0 ? 'через ' + t : t + ' назад';
  };

  // Тост-уведомление (не блокирует, живёт 4 секунды)
  UI.toast = function (message, kind) {
    var box = document.getElementById('toast-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-box';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    var t = document.createElement('div');
    t.className = 'toast toast-' + (kind || 'info');
    t.textContent = message;
    box.appendChild(t);
    setTimeout(function () { t.classList.add('toast-out'); }, 3400);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4000);
  };

  // Возрастной гейт 18+ (тема про алкоголь — требование и вежливость)
  UI.ageGate = function () {
    var cfg = global.AL_CONFIG || {};
    if (!cfg.ageGate) return;
    var S = global.AL.Store;
    if (S.get().settings.ageOk) return;
    var wrap = document.createElement('div');
    wrap.className = 'gate';
    wrap.innerHTML =
      '<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">' +
        '<h2 id="gate-title">Сайт 18+</h2>' +
        '<p>Здесь считают концентрацию алкоголя в крови и время его выведения. ' +
          'Материалы предназначены для совершеннолетних.</p>' +
        '<p class="muted">Сайт не даёт разрешения садиться за руль и не заменяет консультацию врача.</p>' +
        '<div class="gate-actions">' +
          '<button type="button" class="btn" data-gate="yes">Мне 18 или больше</button>' +
          '<a class="btn btn-ghost" href="https://www.google.com/" rel="nofollow noopener">Мне меньше 18</a>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('no-scroll');
    UI.on(UI.qs('[data-gate="yes"]', wrap), 'click', function () {
      S.patchSettings({ ageOk: true });
      document.body.classList.remove('no-scroll');
      wrap.parentNode.removeChild(wrap);
    });
  };

  // Уведомление браузера (напоминание «остановись» / «время проверки»)
  UI.notify = function (title, body) {
    var S = global.AL.Store;
    if (!('Notification' in global)) {
      UI.toast('Браузер не поддерживает уведомления — напоминание останется на странице.', 'warn');
      return false;
    }
    if (Notification.permission === 'granted') {
      try { new Notification(title, { body: body, tag: 'trezvometr' }); return true; } catch (e) { return false; }
    }
    if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(function (res) {
        S.patchSettings({ notifications: res === 'granted' });
        if (res === 'granted') {
          try { new Notification(title, { body: body, tag: 'trezvometr' }); } catch (e) {}
        }
      });
    }
    return false;
  };

  UI.download = function (filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode.removeChild(a); }, 500);
  };

  UI.readFile = function (input, cb) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { cb(String(reader.result || ''), file.name); };
    reader.readAsText(file, 'utf-8');
  };

  // "HH:MM" -> ms (сегодня; dayOffset = -1 вчера, +1 завтра)
  UI.timeToMs = function (hhmm, dayOffset) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    var d = new Date();
    d.setSeconds(0, 0);
    if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (dayOffset) d.setDate(d.getDate() + dayOffset);
    return d.getTime();
  };

  UI.msToTimeInput = function (ms) { return UI.fmtTime(ms); };

  // Число в русской записи: 0.15 -> "0,15"
  UI.num = function (value, digits) {
    var d = (digits === undefined) ? 2 : digits;
    return Number(value || 0).toFixed(d).replace('.', ',');
  };

  // Подсветка активного пункта меню
  UI.markNav = function () {
    var here = location.pathname.split('/').pop() || 'index.html';
    UI.qsa('.nav a').forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('/').pop();
      if (href === here) a.setAttribute('aria-current', 'page');
    });
  };

  // Крепость в подписи: 4,5 % (дробь через запятую), но 40 % без «,0»
  UI.abvText = function (value) {
    var v = Number(value);
    if (!isFinite(v)) return '';
    return (v % 1 === 0) ? String(v) : UI.num(v, 1);
  };

  // Заполнить select напитками (optgroup по категориям).
  // В подписи — только название и крепость: объём пользователь вводит полем ниже,
  // иначе «стопка 50 мл» и поле «Объём, мл» спорят друг с другом.
  UI.fillDrinks = function (select) {
    if (!select) return;
    var E = global.AL.Engine;
    var groups = {}, order = [];
    E.DRINKS.forEach(function (d) {
      if (!groups[d.cat]) { groups[d.cat] = []; order.push(d.cat); }
      groups[d.cat].push(d);
    });
    var html = '';
    order.forEach(function (cat) {
      html += '<optgroup label="' + cat + '">';
      groups[cat].forEach(function (d) {
        html += '<option value="' + d.id + '">' + d.name + ' — ' + UI.abvText(d.abv) + ' %</option>';
      });
      html += '</optgroup>';
    });
    select.innerHTML = html;
    select.value = 'beer-light';
  };

  UI.drinkById = function (id) {
    var found = null;
    global.AL.Engine.DRINKS.forEach(function (d) { if (d.id === id) found = d; });
    return found;
  };

  // Параметры расчёта из профиля (единая точка для страниц)
  UI.opts = function (extra) {
    var cfg = global.AL_CONFIG || {};
    var p = global.AL.Store.get().profile;
    var def = cfg.defaults || {};
    var o = {
      model: p.model || def.model,
      rate: Number(p.eliminationRate) || def.eliminationRate,
      peakMinutes: Number(p.peakMinutes) || def.peakMinutes,
      marginMinutes: 0
    };
    if (extra) Object.assign(o, extra);
    return o;
  };

  UI.units = function () {
    var cfg = global.AL_CONFIG || {};
    var p = global.AL.Store.get().profile;
    return p.units || (cfg.defaults && cfg.defaults.units) || 'promille';
  };

  UI.standard = function () {
    var cfg = global.AL_CONFIG || {};
    var p = global.AL.Store.get().profile;
    return p.standard || (cfg.defaults && cfg.defaults.standard) || 'ru';
  };

  UI.init = function () {
    UI.markNav();
    UI.ageGate();
  };

  global.AL = global.AL || {};
  global.AL.UI = UI;
})(window);

