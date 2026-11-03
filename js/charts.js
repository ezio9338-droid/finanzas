/* Hucha · gráficos SVG sin dependencias */
var HuchaCharts = (function () {
  'use strict';
  var W = 340;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function niceTicks(min, max, n) {
    if (min === max) { max = min + 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / n)));
    var err = (span / n) / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
    for (var v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function compact(v, unit, step) {
    unit = unit === undefined ? ' €' : unit;
    var a = Math.abs(v);
    if (a >= 1000) {
      var dec = step ? Math.max(0, Math.min(2, Math.ceil(-Math.log10(step / 1000) - 1e-9))) : (a >= 10000 ? 0 : 1);
      return (v / 1000).toFixed(dec).replace('.', ',') + 'k' + unit;
    }
    return Math.round(v) + unit;
  }

  /** Barras agrupadas. series: [{name, cls:'s1'|'s2', values:[]}], labels: [] */
  function groupedBars(labels, series, opts) {
    opts = opts || {};
    var H = 190, padL = 40, padR = 6, padT = 10, padB = 24;
    var all = []; series.forEach(function (s) { all = all.concat(s.values); });
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, all)), Math.max(1, Math.max.apply(null, all)), 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function y(v) { return padT + (H - padT - padB) * (1 - (v - y0) / (y1 - y0)); }
    var n = labels.length, band = (W - padL - padR) / n, gap = 2;
    var bw = Math.min(16, (band * 0.7 - gap * (series.length - 1)) / series.length);
    var out = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || '') + '">'];
    ticks.forEach(function (t) {
      out.push('<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>');
      out.push('<text x="' + (padL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + compact(t, '', ticks[1] - ticks[0]) + '</text>');
    });
    out.push('<line class="base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>');
    labels.forEach(function (lab, i) {
      var gx = padL + band * i + (band - (bw * series.length + gap * (series.length - 1))) / 2;
      var tip = [lab].concat(series.map(function (s) { return s.name + ': ' + HuchaCore.fmt(s.values[i]); })).join('\n');
      series.forEach(function (s, j) {
        var v = s.values[i], x = gx + j * (bw + gap), yt = y(Math.max(0, v)), yb = y(Math.min(0, v));
        var h = Math.max(v === 0 ? 0 : 1, yb - yt);
        out.push(roundTopRect(x, yt, bw, h, v >= 0, s.cls));
      });
      out.push('<rect class="hit" data-tip="' + esc(tip) + '" x="' + (padL + band * i) + '" y="' + padT + '" width="' + band + '" height="' + (H - padT - padB) + '"/>');
      if (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) {
        out.push('<text x="' + (padL + band * i + band / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(lab) + '</text>');
      }
    });
    out.push('</svg>');
    return out.join('');
  }

  function roundTopRect(x, y, w, h, up, cls) {
    var r = Math.min(4, w / 2, h);
    if (h <= 0) return '';
    if (up) return '<path class="' + cls + '" d="M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z"/>';
    return '<path class="' + cls + '" d="M' + x + ',' + y + 'V' + (y + h - r) + 'Q' + x + ',' + (y + h) + ' ' + (x + r) + ',' + (y + h) + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w) + ',' + (y + h - r) + 'V' + y + 'Z"/>';
  }

  /** Barras simples con línea de objetivo opcional. values en la unidad de `fmt`. */
  function bars(labels, values, opts) {
    opts = opts || {};
    var H = 170, padL = 40, padR = 6, padT = 10, padB = 24;
    var vals = values.map(function (v) { return v === null ? 0 : v; });
    var hi = Math.max.apply(null, vals.concat([opts.goal || 0, 0.01]));
    var lo = Math.min.apply(null, vals.concat([0]));
    var ticks = niceTicks(lo, hi, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function y(v) { return padT + (H - padT - padB) * (1 - (v - y0) / (y1 - y0)); }
    var n = labels.length, band = (W - padL - padR) / n, bw = Math.min(22, band * 0.6);
    var out = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || '') + '">'];
    ticks.forEach(function (t) {
      out.push('<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>');
      out.push('<text x="' + (padL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + opts.tick(t) + '</text>');
    });
    out.push('<line class="base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>');
    labels.forEach(function (lab, i) {
      var v = vals[i], x = padL + band * i + (band - bw) / 2, yt = y(Math.max(0, v)), yb = y(Math.min(0, v));
      if (values[i] !== null) out.push(roundTopRect(x, yt, bw, Math.max(1, yb - yt), v >= 0, 's1'));
      out.push('<rect class="hit" data-tip="' + esc(lab + '\n' + (values[i] === null ? 'sin datos' : opts.fmt(values[i]))) + '" x="' + (padL + band * i) + '" y="' + padT + '" width="' + band + '" height="' + (H - padT - padB) + '"/>');
      if (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) out.push('<text x="' + (padL + band * i + band / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(lab) + '</text>');
    });
    if (opts.goal) {
      out.push('<line class="goal" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(opts.goal) + '" y2="' + y(opts.goal) + '"/>');
      out.push('<text class="lbl" x="' + (W - padR) + '" y="' + (y(opts.goal) - 5) + '" text-anchor="end">objetivo ' + opts.tick(opts.goal) + '</text>');
    }
    out.push('</svg>');
    return out.join('');
  }

  /** Línea con área suave. points: [{label, value, tip}] */
  function line(points, opts) {
    opts = opts || {};
    var H = 180, padL = 44, padR = 10, padT = 12, padB = 24;
    if (points.length === 1) points = [{ label: '', value: points[0].value, tip: points[0].tip, ghost: true }].concat(points);
    var vals = points.map(function (p) { return p.value; });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.02 || 1;
    var ticks = niceTicks(lo - pad, hi + pad, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function y(v) { return padT + (H - padT - padB) * (1 - (v - y0) / (y1 - y0)); }
    var n = points.length, step = (W - padL - padR) / Math.max(1, n - 1);
    function x(i) { return padL + step * i; }
    var out = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.aria || '') + '">'];
    ticks.forEach(function (t) {
      out.push('<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>');
      out.push('<text x="' + (padL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + compact(t, '', ticks[1] - ticks[0]) + '</text>');
    });
    var d = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.value).toFixed(1); }).join('');
    out.push('<path class="area1" d="' + d + 'L' + x(n - 1) + ',' + (H - padB) + 'L' + x(0) + ',' + (H - padB) + 'Z"/>');
    out.push('<path class="line1" d="' + d + '"/>');
    points.forEach(function (p, i) {
      if (!p.ghost && (n <= 14 || i === n - 1)) out.push('<circle class="dot1" cx="' + x(i) + '" cy="' + y(p.value) + '" r="' + (i === n - 1 ? 5 : 3.5) + '"/>');
      out.push('<rect class="hit" data-tip="' + esc(p.tip || (p.label + '\n' + HuchaCore.fmt(p.value))) + '" x="' + (x(i) - step / 2) + '" y="' + padT + '" width="' + step + '" height="' + (H - padT - padB) + '"/>');
      if (p.label && (n <= 7 || i % Math.ceil(n / 6) === 0 || i === n - 1)) {
        out.push('<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="' + (i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle') + '">' + esc(p.label) + '</text>');
      }
    });
    out.push('</svg>');
    return out.join('');
  }

  // ---------- Tooltip (toque o ratón) ----------
  var tipEl = null;
  function showTip(target, cx, cy) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = target.getAttribute('data-tip');
    tipEl.style.display = 'block';
    var r = tipEl.getBoundingClientRect();
    var left = Math.min(window.innerWidth - r.width - 8, Math.max(8, cx - r.width / 2));
    var top = cy - r.height - 14; if (top < 8) top = cy + 18;
    tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }
  function bindTips(root) {
    root.addEventListener('pointerover', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t && e.pointerType === 'mouse') showTip(t, e.clientX, e.clientY); });
    root.addEventListener('pointermove', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t && e.pointerType === 'mouse') showTip(t, e.clientX, e.clientY); else if (e.pointerType === 'mouse') hideTip(); });
    root.addEventListener('pointerleave', hideTip);
    root.addEventListener('click', function (e) { var t = e.target.closest && e.target.closest('[data-tip]'); if (t) { showTip(t, e.clientX, e.clientY); e.stopPropagation(); } });
    document.addEventListener('click', hideTip);
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  return { groupedBars: groupedBars, bars: bars, line: line, bindTips: bindTips, hideTip: hideTip, compact: compact };
})();
