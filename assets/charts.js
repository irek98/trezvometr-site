// Графики на чистом SVG — без библиотек и без сети.
(function (global) {
  'use strict';

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // Кривая концентрации. points: [{tMin, gL}], opts: {t0, legalGL, nowMin}
  function line(container, points, opts) {
    if (!container) return null;
    var o = opts || {};
    var W = 820, H = 280, padL = 52, padR = 16, padT = 18, padB = 34;
    if (!points || points.length < 2) {
      container.innerHTML = '<p class="muted small">Пока нет данных для графика.</p>';
      return null;
    }
    var maxT = points[points.length - 1].tMin || 1;
    var maxG = Math.max.apply(null, points.map(function (p) { return p.gL; }));
    var legal = o.legalGL === undefined ? 0.30 : o.legalGL;
    maxG = Math.max(maxG, legal * 1.25, 0.2);
    var x = function (t) { return padL + (t / maxT) * (W - padL - padR); };
    var y = function (g) { return H - padB - (g / maxG) * (H - padT - padB); };

    var path = points.map(function (p, i) {
      return (i ? 'L' : 'M') + x(p.tMin).toFixed(1) + ' ' + y(p.gL).toFixed(1);
    }).join(' ');
    var area = path + ' L' + x(maxT).toFixed(1) + ' ' + y(0).toFixed(1) +
               ' L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + ' Z';

    var hours = Math.ceil(maxT / 60);
    // подписи не чаще, чем ~9 штук: на длинной кривой (41 ч) иначе каша
    var tickStep = Math.max(1, Math.ceil(hours / 8));
    var ticks = '';
    for (var h = 0; h <= hours; h += tickStep) {
      var tMin = Math.min(h * 60, maxT);
      var label = o.t0 ? global.AL.UI.fmtTime(o.t0 + tMin * 60000) : h + ' ч';
      ticks += '<line x1="' + x(tMin) + '" y1="' + (H - padB) + '" x2="' + x(tMin) + '" y2="' + (H - padB + 5) +
               '" stroke="rgba(255,255,255,.3)"/>' +
               '<text x="' + x(tMin) + '" y="' + (H - padB + 19) + '" text-anchor="middle" class="chart-axis">' +
               esc(label) + '</text>';
    }
    var grid = '';
    for (var i = 1; i <= 4; i++) {
      var gv = (maxG / 4) * i;
      grid += '<line x1="' + padL + '" y1="' + y(gv) + '" x2="' + (W - padR) + '" y2="' + y(gv) +
              '" stroke="rgba(255,255,255,.08)"/>' +
              '<text x="' + (padL - 8) + '" y="' + (y(gv) + 4) + '" text-anchor="end" class="chart-axis">' +
              gv.toFixed(2).replace('.', ',') + '</text>';
    }
    var legalLine = '<line x1="' + padL + '" y1="' + y(legal) + '" x2="' + (W - padR) + '" y2="' + y(legal) +
      '" stroke="#ff9b52" stroke-dasharray="6 5" stroke-width="1.4"/>' +
      '<text x="' + (W - padR - 4) + '" y="' + (y(legal) - 6) + '" text-anchor="end" class="chart-note">' +
      'порог прибора 0,16 мг/л ≈ ' + legal.toFixed(2) + ' ‰</text>';
    var nowMark = '';
    if (o.nowMin !== undefined && o.nowMin >= 0 && o.nowMin <= maxT) {
      nowMark = '<line x1="' + x(o.nowMin) + '" y1="' + padT + '" x2="' + x(o.nowMin) + '" y2="' + (H - padB) +
        '" stroke="#6fb3ff" stroke-width="1.4" stroke-dasharray="3 4"/>' +
        '<text x="' + (x(o.nowMin) + 6) + '" y="' + (padT + 12) + '" class="chart-note">сейчас</text>';
    }

    container.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" ' +
        'aria-label="График концентрации алкоголя в крови по времени">' +
        '<defs><linearGradient id="alcoFill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#6fb3ff" stop-opacity=".45"/>' +
          '<stop offset="100%" stop-color="#6fb3ff" stop-opacity=".02"/>' +
        '</linearGradient></defs>' +
        grid + ticks +
        '<path d="' + area + '" fill="url(#alcoFill)"/>' +
        '<path d="' + path + '" fill="none" stroke="#6fb3ff" stroke-width="2.4" stroke-linejoin="round"/>' +
        legalLine + nowMark +
        '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) +
        '" stroke="rgba(255,255,255,.25)"/>' +
      '</svg>';
    return container.querySelector('svg');
  }

  // Столбики по дням. items: [{label, drinks}], opts: {cap}
  function bars(container, items, opts) {
    if (!container) return null;
    var o = opts || {};
    if (!items || !items.length) {
      container.innerHTML = '<p class="muted small">Пока нет данных.</p>';
      return null;
    }
    var W = 820, H = 240, padL = 40, padR = 12, padT = 16, padB = 32;
    var maxV = Math.max.apply(null, items.map(function (i) { return i.drinks; }));
    var cap = o.cap || 2;
    maxV = Math.max(maxV, cap * 1.4, 1);
    var bw = (W - padL - padR) / items.length;
    var y = function (v) { return H - padB - (v / maxV) * (H - padT - padB); };
    var out = '';
    items.forEach(function (it, i) {
      var bx = padL + i * bw + bw * 0.18;
      var bwid = bw * 0.64;
      var hgt = Math.max(2, (H - padB) - y(it.drinks));
      out += '<rect x="' + bx.toFixed(1) + '" y="' + y(it.drinks).toFixed(1) + '" width="' + bwid.toFixed(1) +
             '" height="' + hgt.toFixed(1) + '" rx="4" fill="' + (it.drinks > cap ? '#ff9b52' : '#3ddc9a') +
             '" fill-opacity=".78"/>' +
             '<text x="' + (bx + bwid / 2).toFixed(1) + '" y="' + (H - padB + 18) + '" text-anchor="middle" class="chart-axis">' +
             esc(it.label) + '</text>';
      if (it.drinks >= 0.1) {
        out += '<text x="' + (bx + bwid / 2).toFixed(1) + '" y="' + (y(it.drinks) - 5) + '" text-anchor="middle" class="chart-note">' +
               it.drinks.toFixed(1).replace('.', ',') + '</text>';
      }
    });
    container.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Стандартные дозы по дням">' +
        '<line x1="' + padL + '" y1="' + y(cap) + '" x2="' + (W - padR) + '" y2="' + y(cap) +
          '" stroke="#ff9b52" stroke-dasharray="6 5"/>' +
        '<text x="' + (W - padR) + '" y="' + (y(cap) - 5) + '" text-anchor="end" class="chart-note">' +
          'дневной ориентир ' + cap + ' дозы</text>' +
        out +
        '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) +
        '" stroke="rgba(255,255,255,.25)"/>' +
      '</svg>';
    return container.querySelector('svg');
  }

  global.AL = global.AL || {};
  global.AL.Charts = { line: line, bars: bars };
})(window);

