/* Hucha · aplicación */
(function () {
  'use strict';
  var C = HuchaCore, CH = HuchaCharts;
  var VERSION = '1.13.0';
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  var DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var TIPOS_CUENTA = { diario: 'Día a día', efectivo: 'Día a día', pocket: 'Día a día', ahorro: 'Ahorro e inversión', inversion: 'Ahorro e inversión', pension: 'Ahorro e inversión', credito: 'Tarjetas de crédito' };
  var IK = HuchaIconos;
  var ICONO_CUENTA = { diario: 'bank', efectivo: 'cash', pocket: 'jar', ahorro: 'piggy', inversion: 'chart', pension: 'shield', credito: 'card' };
  function icoCuenta(tipo) { return IK.svg(ICONO_CUENTA[tipo] || 'bank'); }
  function ico(n) { return IK.svg(n); }

  // ---------------------------------------------------------------- utilidades
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(x) { return C.fmt(x); }
  /** Importe grande con los céntimos en pequeño: 412<small>,80 €</small> */
  function fmtGrande(x) { var t = C.fmt(x), i = t.lastIndexOf(','); return i < 0 ? esc(t) : esc(t.slice(0, i)) + '<small>' + esc(t.slice(i)) + '</small>'; }
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

  var sesion = { url: '', clave: '' }, llave = null, caja = null, seguridad = null, servidorVersion = 0;
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
    var k = llave, meta = caja, datos = { url: sesion.url, clave: sesion.clave, snapshot: snapshot, queue: queue, ultimoSync: sync.ultimo, servidorVersion: servidorVersion };
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
      snapshot = j.estado; queue = queue.slice(enviadas); seguridad = j.seguridad || null; servidorVersion = j.version || 1;
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
  function topbar(titulo) {
    return '<div class="topbar"><h1>' + titulo + '</h1><div class="inline" style="gap:6px">' + pillHTML() +
      (ui.tab === 'ajustes' ? '' : '<button class="iconbtn" data-act="ir" data-id="ajustes" aria-label="Ajustes"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>') +
      '</div></div>';
  }
  function puedeDeudas() { return modo() === 'demo' || servidorVersion >= 3; }
  function pillHTML() { var e = estadoTexto(); return '<button class="pill ' + e.cls + '" data-act="sync" id="pill"><span class="dot"></span>' + e.txt + '</button>'; }
  function pintarEstado() { var p = $('#pill'); if (p) p.outerHTML = pillHTML(); }

  // ---------------------------------------------------------------- consultas
  function cuenta(id) { return (V.cuentas || []).filter(function (c) { return c.id === id; })[0]; }
  function nombreCuenta(id) { var c = cuenta(id); return c ? c.nombre : (id || '—'); }
  function iconoCat(cat) {
    var c = (V.categorias || []).filter(function (x) { return x.cat === cat && !x.sub; })[0];
    if (!c && cat === C.REDONDEOS) return IK.svg('jar');
    return IK.svg(c && c.icono ? c.icono : 'tag');
  }
  function cicloActual() { var cs = C.ciclos(V, hoy()); return cs[cs.length - 1]; }
  /** Traspasos de reposición (p. ej. Mac → Revolut) que tocan hoy o hace poco y aún no has marcado como hechos. */
  function traspasosPendientes(t) {
    var sob = V.config.cuentaSobrante, out = [], vistos = {};
    if (!sob) return out;
    (V.fijos || []).forEach(function (f) {
      if (!f.financiaDesde || f.financiaDesde === sob || f.activo === false) return;
      // Ya registrados por el servidor en los últimos 3 días
      V.movimientos.forEach(function (m) {
        if (m.id.indexOf('f-' + f.id + '-') !== 0 || m.id.slice(-7) !== '-repone') return;
        if (m.fecha > t || C.diffDays(m.fecha, t) > 3) return;
        vistos[m.id] = true;
        out.push({ id: m.id, fecha: m.fecha, concepto: f.concepto, importe: m.importe, desde: m.cuenta, hacia: m.destino });
      });
      // Si hoy toca y el servidor aún no lo ha apuntado
      if (f.proxima && f.proxima <= t && C.diffDays(f.proxima, t) <= 3) {
        var id = 'f-' + f.id + '-' + f.proxima + '-repone';
        if (!vistos[id]) out.push({ id: id, fecha: f.proxima, concepto: f.concepto, importe: C.num(f.importe), desde: f.financiaDesde, hacia: sob });
      }
    });
    return out.filter(function (x) { return !LS.get('traspasoHecho.' + x.id, false); });
  }

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
    var html = ui.tab === 'movimientos' ? vistaMovimientos() : ui.tab === 'estadisticas' ? vistaEstadisticas() : ui.tab === 'ajustes' ? vistaAjustes() : ui.tab === 'deudas' ? vistaDeudas() : vistaInicio();
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
    var al = C.alertas(p), nom = nominaPendienteDeReparto();
    var deudores = C.deudas(V).filter(function (d) { return d.pendiente > 0.004; }), meDeben = C.totalMeDeben(V);
    var h = topbar('Hucha');

    if (nom) h += '<div class="alert info"><span class="ico">€</span><div class="grow">Has cobrado la nómina. ¿Repartimos el sobrante?<div style="margin-top:8px"><button class="btn small primary" data-act="reparto" data-id="' + esc(nom.id) + '">Repartir</button> <button class="btn small" data-act="reparto-no" data-id="' + esc(nom.id) + '">Ya lo hice</button></div></div></div>';
    traspasosPendientes(t).forEach(function (x) {
      h += '<div class="alert info"><span class="ico">!</span><div class="grow">' + (x.fecha === t ? 'Hoy' : 'El ' + fCorta(x.fecha)) + ' se cobra «' + esc(x.concepto) + '»: pasa <b>' + fmt(x.importe) + '</b> de ' + esc(nombreCuenta(x.desde)) + ' a ' + esc(nombreCuenta(x.hacia)) + ' en tu banco. La app ya lo ha apuntado.' +
        '<div style="margin-top:8px"><button class="btn small primary" data-act="traspaso-ok" data-id="' + esc(x.id) + '">Hecho</button></div></div></div>';
    });
    var anteriores = C.fijosAnteriores(V, ciclo);
    if (anteriores.length) {
      h += '<div class="alert info"><span class="ico">!</span><div class="grow">Hay ' + anteriores.length + ' cargo(s) fijo(s) de este ciclo anteriores a que empezaras a usar Hucha: ' +
        esc(anteriores.map(function (m) { return m.nota + ' (' + fCorta(m.fecha) + ')'; }).join(', ')) + '. Apúntalos para que el presupuesto cuadre; no cambian tus saldos.' +
        '<div style="margin-top:8px"><button class="btn small primary" data-act="fijos-anteriores">Apuntarlos</button></div></div></div>';
    }
    if (sync.estado === 'err' && modo() === 'online') al.unshift({ nivel: 'critical', texto: 'Sincronización: ' + sync.error });
    // Aviso de intentos fallidos: solo los NUEVOS desde la última vez que lo marcaste como visto.
    if (seguridad && seguridad.ultimo && seguridad.ultimo > LS.get('fallosVistos', 0)) {
      h += '<div class="alert critical"><span class="ico">!</span><div class="grow">Intento de acceso a tu hoja con una clave incorrecta (último: ' + esc(new Date(seguridad.ultimo).toLocaleString('es-ES')) + '). Si no fuiste tú, cambia la clave secreta desde el menú Hucha de la hoja.' +
        '<div style="margin-top:8px"><button class="btn small" data-act="fallos-ok" data-id="' + seguridad.ultimo + '">Fui yo / Entendido</button></div></div></div>';
    }
    if (modo() === 'online' && !caja) al.unshift({ nivel: 'serious', texto: 'Este dispositivo aún no está protegido. Ve a Ajustes → Seguridad.' });

    var pct = Math.max(0, p.pct), cls = pct >= 1 ? 'critical' : pct >= 0.8 ? 'serious' : '';
    h += '<div class="card hero-card">' +
      '<div class="row small sec"><span>Ciclo ' + fCorta(ciclo.inicio) + ' → ' + fCorta(ciclo.fin) + (ciclo.estimado ? '*' : '') + '</span><span>día ' + p.transcurridos + ' de ' + p.dias + '</span></div>' +
      '<div class="hero-label" style="margin-top:10px">' + (p.restante >= 0 ? 'Te quedan para gastar' : 'Te has pasado') + '</div>' +
      '<div class="hero num' + (p.restante < 0 ? ' neg' : '') + '">' + fmtGrande(Math.abs(p.restante)) + '</div>' +
      '<div class="sec">' + (p.restante > 0 ? '≈ <b>' + fmt(p.porDia) + '</b> al día durante ' + p.diasRestantes + ' días' : 'Intenta no gastar más hasta la nómina') + '</div>' +
      '<div class="bar" role="progressbar" aria-valuenow="' + Math.round(pct * 100) + '" aria-valuemin="0" aria-valuemax="100"><div class="fill ' + cls + '" style="width:' + Math.min(100, pct * 100) + '%"></div><div class="mark" style="left:calc(' + (p.ritmo * 100) + '% - 1px)" title="Ritmo ideal"></div></div>' +
      '<div class="row small"><span class="sec">Gastado <b class="num">' + fmt(p.gastado) + '</b> de ' + fmt(p.disponible) + '</span><span class="muted">▏ritmo ideal ' + Math.round(p.ritmo * 100) + ' %</span></div>' +
      '<details><summary>¿De dónde sale?</summary><ul class="list small" style="margin-top:6px">' +
      '<li><span class="grow">Nómina' + (p.nominaEstimada ? ' (estimada)' : '') + '</span><span class="amount">' + fmt(p.nomina) + '</span></li>' +
      (p.extras ? '<li><span class="grow">Otros ingresos</span><span class="amount">+' + fmt(p.extras) + '</span></li>' +
        p.lineasExtras.map(function (l) { return '<li style="padding:4px 0 4px 12px"><span class="grow muted">' + esc(l.concepto) + (l.concepto.indexOf('Efectivo ingresado') === 0 ? '' : ' · ' + fCorta(l.fecha)) + '</span><span class="muted num">' + fmt(l.importe) + '</span></li>'; }).join('') : '') +
      '<li><span class="grow">Gastos fijos del ciclo</span><span class="amount">−' + fmt(p.fijos) + '</span></li>' +
      p.lineasFijos.map(function (l) { return '<li style="padding:4px 0 4px 12px"><span class="grow muted">' + esc(l.concepto) + ' · ' + fCorta(l.fecha) + (l.pagado ? ' ✓' : '') + '</span><span class="muted num">' + fmt(l.importe) + '</span></li>'; }).join('') +
      '<li><span class="grow">Objetivo de ahorro (' + p.ahorroPct + ' %' + (p.extras ? ' de ' + fmt(p.base) : '') + ')</span><span class="amount">−' + fmt(p.ahorroObjetivo) + '</span></li>' +
      '<li><span class="grow"><b>Para gastar</b></span><span class="amount">' + fmt(p.disponible) + '</span></li></ul>' +
      (ciclo.estimado ? '<p class="small muted">* El ciclo termina cuando registres la próxima nómina.</p>' : '') + '</details>' +
      '</div>';

    al.forEach(function (a) { h += '<div class="alert ' + a.nivel + '"><span class="ico">' + (a.nivel === 'warning' ? '!' : a.nivel === 'serious' ? '!' : '×') + '</span><div>' + esc(a.texto) + '</div></div>'; });

    // Ahorro: desglose del saldo real de la cuenta diaria
    var ar = C.ahorroReal(V, p, t), obj = p.ahorroObjetivo;
    if (ar) {
      var aho = ar.ahorro, rr = obj > 0 ? Math.max(0, Math.min(1, aho / obj)) : 0, okObj = aho >= obj - 0.5;
      var inv = C.r2(Math.max(0, aho) * p.repartoInversion / 100), rem = C.r2(Math.max(0, aho) - inv);
      h += '<div class="card"><h2>Ahorro de este ciclo<span class="right muted">objetivo ' + fmt(obj) + '</span></h2>' +
        '<div class="row"><div><div class="hero-label">Al cobrar podrás repartir</div>' +
        '<div style="font-size:30px;font-weight:600;letter-spacing:-.02em" class="num">' + fmtGrande(aho) + '</div></div>' +
        '<div class="small ' + (okObj ? 'amount pos' : 'muted') + '">' + (okObj ? '✓ objetivo' : Math.round(rr * 100) + ' % del objetivo') + '</div></div>' +
        '<div class="bar thin"><div class="fill ' + (okObj ? 'good' : 'serious') + '" style="width:' + (rr * 100) + '%"></div></div>' +
        '<p class="small muted" style="margin:6px 0 4px">Si gastas exactamente lo que te queda. Sale de tu saldo real de ' + esc(nombreCuenta(ar.cuenta)) + ':</p>' +
        '<ul class="list small">' +
        '<li><span class="grow sec">' + esc(nombreCuenta(ar.cuenta)) + ' hoy</span><span class="amount num">' + fmt(ar.saldo) + '</span></li>' +
        (ar.efectivo ? '<li><span class="grow sec">' + (ar.efectivo > 0 ? '+ Efectivo que te ha entrado' : '− Efectivo gastado') + ' este ciclo</span><span class="amount num">' + (ar.efectivo > 0 ? '+' : '−') + fmt(Math.abs(ar.efectivo)) + '</span></li>' : '') +
        (ar.deuda ? '<li><span class="grow sec">− Tarjeta de crédito, se paga el día 1' +
          '<div class="subline">' + (ar.deudaActual ? 'debes ' + fmt(ar.deudaActual) : 'no debes nada aún') +
          (ar.cargosTarjeta.length ? ' + aún se cargarán ' + esc(ar.cargosTarjeta.map(function (c) { return c.concepto + ' ' + C.fmt(c.importe); }).join(', ')) : '') +
          '</div></span><span class="amount num">−' + fmt(ar.deuda) + '</span></li>' : '') +
        (ar.pendientes ? '<li><span class="grow sec">− Fijos que aún saldrán de ' + esc(nombreCuenta(ar.cuenta)) + '</span><span class="amount num">' + (ar.pendientes > 0 ? '−' : '+') + fmt(Math.abs(ar.pendientes)) + '</span></li>' : '') +
        '<li><span class="grow sec">− Lo que te queda para gastar</span><span class="amount num">−' + fmt(ar.queda) + '</span></li>' +
        '<li><span class="grow"><b>= Ahorro</b> → Inversión ' + p.repartoInversion + ' % · Remunerada ' + (100 - p.repartoInversion) + ' %</span><span class="amount num">' + fmt(inv) + ' · ' + fmt(rem) + '</span></li>' +
        '</ul>' +
        (!okObj && aho < obj - 5 ? '<p class="small" style="color:var(--warning);margin:6px 0 0">Te faltan ' + fmt(obj - aho) + ' para el objetivo. Suele ser un gasto sin apuntar o un pago del mes anterior (p. ej. la tarjeta) hecho con esta nómina.</p>' : '') +
        '</div>';
    }

    if (meDeben > 0) {
      h += '<button class="card debts-card" data-act="ir" data-id="deudas"><span class="inline" style="gap:10px">' + ico('users') + ' Te ' + (deudores.length === 1 ? 'debe ' + esc(deudores[0].persona) : 'deben ' + deudores.length + ' personas') + '</span><b class="amount pos num">' + fmt(meDeben) + '</b><span class="muted">›</span></button>';
    }

    // Categorías
    var cats = p.categorias.filter(function (c) { return c.presupuesto > 0 || c.gastado !== 0; })
      .sort(function (a, b) { return (b.gastado / (b.presupuesto || 1)) - (a.gastado / (a.presupuesto || 1)); });
    if (cats.length) {
      h += '<div class="card"><h2>Por categoría</h2>' + cats.map(function (c) {
        var rr = c.presupuesto > 0 ? c.gastado / c.presupuesto : (c.gastado > 0 ? 1 : 0);
        var k = rr >= 1 ? 'critical' : rr >= 0.8 ? 'serious' : '';
        return '<div class="catrow"><div class="row"><span class="catname">' + IK.svg(c.icono || (c.cat === C.REDONDEOS ? 'jar' : 'tag')) + esc(c.cat) + '</span><span class="num sec">' + fmt(c.gastado) + (c.presupuesto ? ' <span class="muted">/ ' + fmt(c.presupuesto) + '</span>' : '') + '</span></div>' +
          (c.presupuesto ? '<div class="bar thin"><div class="fill ' + k + '" style="width:' + Math.min(100, Math.max(0, rr) * 100) + '%"></div><div class="mark" style="left:calc(' + (p.ritmo * 100) + '% - 1px)"></div></div>' : '') + '</div>';
      }).join('') + '</div>';
    }

    // Próximos cargos
    var prox = [];
    (V.fijos || []).forEach(function (f) {
      C.ocurrencias(f, t, C.addDays(t, 10)).forEach(function (d) {
        prox.push({ f: f, d: d });
        if (f.financiaDesde && V.config.cuentaSobrante && f.financiaDesde !== V.config.cuentaSobrante) {
          prox.push({ f: { tipo: 'transferencia', concepto: 'Pasar de ' + nombreCuenta(f.financiaDesde) + ' a ' + nombreCuenta(V.config.cuentaSobrante) + ' (hazlo tú)', importe: f.importe, cuenta: f.financiaDesde, destino: V.config.cuentaSobrante }, d: d });
        }
      });
    });
    prox.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    if (prox.length) {
      h += '<div class="card"><h2>Próximos 10 días</h2><ul class="list">' + prox.map(function (x) {
        var signo = x.f.tipo === 'ingreso' ? '+' : x.f.tipo === 'transferencia' ? '' : '−';
        var imp = x.f.modo === 'liquidar' ? 'saldo tarjeta' : signo + fmt(x.f.importe);
        return '<li><span class="avatar">' + (x.f.tipo === 'transferencia' ? ico('transfer') : x.f.tipo === 'ingreso' ? ico('arrowIn') : iconoCat(x.f.cat)) + '</span><div class="grow"><div class="title">' + esc(x.f.concepto) + '</div><div class="subline">' + fLarga(x.d) + ' · ' + esc(nombreCuenta(x.f.cuenta)) + (x.f.destino ? ' → ' + esc(nombreCuenta(x.f.destino)) : '') + '</div></div><span class="amount ' + (x.f.tipo === 'ingreso' ? 'pos' : x.f.tipo === 'transferencia' ? 'tr' : 'neg') + '">' + imp + '</span></li>';
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
        return '<li class="tap" data-act="cuenta" data-id="' + esc(c.id) + '"><span class="avatar">' + icoCuenta(c.tipo) + '</span><div class="grow"><div class="title">' + esc(c.nombre) + '</div>' + (extra ? '<div class="subline">' + extra + '</div>' : '') + '</div><span class="amount num' + ((s[c.id] || 0) < 0 ? ' neg' : '') + '">' + fmt(s[c.id] || 0) + '</span></li>';
      }).join('') + '</ul>';
    });
    h += '</div>';
    return h;
  }

  // ---------- Movimientos ----------
  function filaMov(m, hijos) {
    var tipo = m.tipo, icon, titulo, sub = [], cls, imp;
    if (tipo === 'transferencia') { icon = ico('transfer'); titulo = m.nota || 'Transferencia'; sub.push(esc(nombreCuenta(m.cuenta)) + ' → ' + esc(nombreCuenta(m.destino))); cls = 'tr'; imp = fmt(m.importe); }
    else if (tipo === 'ajuste') { icon = ico('scale'); titulo = 'Ajuste de saldo'; sub.push(esc(nombreCuenta(m.cuenta))); cls = m.importe >= 0 ? 'pos' : ''; imp = (m.importe >= 0 ? '+' : '') + fmt(m.importe); }
    else if (tipo === 'ingreso') {
      icon = ico(m.nomina ? 'briefcase' : m.origen === 'interes' ? 'chart' : m.pagaDeuda ? 'handcoins' : m.reembolso ? 'undo' : 'arrowIn');
      titulo = m.nomina ? 'Nómina' : (m.sub || m.cat || 'Ingreso'); if (m.reembolso) titulo = 'Reembolso' + (m.sub ? ' · ' + m.sub : '');
      if (m.pagaDeuda) titulo = 'Pago de ' + m.pagaDeuda;
      sub.push(esc(nombreCuenta(m.cuenta))); if (m.nota && m.nota !== titulo) sub.push(esc(m.nota)); cls = 'pos'; imp = '+' + fmt(m.importe);
    } else {
      icon = iconoCat(m.cat); titulo = m.sub || m.cat || 'Gasto'; sub.push(esc(nombreCuenta(m.cuenta))); if (m.nota) sub.push(esc(m.nota)); cls = 'neg'; imp = '−' + fmt(m.importe);
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
    return topbar('Movimientos') +
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
    var h = topbar('Estadísticas');
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
      return '<div class="catrow" data-tip="' + esc(c.cat + '\n' + fmt(c.v) + ' · ' + Math.round(c.v / s.gastos * 100) + ' % del gasto') + '"><div class="row small"><span class="catname">' + iconoCat(c.cat) + esc(c.cat || 'Sin categoría') + '</span><span class="num sec">' + fmt(c.v) + '</span></div><div class="bar thin"><div class="fill" style="width:' + (c.v / max * 100) + '%"></div></div></div>';
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

  // ---------- Categorías ----------
  var ICONOS_CAT = HuchaIconos.ELEGIBLES;
  var SUBS_FIJAS = ['Nómina', 'Intereses'];
  function abrirCategoria(nombre, tipo) {
    var nuevo = !nombre;
    var cab = nuevo ? null : (V.categorias || []).filter(function (c) { return c.cat === nombre && c.tipo === tipo && !c.sub; })[0];
    var st = {
      tipo: tipo || 'gasto', antes: nombre || '', cat: nombre || '', icono: cab ? (IK.clave(cab.icono) || cab.icono || 'tag') : 'tag',
      presupuesto: cab && cab.presupuesto !== '' && cab.presupuesto != null ? String(cab.presupuesto).replace('.', ',') : '',
      subs: nuevo ? [] : subsDe(nombre).map(function (sb) { return { antes: sb, nombre: sb }; })
    };
    var esIngresos = st.antes === 'Ingresos';
    function pintar() {
      var h = '<h3>' + (nuevo ? 'Nueva categoría' : 'Editar categoría') + '</h3>';
      if (nuevo) h += '<div class="seg"><button data-c="tipo" data-v="gasto" class="' + (st.tipo === 'gasto' ? 'on' : '') + '">De gasto</button><button data-c="tipo" data-v="ingreso" class="' + (st.tipo === 'ingreso' ? 'on' : '') + '">De ingreso</button></div>';
      h += '<label class="field" style="margin-top:8px"><span>Nombre</span><input class="input" data-c="cat" maxlength="40" value="' + esc(st.cat) + '"' + (esIngresos ? ' disabled' : '') + '></label>';
      h += '<div class="small sec">Icono</div><div class="icongrid">' + ICONOS_CAT.map(function (k) { return '<button class="iconpick' + (IK.clave(st.icono) === k ? ' on' : '') + '" data-c="emoji" data-v="' + k + '" aria-label="' + k + '">' + IK.svg(k) + '</button>'; }).join('') + '</div>';
      if (st.tipo === 'gasto') h += '<label class="field"><span>Presupuesto mensual (gastos variables)</span><input class="input num" data-c="presupuesto" inputmode="decimal" placeholder="sin límite" value="' + esc(st.presupuesto) + '"></label>';
      h += '<div class="small sec" style="margin-top:10px">Subcategorías</div>';
      st.subs.forEach(function (sb, i) {
        var fija = esIngresos && SUBS_FIJAS.indexOf(sb.antes) >= 0;
        h += '<div class="inline" style="margin-top:6px"><input class="input" data-s="' + i + '" maxlength="40" value="' + esc(sb.nombre) + '"' + (fija ? ' disabled' : '') + '>' +
          (fija ? '<span class="small muted" style="width:44px;text-align:center">' + ico('lock') + '</span>' : '<button class="btn small" data-c="quitar" data-v="' + i + '" aria-label="Quitar">✕</button>') + '</div>';
      });
      h += '<button class="btn small" data-c="add" style="margin-top:8px">＋ Añadir subcategoría</button>';
      if (!nuevo) h += '<p class="small muted">Si cambias un nombre, se cambia también en los movimientos y gastos fijos que ya lo usan.</p>';
      h += '<p class="small" id="c-err" style="color:var(--critical)"></p>';
      h += '<div class="sheet-actions">' + (nuevo || esIngresos ? '<button class="btn" data-c="cancelar">Cancelar</button>' : '<button class="btn danger" data-c="borrar">Borrar</button>') + '<button class="btn primary" data-c="guardar">Guardar</button></div>';
      $('.sheet-body', hoja).innerHTML = h;
    }
    function guardar() {
      var err = $('#c-err', hoja), nom = st.cat.trim();
      var subs = st.subs.map(function (sb) { return { antes: sb.antes, nombre: sb.nombre.trim() }; }).filter(function (sb) { return sb.nombre || sb.antes; });
      var otras = catsDe(st.tipo).filter(function (c) { return c.cat !== st.antes; }).map(function (c) { return c.cat.toLowerCase(); });
      var nombresSub = subs.map(function (sb) { return sb.nombre.toLowerCase(); });
      var fallo = !nom ? 'Pon un nombre.'
        : otras.indexOf(nom.toLowerCase()) >= 0 ? 'Ya hay una categoría con ese nombre.'
        : subs.some(function (sb) { return !sb.nombre; }) ? 'Hay una subcategoría sin nombre (quítala con ✕).'
        : nombresSub.some(function (n, i) { return nombresSub.indexOf(n) !== i; }) ? 'Hay subcategorías repetidas.'
        : st.presupuesto.trim() && !(C.num(st.presupuesto) >= 0) ? 'El presupuesto no es válido.' : '';
      if (fallo) { err.textContent = fallo; return; }
      cerrarHoja();
      commit([{ op: 'categoria', tipo: st.tipo, antes: st.antes, cat: nom, icono: st.icono.trim(), presupuesto: st.tipo === 'gasto' && st.presupuesto.trim() ? C.r2(C.num(st.presupuesto)) : '', subs: subs }]);
      toast(nuevo ? 'Categoría creada' : 'Categoría guardada');
    }
    abrirHoja('', function (el) {
      pintar();
      el.addEventListener('input', function (e) {
        var t = e.target;
        if (t.dataset.s !== undefined) st.subs[+t.dataset.s].nombre = t.value;
        else if (t.dataset.c) st[t.dataset.c] = t.value;
      });
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-c]'); if (!b || b.tagName === 'INPUT') return;
        var k = b.dataset.c, v = b.dataset.v;
        if (k === 'guardar') return guardar();
        if (k === 'cancelar') return cerrarHoja();
        if (k === 'borrar') {
          var usos = V.movimientos.filter(function (m) { return m.cat === st.antes; }).length + (V.fijos || []).filter(function (f) { return f.cat === st.antes; }).length;
          if (confirm('¿Borrar «' + st.antes + '»?' + (usos ? ' Hay ' + usos + ' movimiento(s) o fijo(s) que la usan: conservarán el nombre y seguirán en las estadísticas.' : ''))) {
            cerrarHoja(); commit([{ op: 'borrarCategoria', cat: st.antes, tipo: st.tipo }]); toast('Categoría borrada');
          }
          return;
        }
        if (k === 'tipo') st.tipo = v;
        else if (k === 'emoji') st.icono = v;
        else if (k === 'add') st.subs.push({ antes: '', nombre: '' });
        else if (k === 'quitar') st.subs.splice(+v, 1);
        pintar();
        if (k === 'add') { var ins = hoja.querySelectorAll('[data-s]'); if (ins.length) ins[ins.length - 1].focus(); }
      });
    });
  }

  // ---------- Deudas ----------
  function vistaDeudas() {
    var h = topbar('Deudas');
    var ds = C.deudas(V), activos = ds.filter(function (d) { return d.pendiente > 0.004; }), saldados = ds.filter(function (d) { return d.pendiente <= 0.004; });
    var total = C.totalMeDeben(V);
    if (!puedeDeudas()) h += '<div class="alert serious"><span class="ico">!</span><div>Para repartir gastos entre personas, actualiza el Apps Script (te lo explico en el chat). Mientras, aquí ves los gastos compartidos antiguos.</div></div>';
    h += '<div class="card hero-card"><div class="hero-label">Te deben en total</div><div class="hero num" style="font-size:40px">' + fmtGrande(total) + '</div>' +
      '<p class="small muted" style="margin:4px 0 0">Cuando te paguen: ＋ → Ingreso → «Salda una deuda», o toca la persona y pulsa «Me ha pagado».</p></div>';
    h += '<div class="card"><h2>Me deben</h2>' + (activos.length ? '<ul class="list">' + activos.map(function (d) {
      var p = d.items[0], mas = d.items.length - 1;
      var info = p ? esc(p.deuda.concepto || 'Gasto compartido') + ' · ' + fCorta(p.deuda.fecha) + (mas > 0 ? ' y ' + mas + ' más' : '') : '';
      if (d.pagado > 0) info += ' · ya pagó ' + fmt(d.pagado);
      return '<li class="tap" data-act="persona" data-id="' + esc(d.persona) + '"><span class="avatar">' + ico(d.persona === C.SIN_ASIGNAR ? 'question' : 'user') + '</span><div class="grow"><div class="title">' + esc(d.persona) + '</div><div class="subline">' + info + '</div></div><span class="amount pos">' + fmt(d.pendiente) + '</span><span class="muted">›</span></li>';
    }).join('') + '</ul>' : '<div class="empty-state">Nadie te debe nada</div>') + '</div>';

    var debo = (V.debo || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
    var totalDebo = debo.reduce(function (a, d) { return a + C.num(d.importe); }, 0);
    h += '<div class="card"><h2>Debo<span class="right">' + (totalDebo ? fmt(totalDebo) : 'Recordatorio') + '</span></h2>' +
      (debo.length ? '<ul class="list">' + debo.map(function (d) {
        return '<li><span class="avatar">' + ico('receipt') + '</span><div class="grow tap" data-act="debo" data-id="' + esc(d.id) + '"><div class="title">A ' + esc(d.persona) + '</div><div class="subline">' + esc(d.concepto || '') + (d.concepto ? ' · ' : '') + fCorta(d.fecha) + '</div></div>' +
          (d.importe !== '' && d.importe != null ? '<span class="amount neg">' + fmt(d.importe) + '</span>' : '') +
          '<button class="btn small" data-act="debo-ok" data-id="' + esc(d.id) + '">Pagado</button></li>';
      }).join('') + '</ul>' : '<p class="small muted" style="margin-top:0">Apunta aquí lo que debes tú, para no olvidarte. No afecta a tus saldos.</p>') +
      '<button class="btn block" data-act="debo-nuevo" style="margin-top:8px">＋ Añadir lo que debo</button></div>';

    if (saldados.length) {
      h += '<div class="card"><h2>Saldadas</h2><ul class="list">' + saldados.map(function (d) {
        return '<li class="tap" data-act="persona" data-id="' + esc(d.persona) + '"><span class="avatar">' + ico('check') + '</span><div class="grow"><div class="title">' + esc(d.persona) + '</div><div class="subline">Te pagó ' + fmt(d.pagado) + ' en total</div></div><span class="muted">›</span></li>';
      }).join('') + '</ul></div>';
    }
    return h;
  }

  function abrirPersona(nombre) {
    var d = C.deudas(V).filter(function (x) { return C.clavePersona(x.persona) === C.clavePersona(nombre); })[0];
    if (!d) return;
    var h = '<h3 class="catname">' + ico('user') + esc(d.persona) + '</h3>' +
      '<div class="hero num" style="font-size:32px;color:' + (d.pendiente > 0 ? 'var(--pos-text)' : 'var(--text)') + '">' + fmt(Math.max(0, d.pendiente)) + '</div>' +
      '<p class="small muted" style="margin-top:0">' + (d.pendiente > 0 ? 'te debe' : 'está al día') + ' · total ' + fmt(d.total) + ' · pagado ' + fmt(d.pagado) + '</p>';
    if (d.pendiente > 0 && d.persona !== C.SIN_ASIGNAR) h += '<button class="btn primary block" id="p-pago">Me ha pagado</button>';
    h += '<div class="group-title" style="margin-top:14px">Gastos compartidos</div><ul class="list">' + d.deudas.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).map(function (x) {
      var it = d.items.filter(function (i) { return i.deuda.id === x.id; })[0];
      return '<li class="tap" data-mov="' + esc(x.movId) + '"><div class="grow"><div class="title">' + esc(x.concepto || 'Gasto compartido') + '</div><div class="subline">' + fCorta(x.fecha) + (it ? ' · pendiente ' + fmt(it.restante) : ' · pagado ✓') + '</div></div><span class="amount">' + fmt(x.importe) + '</span></li>';
    }).join('') + '</ul>';
    if (d.pagos.length) {
      h += '<div class="group-title">Pagos recibidos</div><ul class="list">' + d.pagos.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }).map(function (m) {
        return '<li class="tap" data-mov="' + esc(m.id) + '"><span class="avatar">' + ico('handcoins') + '</span><div class="grow"><div class="title">' + fLarga(m.fecha) + '</div><div class="subline">' + esc(nombreCuenta(m.cuenta)) + (m.nota ? ' · ' + esc(m.nota) : '') + '</div></div><span class="amount pos">+' + fmt(m.importe) + '</span></li>';
      }).join('') + '</ul>';
    }
    abrirHoja(h, function (el) {
      var b = $('#p-pago', el);
      if (b) b.addEventListener('click', function () {
        cerrarHoja();
        abrirMovimiento(null, { tipo: 'ingreso', saldaOn: true, pagaDeuda: d.persona, importe: String(d.pendiente).replace('.', ','), cuenta: V.config.cuentaDefecto || V.cuentas[0].id, debito: false });
      });
      el.addEventListener('click', function (e) {
        var li = e.target.closest('[data-mov]'); if (!li) return;
        var m = V.movimientos.filter(function (x) { return x.id === li.dataset.mov; })[0];
        if (m) { cerrarHoja(); abrirMovimiento(m); }
      });
    });
  }

  function abrirDebo(debo) {
    var nuevo = !debo, d = debo ? clone(debo) : { id: 'b' + C.uid(), persona: '', concepto: '', importe: '', fecha: hoy() };
    var h = '<h3>' + (nuevo ? 'Apuntar lo que debo' : 'Lo que debo') + '</h3>' +
      '<label class="field"><span>¿A quién?</span><input class="input" id="b-persona" list="dl-personas2" maxlength="40" autocapitalize="words" value="' + esc(d.persona) + '"></label>' +
      '<datalist id="dl-personas2">' + C.personasConocidas(V).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>' +
      '<label class="field"><span>Concepto</span><input class="input" id="b-concepto" maxlength="120" value="' + esc(d.concepto) + '" placeholder="p. ej. entradas del concierto"></label>' +
      '<div class="inline"><label class="field"><span>Importe (opcional)</span><input class="input num" id="b-importe" inputmode="decimal" value="' + esc(d.importe === '' || d.importe == null ? '' : String(d.importe).replace('.', ',')) + '"></label>' +
      '<label class="field"><span>Fecha</span><input class="input" type="date" id="b-fecha" value="' + esc(d.fecha) + '"></label></div>' +
      '<p class="small" id="b-err" style="color:var(--critical)"></p>' +
      '<div class="sheet-actions">' + (nuevo ? '<button class="btn" id="b-cancelar">Cancelar</button>' : '<button class="btn danger" id="b-borrar">Borrar</button>') + '<button class="btn primary" id="b-ok">Guardar</button></div>';
    abrirHoja(h, function (el) {
      var c = $('#b-cancelar', el); if (c) c.addEventListener('click', function () { cerrarHoja(); });
      var br = $('#b-borrar', el); if (br) br.addEventListener('click', function () { if (confirm('¿Borrar este recordatorio?')) { cerrarHoja(); commit([{ op: 'borrarDebo', id: d.id }]); } });
      $('#b-ok', el).addEventListener('click', function () {
        var persona = $('#b-persona', el).value.trim(), imp = $('#b-importe', el).value.trim(), fecha = $('#b-fecha', el).value;
        if (!persona) { $('#b-err', el).textContent = 'Pon a quién se lo debes.'; return; }
        if (imp && !(C.num(imp) > 0)) { $('#b-err', el).textContent = 'El importe no es válido.'; return; }
        cerrarHoja();
        commit([{ op: 'debo', debo: { id: d.id, persona: persona, concepto: $('#b-concepto', el).value.trim(), importe: imp ? C.r2(C.num(imp)) : '', fecha: fecha || hoy() } }]);
        toast('Guardado');
      });
    });
  }

  // ---------- Ajustes ----------
  function vistaAjustes() {
    var cfg = V.config, ciclo = cicloActual(), p = C.presupuesto(V, ciclo, hoy());
    var sumCats = p.categorias.reduce(function (a, c) { return a + (c.presupuesto || 0); }, 0);
    var h = topbar('Ajustes');

    h += '<div class="card"><h2>Presupuesto y ahorro</h2>' +
      campoNum('ahorroPct', 'Objetivo de ahorro (% de la nómina)', cfg.ahorroPct) +
      campoNum('repartoInversion', '% del sobrante a inversión (resto a remunerada)', cfg.repartoInversion) +
      campoNum('sueldo', 'Sueldo de referencia (hasta registrar la nómina)', cfg.sueldo) +
      '<label class="field"><span>Inicio del primer ciclo (última nómina antes de usar la app)</span><input class="input" type="date" data-cfg="inicioCiclo" value="' + esc(cfg.inicioCiclo || '') + '"></label>' +
      '</div>';

    h += '<div class="card"><h2>Presupuesto por categoría<span class="right">' + fmt(sumCats) + ' de ' + fmt(p.disponible) + '</span></h2>' +
      '<p class="small muted" style="margin-top:0">Solo gastos variables: los fijos ya se descuentan aparte. ' + (sumCats > p.disponible ? '<b style="color:var(--critical)">La suma supera lo disponible.</b>' : 'Sin asignar: ' + fmt(p.disponible - sumCats) + '.') + '</p>' +
      p.categorias.filter(function (c) { return c.cat && c.cat !== C.REDONDEOS; }).map(function (c) {
        return '<label class="inline" style="margin:6px 0"><span class="catname" style="flex:1">' + IK.svg(c.icono || 'tag') + esc(c.cat) + '</span><input class="input num" style="max-width:120px;text-align:right" inputmode="decimal" data-pres="' + esc(c.cat) + '" value="' + (c.presupuesto ? String(c.presupuesto).replace('.', ',') : '') + '" placeholder="sin límite"></label>';
      }).join('') + '</div>';

    var editCats = modo() === 'demo' || servidorVersion >= 4;
    h += '<div class="card"><h2>Categorías' + (editCats ? '<span class="right"><button class="btn small" data-act="cat-nueva">＋ Nueva</button></span>' : '') + '</h2>';
    [['gasto', 'Gastos'], ['ingreso', 'Ingresos']].forEach(function (t) {
      h += '<div class="group-title">' + t[1] + '</div><ul class="list">' + catsDe(t[0]).map(function (c) {
        var subs = subsDe(c.cat);
        return '<li' + (editCats ? ' class="tap" data-act="cat" data-id="' + esc(c.cat) + '" data-tipo="' + t[0] + '"' : '') + '><span class="avatar">' + IK.svg(c.icono || 'tag') + '</span><div class="grow"><div class="title">' + esc(c.cat) + '</div><div class="subline">' + (subs.length ? esc(subs.join(' · ')) : 'sin subcategorías') + '</div></div>' + (editCats ? '<span class="muted">›</span>' : '') + '</li>';
      }).join('') + '</ul>';
    });
    h += (editCats ? '' : '<p class="small muted">Para editarlas desde aquí, actualiza el Apps Script (ver chat/README).</p>') + '</div>';

    h += '<div class="card"><h2>Cuentas</h2><ul class="list">' + V.cuentas.map(function (c) {
      return '<li class="tap" data-act="cuenta" data-id="' + esc(c.id) + '"><span class="avatar">' + icoCuenta(c.tipo) + '</span><div class="grow"><div class="title">' + esc(c.nombre) + '</div><div class="subline">ID ' + esc(c.id) + ' · ' + esc(c.tipo) + '</div></div><span class="muted">›</span></li>';
    }).join('') + '</ul><p class="small muted">Para crear o renombrar cuentas, edita la hoja «Cuentas».</p></div>';

    var editable = modo() === 'demo' || servidorVersion >= 2;
    var fijosOrd = (V.fijos || []).slice().sort(function (a, b) { return (a.activo === false) - (b.activo === false) || String(a.proxima).localeCompare(String(b.proxima)); });
    h += '<div class="card"><h2>Gastos fijos y automáticos' + (editable ? '<span class="right"><button class="btn small" data-act="fijo-nuevo">＋ Añadir</button></span>' : '') + '</h2><ul class="list">' + fijosOrd.map(function (f) {
      var frec = f.frecuencia === 'dias' ? 'cada ' + f.cada + ' días' : 'día ' + f.dia + ' de cada mes';
      var rest = f.restantes !== '' && f.restantes != null ? ' · quedan ' + f.restantes : '';
      return '<li' + (editable ? ' class="tap" data-act="fijo" data-id="' + esc(f.id) + '"' : '') + ' style="' + (f.activo === false ? 'opacity:.55' : '') + '"><div class="grow"><div class="title">' + esc(f.concepto) + (f.activo === false ? ' <span class="muted">(pausado)</span>' : '') + '</div><div class="subline">' + frec + rest + ' · próximo ' + (f.proxima ? fCorta(f.proxima) : '—') + ' · ' + esc(nombreCuenta(f.cuenta)) + (f.destino ? ' → ' + esc(nombreCuenta(f.destino)) : '') + '</div></div><span class="amount ' + (f.tipo === 'ingreso' ? 'pos' : f.tipo === 'transferencia' ? 'tr' : '') + '">' + (f.modo === 'liquidar' ? 'saldo' : fmt(f.importe)) + '</span>' + (editable ? '<span class="muted">›</span>' : '') + '</li>';
    }).join('') + '</ul><p class="small muted">' + (editable ? 'Se apuntan solos el día que toca. Toca uno para editarlo, pausarlo o borrarlo.' : 'Para añadirlos o editarlos desde aquí, actualiza el Apps Script (ver README). Mientras, se editan en la hoja «Fijos».') + '</p></div>';

    if (modo() === 'online') {
      h += '<div class="card"><h2>Seguridad</h2><p class="small sec" style="margin-top:0">' +
        (caja ? 'Los datos de este dispositivo están cifrados (AES-256). Se desbloquean con ' + ({ passkey: 'Face ID / huella', 'passkey-local': 'Face ID (modo compatible: llave no exportable guardada en el dispositivo)', password: 'tu contraseña' }[caja.metodo] || caja.metodo) + ' y se bloquean solos a los 30 s fuera de la app.' : '⚠️ Este dispositivo aún no está protegido: no se guarda nada hasta que lo protejas.') + '</p>' +
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
        (sync.estado === 'err' && queue.length ? '<button class="btn block danger" data-act="descartar-cola" style="margin-top:8px">Descartar ' + queue.length + ' cambio(s) sin enviar</button>' : '') +
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
    hoja.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-top"><div class="grab"></div>' +
      (fija ? '' : '<button class="sheet-close" aria-label="Cerrar">✕</button>') + '</div><div class="sheet-body">' + html + '</div></div>';
    if (!fija) {
      hoja.addEventListener('click', function (e) { if (e.target === hoja) cerrarHoja(); });
      $('.sheet-close', hoja).addEventListener('click', function (e) { e.stopPropagation(); cerrarHoja(true); });
      deslizarParaCerrar(hoja);
    }
    document.body.appendChild(hoja);
    document.body.style.overflow = 'hidden';
    if (onMount) onMount(hoja);
  }
  function cerrarHoja(animado) {
    var el = hoja;
    if (el) {
      hoja = null; form = null;
      if (animado) {
        var sh = $('.sheet', el);
        sh.style.transition = 'transform .2s ease-in'; sh.style.transform = 'translateY(100%)';
        el.style.transition = 'opacity .2s'; el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 200);
      } else el.remove();
    }
    document.body.style.overflow = '';
  }

  /** Gesto: arrastrar la hoja hacia abajo (desde arriba del todo) la cierra. */
  function deslizarParaCerrar(ov) {
    var sh = $('.sheet', ov), y0 = 0, x0 = 0, t0 = 0, dy = 0, estado = 0; // 0 nada · 1 pendiente · 2 arrastrando · -1 ignorar
    sh.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { estado = -1; return; }
      var enCabecera = !!e.target.closest('.sheet-top');
      estado = (sh.scrollTop <= 0 || enCabecera) ? 1 : -1;
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = Date.now(); dy = 0;
    }, { passive: true });
    sh.addEventListener('touchmove', function (e) {
      if (estado <= 0) return;
      var y = e.touches[0].clientY - y0, x = e.touches[0].clientX - x0;
      if (estado === 1) {
        if (Math.abs(y) < 6 && Math.abs(x) < 6) return;
        if (y <= 0 || Math.abs(x) > Math.abs(y)) { estado = -1; return; }
        estado = 2; sh.style.transition = 'none';
      }
      dy = Math.max(0, y);
      sh.style.transform = 'translateY(' + dy + 'px)';
      ov.style.backgroundColor = 'rgba(0,0,0,' + (0.35 * Math.max(0, 1 - dy / 400)) + ')';
      e.preventDefault();
    }, { passive: false });
    function fin() {
      if (estado !== 2) { estado = 0; return; }
      estado = 0;
      var v = dy / Math.max(1, Date.now() - t0);
      if (dy > 110 || (dy > 40 && v > 0.6)) { cerrarHoja(true); return; }
      sh.style.transition = 'transform .2s ease-out'; sh.style.transform = '';
      ov.style.backgroundColor = '';
    }
    sh.addEventListener('touchend', fin);
    sh.addEventListener('touchcancel', fin);
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
      debito: !!red, nomina: !!mov.nomina, reembolso: !!mov.reembolso, vinculado: mov.vinculado || '',
      pagaDeuda: mov.pagaDeuda || '', saldaOn: !!mov.pagaDeuda,
      personas: (V.deudas || []).filter(function (d) { return d.movId === mov.id; }).map(function (d) { return { nombre: d.persona, importe: String(d.importe).replace('.', ',') }; })
    } : Object.assign({
      id: null, tipo: 'gasto', importe: '', cuenta: def, destino: '', fecha: hoy(), cat: '', sub: '', nota: '',
      compartido: false, miParte: '', debito: !!(cuenta(def) && cuenta(def).redondeoA), nomina: false, reembolso: false, vinculado: '',
      pagaDeuda: '', saldaOn: false, personas: []
    }, preset || {});
    if (form.compartido && !form.personas.length && puedeDeudas() && !mov) form.personas.push({ nombre: '', importe: '' });
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
      if (f.compartido) {
        h += '<div class="shared">';
        h += '<label class="field"><span>Mi parte (lo que cuenta para el presupuesto)</span><input class="input num" inputmode="decimal" data-f="miParte" value="' + esc(f.miParte) + '" placeholder="p. ej. 20"></label>';
        if (puedeDeudas()) {
          h += '<div class="small sec">¿Quién te debe el resto?</div>';
          f.personas.forEach(function (pp, i) {
            h += '<div class="persona-row"><span class="muted">' + ico('user') + '</span><input class="input" data-p="' + i + '" data-pk="nombre" list="dl-personas" placeholder="Nombre" maxlength="40" autocapitalize="words" value="' + esc(pp.nombre) + '">' +
              '<input class="input num" data-p="' + i + '" data-pk="importe" inputmode="decimal" placeholder="0,00" value="' + esc(pp.importe) + '">' +
              '<button class="btn small" data-f="quitar-persona" data-v="' + i + '" aria-label="Quitar">✕</button></div>';
          });
          h += '<div class="inline" style="margin-top:6px"><button class="btn small" data-f="add-persona">＋ Añadir persona</button><button class="btn small" data-f="repartir">Repartir a partes iguales</button></div>';
          h += '<datalist id="dl-personas">' + C.personasConocidas(V).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
        } else h += '<p class="small muted">Para repartir entre personas, actualiza el Apps Script (ver chat/README).</p>';
        h += '</div>';
      }
    } else if (f.tipo === 'ingreso') {
      h += '<div class="switch"><span>Es la nómina</span><input type="checkbox" data-f="nomina"' + (f.nomina ? ' checked' : '') + '></div>';
      if (!f.nomina) {
        if (puedeDeudas()) h += '<div class="switch"><span>Salda una deuda <span class="muted small">(alguien te paga lo que te debía)</span></span><input type="checkbox" data-f="saldaOn"' + (f.saldaOn ? ' checked' : '') + '></div>';
        if (f.saldaOn) {
          var ds = C.deudas(V).filter(function (d) { return d.pendiente > 0.004 || C.clavePersona(d.persona) === C.clavePersona(f.pagaDeuda); });
          if (f.pagaDeuda && !ds.some(function (d) { return C.clavePersona(d.persona) === C.clavePersona(f.pagaDeuda); })) ds.unshift({ persona: f.pagaDeuda, pendiente: 0 });
          h += ds.length ? '<div class="small sec" style="margin-top:6px">¿Quién te paga?</div><div class="chips">' + ds.map(function (d) {
            return '<button class="chip' + (C.clavePersona(f.pagaDeuda) === C.clavePersona(d.persona) ? ' on' : '') + '" data-f="pagaDeuda" data-v="' + esc(d.persona) + '">' + esc(d.persona) + (d.pendiente > 0 ? ' · ' + fmt(d.pendiente) : '') + '</button>';
          }).join('') + '</div>' : '<p class="small muted">Nadie te debe nada ahora mismo.</p>';
        } else {
          h += '<div class="switch"><span>Es un reembolso <span class="muted small">(descuenta de una categoría)</span></span><input type="checkbox" data-f="reembolso"' + (f.reembolso ? ' checked' : '') + '></div>';
          h += f.reembolso ? gridCats('gasto') : gridCats('ingreso');
        }
      }
    } else if (f.tipo === 'ajuste') {
      h += '<div class="seg"><button data-f="signo" data-v="1" class="' + (f.signo > 0 ? 'on' : '') + '">Suma</button><button data-f="signo" data-v="-1" class="' + (f.signo < 0 ? 'on' : '') + '">Resta</button></div>';
    }
    h += '<input class="input" data-f="nota" placeholder="Nota (opcional)" value="' + esc(f.nota) + '" style="margin-top:8px;min-height:40px;padding:8px 12px">';
    h += '<div class="keypad">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map(function (k) { return '<button data-k="' + k + '" aria-label="' + (k === '⌫' ? 'Borrar' : k) + '">' + k + '</button>'; }).join('') + '</div>';
    h += '<div class="sheet-actions">' + (f.id ? '<button class="btn danger" data-f="borrar">Borrar</button>' : '<button class="btn" data-f="cancelar">Cancelar</button>') + '<button class="btn primary" data-f="guardar">Guardar</button></div>';
    $('.sheet-body', hoja).innerHTML = h;
    // Que la categoría elegida quede a la vista en la fila desplazable
    hoja.querySelectorAll('.chips').forEach(function (fila) {
      var on = fila.querySelector('.chip.on');
      if (on) fila.scrollLeft = on.offsetLeft - fila.offsetLeft - fila.clientWidth / 2 + on.offsetWidth / 2;
    });
    pintarHint();
  }

  function gridCats(tipo) {
    var f = form, h = '<div class="chips cats">' + catsDe(tipo).map(function (c) {
      return '<button class="chip' + (f.cat === c.cat ? ' on' : '') + '" data-f="cat" data-v="' + esc(c.cat) + '">' + IK.svg(c.icono || 'tag') + esc(c.cat) + '</button>';
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
    if (f.tipo === 'gasto' && f.debito && c && c.redondeoA && imp > 0) txt = '+' + fmt(C.redondeo(imp)) + ' → ' + nombreCuenta(c.redondeoA) + ' (redondeo, cuenta como gasto)';
    if (f.tipo === 'gasto' && f.compartido && imp > 0) {
      var otros = (f.personas || []).reduce(function (a, pp) { return a + C.num(pp.importe); }, 0), falta = C.r2(imp - C.num(f.miParte) - otros);
      txt += (txt ? ' · ' : '') + (puedeDeudas() && f.personas.length ? (Math.abs(falta) < 0.01 ? '✓ cuadra' : falta > 0 ? 'faltan ' + fmt(falta) + ' por asignar' : 'te pasas ' + fmt(-falta)) : 'te deberán ' + fmt(imp - C.num(f.miParte)));
    }
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
    var personas = f.tipo === 'gasto' && f.compartido && puedeDeudas() ? f.personas.filter(function (pp) { return pp.nombre.trim() || C.num(pp.importe) > 0; }) : [];
    if (personas.some(function (pp) { return !pp.nombre.trim() || !(C.num(pp.importe) > 0); })) { toast('Pon nombre e importe a cada persona'); return; }
    if (personas.length) {
      var suma = C.r2(C.num(f.miParte) + personas.reduce(function (a, pp) { return a + C.num(pp.importe); }, 0));
      if (Math.abs(suma - imp) >= 0.01) { toast('Tu parte + las personas suman ' + fmt(suma) + ', no ' + fmt(imp)); return; }
    }
    if (f.tipo === 'ingreso' && f.saldaOn && !f.pagaDeuda) { toast('Elige quién te paga'); return; }
    var id = f.id || C.uid(), orig = f.original || {};
    var salda = f.tipo === 'ingreso' && !f.nomina && f.saldaOn ? f.pagaDeuda : '';
    var mov = {
      id: id, fecha: f.fecha || hoy(), tipo: f.tipo, importe: f.tipo === 'ajuste' ? imp * f.signo : imp,
      cuenta: f.cuenta, destino: f.tipo === 'transferencia' ? f.destino : '',
      cat: f.tipo === 'transferencia' || f.tipo === 'ajuste' || salda ? '' : (f.tipo === 'ingreso' && f.nomina ? 'Ingresos' : (f.vinculado ? '' : f.cat)),
      sub: f.tipo === 'transferencia' || f.tipo === 'ajuste' || salda ? '' : (f.tipo === 'ingreso' && f.nomina ? 'Nómina' : (f.vinculado ? '' : f.sub)),
      nota: f.nota.trim(), miParte: f.tipo === 'gasto' && f.compartido ? C.r2(C.num(f.miParte)) : '',
      nomina: f.tipo === 'ingreso' && f.nomina, reembolso: f.tipo === 'ingreso' && !f.nomina && !salda && f.reembolso,
      vinculado: orig.vinculado && f.tipo === orig.tipo && !salda ? orig.vinculado : '',
      pagaDeuda: salda, origen: orig.origen || 'manual', act: Date.now()
    };
    var ops = [{ op: 'mov', mov: mov }];
    var teniaDeudas = (V.deudas || []).some(function (d) { return d.movId === id; });
    if (puedeDeudas() && (personas.length || teniaDeudas)) {
      ops.push({ op: 'deudas', movId: id, lista: personas.map(function (pp, i) {
        return { id: id + '-d' + i, movId: id, fecha: mov.fecha, persona: pp.nombre.trim(), importe: C.r2(C.num(pp.importe)), concepto: mov.nota || mov.sub || mov.cat };
      }) });
    }
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
    if (key === 'add-persona') { f.personas.push({ nombre: '', importe: '' }); pintarForm(); return; }
    if (key === 'quitar-persona') { f.personas.splice(+v, 1); pintarForm(); return; }
    if (key === 'repartir') {
      var tot = C.num(f.importe), n = f.personas.length || 1;
      if (!f.personas.length) f.personas.push({ nombre: '', importe: '' });
      if (!(tot > 0)) { toast('Escribe primero el importe total'); return; }
      var cada = C.r2(tot / (n + 1));
      f.personas.forEach(function (pp) { pp.importe = String(cada).replace('.', ','); });
      f.miParte = String(C.r2(tot - cada * n)).replace('.', ',');
      pintarForm(); return;
    }
    if (b.type === 'checkbox') {
      f[key] = b.checked;
      if (key === 'compartido' && b.checked && !f.personas.length && puedeDeudas()) f.personas.push({ nombre: '', importe: '' });
      if (key === 'saldaOn') { if (b.checked) { f.reembolso = false; f.cat = ''; f.sub = ''; } else f.pagaDeuda = ''; }
      if (key === 'reembolso' && !b.checked) { f.vinculado = ''; }
      if (key === 'reembolso' && b.checked) { f.cat = ''; f.sub = ''; }
      if (key === 'nomina' && b.checked) { f.cat = 'Ingresos'; f.sub = 'Nómina'; if (V.config.cuentaNomina) f.cuenta = V.config.cuentaNomina; if (!f.importe && V.config.sueldo) f.importe = String(V.config.sueldo).replace('.', ','); }
      if (key === 'debito') { pintarHint(); return; }
      pintarForm(); return;
    }
    if (key === 'tipo') { f.tipo = v; f.cat = ''; f.sub = ''; f.nomina = false; f.reembolso = false; f.vinculado = ''; f.compartido = false; f.saldaOn = false; f.pagaDeuda = ''; }
    else if (key === 'cat') { f.cat = f.cat === v ? '' : v; f.sub = ''; }
    else if (key === 'sub') { f.sub = f.sub === v ? '' : v; }
    else if (key === 'pagaDeuda') {
      f.pagaDeuda = C.clavePersona(f.pagaDeuda) === C.clavePersona(v) ? '' : v;
      var dd = C.deudas(V).filter(function (x) { return C.clavePersona(x.persona) === C.clavePersona(v); })[0];
      if (f.pagaDeuda && dd && dd.pendiente > 0 && !f.importe) f.importe = String(dd.pendiente).replace('.', ',');
    }
    else if (key === 'signo') { f.signo = +v; }
    pintarForm();
  }
  function onFormInput(e) {
    if (form && e.target.dataset && e.target.dataset.p !== undefined) {
      var pp = form.personas[+e.target.dataset.p]; if (pp) pp[e.target.dataset.pk] = e.target.value;
      pintarHint(); return;
    }
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
    var sobN = esc(nombreCuenta(V.config.cuentaSobrante)), tarN = esc(nombreCuenta(V.config.tarjetaSobrante));
    var h = '<h3>Reparto al cobrar la nómina</h3>' +
      '<ul class="list small">' +
      '<li><span class="grow sec">' + sobN + ' antes de cobrar</span><span class="amount num">' + fmt(prop.enDiaria) + '</span></li>' +
      (prop.deudaTarjeta ? '<li><span class="grow sec">− Se queda para la ' + tarN + ' (se cobra el día 1)</span><span class="amount num">−' + fmt(prop.deudaTarjeta) + '</span></li>' : '') +
      '<li><span class="grow"><b>= Sobrante para ahorrar</b></span><span class="amount num">' + fmt(prop.sobrante) + '</span></li>' +
      '</ul>' +
      '<p class="small sec">En ' + esc(nombreCuenta(nom.cuenta)) + ' se quedan ' + fmt(prop.reservado) + (prop.reservas.length ? ' (' + esc(prop.reservas.map(function (r) { return r.concepto + ' ' + C.fmt(r.importe); }).join(' + ')) + ', más los céntimos)' : '') + '. ' +
      'El día del cargo de la cuota, la app apunta sola el traspaso de reposición desde Mac.</p>' +
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

  // ---------- Gastos fijos ----------
  function abrirFijo(fijo) {
    var nuevo = !fijo;
    var f = fijo ? clone(fijo) : {
      id: 'f' + C.uid(), concepto: '', tipo: 'gasto', importe: '', cuenta: V.config.cuentaDefecto || (V.cuentas[0] && V.cuentas[0].id) || '',
      destino: '', cat: '', sub: '', frecuencia: 'mensual', dia: '', cada: 28, proxima: '', restantes: '', modo: '',
      reembolso: false, compromiso: true, financiaDesde: '', activo: true
    };
    if (f.importe !== '' && f.importe != null) f.importe = String(f.importe).replace('.', ',');
    var esCredito = function (id) { var c = cuenta(id); return c && c.tipo === 'credito'; };

    function opcionesCat(tipo, sel) {
      return '<option value="">Elige…</option>' + catsDe(tipo).map(function (c) { return '<option value="' + esc(c.cat) + '"' + (c.cat === sel ? ' selected' : '') + '>' + esc(c.cat) + '</option>'; }).join('');
    }
    function campo(label, html) { return '<label class="field"><span>' + label + '</span>' + html + '</label>'; }
    function pintar() {
      var x = f, h = '<h3>' + (nuevo ? 'Nuevo gasto fijo' : 'Editar «' + esc(fijo.concepto) + '»') + '</h3>';
      h += '<div class="seg">' + [['gasto', 'Gasto'], ['ingreso', 'Ingreso'], ['transferencia', 'Transferencia']].map(function (t) {
        return '<button data-g="tipo" data-v="' + t[0] + '" class="' + (x.tipo === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
      }).join('') + '</div>';
      h += campo('Concepto', '<input class="input" data-g="concepto" maxlength="80" value="' + esc(x.concepto) + '" placeholder="p. ej. YouTube Premium Lite">');
      if (x.tipo === 'transferencia') {
        h += '<div class="inline">' + campo('Desde', '<select class="input" data-g="cuenta">' + cuentasOpciones(x.cuenta) + '</select>') +
          campo('Hacia', '<select class="input" data-g="destino"><option value="">Elige…</option>' + cuentasOpciones(x.destino) + '</select>') + '</div>';
        if (esCredito(x.destino)) h += '<div class="switch"><span>Pagar el saldo completo de la tarjeta</span><input type="checkbox" data-g="liquidar"' + (x.modo === 'liquidar' ? ' checked' : '') + '></div>';
      } else {
        h += campo(x.tipo === 'gasto' ? 'Se paga con' : 'Entra en', '<select class="input" data-g="cuenta">' + cuentasOpciones(x.cuenta) + '</select>');
      }
      if (x.modo !== 'liquidar') h += campo('Importe (€)', '<input class="input num" data-g="importe" inputmode="decimal" value="' + esc(x.importe) + '" placeholder="0,00">');
      if (x.tipo === 'ingreso') {
        h += '<div class="switch"><span>Es un reembolso <span class="muted small">(alguien te paga parte de un gasto)</span></span><input type="checkbox" data-g="reembolso"' + (x.reembolso ? ' checked' : '') + '></div>';
      }
      if (x.tipo === 'gasto' || (x.tipo === 'ingreso' && x.reembolso) || x.tipo === 'transferencia') {
        var subs = x.cat ? subsDe(x.cat) : [];
        h += '<div class="inline">' + campo(x.tipo === 'transferencia' ? 'Categoría (opcional)' : x.reembolso ? 'Descuenta de' : 'Categoría', '<select class="input" data-g="cat">' + opcionesCat('gasto', x.cat) + '</select>') +
          campo('Subcategoría', '<input class="input" data-g="sub" list="dl-subs" value="' + esc(x.sub) + '" placeholder="opcional"><datalist id="dl-subs">' + subs.map(function (s2) { return '<option value="' + esc(s2) + '">'; }).join('') + '</datalist>') + '</div>';
      }
      h += '<div class="small sec" style="margin-top:6px">Se repite</div><div class="seg" style="margin-top:4px">' +
        '<button data-g="frecuencia" data-v="mensual" class="' + (x.frecuencia === 'mensual' ? 'on' : '') + '">Cada mes</button>' +
        '<button data-g="frecuencia" data-v="dias" class="' + (x.frecuencia === 'dias' ? 'on' : '') + '">Cada X días</button></div>';
      h += '<div class="inline">' + (x.frecuencia === 'mensual'
        ? campo('Día del mes', '<input class="input num" data-g="dia" inputmode="numeric" value="' + esc(x.dia) + '" placeholder="1-31">')
        : campo('Cada (días)', '<input class="input num" data-g="cada" inputmode="numeric" value="' + esc(x.cada) + '" placeholder="28">')) +
        campo('Próximo cargo', '<input class="input" type="date" data-g="proxima" value="' + esc(x.proxima) + '">') + '</div>';
      h += campo('Pagos restantes', '<input class="input num" data-g="restantes" inputmode="numeric" value="' + esc(x.restantes) + '" placeholder="Vacío = sin fin">');
      h += '<div class="switch"><span>Cuenta en el presupuesto <span class="muted small">(resta de lo que puedes gastar)</span></span><input type="checkbox" data-g="compromiso"' + (x.compromiso ? ' checked' : '') + '></div>';
      h += '<details><summary>Opciones avanzadas</summary>' + campo('Al cobrar la nómina, reponer el importe desde', '<select class="input" data-g="financiaDesde"><option value="">— nada —</option>' + cuentasOpciones(x.financiaDesde) + '</select>') + '</details>';
      if (!nuevo) h += '<div class="switch"><span>Activo <span class="muted small">(desactívalo para pausarlo)</span></span><input type="checkbox" data-g="activo"' + (x.activo !== false ? ' checked' : '') + '></div>';
      h += '<p class="small" id="g-hint" style="color:var(--text-2)"></p><p class="small" id="g-err" style="color:var(--critical)"></p>';
      h += '<div class="sheet-actions">' + (nuevo ? '<button class="btn" data-g="cancelar">Cancelar</button>' : '<button class="btn danger" data-g="borrar">Borrar</button>') + '<button class="btn primary" data-g="guardar">Guardar</button></div>';
      $('.sheet-body', hoja).innerHTML = h;
      pista();
    }
    function pista() {
      var el = $('#g-hint', hoja); if (!el) return;
      el.textContent = f.proxima && f.proxima < hoy() ? 'La fecha ya ha pasado: al guardar se apuntarán también los cargos desde ese día hasta hoy.' : '';
    }
    function entero(v) { v = String(v == null ? '' : v).trim(); return v === '' ? '' : (/^\d+$/.test(v) ? +v : NaN); }
    function guardar() {
      var err = $('#g-err', hoja), x = f, imp = x.modo === 'liquidar' ? 0 : C.r2(C.num(x.importe));
      var dia = entero(x.dia), cada = entero(x.cada), rest = entero(x.restantes);
      var fallo = !x.concepto.trim() ? 'Pon un concepto.'
        : x.modo !== 'liquidar' && !(imp > 0) ? 'Pon un importe.'
        : !x.cuenta ? 'Elige la cuenta.'
        : x.tipo === 'transferencia' && (!x.destino || x.destino === x.cuenta) ? 'Elige la cuenta de destino.'
        : x.tipo === 'gasto' && !x.cat ? 'Elige una categoría.'
        : x.tipo === 'ingreso' && x.reembolso && !x.cat ? 'Elige de qué categoría descuenta.'
        : !x.proxima ? 'Pon la fecha del próximo cargo.'
        : x.frecuencia === 'mensual' && dia !== '' && !(dia >= 1 && dia <= 31) ? 'El día del mes debe ir de 1 a 31.'
        : x.frecuencia === 'dias' && !(cada >= 1 && cada <= 366) ? 'Indica cada cuántos días.'
        : rest !== '' && !(rest >= 0 && rest <= 1000) ? 'Los pagos restantes deben ser un número.' : '';
      if (fallo) { err.textContent = fallo; return; }
      if (x.frecuencia === 'mensual' && dia === '') dia = C.parseISO(x.proxima).getUTCDate();
      var obj = {
        id: x.id, concepto: x.concepto.trim(), tipo: x.tipo, importe: imp, cuenta: x.cuenta,
        destino: x.tipo === 'transferencia' ? x.destino : '',
        cat: x.tipo === 'ingreso' && !x.reembolso ? 'Ingresos' : x.cat, sub: x.tipo === 'ingreso' && !x.reembolso ? (x.sub || 'Otros ingresos') : x.sub.trim(),
        frecuencia: x.frecuencia, dia: x.frecuencia === 'mensual' ? dia : '', cada: x.frecuencia === 'dias' ? cada : '',
        proxima: x.proxima, restantes: rest, modo: x.tipo === 'transferencia' && x.modo === 'liquidar' ? 'liquidar' : '',
        reembolso: x.tipo === 'ingreso' && !!x.reembolso, compromiso: !!x.compromiso, financiaDesde: x.financiaDesde || '',
        activo: x.activo !== false && !(rest === 0)
      };
      cerrarHoja();
      commit([{ op: 'fijo', fijo: obj }]);
      toast(nuevo ? 'Gasto fijo añadido' : 'Gasto fijo guardado');
    }
    abrirHoja('', function (el) {
      pintar();
      el.addEventListener('click', function (e) {
        var b = e.target.closest('[data-g]'); if (!b) return;
        var k = b.dataset.g;
        if (k === 'guardar') return guardar();
        if (k === 'cancelar') return cerrarHoja();
        if (k === 'borrar') {
          if (confirm('¿Borrar «' + fijo.concepto + '»? Los movimientos ya apuntados se quedan. (Si solo quieres pararlo un tiempo, desactívalo.)')) { cerrarHoja(); commit([{ op: 'borrarFijo', id: fijo.id }]); toast('Gasto fijo borrado'); }
          return;
        }
        if (b.tagName === 'BUTTON' && b.dataset.v) {
          if (k === 'tipo' && f.tipo !== b.dataset.v) { f.tipo = b.dataset.v; f.compromiso = f.tipo !== 'transferencia'; f.modo = ''; f.reembolso = false; f.cat = ''; f.sub = ''; }
          if (k === 'frecuencia') f.frecuencia = b.dataset.v;
          pintar();
        }
      });
      el.addEventListener('change', function (e) {
        var t = e.target, k = t.dataset && t.dataset.g; if (!k) return;
        if (t.type === 'checkbox') {
          if (k === 'liquidar') f.modo = t.checked ? 'liquidar' : '';
          else f[k] = t.checked;
          if (k === 'reembolso') { f.compromiso = t.checked; if (!t.checked) { f.cat = ''; f.sub = ''; } }
          pintar(); return;
        }
        f[k] = t.value;
        if (k === 'destino' || k === 'cat') { if (k === 'cat') f.sub = ''; if (k === 'destino' && !esCredito(t.value)) f.modo = ''; pintar(); }
        if (k === 'proxima') pista();
      });
      el.addEventListener('input', function (e) { var t = e.target, k = t.dataset && t.dataset.g; if (k && t.type !== 'checkbox') f[k] = t.value; });
    });
  }

  // ---------- Detalle de cuenta ----------
  function abrirCuenta(id) {
    var c = cuenta(id), s = C.saldos(V)[id] || 0;
    var movs = V.movimientos.filter(function (m) { return m.cuenta === id || m.destino === id; });
    var h = '<h3 class="catname">' + icoCuenta(c.tipo) + esc(c.nombre) + '</h3>' +
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
        llave = k; sesion = { url: d.url, clave: d.clave }; snapshot = d.snapshot; queue = d.queue || []; sync.ultimo = d.ultimoSync || 0; servidorVersion = d.servidorVersion || 0;
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
    else if (act === 'ir') irA(id);
    else if (act === 'fijos-anteriores') {
      var ants = C.fijosAnteriores(V, cicloActual());
      if (ants.length) { commit(ants.map(function (m) { return { op: 'mov', mov: m }; })); toast(ants.length + ' cargo(s) apuntado(s)'); }
    }
    else if (act === 'cat') abrirCategoria(id, a.dataset.tipo);
    else if (act === 'cat-nueva') abrirCategoria(null, 'gasto');
    else if (act === 'persona') abrirPersona(id);
    else if (act === 'debo') { var db = (V.debo || []).filter(function (x) { return x.id === id; })[0]; if (db) abrirDebo(db); }
    else if (act === 'debo-nuevo') abrirDebo(null);
    else if (act === 'debo-ok') { if (confirm('¿Ya le has pagado? Se quitará de la lista.')) { commit([{ op: 'borrarDebo', id: id }]); toast('Quitado de la lista'); } }
    else if (act === 'reparto') abrirReparto(id);
    else if (act === 'traspaso-ok') { LS.set('traspasoHecho.' + id, true); render(); }
    else if (act === 'reparto-no') { LS.set('repartoHecho.' + id, true); render(); }
    else if (act === 'fijo') { var fj = (V.fijos || []).filter(function (x) { return x.id === id; })[0]; if (fj) abrirFijo(fj); }
    else if (act === 'fijo-nuevo') abrirFijo(null);
    else if (act === 'descartar-cola') { if (confirm('Se descartarán ' + queue.length + ' cambio(s) que el servidor no ha aceptado. ¿Seguir?')) { queue = []; sync.estado = 'idle'; sync.error = ''; persist(); recompute(); render(); hacerSync(); } }
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
  /** Sin zoom: Safari ignora a veces user-scalable=no, así que se cortan también los gestos. */
  function bloquearZoom() {
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
    });
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
    // El doble toque lo evita «touch-action: manipulation» (CSS) sin frenar el tecleo rápido.
  }

  function iniciar() {
    bloquearZoom();
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
