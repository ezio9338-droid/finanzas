/* Hucha · aplicación */
(function () {
  'use strict';
  var C = HuchaCore, CH = HuchaCharts;
  var VERSION = '1.2.1';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var TIPOS_CUENTA = { diario: 'Día a día', efectivo: 'Día a día', pocket: 'Día a día', ahorro: 'Ahorro e inversión', inversion: 'Ahorro e inversión', pension: 'Ahorro e inversión', credito: 'Tarjetas de crédito' };
  var ICONO_CUENTA = { diario: '🏦', efectivo: '💵', pocket: '🫙', ahorro: '📈', inversion: '📊', pension: '🧓', credito: '💳' };

  // ---------------------------------------------------------------- utilidades
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(x) { return C.fmt(x); }
  function hoy() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function fCorta(s) { var d = C.parseISO(s); return d.getUTCDate() + ' ' + MESES[d.getUTCMonth()]; }
  function fLarga(s) {
    var t = hoy();
    if (s === t) return 'Hoy';
    if (s === C.addDays(t, -1)) return 'Ayer';
    var d = C.parseISO(s);
    return DIAS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MESES[d.getUTCMonth()] + (s.slice(0, 4) !== t.slice(0, 4) ? ' ' + s.slice(0, 4) : '');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem('hucha.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('hucha.' + k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem('hucha.' + k); } catch (e) {} }
  };
  var DB = {
    db: null,
    open: function () {
      var self = this;
      return new Promise(function (res) {
        try {
          var r = indexedDB.open('hucha', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
          r.onsuccess = function () { self.db = r.result; res(); };
          r.onerror = function () { res(); };
        } catch (e) { res(); }
      });
    },
    get: function (k) {
      var self = this;
      if (!self.db) return Promise.resolve(LS.get('kv.' + k, null));
      return new Promise(function (res) {
        try { var r = self.db.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { res(r.result === undefined ? null : r.result); }; r.onerror = function () { res(null); }; }
        catch (e) { res(null); }
      });
    },
    set: function (k, v) {
      var self = this;
      if (!self.db) { LS.set('kv.' + k, v); return Promise.resolve(); }
      return new Promise(function (res) {
        try { var tx = self.db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; }
        catch (e) { res(); }
      });
    }
  };
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200);
  }

  // ---------------------------------------------------------------- estado
  var snapshot = null, queue = [], V = null;
  var ui = { tab: 'inicio', statIdx: null, filtro: { tipo: 'todos', cuenta: '', q: '', intereses: false }, limite: 150 };
  var sync = { estado: 'idle', ultimo: LS.get('ultimoSync', 0), error: '' }, syncing = false, syncTimer = null;

  var sesion = { url: '', clave: '' }, llave = null, caja = null, seguridad = null;
  function modo() {
    if (LS.get('demo', false)) return 'demo';
    if (caja && !llave) return 'bloqueado';
    return sesion.url ? 'online' : 'setup';
  }

  function recompute() {
    if (!snapshot) { V = null; return; }
    V = C.aplicarOps(clone(snapshot), queue);
    V.cuentas.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
  }
  var cadena = Promise.resolve();
  /** Guarda en el dispositivo. Fuera del modo demo, solo cifrado y solo si la caja está abierta. */
  function persist() {
    if (modo() === 'demo') { DB.set('demo.snapshot', snapshot); DB.set('demo.queue', queue); return; }
    if (!llave || !caja) return;
    var k = llave, meta = caja, datos = { url: sesion.url, clave: sesion.clave, snapshot: snapshot, queue: queue, ultimoSync: sync.ultimo };
    cadena = cadena.then(function () { return HuchaVault.cifrar(k, datos); }).then(function (c) {
      if (caja !== meta) return;
      meta.iv = c.iv; meta.ct = c.ct;
      return DB.set('vault', meta);
    }).catch(function () {});
  }

  function commit(ops) {
    if (modo() === 'demo') { C.aplicarOps(snapshot, ops); }
    else queue = queue.concat(ops);
    persist(); recompute(); render(); programarSync(300);
  }

  function programarSync(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(hacerSync, ms || 0);
  }

  function hacerSync() {
    if (modo() !== 'online' || syncing) return Promise.resolve();
    if (!navigator.onLine) { sync.estado = 'off'; pintarEstado(); return Promise.resolve(); }
    syncing = true; sync.estado = 'sync'; pintarEstado();
    var enviadas = queue.length, ops = queue.slice(0, enviadas);
    return fetch(sesion.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ clave: sesion.clave, ops: ops })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) throw new Error(j.error || 'Error desconocido');
      snapshot = j.estado; queue = queue.slice(enviadas); seguridad = j.seguridad || null;
      sync.estado = queue.length ? 'pend' : 'ok'; sync.ultimo = Date.now(); sync.error = '';
      LS.set('ultimoSync', sync.ultimo);
      persist(); recompute(); render();
    }).catch(function (e) {
      sync.estado = 'err';
      sync.error = /CLAVE_INCORRECTA/.test(e.message) ? 'La clave secreta no coincide.' : (e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'No se pudo contactar con Google.' : e.message);
      pintarEstado();
    }).then(function () {
      syncing = false;
      if (queue.length && sync.estado === 'ok') programarSync(200);
    });
  }

  function estadoTexto() {
    if (modo() === 'demo') return { cls: '', txt: 'Demo' };
    if (sync.estado === 'sync') return { cls: 'pend', txt: 'Sincronizando…' };
    if (sync.estado === 'err') return { cls: 'err', txt: queue.length ? queue.length + ' sin enviar' : 'Error' };
    if (sync.estado === 'off' || !navigator.onLine) return { cls: 'pend', txt: queue.length ? 'Sin conexión · ' + queue.length : 'Sin conexión' };
    if (queue.length) return { cls: 'pend', txt: queue.length + ' pendientes' };
    return { cls: 'ok', txt: 'Al día' };
  }
  function pillHTML() { var e = estadoTexto(); return '<button class="pill ' + e.cls + '" data-act="sync" id="pill"><span class="dot"></span>' + e.txt + '</button>'; }
  function pintarEstado() { var p = $('#pill'); if (p) p.outerHTML = pillHTML(); }

  // ---------------------------------------------------------------- consultas
  function cuenta(id) { return (V.cuentas || []).filter(function (c) { return c.id === id; })[0]; }
  function nombreCuenta(id) { var c = cuenta(id); return c ? c.nombre : (id || '—'); }
  function iconoCat(cat) {
    var c = (V.categorias || []).filter(function (x) { return x.cat === cat && !x.sub; })[0];
    return c && c.icono ? c.icono : '•';
  }
  function cicloActual() { var cs = C.ciclos(V, hoy()); return cs[cs.length - 1]; }
  function nominaPendienteDeReparto() {
    var ns = V.movimientos.filter(function (m) { return m.nomina && m.tipo === 'ingreso'; }).sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; });
    var n = ns[0];
    if (!n || C.diffDays(n.fecha, hoy()) > 5) return null;
    if (LS.get('repartoHecho.' + n.id, false)) return null;
    var hecho = V.movimientos.some(function (m) { return m.tipo === 'transferencia' && m.vinculado === n.id; });
    return hecho ? null : n;
  }

  // ---------------------------------------------------------------- render
  function render() {
    var app = $('#app');
    if (modo() === 'bloqueado') { $('#tabbar').hidden = true; app.innerHTML = vistaBloqueo(); return; }
    if (modo() === 'setup' || !V) { $('#tabbar').hidden = true; app.innerHTML = vistaBienvenida(); return; }
    $('#tabbar').hidden = false;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('on', t.dataset.tab === ui.tab); });
    var html = ui.tab === 'movimientos' ? vistaMovimientos() : ui.tab === 'estadisticas' ? vistaEstadisticas() : ui.tab === 'ajustes' ? vistaAjustes() : vistaInicio();
    var y = window.scrollY;
    app.innerHTML = '<div class="view">' + html + '</div>';
    window.scrollTo(0, y);
  }

  function vistaBienvenida() {
    return '<div class="view welcome">' +
      '<img class="logo" src="icons/icon-192.png" alt="">' +
      '<h1>Hucha</h1><p class="lead">Tus cuentas, tu presupuesto y tu ahorro, en el móvil.</p>' +
      '<div class="card"><h2>Conectar con tu hoja de cálculo</h2>' +
      '<label class="field"><span>URL de la aplicación web de Apps Script</span><input class="input" id="w-url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off"></label>' +
      '<label class="field"><span>Clave secreta</span><input class="input" id="w-clave" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      '<button class="btn primary block" data-act="conectar">Conectar</button>' +
      '<p class="small muted">Las instrucciones para crear la hoja están en el README del repositorio.</p></div>' +
      '<button class="btn block" data-act="demo">Probar con datos de ejemplo</button>' +
      '</div>';
  }

  // ---------- Inicio ----------
  function vistaInicio() {
    var t = hoy(), ciclo = cicloActual(), p = C.presupuesto(V, ciclo, t), s = C.saldos(V);
    var al = C.alertas(p), pend = C.pendientesCobro(V), nom = nominaPendienteDeReparto();
    var h = '<div class="topbar"><h1>Hucha</h1>' + pillHTML() + '</div>';

    if (nom) h += '<div class="alert info"><span class="ico">€</span><div class="grow">Has cobrado la nómina. ¿Repartimos el sobrante?<div style="margin-top:8px"><button class="btn small primary" data-act="reparto" data-id="' + esc(nom.id) + '">Repartir</button> <button class="btn small" data-act="reparto-no" data-id="' + esc(nom.id) + '">Ya lo hice</button></div></div></div>';
    if (sync.estado === 'err' && modo() === 'online') al.unshift({ nivel: 'critical', texto: 'Sincronización: ' + sync.error });
    // Aviso de intentos fallidos: solo los NUEVOS desde la última vez que lo marcaste como visto.
    if (seguridad && seguridad.ultimo && seguridad.ultimo > LS.get('fallosVistos', 0)) {
      h += '<div class="alert critical"><span class="ico">!</span><div class="grow">Intento de acceso a tu hoja con una clave incorrecta (último: ' + esc(new Date(seguridad.ultimo).toLocaleString('es-ES')) + '). Si no fuiste tú, cambia la clave secreta desde el menú Hucha de la hoja.' +
        '<div style="margin-top:8px"><button class="btn small" data-act="fallos-ok" data-id="' + seguridad.ultimo + '">Fui yo / Entendido</button></div></div></div>';
    }
    if (modo() === 'online' && !caja) al.unshift({ nivel: 'serious', texto: 'Este dispositivo aún no está protegido. Ve a Ajustes → Seguridad.' });

    var pct = Math.max(0, p.pct), cls = pct >= 1 ? 'critical' : pct >= 0.8 ? 'serious' : '';
    h += '<div class="card">' +
      '<div class="row small sec"><span>Ciclo ' + fCorta(ciclo.inicio) + ' → ' + fCorta(ciclo.fin) + (ciclo.estimado ? '*' : '') + '</span><span>día ' + p.transcurridos + ' de ' + p.dias + '</span></div>' +
      '<div class="hero-label" style="margin-top:10px">' + (p.restante >= 0 ? 'Te quedan para gastar' : 'Te has pasado') + '</div>' +
      '<div class="hero num' + (p.restante < 0 ? ' neg' : '') + '">' + fmt(Math.abs(p.restante)) + '</div>' +
      '<div class="sec">' + (p.restante > 0 ? '≈ <b>' + fmt(p.porDia) + '</b> al día durante ' + p.diasRestantes + ' días' : 'Intenta no gastar más hasta la nómina') + '</div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + Math.round(pct * 100) + '" aria-valuemin="0" aria-valuemax="100"><div class="fill ' + cls + '" style="width:' + Math.min(100, pct * 100) + '%"></div><div class="mark" style="left:calc(' + (p.ritmo * 100) + '% - 1px)" title="Ritmo ideal"></div></div>' +
      '<div class="row small"><span class="sec">Gastado <b class="num">' + fmt(p.gastado) + '</b> de ' + fmt(p.disponible) + '</span><span class="muted">▏ritmo ideal ' + Math.round(p.ritmo * 100) + ' %</span></div>' +
      '<details><summary>¿De dónde sale?</summary><ul class="list small" style="margin-top:6px">' +
      '<li><span class="grow">Nómina' + (p.nominaEstimada ? ' (estimada)' : '') + '</span><span class="amount">' + fmt(p.nomina) + '</span></li>' +
      '<li><span class="grow">Gastos fijos del ciclo</span><span class="amount">−' + fmt(p.fijos) + '</span></li>' +
      p.lineasFijos.map(function (l) { return '<li style="padding:4px 0 4px 12px"><span class="grow muted">' + esc(l.concepto) + ' · ' + fCorta(l.fecha) + (l.pagado ? ' ✓' : '') + '</span><span class="muted num">' + fmt(l.importe) + '</span></li>'; }).join('') +
      '<li><span class="grow">Objetivo de ahorro (' + p.ahorroPct + ' %)</span><span class="amount">−' + fmt(p.ahorroObjetivo) + '</span></li>' +
      '<li><span class="grow"><b>Para gastar</b></span><span class="amount">' + fmt(p.disponible) + '</span></li></ul>' +
      (ciclo.estimado ? '<p class="small muted">* El ciclo termina cuando registres la próxima nómina.</p>' : '') + '</details>' +
      '</div>';

    al.forEach(function (a) { h += '<div class="alert ' + a.nivel + '"><span class="ico">' + (a.nivel === 'warning' ? '!' : a.nivel === 'serious' ? '!' : '×') + '</span><div>' + esc(a.texto) + '</div></div>'; });

    // Ahorro
    var ap = p.ahorroPrevisto, obj = p.ahorroObjetivo, r = obj > 0 ? Math.max(0, Math.min(1, ap / obj)) : 0;
    var inv = C.r2(Math.max(0, p.sobrantePrevisto) * p.repartoInversion / 100), rem = C.r2(Math.max(0, p.sobrantePrevisto) - inv);
    h += '<div class="card"><h2>Ahorro de este ciclo<span class="right muted">objetivo ' + fmt(obj) + '</span></h2>' +
      '<div class="row"><div><div class="hero-label">' + (p.transcurridos >= 7 ? 'A este ritmo ahorrarás' : 'Si cumples el presupuesto ahorrarás') + '</div>' +
      '<div style="font-size:28px;font-weight:700;letter-spacing:-.02em" class="num">' + fmt(ap) + '</div></div>' +
      '<div class="small ' + (ap >= obj ? 'amount pos' : 'muted') + '">' + (ap >= obj ? '✓ objetivo' : Math.round(r * 100) + ' % del objetivo') + '</div></div>' +
      '<div class="bar thin"><div class="fill ' + (ap >= obj ? 'good' : 'serious') + '" style="width:' + (r * 100) + '%"></div></div>' +
      '<ul class="list small" style="margin-top:8px">' +
      '<li><span class="grow sec">Plan de pensiones</span><span class="amount num">' + fmt(p.pension) + '</span></li>' +
      '<li><span class="grow sec">Sobrante al cobrar → Inversión ' + p.repartoInversion + ' %</span><span class="amount num">' + fmt(inv) + '</span></li>' +
      '<li><span class="grow sec">Sobrante al cobrar → Remunerada ' + (100 - p.repartoInversion) + ' %</span><span class="amount num">' + fmt(rem) + '</span></li>' +
      '</ul></div>';

    if (pend.length) {
      h += '<div class="card"><h2>Me deben<span class="right">' + fmt(pend.reduce(function (a, x) { return a + x.pendiente; }, 0)) + '</span></h2><ul class="list">' +
        pend.map(function (x) {
          return '<li><div class="grow"><div class="title">' + esc(x.mov.nota || x.mov.sub || x.mov.cat) + '</div><div class="subline">' + fCorta(x.mov.fecha) + ' · pagaste ' + fmt(x.mov.importe) + ', tu parte ' + fmt(x.mov.miParte) + '</div></div>' +
            '<span class="amount">' + fmt(x.pendiente) + '</span><button class="btn small" data-act="cobrar" data-id="' + esc(x.mov.id) + '">Cobrado</button></li>';
        }).join('') + '</ul></div>';
    }

    // Categorías
    var cats = p.categorias.filter(function (c) { return c.presupuesto > 0 || c.gastado !== 0; })
      .sort(function (a, b) { return (b.gastado / (b.presupuesto || 1)) - (a.gastado / (a.presupuesto || 1)); });
    if (cats.length) {
      h += '<div class="card"><h2>Por categoría</h2>' + cats.map(function (c) {
        var rr = c.presupuesto > 0 ? c.gastado / c.presupuesto : (c.gastado > 0 ? 1 : 0);
        var k = rr >= 1 ? 'critical' : rr >= 0.8 ? 'serious' : '';
        return '<div class="catrow"><div class="row"><span>' + esc(c.icono) + ' ' + esc(c.cat) + '</span><span class="num sec">' + fmt(c.gastado) + (c.presupuesto ? ' <span class="muted">/ ' + fmt(c.presupuesto) + '</span>' : '') + '</span></div>' +
          (c.presupuesto ? '<div class="bar thin"><div class="fill ' + k + '" style="width:' + Math.min(100, Math.max(0, rr) * 100) + '%"></div><div class="mark" style="left:calc(' + (p.ritmo * 100) + '% - 1px)"></div></div>' : '') + '</div>';
      }).join('') + '</div>';
    }

    // Próximos cargos
    var prox = [];
    (V.fijos || []).forEach(function (f) {
      C.ocurrencias(f, t, C.addDays(t, 10)).forEach(function (d) { prox.push({ f: f, d: d }); });
    });
    prox.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    if (prox.length) {
      h += '<div class="card"><h2>Próximos 10 días</h2><ul class="list">' + prox.map(function (x) {
        var signo = x.f.tipo === 'ingreso' ? '+' : x.f.tipo === 'transferencia' ? '' : '−';
        var imp = x.f.modo === 'liquidar' ? 'saldo tarjeta' : signo + fmt(x.f.importe);
        return '<li><span class="avatar">' + (x.f.tipo === 'transferencia' ? '⇄' : x.f.tipo === 'ingreso' ? '↘' : iconoCat(x.f.cat)) + '</span><div class="grow"><div class="title">' + esc(x.f.concepto) + '</div><div class="subline">' + fLarga(x.d) + ' · ' + esc(nombreCuenta(x.f.cuenta)) + (x.f.destino ? ' → ' + esc(nombreCuenta(x.f.destino)) : '') + '</div></div><span class="amount ' + (x.f.tipo === 'ingreso' ? 'pos' : x.f.tipo === 'transferencia' ? 'tr' : '') + '">' + imp + '</span></li>';
      }).join('') + '</ul></div>';
    }

    // Cuentas
    var grupos = {};
    V.cuentas.filter(function (c) { return c.activa !== false; }).forEach(function (c) {
      var g = TIPOS_CUENTA[c.tipo] || 'Otras'; (grupos[g] = grupos[g] || []).push(c);
    });
    h += '<div class="card"><h2>Cuentas<span class="right">Patrimonio <b class="num" style="color:var(--text)">' + fmt(C.patrimonio(V)) + '</b></span></h2>';
    ['Día a día', 'Ahorro e inversión', 'Tarjetas de crédito', 'Otras'].forEach(function (g) {
      if (!grupos[g]) return;
      var tot = grupos[g].reduce(function (a, c) { return a + (s[c.id] || 0); }, 0);
      h += '<div class="group-title row"><span>' + g + '</span><span class="num">' + fmt(tot) + '</span></div><ul class="list">' + grupos[g].map(function (c) {
        var extra = c.tae ? (c.tae + ' % TAE · ≈ ' + fmt(C.interesDiario(s[c.id], C.num(c.tae), C.num(c.retencion))) + '/día netos') : c.redondeoA ? 'redondeo → ' + esc(nombreCuenta(c.redondeoA)) : '';
        return '<li class="tap" data-act="cuenta" data-id="' + esc(c.id) + '"><span class="avatar">' + (ICONO_CUENTA[c.tipo] || '🏦') + '</span><div class="grow"><div class="title">' + esc(c.nombre) + '</div>' + (extra ? '<div class="subline">' + extra + '</div>' : '') + '</div><span class="amount num' + ((s[c.id] || 0) < 0 ? ' neg' : '') + '">' + fmt(s[c.id] || 0) + '</span></li>';
      }).join('') + '</ul>';
    });
    h += '</div>';
    return h;
  }

  // ---------- Movimientos ----------
  function filaMov(m, hijos) {
    var tipo = m.tipo, icon, titulo, sub = [], cls, imp;
    if (tipo === 'transferencia') { icon = '⇄'; titulo = m.nota || 'Transferencia'; sub.push(esc(nombreCuenta(m.cuenta)) + ' → ' + esc(nombreCuenta(m.destino))); cls = 'tr'; imp = fmt(m.importe); }
    else if (tipo === 'ajuste') { icon = '⚖️'; titulo = 'Ajuste de saldo'; sub.push(esc(nombreCuenta(m.cuenta))); cls = m.importe >= 0 ? 'pos' : ''; imp = (m.importe >= 0 ? '+' : '') + fmt(m.importe); }
    else if (tipo === 'ingreso') {
      icon = m.nomina ? '💼' : m.origen === 'interes' ? '📈' : m.reembolso ? '↩️' : '💶';
      titulo = m.nomina ? 'Nómina' : (m.sub || m.cat || 'Ingreso'); if (m.reembolso) titulo = 'Reembolso' + (m.sub ? ' · ' + m.sub : '');
      sub.push(esc(nombreCuenta(m.cuenta))); if (m.nota && m.nota !== titulo) sub.push(esc(m.nota)); cls = 'pos'; imp = '+' + fmt(m.importe);
    } else {
      icon = iconoCat(m.cat); titulo = m.sub || m.cat || 'Gasto'; sub.push(esc(nombreCuenta(m.cuenta))); if (m.nota) sub.push(esc(m.nota)); cls = ''; imp = '−' + fmt(m.importe);
      if (m.miParte !== '' && m.miParte != null) sub.push('tu parte ' + fmt(m.miParte));
    }
    if (m.origen && m.origen.indexOf('fijo:') === 0) sub.push('automático');
    (hijos || []).forEach(function (r) { sub.push('+' + fmt(r.importe) + ' a ' + esc(nombreCuenta(r.destino))); });
    return '<li class="tap" data-act="editar" data-id="' + esc(m.id) + '"><span class="avatar">' + icon + '</span><div class="grow"><div class="title">' + esc(titulo) + '</div><div class="subline">' + sub.join(' · ') + '</div></div><span class="amount ' + cls + '">' + imp + '</span></li>';
  }

  function listaMovs(movs, limite) {
    var red = {};
    V.movimientos.forEach(function (m) { if (m.origen === 'redondeo' && m.vinculado) (red[m.vinculado] = red[m.vinculado] || []).push(m); });
    var ids = {}; V.movimientos.forEach(function (m) { ids[m.id] = true; });
    movs = movs.filter(function (m) { return !(m.origen === 'redondeo' && ids[m.vinculado]); })
      .sort(function (a, b) { return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (b.act || 0) - (a.act || 0); });
    var total = movs.length; movs = movs.slice(0, limite);
    if (!movs.length) return '<div class="empty-state">No hay movimientos.</div>';
    var h = '', dia = null;
    movs.forEach(function (m) {
      if (m.fecha !== dia) {
        if (dia) h += '</ul></div>';
        dia = m.fecha;
        var gastoDia = movs.filter(function (x) { return x.fecha === dia && x.tipo === 'gasto'; }).reduce(function (a, x) { return a + C.parteMia(x); }, 0);
        h += '<div class="daytitle"><span>' + fLarga(dia) + '</span><span class="num">' + (gastoDia ? '−' + fmt(gastoDia) : '') + '</span></div><div class="card" style="padding:4px 14px"><ul class="list">';
      }
      h += filaMov(m, red[m.id]);
    });
    h += '</ul></div>';
    if (total > limite) h += '<button class="btn block" data-act="mas">Ver más (' + (total - limite) + ')</button>';
    return h;
  }

  function vistaMovimientos() {
    var f = ui.filtro;
    var movs = V.movimientos.filter(function (m) {
      if (!f.intereses && m.origen === 'interes') return false;
      if (f.tipo !== 'todos' && m.tipo !== f.tipo) return false;
      if (f.cuenta && m.cuenta !== f.cuenta && m.destino !== f.cuenta) return false;
      if (f.q) {
        var q = f.q.toLowerCase();
        var txt = [m.nota, m.cat, m.sub, nombreCuenta(m.cuenta), nombreCuenta(m.destino), String(m.importe).replace('.', ',')].join(' ').toLowerCase();
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    });
    var chip = function (k, l) { return '<button class="chip' + (f.tipo === k ? ' on' : '') + '" data-act="ftipo" data-id="' + k + '">' + l + '</button>'; };
    return '<div class="topbar"><h1>Movimientos</h1>' + pillHTML() + '</div>' +
      '<input class="input" id="f-q" type="search" placeholder="Buscar (nota, categoría, importe…)" value="' + esc(f.q) + '" style="margin-bottom:8px">' +
      '<div class="chips">' + chip('todos', 'Todos') + chip('gasto', 'Gastos') + chip('ingreso', 'Ingresos') + chip('transferencia', 'Transferencias') +
      '<button class="chip' + (f.intereses ? ' on' : '') + '" data-act="fint">Intereses</button></div>' +
      '<select class="input" id="f-cuenta" style="margin-top:6px"><option value="">Todas las cuentas</option>' +
      V.cuentas.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.cuenta === c.id ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('') + '</select>' +
      listaMovs(movs, ui.limite);
  }

  // ---------- Estadísticas ----------
  function etiquetaCiclo(s) { var d = C.parseISO(C.addDays(s.inicio, 10)); return MESES[d.getUTCMonth()] + (s.inicio.slice(2, 4) !== hoy().slice(2, 4) ? " '" + s.inicio.slice(2, 4) : ''); }

  function vistaEstadisticas() {
    var t = hoy(), stats = C.estadisticas(V, t);
    if (ui.statIdx === null || ui.statIdx >= stats.length) ui.statIdx = stats.length - 1;
    var s = stats[ui.statIdx];
    var h = '<div class="topbar"><h1>Estadísticas</h1>' + pillHTML() + '</div>';
    h += '<div class="card"><div class="row" style="margin-bottom:10px"><button class="btn small" data-act="stat-prev"' + (ui.statIdx <= 0 ? ' disabled' : '') + ' aria-label="Ciclo anterior">‹</button>' +
      '<b>' + fCorta(s.inicio) + ' – ' + fCorta(s.fin) + (s.actual ? ' (actual)' : '') + '</b>' +
      '<button class="btn small" data-act="stat-next"' + (ui.statIdx >= stats.length - 1 ? ' disabled' : '') + ' aria-label="Ciclo siguiente">›</button></div>' +
      '<div class="tiles">' +
      '<div class="tile"><div class="k">Ingresos</div><div class="v num">' + fmt(s.ingresos) + '</div></div>' +
      '<div class="tile"><div class="k">Gastos</div><div class="v num">' + fmt(s.gastos) + '</div></div>' +
      '<div class="tile"><div class="k">Ahorro</div><div class="v num">' + fmt(s.ahorro) + '</div></div>' +
      '<div class="tile"><div class="k">Tasa de ahorro</div><div class="v num">' + (s.tasaAhorro === null ? '—' : Math.round(s.tasaAhorro * 100) + ' %') + '</div></div>' +
      '</div>' + (s.intereses ? '<p class="small muted" style="margin:8px 0 0">Incluye ' + fmt(s.intereses) + ' de intereses netos.</p>' : '') + '</div>';

    var cats = Object.keys(s.porCategoria).map(function (k) { return { cat: k, v: s.porCategoria[k] }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    var max = cats.length ? cats[0].v : 1;
    h += '<div class="card"><h2>Gasto por categoría</h2>' + (cats.length ? cats.map(function (c) {
      return '<div class="catrow" data-tip="' + esc(c.cat + '\n' + fmt(c.v) + ' · ' + Math.round(c.v / s.gastos * 100) + ' % del gasto') + '"><div class="row small"><span>' + esc(iconoCat(c.cat)) + ' ' + esc(c.cat || 'Sin categoría') + '</span><span class="num sec">' + fmt(c.v) + '</span></div><div class="bar thin"><div class="fill" style="width:' + (c.v / max * 100) + '%"></div></div></div>';
    }).join('') : '<div class="empty-state">Sin gastos en este ciclo.</div>') + '</div>';

    var ult = stats.slice(-12), labels = ult.map(etiquetaCiclo);
    h += '<div class="card"><h2>Ingresos y gastos por ciclo</h2>' +
      '<div class="legend"><span><i style="background:var(--series-1)"></i>Ingresos</span><span><i style="background:var(--series-2)"></i>Gastos</span></div>' +
      CH.groupedBars(labels, [
        { name: 'Ingresos', cls: 's1', values: ult.map(function (x) { return x.ingresos; }) },
        { name: 'Gastos', cls: 's2', values: ult.map(function (x) { return x.gastos; }) }
      ], { aria: 'Ingresos y gastos por ciclo' }) +
      '<details><summary>Ver tabla</summary><table class="data"><tr><th>Ciclo</th><th>Ingresos</th><th>Gastos</th><th>Ahorro</th></tr>' +
      ult.slice().reverse().map(function (x) { return '<tr><td>' + fCorta(x.inicio) + '</td><td>' + fmt(x.ingresos) + '</td><td>' + fmt(x.gastos) + '</td><td>' + fmt(x.ahorro) + '</td></tr>'; }).join('') + '</table></details></div>';

    h += '<div class="card"><h2>Tasa de ahorro</h2>' + CH.bars(labels, ult.map(function (x) { return x.tasaAhorro === null ? null : Math.round(x.tasaAhorro * 1000) / 10; }), {
      goal: C.num(V.config.ahorroPct), aria: 'Tasa de ahorro por ciclo',
      tick: function (v) { return Math.round(v) + '%'; }, fmt: function (v) { return v.toString().replace('.', ',') + ' %'; }
    }) + '</div>';

    var pts = stats.map(function (x) { var f = x.fin < t ? x.fin : t; return { label: etiquetaCiclo(x), value: x.patrimonio, tip: fCorta(f) + '\n' + fmt(x.patrimonio) }; });
    var first = stats[0] ? stats[0].patrimonio : 0, last = pts.length ? pts[pts.length - 1].value : 0;
    h += '<div class="card"><h2>Patrimonio total<span class="right num" style="color:var(--text)">' + fmt(last) + '</span></h2>' +
      CH.line(pts.slice(-24), { aria: 'Evolución del patrimonio' }) +
      (stats.length > 1 ? '<p class="small sec" style="margin:6px 0 0">' + (last - first >= 0 ? '▲ +' : '▼ ') + fmt(last - first) + ' desde ' + fCorta(stats[0].inicio) + '</p>' : '<p class="small muted" style="margin:6px 0 0">Se irá dibujando con cada ciclo.</p>') + '</div>';
    return h;
  }

  // ---------- Ajustes ----------
  function vistaAjustes() {
    var cfg = V.config, ciclo = cicloActual(), p = C.presupuesto(V, ciclo, hoy());
    var sumCats = p.categorias.reduce(function (a, c) { return a + (c.presupuesto || 0); }, 0);
    var h = '<div class="topbar"><h1>Ajustes</h1>' + pillHTML() + '</div>';

    h += '<div class="card"><h2>Presupuesto y ahorro</h2>' +
      campoNum('ahorroPct', 'Objetivo de ahorro (% de la nómina, incluye plan de pensiones)', cfg.ahorroPct) +
      campoNum('repartoInversion', '% del sobrante a inversión (resto a remunerada)', cfg.repartoInversion) +
      campoNum('sueldo', 'Sueldo de referencia (hasta registrar la nómina)', cfg.sueldo) +
      '<label class="field"><span>Inicio del primer ciclo (última nómina antes de usar la app)</span><input class="input" type="date" data-cfg="inicioCiclo" value="' + esc(cfg.inicioCiclo || '') + '"></label>' +
      '</div>';

    h += '<div class="card"><h2>Presupuesto por categoría<span class="right">' + fmt(sumCats) + ' de ' + fmt(p.disponible) + '</span></h2>' +
      '<p class="small muted" style="margin-top:0">Solo gastos variables: los fijos ya se descuentan aparte. ' + (sumCats > p.disponible ? '<b style="color:var(--critical)">La suma supera lo disponible.</b>' : 'Sin asignar: ' + fmt(p.disponible - sumCats) + '.') + '</p>' +
      p.categorias.filter(function (c) { return c.cat; }).map(function (c) {
        return '<label class="inline" style="margin:6px 0"><span style="flex:1">' + esc(c.icono) + ' ' + esc(c.cat) + '</span><input class="input num" style="max-width:120px;text-align:right" inputmode="decimal" data-pres="' + esc(c.cat) + '" value="' + (c.presupuesto ? String(c.presupuesto).replace('.', ',') : '') + '" placeholder="sin límite"></label>';
      }).join('') + '</div>';

    h += '<div class="card"><h2>Cuentas</h2><ul class="list">' + V.cuentas.map(function (c) {
      return '<li class="tap" data-act="cuenta" data-id="' + esc(c.id) + '"><span class="avatar">' + (ICONO_CUENTA[c.tipo] || '🏦') + '</span><div class="grow"><div class="title">' + esc(c.nombre) + '</div><div class="subline">ID ' + esc(c.id) + ' · ' + esc(c.tipo) + '</div></div><span class="muted">›</span></li>';
    }).join('') + '</ul><p class="small muted">Para crear o renombrar cuentas, edita la hoja «Cuentas».</p></div>';

    h += '<div class="card"><h2>Gastos fijos y automáticos</h2><ul class="list">' + (V.fijos || []).map(function (f) {
      var frec = f.frecuencia === 'dias' ? 'cada ' + f.cada + ' días' : 'día ' + f.dia + ' de cada mes';
      var rest = f.restantes !== '' && f.restantes != null ? ' · quedan ' + f.restantes : '';
      return '<li><div class="grow"><div class="title">' + esc(f.concepto) + (f.activo === false ? ' <span class="muted">(inactivo)</span>' : '') + '</div><div class="subline">' + frec + rest + ' · próximo ' + (f.proxima ? fCorta(f.proxima) : '—') + '</div></div><span class="amount ' + (f.tipo === 'ingreso' ? 'pos' : f.tipo === 'transferencia' ? 'tr' : '') + '">' + (f.modo === 'liquidar' ? 'saldo' : fmt(f.importe)) + '</span></li>';
    }).join('') + '</ul><p class="small muted">Se registran solos cada día. Para añadir o cambiar, edita la hoja «Fijos».</p></div>';

    if (modo() === 'online') {
      h += '<div class="card"><h2>Seguridad</h2><p class="small sec" style="margin-top:0">' +
        (caja ? '🔒 Los datos de este dispositivo están cifrados (AES-256). Se desbloquean con ' + ({ passkey: 'Face ID / huella', 'passkey-local': 'Face ID (modo compatible: llave no exportable guardada en el dispositivo)', password: 'tu contraseña' }[caja.metodo] || caja.metodo) + ' y se bloquean solos a los 30 s fuera de la app.' : '⚠️ Este dispositivo aún no está protegido: no se guarda nada hasta que lo protejas.') + '</p>' +
        '<div class="stack"><button class="btn block' + (caja ? '' : ' primary') + '" data-act="proteger">' + (caja ? 'Cambiar método de desbloqueo' : 'Proteger ahora') + '</button>' +
        (caja ? '<button class="btn block" data-act="bloquear">Bloquear ahora</button>' : '') + '</div>' +
        (seguridad ? '<p class="small muted">Intentos de acceso fallidos a la hoja (7 días): ' + seguridad.fallos7d + '</p>' : '') + '</div>';
    }

    h += '<div class="card"><h2>Conexión</h2>';
    if (modo() === 'demo') {
      h += '<p class="small sec" style="margin-top:0">Estás en modo demo con datos de ejemplo. Nada se guarda en Google.</p><button class="btn primary block" data-act="salir-demo">Conectar mi hoja de cálculo</button>';
    } else {
      h += '<label class="field"><span>URL de Apps Script</span><input class="input" id="a-url" value="' + esc(sesion.url) + '" autocapitalize="off" autocomplete="off"></label>' +
        '<label class="field"><span>Clave secreta</span><input class="input" id="a-clave" type="password" value="' + esc(sesion.clave) + '" autocapitalize="off" autocomplete="off"></label>' +
        '<div class="inline"><button class="btn" data-act="guardar-conexion">Guardar</button><button class="btn primary" data-act="sync">Sincronizar ahora</button></div>' +
        '<p class="small muted">Última sincronización: ' + (sync.ultimo ? new Date(sync.ultimo).toLocaleString('es-ES') : 'nunca') + (queue.length ? ' · ' + queue.length + ' cambios sin enviar' : '') + (sync.error ? '<br><span style="color:var(--critical)">' + esc(sync.error) + '</span>' : '') + '</p>';
    }
    h += '</div>';

    h += '<div class="card"><h2>Datos</h2><div class="stack">' +
      '<button class="btn block" data-act="exportar">Descargar copia de seguridad (JSON)</button>' +
      '<button class="btn block danger" data-act="reset">Desconectar y borrar datos de este dispositivo</button></div>' +
      '<p class="small muted">Hucha ' + VERSION + ' · Tus datos viven en tu hoja de Google y, cifrados, en este dispositivo.</p></div>';
    return h;
  }
  function campoNum(k, label, v) {
    return '<label class="field"><span>' + esc(label) + '</span><input class="input num" inputmode="decimal" data-cfg="' + k + '" value="' + esc(String(v == null ? '' : v).replace('.', ',')) + '"></label>';
  }

  // ---------------------------------------------------------------- hoja (overlay)
  var hoja = null;
  function abrirHoja(html, onMount, fija) {
    cerrarHoja();
    hoja = document.createElement('div');
    hoja.className = 'overlay';
    if (fija) hoja.dataset.fija = '1';
    hoja.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="sheet-body">' + html + '</div></div>';
    if (!fija) hoja.addEventListener('click', function (e) { if (e.target === hoja) cerrarHoja(); });
    document.body.appendChild(hoja);
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(hoja);
  }
  function cerrarHoja() {
    if (hoja) { hoja.remove(); hoja = null; form = null; }
    document.body.style.overflow = '';
  }

  // ---------- Formulario de movimiento ----------
  var form = null;
  function cuentasOpciones(sel, filtro) {
    return V.cuentas.filter(function (c) { return c.activa !== false && (!filtro || filtro(c)); })
      .map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.nombre) + '</option>'; }).join('');
  }

  function abrirMovimiento(mov, preset) {
    var red = mov ? V.movimientos.filter(function (m) { return m.id === mov.id + '-r'; })[0] : null;
    var def = V.config.cuentaDefecto || (V.cuentas[0] && V.cuentas[0].id);
    form = mov ? {
      id: mov.id, original: mov, tipo: mov.tipo === 'ajuste' ? 'ajuste' : mov.tipo,
      importe: String(C.r2(Math.abs(mov.importe))).replace('.', ','), signo: mov.importe < 0 ? -1 : 1,
      cuenta: mov.cuenta, destino: mov.destino || '', fecha: mov.fecha, cat: mov.cat || '', sub: mov.sub || '',
      nota: mov.nota || '', compartido: mov.miParte !== '' && mov.miParte != null, miParte: mov.miParte !== '' && mov.miParte != null ? String(mov.miParte).replace('.', ',') : '',
      debito: !!red, nomina: !!mov.nomina, reembolso: !!mov.reembolso, vinculado: mov.vinculado || ''
    } : Object.assign({
      id: null, tipo: 'gasto', importe: '', cuenta: def, destino: '', fecha: hoy(), cat: '', sub: '', nota: '',
      compartido: false, miParte: '', debito: !!(cuenta(def) && cuenta(def).redondeoA), nomina: false, reembolso: false, vinculado: ''
    }, preset || {});
    abrirHoja('', function () { pintarForm(); });
  }

  function catsDe(tipo) {
    return (V.categorias || []).filter(function (c) { return c.tipo === tipo && !c.sub; });
  }
  function subsDe(cat) { return (V.categorias || []).filter(function (c) { return c.cat === cat && c.sub; }).map(function (c) { return c.sub; }); }

  function pintarForm() {
    if (!hoja || !form) return;
    var f = form, h = '';
    if (f.tipo === 'ajuste') h += '<h3>Ajuste de saldo</h3>';
    if (f.tipo !== 'ajuste') {
      h += '<div class="seg">' + ['gasto', 'ingreso', 'transferencia'].map(function (t) {
        return '<button data-f="tipo" data-v="' + t + '" class="' + (f.tipo === t ? 'on' : '') + '">' + { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' }[t] + '</button>';
      }).join('') + '</div>';
    }
    h += '<div class="amount-display' + (f.importe ? '' : ' empty') + '" id="f-imp">' + (f.tipo === 'ajuste' && f.signo < 0 ? '−' : '') + (f.importe || '0') + ' €</div>';
    h += '<div class="meta-row">';
    if (f.tipo === 'transferencia') {
      h += '<select data-f="cuenta" aria-label="Desde">' + cuentasOpciones(f.cuenta) + '</select><span style="align-self:center">→</span><select data-f="destino" aria-label="Hacia"><option value="">Destino…</option>' + cuentasOpciones(f.destino) + '</select>';
    } else {
      h += '<select data-f="cuenta" aria-label="Cuenta">' + cuentasOpciones(f.cuenta) + '</select>';
    }
    h += '<input type="date" data-f="fecha" value="' + esc(f.fecha) + '" aria-label="Fecha"></div>';
    h += '<div class="hint" id="f-hint"></div>';

    if (f.tipo === 'gasto') {
      var c = cuenta(f.cuenta);
      if (c && c.redondeoA) h += '<div class="switch"><span>Con tarjeta de débito <span class="muted small">(redondeo)</span></span><input type="checkbox" data-f="debito"' + (f.debito ? ' checked' : '') + '></div>';
      h += gridCats('gasto');
      h += '<div class="switch"><span>Compartido <span class="muted small">(me devuelven)</span></span><input type="checkbox" data-f="compartido"' + (f.compartido ? ' checked' : '') + '></div>';
      if (f.compartido) h += '<label class="field"><span>Mi parte (lo que cuenta para el presupuesto)</span><input class="input num" inputmode="decimal" data-f="miParte" value="' + esc(f.miParte) + '" placeholder="p. ej. 20"></label>';
    } else if (f.tipo === 'ingreso') {
      h += '<div class="switch"><span>Es la nómina</span><input type="checkbox" data-f="nomina"' + (f.nomina ? ' checked' : '') + '></div>';
      if (!f.nomina) {
        h += '<div class="switch"><span>Es un reembolso <span class="muted small">(Bizum de amigos, devolución…)</span></span><input type="checkbox" data-f="reembolso"' + (f.reembolso ? ' checked' : '') + '></div>';
        if (f.reembolso) {
          var pend = C.pendientesCobro(V).filter(function (x) { return !f.id || x.mov.id !== f.id; });
          if (f.vinculado && !pend.some(function (x) { return x.mov.id === f.vinculado; })) {
            var vm = V.movimientos.filter(function (m) { return m.id === f.vinculado; })[0];
            if (vm) pend.unshift({ mov: vm, pendiente: 0 });
          }
          if (pend.length) {
            h += '<div class="small sec" style="margin-top:6px">¿De qué gasto compartido?</div><div class="chips">' + pend.map(function (x) {
              return '<button class="chip' + (f.vinculado === x.mov.id ? ' on' : '') + '" data-f="vinculado" data-v="' + esc(x.mov.id) + '">' + esc(x.mov.nota || x.mov.sub || x.mov.cat) + ' · ' + fCorta(x.mov.fecha) + (x.pendiente ? ' · ' + fmt(x.pendiente) : '') + '</button>';
            }).join('') + '</div>';
          }
          if (!f.vinculado) h += '<div class="small sec" style="margin-top:6px">O elige la categoría a la que descuenta:</div>' + gridCats('gasto');
        } else h += gridCats('ingreso');
      }
    } else if (f.tipo === 'ajuste') {
      h += '<div class="seg"><button data-f="signo" data-v="1" class="' + (f.signo > 0 ? 'on' : '') + '">Suma</button><button data-f="signo" data-v="-1" class="' + (f.signo < 0 ? 'on' : '') + '">Resta</button></div>';
    }
    h += '<input class="input" data-f="nota" placeholder="Nota (opcional)" value="' + esc(f.nota) + '" style="margin-top:8px;min-height:40px;padding:8px 12px">';
    h += '<div class="keypad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map(function (k) { return '<button data-k="' + k + '" aria-label="' + (k === '⌫' ? 'Borrar' : k) + '">' + k + '</button>'; }).join('') + '</div>';
    h += '<div class="sheet-actions">' + (f.id ? '<button class="btn danger" data-f="borrar">Borrar</button>' : '<button class="btn" data-f="cancelar">Cancelar</button>') + '<button class="btn primary" data-f="guardar">Guardar</button></div>';
    $('.sheet-body', hoja).innerHTML = h;
    pintarHint();
  }

  function gridCats(tipo) {
    var f = form, h = '<div class="chips cats">' + catsDe(tipo).map(function (c) {
      return '<button class="chip' + (f.cat === c.cat ? ' on' : '') + '" data-f="cat" data-v="' + esc(c.cat) + '">' + esc(c.icono || '•') + ' ' + esc(c.cat) + '</button>';
    }).join('') + '</div>';
    var subs = f.cat ? subsDe(f.cat) : [];
    if (subs.length) h += '<div class="chips">' + subs.map(function (s) { return '<button class="chip' + (f.sub === s ? ' on' : '') + '" data-f="sub" data-v="' + esc(s) + '">' + esc(s) + '</button>'; }).join('') + '</div>';
    return h;
  }

  function pintarHint() {
    if (!form || !hoja) return;
    var f = form, imp = C.num(f.importe), txt = '';
    var d = $('#f-imp', hoja);
    if (d) { d.textContent = (f.tipo === 'ajuste' && f.signo < 0 ? '−' : '') + (f.importe || '0') + ' €'; d.classList.toggle('empty', !f.importe); }
    var c = cuenta(f.cuenta);
    if (f.tipo === 'gasto' && f.debito && c && c.redondeoA && imp > 0) txt = '+' + fmt(C.redondeo(imp)) + ' → ' + nombreCuenta(c.redondeoA) + ' (redondeo)';
    if (f.tipo === 'gasto' && f.compartido && imp > 0) txt += (txt ? ' · ' : '') + 'te deberán ' + fmt(imp - C.num(f.miParte));
    if (f.tipo === 'ingreso' && f.nomina) txt = 'Empieza un ciclo nuevo y te propondré el reparto del sobrante.';
    var hint = $('#f-hint', hoja); if (hint) hint.textContent = txt;
  }

  function teclear(k) {
    var s = form.importe;
    if (k === '⌫') s = s.slice(0, -1);
    else if (k === ',' || k === '.') { if (s.indexOf(',') < 0) s = (s || '0') + ','; }
    else {
      var dec = s.indexOf(',');
      if (dec >= 0 && s.length - dec > 2) return;
      if (s.replace(',', '').length >= 9) return;
      s = (s === '0' ? '' : s) + k;
    }
    form.importe = s; pintarHint();
  }

  function guardarForm() {
    var f = form, imp = C.r2(C.num(f.importe));
    if (!(imp > 0)) { toast('Escribe un importe'); return; }
    if (f.tipo === 'transferencia' && (!f.destino || f.destino === f.cuenta)) { toast('Elige la cuenta de destino'); return; }
    if (f.tipo === 'gasto' && !f.cat) { toast('Elige una categoría'); return; }
    if (f.compartido && f.tipo === 'gasto' && (C.num(f.miParte) < 0 || C.num(f.miParte) > imp)) { toast('Tu parte debe estar entre 0 y el total'); return; }
    var id = f.id || C.uid(), orig = f.original || {};
    var mov = {
      id: id, fecha: f.fecha || hoy(), tipo: f.tipo, importe: f.tipo === 'ajuste' ? imp * f.signo : imp,
      cuenta: f.cuenta, destino: f.tipo === 'transferencia' ? f.destino : '',
      cat: f.tipo === 'transferencia' || f.tipo === 'ajuste' ? '' : (f.tipo === 'ingreso' && f.nomina ? 'Ingresos' : (f.vinculado ? '' : f.cat)),
      sub: f.tipo === 'transferencia' || f.tipo === 'ajuste' ? '' : (f.tipo === 'ingreso' && f.nomina ? 'Nómina' : (f.vinculado ? '' : f.sub)),
      nota: f.nota.trim(), miParte: f.tipo === 'gasto' && f.compartido ? C.r2(C.num(f.miParte)) : '',
      nomina: f.tipo === 'ingreso' && f.nomina, reembolso: f.tipo === 'ingreso' && !f.nomina && f.reembolso,
      vinculado: f.tipo === 'ingreso' && f.reembolso ? f.vinculado : (orig.vinculado && f.tipo === orig.tipo ? orig.vinculado : ''),
      origen: orig.origen || 'manual', act: Date.now()
    };
    var ops = [{ op: 'mov', mov: mov }];
    var c = cuenta(mov.cuenta), teniaRed = V.movimientos.some(function (m) { return m.id === id + '-r'; });
    if (mov.tipo === 'gasto' && f.debito && c && c.redondeoA) {
      ops.push({ op: 'mov', mov: { id: id + '-r', fecha: mov.fecha, tipo: 'transferencia', importe: C.redondeo(imp), cuenta: mov.cuenta, destino: c.redondeoA, cat: '', sub: '', nota: 'Redondeo', miParte: '', nomina: false, reembolso: false, vinculado: id, origen: 'redondeo', act: Date.now() } });
    } else if (teniaRed) ops.push({ op: 'borrar', id: id + '-r' });
    var esNuevaNomina = mov.nomina && !orig.nomina;
    cerrarHoja();
    commit(ops);
    toast(f.id ? 'Movimiento actualizado' : 'Guardado');
    if (esNuevaNomina) setTimeout(function () { abrirReparto(mov.id); }, 350);
  }

  function borrarForm() {
    var id = form.id;
    if (!confirm('¿Borrar este movimiento?')) return;
    var ops = [{ op: 'borrar', id: id }];
    if (V.movimientos.some(function (m) { return m.id === id + '-r'; })) ops.push({ op: 'borrar', id: id + '-r' });
    cerrarHoja(); commit(ops); toast('Borrado');
  }

  function onFormClick(e) {
    var k = e.target.closest('[data-k]');
    if (k) { teclear(k.dataset.k); return; }
    var b = e.target.closest('[data-f]');
    if (!b || b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type !== 'checkbox')) return;
    var f = form, key = b.dataset.f, v = b.dataset.v;
    if (key === 'guardar') return guardarForm();
    if (key === 'borrar') return borrarForm();
    if (key === 'cancelar') return cerrarHoja();
    if (b.type === 'checkbox') {
      f[key] = b.checked;
      if (key === 'reembolso' && !b.checked) { f.vinculado = ''; }
      if (key === 'reembolso' && b.checked) { f.cat = ''; f.sub = ''; }
      if (key === 'nomina' && b.checked) { f.cat = 'Ingresos'; f.sub = 'Nómina'; if (V.config.cuentaNomina) f.cuenta = V.config.cuentaNomina; if (!f.importe && V.config.sueldo) f.importe = String(V.config.sueldo).replace('.', ','); }
      if (key === 'debito') { pintarHint(); return; }
      pintarForm(); return;
    }
    if (key === 'tipo') { f.tipo = v; f.cat = ''; f.sub = ''; f.nomina = false; f.reembolso = false; f.vinculado = ''; f.compartido = false; }
    else if (key === 'cat') { f.cat = f.cat === v ? '' : v; f.sub = ''; }
    else if (key === 'sub') { f.sub = f.sub === v ? '' : v; }
    else if (key === 'vinculado') {
      f.vinculado = f.vinculado === v ? '' : v;
      var x = C.pendientesCobro(V).filter(function (p) { return p.mov.id === v; })[0];
      if (f.vinculado && x && !f.importe) f.importe = String(x.pendiente).replace('.', ',');
    }
    else if (key === 'signo') { f.signo = +v; }
    pintarForm();
  }
  function onFormInput(e) {
    var b = e.target.closest('[data-f]'); if (!b || !form) return;
    var key = b.dataset.f;
    if (b.type === 'checkbox') return;
    form[key] = b.value;
    if (key === 'cuenta' && form.tipo === 'gasto') { var c = cuenta(b.value); form.debito = !!(c && c.redondeoA); pintarForm(); return; }
    pintarHint();
  }

  // ---------- Reparto de la nómina ----------
  function abrirReparto(nominaId) {
    var nom = V.movimientos.filter(function (m) { return m.id === nominaId; })[0];
    if (!nom) return;
    var prop = C.propuestaNomina(V, nom);
    var lineas = prop.movimientos.map(function (m, i) { return Object.assign({ on: true, idx: i }, m); });
    var h = '<h3>Reparto al cobrar la nómina</h3>' +
      '<p class="small sec" style="margin-top:0">Sobrante en ' + esc(nombreCuenta(V.config.cuentaSobrante)) + (V.config.tarjetaSobrante ? ' (descontando la deuda de ' + esc(nombreCuenta(V.config.tarjetaSobrante)) + ')' : '') + ': <b>' + fmt(prop.sobrante) + '</b>. ' +
      'En ' + esc(nombreCuenta(nom.cuenta)) + ' se quedan ' + fmt(prop.reservado) + ' para los cargos fijos.</p>' +
      '<ul class="list">' + lineas.map(function (l) {
        return '<li><input type="checkbox" checked data-r="' + l.idx + '" aria-label="Incluir"><div class="grow"><div class="title">' + esc(nombreCuenta(l.cuenta)) + ' → ' + esc(nombreCuenta(l.destino)) + '</div><div class="subline">' + esc(l.nota) + '</div></div>' +
          '<input class="input num" style="max-width:110px;text-align:right" inputmode="decimal" data-ri="' + l.idx + '" value="' + String(l.importe).replace('.', ',') + '"></li>';
      }).join('') + '</ul>' +
      (lineas.length ? '' : '<div class="empty-state">No hay nada que repartir.</div>') +
      '<div class="sheet-actions"><button class="btn" data-x="cerrar">Ahora no</button><button class="btn primary" data-x="ok">Registrar</button></div>';
    abrirHoja(h, function (el) {
      el.addEventListener('click', function (e) {
        var x = e.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'cerrar') return cerrarHoja();
        var ops = [];
        lineas.forEach(function (l) {
          if (!$('[data-r="' + l.idx + '"]', el).checked) return;
          var imp = C.r2(C.num($('[data-ri="' + l.idx + '"]', el).value));
          if (!(imp > 0)) return;
          ops.push({ op: 'mov', mov: { id: C.uid(), fecha: l.fecha, tipo: 'transferencia', importe: imp, cuenta: l.cuenta, destino: l.destino, cat: '', sub: '', nota: l.nota, miParte: '', nomina: false, reembolso: false, vinculado: nom.id, origen: 'manual', act: Date.now() } });
        });
        LS.set('repartoHecho.' + nom.id, true);
        cerrarHoja();
        if (ops.length) { commit(ops); toast('Reparto registrado'); } else render();
      });
    });
  }

  // ---------- Detalle de cuenta ----------
  function abrirCuenta(id) {
    var c = cuenta(id), s = C.saldos(V)[id] || 0;
    var movs = V.movimientos.filter(function (m) { return m.cuenta === id || m.destino === id; });
    var h = '<h3>' + (ICONO_CUENTA[c.tipo] || '') + ' ' + esc(c.nombre) + '</h3>' +
      '<div class="hero num' + (s < 0 ? ' neg' : '') + '" style="font-size:34px">' + fmt(s) + '</div>' +
      '<p class="small muted" style="margin-top:0">Saldo inicial ' + fmt(c.saldoInicial) + ' el ' + (c.fechaInicial ? fCorta(c.fechaInicial) : '—') + (c.tae ? ' · ' + c.tae + ' % TAE, retención ' + (c.retencion || 0) + ' %' : '') + '</p>' +
      '<label class="field"><span>¿No cuadra? Escribe el saldo real y creo un ajuste</span><div class="inline"><input class="input num" id="c-real" inputmode="decimal" placeholder="' + String(s).replace('.', ',') + '"><button class="btn primary" id="c-ajustar">Ajustar</button></div></label>' +
      '<button class="btn block" id="c-ver">Ver todos sus movimientos</button>' +
      '<div style="margin-top:10px">' + (movs.length ? '<div class="card" style="padding:4px 14px"><ul class="list">' + movs.sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).slice(0, 8).map(function (m) { return filaMov(m); }).join('') + '</ul></div>' : '<div class="empty-state">Sin movimientos todavía.</div>') + '</div>';
    abrirHoja(h, function (el) {
      $('#c-ajustar', el).addEventListener('click', function () {
        var v = $('#c-real', el).value; if (v.trim() === '') return;
        var diff = C.r2(C.num(v) - s);
        if (Math.abs(diff) < 0.005) { toast('Ya cuadra'); return; }
        cerrarHoja();
        commit([{ op: 'mov', mov: { id: C.uid(), fecha: hoy(), tipo: 'ajuste', importe: diff, cuenta: id, destino: '', cat: '', sub: '', nota: 'Ajuste de saldo', miParte: '', nomina: false, reembolso: false, vinculado: '', origen: 'manual', act: Date.now() } }]);
        toast('Ajuste de ' + fmt(diff));
      });
      $('#c-ver', el).addEventListener('click', function () { cerrarHoja(); ui.filtro.cuenta = id; ui.filtro.tipo = 'todos'; irA('movimientos'); });
      el.addEventListener('click', function (e) {
        var li = e.target.closest('[data-act="editar"]'); if (!li) return;
        var m = V.movimientos.filter(function (x) { return x.id === li.dataset.id; })[0];
        cerrarHoja(); if (m) abrirMovimiento(m);
      });
    });
  }

  // ---------------------------------------------------------------- caja fuerte (cifrado local)
  function vistaBloqueo() {
    var pk = caja.metodo.indexOf('passkey') === 0;
    return '<div class="view welcome"><img class="logo" src="icons/icon-192.png" alt=""><h1>Hucha</h1><p class="lead">🔒 Bloqueada</p>' +
      (pk ? '<button class="btn primary block" data-act="desbloquear">Desbloquear con Face ID</button>'
        : '<div class="card"><label class="field"><span>Contraseña</span><input class="input" id="l-pass" type="password" autocomplete="current-password"></label><button class="btn primary block" data-act="desbloquear">Desbloquear</button></div>') +
      '<p class="small" id="l-err" style="text-align:center;color:var(--critical)"></p>' +
      '<button class="btn block" style="margin-top:28px" data-act="reconectar">¿No puedes entrar? Reconectar desde cero</button></div>';
  }

  var abriendo = false;
  function desbloquear(silencioso) {
    if (abriendo || !caja) return;
    abriendo = true;
    var campo = $('#l-pass'), pass = campo ? campo.value : null;
    HuchaVault.abrir(caja, pass, function () { return DB.get('llaveLocal'); }).then(function (k) {
      return HuchaVault.descifrar(k, caja).then(function (d) {
        llave = k; sesion = { url: d.url, clave: d.clave }; snapshot = d.snapshot; queue = d.queue || []; sync.ultimo = d.ultimoSync || 0;
        recompute(); render(); hacerSync();
      });
    }).catch(function (e) {
      var err = $('#l-err');
      if (err && silencioso !== true) err.textContent = e.message === 'CLAVE_INCORRECTA' ? 'Contraseña incorrecta.' : e.message === 'SIN_LLAVE' ? 'No se encuentra la llave en este dispositivo. Pulsa «Reconectar desde cero».' : (e.name === 'NotAllowedError' ? 'Cancelado. Vuelve a intentarlo.' : 'No se pudo desbloquear: ' + e.message);
    }).then(function () { abriendo = false; });
  }

  function bloquear() {
    if (!caja || !llave) return;
    cerrarHoja();
    llave = null; snapshot = null; queue = []; V = null; sesion = { url: '', clave: '' }; seguridad = null;
    render();
  }

  function abrirProteccion(obligatorio) {
    var pk = HuchaVault.soportaPasskey();
    var h = '<h3>Protege tus datos</h3><p class="small sec" style="margin-top:0">Lo que Hucha guarda en este dispositivo se cifrará (AES-256) y solo se abrirá contigo.</p>' +
      (pk ? '<button class="btn primary block" data-x="pk">Usar Face ID / huella</button><p class="small muted">Recomendado. Se crea una passkey «Hucha» en tu llavero.</p>' : '') +
      '<label class="field"><span>' + (pk ? 'O una contraseña' : 'Contraseña') + ' (mínimo 8 caracteres)</span><input class="input" type="password" id="p-1" autocomplete="new-password"></label>' +
      '<input class="input" type="password" id="p-2" placeholder="Repítela" autocomplete="new-password">' +
      '<div class="sheet-actions">' + (obligatorio ? '' : '<button class="btn" data-x="no">Cancelar</button>') + '<button class="btn' + (pk ? '' : ' primary') + '" data-x="pw">Usar contraseña</button></div>' +
      '<p class="small" id="p-err" style="color:var(--critical)"></p>';
    abrirHoja(h, function (el) {
      var pendiente = null;
      el.addEventListener('click', function (e) {
        var x = e.target.closest('[data-x]'); if (!x) return;
        var err = $('#p-err', el), p;
        if (x.dataset.x === 'no') return cerrarHoja();
        if (x.dataset.x === 'pk') p = HuchaVault.configurarPasskey();
        else if (x.dataset.x === 'pk2') p = HuchaVault.completarPasskey(pendiente.credId, pendiente.salt);
        else {
          var a = $('#p-1', el).value, b = $('#p-2', el).value;
          if (a.length < 8) { err.textContent = 'Mínimo 8 caracteres.'; return; }
          if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }
          p = HuchaVault.configurarPassword(a);
        }
        x.disabled = true; err.textContent = '';
        p.then(function (r) {
          if (r.pendiente) {
            // Passkey creada; Safari exige un segundo toque para obtener la llave.
            pendiente = r;
            x.outerHTML = '<button class="btn primary block" data-x="pk2">Último paso: confirmar con Face ID</button>';
            return;
          }
          caja = r.meta; llave = r.clave;
          DB.set('llaveLocal', r.llaveLocal || null);
          persist();
          cerrarHoja(); render(); toast(r.llaveLocal ? '🔒 Protegido con Face ID (modo compatible)' : '🔒 Datos protegidos');
        }).catch(function (e2) {
          x.disabled = false;
          err.textContent = e2.message === 'NO_PRF'
            ? 'Este dispositivo no permite cifrar con Face ID / huella (necesita iOS 18+ y Contraseñas de iCloud). De momento usa una contraseña.'
            : (e2.name === 'NotAllowedError' ? 'Cancelado o no permitido. Vuelve a pulsar.' : 'Error: ' + (e2.name || '') + ' ' + e2.message);
        });
      });
    }, obligatorio);
  }

  function borrarTodo() {
    ['url', 'clave', 'pin', 'demo', 'ultimoSync'].forEach(LS.del);
    snapshot = null; queue = []; V = null; llave = null; caja = null; seguridad = null; sesion = { url: '', clave: '' };
    DB.set('vault', null); DB.set('llaveLocal', null); DB.set('snapshot', null); DB.set('queue', []); DB.set('demo.snapshot', null); DB.set('demo.queue', []);
    cerrarHoja(); render();
  }

  // ---------------------------------------------------------------- eventos
  function irA(tab) { ui.tab = tab; ui.limite = 150; render(); window.scrollTo(0, 0); }

  document.addEventListener('click', function (e) {
    if (hoja && hoja.contains(e.target) && form) { onFormClick(e); return; }
    var tab = e.target.closest('.tab');
    if (tab) { if (tab.dataset.tab === 'nuevo') abrirMovimiento(null); else irA(tab.dataset.tab); return; }
    var a = e.target.closest('[data-act]');
    if (!a || (hoja && hoja.contains(a))) return;
    var act = a.dataset.act, id = a.dataset.id;
    if (act === 'sync') { if (modo() === 'online') hacerSync(); else toast('Modo demo: sin sincronización'); }
    else if (act === 'conectar') conectar($('#w-url').value, $('#w-clave').value);
    else if (act === 'demo') entrarDemo();
    else if (act === 'editar') { var m = V.movimientos.filter(function (x) { return x.id === id; })[0]; if (m) abrirMovimiento(m); }
    else if (act === 'cuenta') abrirCuenta(id);
    else if (act === 'cobrar') {
      var g = V.movimientos.filter(function (x) { return x.id === id; })[0], pd = C.pendientesCobro(V).filter(function (x) { return x.mov.id === id; })[0];
      abrirMovimiento(null, { tipo: 'ingreso', reembolso: true, vinculado: id, cuenta: g.cuenta, importe: pd ? String(pd.pendiente).replace('.', ',') : '', debito: false });
    }
    else if (act === 'reparto') abrirReparto(id);
    else if (act === 'reparto-no') { LS.set('repartoHecho.' + id, true); render(); }
    else if (act === 'fallos-ok') { LS.set('fallosVistos', +id); render(); }
    else if (act === 'ftipo') { ui.filtro.tipo = id; render(); }
    else if (act === 'fint') { ui.filtro.intereses = !ui.filtro.intereses; render(); }
    else if (act === 'mas') { ui.limite += 200; render(); }
    else if (act === 'stat-prev') { ui.statIdx--; render(); }
    else if (act === 'stat-next') { ui.statIdx++; render(); }
    else if (act === 'guardar-conexion') { sesion = { url: $('#a-url').value.trim(), clave: $('#a-clave').value.trim() }; persist(); toast('Guardado'); hacerSync(); }
    else if (act === 'desbloquear') desbloquear(false);
    else if (act === 'bloquear') bloquear();
    else if (act === 'proteger') abrirProteccion(false);
    else if (act === 'reconectar') { if (confirm('Se borrarán los datos guardados en este dispositivo (tu hoja de Google no se toca) y tendrás que conectar de nuevo con la URL y la clave secreta. ¿Seguir?')) borrarTodo(); }
    else if (act === 'exportar') exportar();
    else if (act === 'reset') resetear();
    else if (act === 'salir-demo') { LS.del('demo'); snapshot = null; V = null; render(); }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (hoja && hoja.contains(t)) { if (form) onFormInput(e); return; }
    if (t.id === 'f-cuenta') { ui.filtro.cuenta = t.value; render(); }
    else if (t.dataset.cfg) {
      var k = t.dataset.cfg, v = t.type === 'date' ? t.value : C.num(t.value);
      if (V.config[k] !== v) { commit([{ op: 'config', clave: k, valor: v }]); toast('Guardado'); }
    } else if (t.dataset.pres !== undefined) {
      var val = t.value.trim() === '' ? '' : C.num(t.value);
      commit([{ op: 'presupuesto', cat: t.dataset.pres, valor: val }]); toast('Presupuesto guardado');
    }
  });

  var qTimer = null;
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (hoja && hoja.contains(t)) { if (form) onFormInput(e); return; }
    if (t.id === 'f-q') {
      ui.filtro.q = t.value; clearTimeout(qTimer);
      qTimer = setTimeout(function () { var pos = t.selectionStart; render(); var n = $('#f-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} } }, 250);
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'l-pass' && e.key === 'Enter') { desbloquear(); return; }
    if (hoja && hoja.dataset.fija) return;
    if (!hoja || !form) { if (e.key === 'Escape') cerrarHoja(); return; }
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === 'Escape') { cerrarHoja(); return; }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') { if (e.key === 'Enter' && e.target.dataset.f === 'nota') guardarForm(); return; }
    if (/^[0-9]$/.test(e.key)) teclear(e.key);
    else if (e.key === ',' || e.key === '.') teclear(',');
    else if (e.key === 'Backspace') teclear('⌫');
    else if (e.key === 'Enter') guardarForm();
    else return;
    e.preventDefault();
  });

  var ocultoDesde = 0;
  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('oculto', document.hidden && modo() === 'online');
    if (document.hidden) { ocultoDesde = Date.now(); return; }
    if (ocultoDesde && Date.now() - ocultoDesde > 30000 && caja && llave) { bloquear(); return; }
    if (V && modo() === 'online') hacerSync();
    if (V) render();
  });
  window.addEventListener('online', function () { programarSync(100); });
  window.addEventListener('offline', function () { sync.estado = 'off'; pintarEstado(); });

  // ---------------------------------------------------------------- acciones
  function conectar(url, clave) {
    url = (url || '').trim(); clave = (clave || '').trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) { toast('La URL debe acabar en /exec'); return; }
    if (!clave) { toast('Falta la clave secreta'); return; }
    sesion = { url: url, clave: clave }; LS.del('demo');
    queue = []; snapshot = null;
    toast('Conectando…');
    hacerSync().then(function () {
      if (!snapshot) { toast(sync.error || 'No se pudo conectar'); sesion = { url: '', clave: '' }; render(); return; }
      toast('¡Conectado!');
      abrirProteccion(true);
    });
  }

  function entrarDemo() {
    LS.set('demo', true);
    DB.get('demo.snapshot').then(function (s) {
      snapshot = s || C.estadoEjemplo(hoy()); queue = [];
      persist(); recompute(); render();
    });
  }

  function exportar() {
    if (!confirm('La copia se descarga SIN cifrar. Guárdala en un sitio seguro y bórrala cuando no la necesites. ¿Descargar?')) return;
    var blob = new Blob([JSON.stringify(V, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hucha-' + hoy() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function resetear() {
    if (queue.length && !confirm('Hay ' + queue.length + ' cambios sin enviar a la hoja. Se perderán. ¿Seguir?')) return;
    if (!confirm('Se borrarán la conexión y los datos cifrados guardados en este dispositivo (tu hoja de Google no se toca). ¿Seguir?')) return;
    borrarTodo();
  }

  // ---------------------------------------------------------------- arranque
  function iniciar() {
    CH.bindTips(document.getElementById('app'));
    DB.open().then(function () {
      if (LS.get('demo', false)) {
        return Promise.all([DB.get('demo.snapshot'), DB.get('demo.queue')]).then(function (r) {
          snapshot = r[0] || C.estadoEjemplo(hoy()); queue = r[1] || [];
          recompute(); render();
        });
      }
      ['url', 'clave', 'pin'].forEach(LS.del); // restos de versiones sin cifrar
      return DB.get('vault').then(function (v) {
        caja = v && v.metodo && v.ct ? v : null;
        render();
        if (caja && caja.metodo.indexOf('passkey') === 0) setTimeout(function () { desbloquear(true); }, 150);
      });
    });
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    setInterval(function () { if (V && modo() === 'online' && !document.hidden) hacerSync(); }, 5 * 60000);
  }
  iniciar();
})();
