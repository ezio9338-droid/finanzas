/*
 * Hucha · lógica compartida
 * Este archivo lo usan la app (navegador) y el Apps Script (Core.gs es una copia exacta).
 * Solo funciones puras: no toca el DOM ni las hojas de cálculo.
 */
var HuchaCore = (function () {
  'use strict';

  // ---------- Fechas (siempre texto 'AAAA-MM-DD') ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function parseISO(s) { var p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function addDays(s, n) { var d = parseISO(s); d.setUTCDate(d.getUTCDate() + n); return toISO(d); }
  function diffDays(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  /** Mismo día (o el último del mes si no existe) en el mes siguiente a `s`. */
  function nextMonthly(s, dia) {
    var d = parseISO(s), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    if (m > 11) { m = 0; y++; }
    var dd = Math.min(dia || d.getUTCDate(), daysInMonth(y, m));
    return toISO(new Date(Date.UTC(y, m, dd)));
  }
  function addMonths(s, n) {
    var d = parseISO(s), y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return toISO(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), daysInMonth(y, m)))));
  }

  // ---------- Números ----------
  function r2(x) { return Math.round((+x || 0) * 100) / 100; }
  function num(x) {
    if (typeof x === 'number') return x;
    if (x === '' || x == null) return 0;
    var s = String(x).trim().replace(/\s|€/g, '');
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /** Redondeo de la tarjeta de débito: hasta el euro siguiente × 5; si es exacto, 5 €. */
  function redondeo(importe) {
    var c = Math.round(Math.abs(importe) * 100);
    if (c <= 0) return 0;
    var resto = c % 100;
    if (resto === 0) return 5;
    return r2((100 - resto) / 100 * 5);
  }

  /** Interés neto de un día con TAE y retención en %. */
  function interesDiario(saldo, tae, retencion) {
    if (saldo <= 0 || !tae) return 0;
    var bruto = saldo * (Math.pow(1 + tae / 100, 1 / 365) - 1);
    return bruto * (1 - (retencion || 0) / 100);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Saldos ----------
  function cuentaMap(state) {
    var m = {};
    (state.cuentas || []).forEach(function (c) { m[c.id] = c; });
    return m;
  }

  /**
   * Saldo de cada cuenta. Un movimiento solo cambia el saldo si su fecha es >= la fecha
   * inicial de la cuenta (los anteriores ya estaban incluidos en el saldo inicial).
   * @param hasta fecha incluida (opcional)
   * @param extra movimientos adicionales aún no guardados (opcional)
   */
  function saldos(state, hasta, extra) {
    var cm = cuentaMap(state), s = {};
    (state.cuentas || []).forEach(function (c) { s[c.id] = num(c.saldoInicial); });
    function cuenta(id, fecha, delta) {
      var c = cm[id];
      if (!c) return;
      if (c.fechaInicial && fecha < c.fechaInicial) return;
      s[id] += delta;
    }
    var movs = (state.movimientos || []).concat(extra || []);
    for (var i = 0; i < movs.length; i++) {
      var m = movs[i];
      if (hasta && m.fecha > hasta) continue;
      var imp = num(m.importe);
      if (m.tipo === 'gasto') cuenta(m.cuenta, m.fecha, -imp);
      else if (m.tipo === 'ingreso') cuenta(m.cuenta, m.fecha, imp);
      else if (m.tipo === 'ajuste') cuenta(m.cuenta, m.fecha, imp);
      else if (m.tipo === 'transferencia') { cuenta(m.cuenta, m.fecha, -imp); cuenta(m.destino, m.fecha, imp); }
    }
    Object.keys(s).forEach(function (k) { s[k] = r2(s[k]); });
    return s;
  }

  function patrimonio(state, hasta) {
    var s = saldos(state, hasta), t = 0;
    (state.cuentas || []).forEach(function (c) { if (c.activa !== false) t += s[c.id] || 0; });
    return r2(t);
  }

  // ---------- Ciclos (de nómina a nómina) ----------
  function nominas(state) {
    return (state.movimientos || []).filter(function (m) { return m.tipo === 'ingreso' && m.nomina; })
      .sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });
  }

  /** Lista de ciclos [{inicio, fin, nomina, estimado}] del más antiguo al actual. */
  function ciclos(state, hoy) {
    var cfg = state.config || {}, ns = nominas(state), out = [];
    var inicio0 = cfg.inicioCiclo || (ns[0] && ns[0].fecha) || hoy;
    if (!ns.length || inicio0 < ns[0].fecha) out.push({ inicio: inicio0, nomina: null });
    ns.forEach(function (n) {
      if (out.length && out[out.length - 1].inicio === n.fecha) { out[out.length - 1].nomina = n; return; }
      out.push({ inicio: n.fecha, nomina: n });
    });
    for (var i = 0; i < out.length; i++) {
      if (i < out.length - 1) { out[i].fin = addDays(out[i + 1].inicio, -1); out[i].estimado = false; }
      else {
        var fin = addDays(addMonths(out[i].inicio, 1), -1);
        if (fin < hoy) fin = hoy;
        out[i].fin = fin; out[i].estimado = true;
      }
    }
    return out;
  }

  function cicloDe(state, fecha, hoy) {
    var cs = ciclos(state, hoy || fecha);
    for (var i = cs.length - 1; i >= 0; i--) if (fecha >= cs[i].inicio) return cs[i];
    return cs[0];
  }

  // ---------- Gastos fijos ----------
  function siguienteFecha(f, fecha) {
    if (f.frecuencia === 'dias') return addDays(fecha, +f.cada || 28);
    return nextMonthly(fecha, +f.dia || parseISO(fecha).getUTCDate());
  }

  /** Fechas futuras de un fijo entre [desde, hasta], respetando los pagos restantes. */
  function ocurrencias(f, desde, hasta) {
    var out = [], d = f.proxima, rest = f.restantes === '' || f.restantes == null ? Infinity : +f.restantes, guard = 0;
    if (!d || f.activo === false) return out;
    while (d <= hasta && rest > 0 && guard++ < 400) {
      if (d >= desde) out.push(d);
      d = siguienteFecha(f, d); rest--;
    }
    return out;
  }

  /** Efecto de un fijo en el presupuesto: + resta disponible, − lo suma (reembolsos). */
  function signoCompromiso(f) {
    if (f.tipo === 'ingreso') return f.reembolso ? -1 : 0;
    return 1;
  }

  // ---------- Presupuesto del ciclo ----------
  var REDONDEOS = 'Redondeos';
  function esVariable(m) { return !m.origen || m.origen === 'manual'; }
  function parteMia(m) { return m.miParte !== '' && m.miParte != null ? num(m.miParte) : num(m.importe); }

  function categoriasGasto(state) {
    var out = [], seen = {};
    (state.categorias || []).forEach(function (c) {
      if (c.tipo !== 'gasto' || seen[c.cat]) return;
      seen[c.cat] = true;
      var head = (state.categorias || []).filter(function (x) { return x.cat === c.cat && !x.sub; })[0] || c;
      out.push({ cat: c.cat, icono: head.icono || '', presupuesto: num(head.presupuesto) });
    });
    return out;
  }

  function presupuesto(state, ciclo, hoy) {
    var cfg = state.config || {};
    var fijosById = {};
    (state.fijos || []).forEach(function (f) { fijosById[f.id] = f; });
    var nomina = ciclo.nomina ? num(ciclo.nomina.importe) : num(cfg.sueldo);
    var ahorroPct = num(cfg.ahorroPct);
    var ahorroObjetivo = r2(nomina * ahorroPct / 100);
    var tipos = {};
    (state.cuentas || []).forEach(function (c) { tipos[c.id] = c.tipo; });

    var fijosPagados = 0, fijosPendientes = 0, pension = 0, porCat = {}, total = 0, lineasFijos = [];
    var enCiclo = (state.movimientos || []).filter(function (m) { return m.fecha >= ciclo.inicio && m.fecha <= ciclo.fin; });

    enCiclo.forEach(function (m) {
      if (m.origen && m.origen.indexOf('fijo:') === 0) {
        var f = fijosById[m.origen.slice(5)] || {};
        if (m.tipo === 'transferencia' && tipos[m.destino] === 'pension' && !f.compromiso) pension += num(m.importe);
        if (f.compromiso) {
          var v = signoCompromiso(f) * num(m.importe);
          fijosPagados += v;
          lineasFijos.push({ concepto: f.concepto || m.nota, fecha: m.fecha, importe: v, pagado: true });
        }
        return;
      }
      if (m.origen === 'redondeo' && m.tipo === 'transferencia') {
        // El redondeo sale de la cuenta diaria: cuenta como gasto (paga el aplazado vía Mac)
        porCat[REDONDEOS] = (porCat[REDONDEOS] || 0) + num(m.importe); total += num(m.importe);
        return;
      }
      if (!esVariable(m)) return;
      if (m.tipo === 'gasto') {
        var p = parteMia(m);
        porCat[m.cat] = (porCat[m.cat] || 0) + p; total += p;
      } else if (m.tipo === 'ingreso' && m.reembolso && !m.vinculado && m.cat) {
        porCat[m.cat] = (porCat[m.cat] || 0) - num(m.importe); total -= num(m.importe);
      }
    });

    // Desde el inicio del ciclo: así cuentan también los cargos ya vencidos que el servidor
    // aún no ha apuntado (los ya registrados se descartan justo debajo).
    var desde = ciclo.inicio;
    (state.fijos || []).forEach(function (f) {
      var occ = ocurrencias(f, desde, ciclo.fin);
      // Un fijo de hoy que ya se registró no debe contarse dos veces.
      occ = occ.filter(function (d) {
        return !enCiclo.some(function (m) { return m.origen === 'fijo:' + f.id && m.fecha === d; });
      });
      occ.forEach(function (d) {
        if (f.tipo === 'transferencia' && tipos[f.destino] === 'pension' && !f.compromiso) pension += num(f.importe);
        if (!f.compromiso) return;
        var v = signoCompromiso(f) * num(f.importe);
        fijosPendientes += v;
        lineasFijos.push({ concepto: f.concepto, fecha: d, importe: v, pagado: false });
      });
    });

    var fijos = r2(fijosPagados + fijosPendientes);
    var disponible = r2(nomina - fijos - ahorroObjetivo);
    var dias = diffDays(ciclo.inicio, ciclo.fin) + 1;
    var transcurridos = Math.min(dias, Math.max(1, diffDays(ciclo.inicio, hoy) + 1));
    var ritmo = transcurridos / dias;
    var proyectado = ritmo > 0 ? total / ritmo : total;
    // Los primeros días el ritmo no es fiable: se supone que gastarás lo presupuestado.
    var gastoPrevisto = transcurridos >= 7
      ? Math.max(total, Math.min(proyectado, Math.max(disponible, total) * 3))
      : Math.max(total, disponible);
    var ahorroPrevisto = r2(nomina - fijos - gastoPrevisto);
    var restante = r2(disponible - total);
    var diasRestantes = Math.max(1, dias - transcurridos + 1);

    var cats = categoriasGasto(state).map(function (c) {
      return { cat: c.cat, icono: c.icono, presupuesto: c.presupuesto, gastado: r2(porCat[c.cat] || 0) };
    });
    Object.keys(porCat).forEach(function (k) {
      if (!cats.some(function (c) { return c.cat === k; })) cats.push({ cat: k || 'Sin categoría', icono: '', presupuesto: 0, gastado: r2(porCat[k]) });
    });
    var reparto = num(cfg.repartoInversion);
    var sobranteObjetivo = r2(ahorroObjetivo - pension);
    var sobrantePrevisto = r2(ahorroPrevisto - pension);
    lineasFijos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });

    return {
      ciclo: ciclo, nomina: nomina, nominaEstimada: !ciclo.nomina,
      ahorroPct: ahorroPct, ahorroObjetivo: ahorroObjetivo,
      fijos: fijos, fijosPagados: r2(fijosPagados), fijosPendientes: r2(fijosPendientes), lineasFijos: lineasFijos,
      pension: r2(pension), disponible: disponible, gastado: r2(total), restante: restante,
      porDia: r2(restante / diasRestantes), dias: dias, transcurridos: transcurridos, diasRestantes: diasRestantes,
      pct: disponible > 0 ? total / disponible : (total > 0 ? 1 : 0), ritmo: ritmo,
      ahorroPrevisto: ahorroPrevisto, sobranteObjetivo: sobranteObjetivo, sobrantePrevisto: sobrantePrevisto,
      repartoInversion: reparto,
      categorias: cats
    };
  }

  /** Avisos para la pantalla de inicio. */
  function alertas(p) {
    var out = [];
    if (p.disponible <= 0) {
      out.push({ nivel: 'critical', texto: 'Con este sueldo, fijos y objetivo de ahorro no queda margen para gastar. Revisa el % de ahorro.' });
      return out;
    }
    if (p.pct >= 1) out.push({ nivel: 'critical', texto: 'Has superado el presupuesto del mes en ' + fmt(p.gastado - p.disponible) + '.' });
    else if (p.pct >= 0.8) out.push({ nivel: 'serious', texto: 'Llevas el ' + Math.round(p.pct * 100) + ' % del presupuesto del mes.' });
    if (p.pct < 1 && p.pct > p.ritmo + 0.08 && p.transcurridos > 2) {
      out.push({ nivel: 'warning', texto: 'Vas rápido: has gastado el ' + Math.round(p.pct * 100) + ' % y solo ha pasado el ' + Math.round(p.ritmo * 100) + ' % del mes.' });
    }
    p.categorias.forEach(function (c) {
      if (!c.presupuesto) return;
      var r = c.gastado / c.presupuesto;
      if (r >= 1) out.push({ nivel: 'critical', texto: c.cat + ': superado (' + fmt(c.gastado) + ' de ' + fmt(c.presupuesto) + ').' });
      else if (r >= 0.8) out.push({ nivel: 'serious', texto: c.cat + ': ' + Math.round(r * 100) + ' % usado.' });
    });
    return out;
  }

  function fmt(x) {
    var n = r2(x), neg = n < 0; n = Math.abs(n);
    var ent = Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    var dec = pad(Math.round((n - Math.floor(n)) * 100));
    return (neg ? '−' : '') + ent + ',' + dec + ' €';
  }

  // ---------- Deudas: lo que me deben, por persona ----------
  function clavePersona(n) { return String(n || '').trim().toLowerCase(); }
  var SIN_ASIGNAR = 'Sin asignar';

  /**
   * Agrupa por persona lo que te deben (hoja Deudas) menos lo que ya te han pagado
   * (ingresos con «Salda deuda de»). Los pagos se aplican a las deudas más antiguas primero.
   * Los gastos compartidos antiguos sin personas aparecen como «Sin asignar».
   * Devuelve [{persona, total, pagado, pendiente, items:[{deuda, restante, pagado}], pagos:[mov]}].
   */
  function deudas(state) {
    var por = {}, conPersonas = {};
    function grupo(nombre) { var k = clavePersona(nombre); return por[k] = por[k] || { persona: String(nombre).trim(), deudas: [], pagado: 0, pagos: [] }; }
    (state.deudas || []).forEach(function (d) {
      if (!clavePersona(d.persona)) return;
      conPersonas[d.movId] = true;
      grupo(d.persona).deudas.push(d);
    });
    var cobradoLegacy = {};
    (state.movimientos || []).forEach(function (m) {
      if (m.tipo !== 'ingreso') return;
      if (m.pagaDeuda) { var g = grupo(m.pagaDeuda); g.pagado += num(m.importe); g.pagos.push(m); }
      else if (m.vinculado) cobradoLegacy[m.vinculado] = (cobradoLegacy[m.vinculado] || 0) + num(m.importe);
    });
    // Compatibilidad: gastos compartidos registrados antes de existir las personas
    (state.movimientos || []).forEach(function (m) {
      if (m.tipo !== 'gasto' || m.miParte === '' || m.miParte == null || conPersonas[m.id]) return;
      var resto = r2(num(m.importe) - num(m.miParte) - (cobradoLegacy[m.id] || 0));
      if (resto > 0.004) grupo(SIN_ASIGNAR).deudas.push({ id: 'legacy-' + m.id, movId: m.id, fecha: m.fecha, persona: SIN_ASIGNAR, importe: resto, concepto: m.nota || m.sub || m.cat });
    });
    var out = [];
    Object.keys(por).forEach(function (k) {
      var p = por[k], resto = p.pagado, total = 0, items = [];
      p.deudas.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; }).forEach(function (d) {
        var imp = num(d.importe), usa = Math.min(imp, Math.max(0, resto));
        resto -= usa; total += imp;
        if (imp - usa > 0.004) items.push({ deuda: d, restante: r2(imp - usa), pagado: r2(usa) });
      });
      out.push({ persona: p.persona, total: r2(total), pagado: r2(p.pagado), pendiente: r2(total - p.pagado), items: items, pagos: p.pagos, deudas: p.deudas });
    });
    return out.sort(function (a, b) { return b.pendiente - a.pendiente; });
  }
  function totalMeDeben(state) { return r2(deudas(state).reduce(function (a, d) { return a + Math.max(0, d.pendiente); }, 0)); }
  function personasConocidas(state) {
    var vistos = {}, out = [];
    (state.deudas || []).concat(state.debo || []).forEach(function (d) {
      var k = clavePersona(d.persona); if (k && k !== clavePersona(SIN_ASIGNAR) && !vistos[k]) { vistos[k] = 1; out.push(String(d.persona).trim()); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'es'); });
  }

  // ---------- Compartidos / reembolsos (antiguo) ----------
  function pendientesCobro(state) {
    var cobrado = {};
    (state.movimientos || []).forEach(function (m) {
      if (m.tipo === 'ingreso' && m.vinculado) cobrado[m.vinculado] = (cobrado[m.vinculado] || 0) + num(m.importe);
    });
    return (state.movimientos || []).filter(function (m) {
      return m.tipo === 'gasto' && m.miParte !== '' && m.miParte != null;
    }).map(function (m) {
      var debe = r2(num(m.importe) - num(m.miParte) - (cobrado[m.id] || 0));
      return { mov: m, pendiente: debe };
    }).filter(function (x) { return x.pendiente > 0.004; });
  }

  // ---------- Asistente de nómina ----------
  /**
   * Propuestas de movimientos al registrar la nómina.
   * @param nomina movimiento de nómina recién creado (aún puede no estar en state)
   */
  function propuestaNomina(state, nomina) {
    var cfg = state.config || {}, s = saldos(state, null, state.movimientos.some(function (m) { return m.id === nomina.id; }) ? [] : [nomina]);
    var out = [], hoy = nomina.fecha;
    var sob = cfg.cuentaSobrante, tarj = cfg.tarjetaSobrante;
    var sobrante = r2((s[sob] || 0) + (tarj ? Math.min(0, s[tarj] || 0) : 0));
    var pct = num(cfg.repartoInversion) / 100;
    if (sobrante > 0) {
      var inv = r2(sobrante * pct);
      out.push({ tipo: 'transferencia', fecha: hoy, cuenta: sob, destino: cfg.cuentaInversion, importe: inv, nota: 'Reparto sobrante (' + Math.round(pct * 100) + ' %)' });
      out.push({ tipo: 'transferencia', fecha: hoy, cuenta: sob, destino: cfg.cuentaRemunerada, importe: r2(sobrante - inv), nota: 'Reparto sobrante (' + Math.round((1 - pct) * 100) + ' %)' });
    }
    // Lo que debe quedarse en la cuenta de nómina: fijos que salen de ella antes de la próxima nómina.
    var finEst = addDays(addMonths(hoy, 1), -1), reservar = 0, deMac = 0;
    (state.fijos || []).forEach(function (f) {
      if (f.cuenta !== nomina.cuenta || f.tipo === 'ingreso') return;
      var n = ocurrencias(f, hoy, finEst).length;
      reservar += n * num(f.importe);
      if (f.financiaDesde) deMac += n * num(f.importe);
    });
    var enNomina = r2((s[nomina.cuenta] || 0));
    var aPasar = Math.floor(enNomina - reservar);
    if (aPasar > 0 && sob && sob !== nomina.cuenta) {
      out.push({ tipo: 'transferencia', fecha: hoy, cuenta: nomina.cuenta, destino: sob, importe: aPasar, nota: 'Nómina a cuenta diaria' });
    }
    (state.fijos || []).forEach(function (f) {
      if (!f.financiaDesde || f.cuenta !== nomina.cuenta) return;
      var n = ocurrencias(f, hoy, finEst).length;
      if (n > 0) out.push({ tipo: 'transferencia', fecha: hoy, cuenta: f.financiaDesde, destino: sob, importe: r2(n * num(f.importe)), nota: 'Repongo ' + f.concepto });
    });
    return { sobrante: sobrante, reservado: r2(reservar), movimientos: out };
  }

  // ---------- Automáticos (los ejecuta el Apps Script cada día) ----------
  /**
   * Genera los movimientos de fijos e intereses pendientes hasta `hoy`.
   * Modifica state.fijos y state.cuentas (próxima fecha, restantes, intereses) y
   * devuelve los movimientos nuevos (ya añadidos a state.movimientos).
   */
  function procesarAutomaticos(state, hoy) {
    var nuevos = [], ids = {};
    (state.movimientos || []).forEach(function (m) { ids[m.id] = true; });
    function add(m) { if (ids[m.id]) return; ids[m.id] = true; nuevos.push(m); state.movimientos.push(m); }

    var fijos = (state.fijos || []).filter(function (f) { return f.activo !== false && f.proxima; })
      .sort(function (a, b) { return a.proxima < b.proxima ? -1 : 1; });
    var guard = 0, pendiente = true;
    while (pendiente && guard++ < 1000) {
      pendiente = false;
      for (var i = 0; i < fijos.length; i++) {
        var f = fijos[i];
        if (f.activo === false || !f.proxima || f.proxima > hoy) continue;
        if (f.restantes !== '' && f.restantes != null && +f.restantes <= 0) { f.activo = false; continue; }
        var imp = num(f.importe);
        if (f.modo === 'liquidar') {
          var sd = saldos(state, addDays(f.proxima, -1));
          imp = r2(Math.max(0, -(sd[f.destino] || 0)));
        }
        if (imp > 0) {
          add({
            id: 'f-' + f.id + '-' + f.proxima, fecha: f.proxima, tipo: f.tipo, importe: imp,
            cuenta: f.cuenta, destino: f.tipo === 'transferencia' ? f.destino : '',
            cat: f.cat || '', sub: f.sub || '', nota: f.concepto, miParte: '', nomina: false,
            reembolso: !!f.reembolso, vinculado: '', origen: 'fijo:' + f.id, act: Date.now()
          });
        }
        f.proxima = siguienteFecha(f, f.proxima);
        if (f.restantes !== '' && f.restantes != null) {
          f.restantes = +f.restantes - 1;
          if (f.restantes <= 0) f.activo = false;
        }
        pendiente = true;
      }
    }

    (state.cuentas || []).forEach(function (c) {
      var tae = num(c.tae);
      if (!tae || !c.interesesHasta) return;
      var d = addDays(c.interesesHasta, 1), resto = num(c.interesResto), n = 0;
      while (d < hoy && n++ < 1000) {
        var saldo = saldos(state, d)[c.id] || 0;
        var x = interesDiario(saldo, tae, num(c.retencion)) + resto;
        var cents = Math.floor(x * 100 + 1e-9) / 100;
        resto = x - cents;
        if (cents > 0) {
          add({
            id: 'i-' + c.id + '-' + d, fecha: d, tipo: 'ingreso', importe: cents, cuenta: c.id, destino: '',
            cat: 'Ingresos', sub: 'Intereses', nota: 'Intereses netos', miParte: '', nomina: false,
            reembolso: false, vinculado: '', origen: 'interes', act: Date.now()
          });
        }
        c.interesesHasta = d;
        d = addDays(d, 1);
      }
      c.interesResto = Math.round(resto * 1e6) / 1e6;
    });
    return nuevos;
  }

  // ---------- Operaciones de sincronización ----------
  /** Aplica operaciones de la app sobre el estado. Idempotente. */
  function aplicarOps(state, ops) {
    (ops || []).forEach(function (op) {
      if (op.op === 'mov') {
        var i = indexById(state.movimientos, op.mov.id);
        if (i >= 0) state.movimientos[i] = op.mov; else state.movimientos.push(op.mov);
      } else if (op.op === 'borrar') {
        state.movimientos = state.movimientos.filter(function (m) { return m.id !== op.id; });
        state.deudas = (state.deudas || []).filter(function (d) { return d.movId !== op.id; });
      } else if (op.op === 'deudas') {
        // Sustituye las deudas de un gasto por la lista nueva
        state.deudas = (state.deudas || []).filter(function (d) { return d.movId !== op.movId; }).concat(op.lista || []);
      } else if (op.op === 'debo') {
        state.debo = state.debo || [];
        var b = indexById(state.debo, op.debo.id);
        if (b >= 0) state.debo[b] = op.debo; else state.debo.push(op.debo);
      } else if (op.op === 'borrarDebo') {
        state.debo = (state.debo || []).filter(function (d) { return d.id !== op.id; });
      } else if (op.op === 'categoria') {
        aplicarCategoria(state, op);
      } else if (op.op === 'borrarCategoria') {
        state.categorias = (state.categorias || []).filter(function (c) { return !(c.cat === op.cat && c.tipo === op.tipo); });
      } else if (op.op === 'config') {
        state.config[op.clave] = op.valor;
      } else if (op.op === 'presupuesto') {
        (state.categorias || []).forEach(function (c) { if (c.cat === op.cat && !c.sub) c.presupuesto = op.valor; });
      } else if (op.op === 'cuenta') {
        var j = indexById(state.cuentas, op.cuenta.id);
        if (j >= 0) state.cuentas[j] = Object.assign({}, state.cuentas[j], op.cuenta); else state.cuentas.push(op.cuenta);
      } else if (op.op === 'fijo') {
        var k = indexById(state.fijos, op.fijo.id);
        if (k >= 0) state.fijos[k] = Object.assign({}, state.fijos[k], op.fijo); else state.fijos.push(op.fijo);
      } else if (op.op === 'borrarFijo') {
        state.fijos = (state.fijos || []).filter(function (f) { return f.id !== op.id; });
      }
    });
    return state;
  }
  /**
   * Crea o edita una categoría con sus subcategorías.
   * op: {tipo, antes, cat, icono, presupuesto, subs:[{antes, nombre}]}
   * Si cambia el nombre (o el de una subcategoría) se renombra también en movimientos y fijos.
   */
  function aplicarCategoria(state, op) {
    var cats = state.categorias = state.categorias || [];
    var clave = op.antes || op.cat, pos = -1;
    for (var i = 0; i < cats.length; i++) if (cats[i].cat === clave && cats[i].tipo === op.tipo) { pos = i; break; }
    var restantes = cats.filter(function (c) { return !(c.cat === clave && c.tipo === op.tipo); });
    if (pos < 0) {
      // Nueva: al final de su tipo (los gastos van antes que los ingresos)
      pos = restantes.length;
      if (op.tipo === 'gasto') for (var j = 0; j < restantes.length; j++) if (restantes[j].tipo !== 'gasto') { pos = j; break; }
    } else {
      pos = cats.slice(0, pos).filter(function (c) { return !(c.cat === clave && c.tipo === op.tipo); }).length;
    }
    var filas = [{ cat: op.cat, sub: '', tipo: op.tipo, icono: op.icono || '', presupuesto: op.presupuesto === undefined ? '' : op.presupuesto }];
    (op.subs || []).forEach(function (sb) { filas.push({ cat: op.cat, sub: sb.nombre, tipo: op.tipo, icono: '', presupuesto: '' }); });
    state.categorias = restantes.slice(0, pos).concat(filas, restantes.slice(pos));
    var listas = [state.movimientos || [], state.fijos || []];
    if (op.antes && op.antes !== op.cat) {
      listas.forEach(function (l) { l.forEach(function (x) { if (x.cat === op.antes) x.cat = op.cat; }); });
      (state.deudas || []).forEach(function (d) { if (d.concepto === op.antes) d.concepto = op.cat; });
    }
    (op.subs || []).forEach(function (sb) {
      if (!sb.antes || sb.antes === sb.nombre) return;
      listas.forEach(function (l) { l.forEach(function (x) { if (x.cat === op.cat && x.sub === sb.antes) x.sub = sb.nombre; }); });
    });
  }

  function indexById(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return i; return -1; }

  // ---------- Ahorro real (a partir del saldo de la cuenta diaria) ----------
  /**
   * Reparte el saldo actual de la cuenta diaria (cuentaSobrante) en:
   *  deuda de la tarjeta (actual + fijos que aún se le cargarán este ciclo),
   *  otros fijos pendientes de esa cuenta, lo que te queda por gastar y, lo que sobra, el ahorro.
   * Es lo que podrás repartir al cobrar si gastas exactamente lo que te queda.
   */
  function ahorroReal(state, p, hoy) {
    var cfg = state.config || {}, sob = cfg.cuentaSobrante, tarj = cfg.tarjetaSobrante;
    if (!sob) return null;
    var s = saldos(state), ciclo = p.ciclo;
    var deuda = tarj ? Math.max(0, -(s[tarj] || 0)) : 0, pendientes = 0;
    var registrados = {};
    (state.movimientos || []).forEach(function (m) { registrados[m.id] = true; });
    (state.fijos || []).forEach(function (f) {
      if (f.modo === 'liquidar' || (f.tipo === 'transferencia' && f.destino === tarj)) return;
      ocurrencias(f, ciclo.inicio, ciclo.fin).forEach(function (d) {
        if (registrados['f-' + f.id + '-' + d]) return;
        var imp = num(f.importe);
        if (f.tipo === 'gasto' && f.cuenta === tarj) deuda += imp;
        else if (f.tipo === 'gasto' && f.cuenta === sob) pendientes += imp;
        else if (f.tipo === 'ingreso' && f.cuenta === sob) pendientes -= imp;
        else if (f.tipo === 'transferencia' && f.cuenta === sob) pendientes += imp;
      });
    });
    var queda = Math.max(0, p.restante);
    var saldo = s[sob] || 0;
    return {
      cuenta: sob, saldo: r2(saldo), deuda: r2(deuda), pendientes: r2(pendientes), queda: r2(queda),
      ahorro: r2(saldo - deuda - pendientes - queda)
    };
  }

  // ---------- Cargos fijos anteriores a empezar ----------
  /**
   * Cargos de fijos que cuentan en presupuesto y caen entre el inicio del ciclo y el día en que
   * se pusieron los saldos iniciales (no se registraron porque la app aún no existía).
   * Se apuntan con su fecha: al ser anteriores al saldo inicial, no cambian los saldos.
   */
  function fijosAnteriores(state, ciclo) {
    var inicioApp = null;
    (state.cuentas || []).forEach(function (c) { if (c.fechaInicial && (!inicioApp || c.fechaInicial < inicioApp)) inicioApp = c.fechaInicial; });
    if (!inicioApp || inicioApp <= ciclo.inicio) return [];
    var ids = {};
    (state.movimientos || []).forEach(function (m) { ids[m.id] = true; });
    var out = [];
    (state.fijos || []).forEach(function (f) {
      if (!f.compromiso || f.modo === 'liquidar' || !f.proxima) return;
      var fechas = [];
      if (f.frecuencia === 'dias') {
        var d = f.proxima, guard = 0;
        while (d >= ciclo.inicio && guard++ < 400) { if (d < inicioApp) fechas.push(d); d = addDays(d, -(+f.cada || 28)); }
      } else {
        var dia = +f.dia || parseISO(f.proxima).getUTCDate(), m0 = parseISO(ciclo.inicio), y = m0.getUTCFullYear(), mo = m0.getUTCMonth();
        for (var n = 0; n < 3; n++) {
          var yy = y + Math.floor((mo + n) / 12), mm = (mo + n) % 12;
          var fd = toISO(new Date(Date.UTC(yy, mm, Math.min(dia, daysInMonth(yy, mm)))));
          if (fd >= ciclo.inicio && fd < inicioApp) fechas.push(fd);
        }
      }
      fechas.forEach(function (fd) {
        var id = 'f-' + f.id + '-' + fd;
        if (ids[id]) return;
        out.push({
          id: id, fecha: fd, tipo: f.tipo, importe: num(f.importe), cuenta: f.cuenta, destino: f.tipo === 'transferencia' ? f.destino : '',
          cat: f.cat || '', sub: f.sub || '', nota: f.concepto, miParte: '', nomina: false, reembolso: !!f.reembolso,
          vinculado: '', pagaDeuda: '', origen: 'fijo:' + f.id, act: Date.now()
        });
      });
    });
    return out.sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
  }

  // ---------- Estadísticas ----------
  function estadisticas(state, hoy) {
    var cs = ciclos(state, hoy), fijosById = {};
    (state.fijos || []).forEach(function (f) { fijosById[f.id] = f; });
    return cs.map(function (c) {
      var ing = 0, nom = 0, intereses = 0, gas = 0, porCat = {};
      (state.movimientos || []).forEach(function (m) {
        if (m.fecha < c.inicio || m.fecha > c.fin) return;
        if (m.tipo === 'ingreso') {
          if (m.vinculado || m.pagaDeuda) return;
          if (m.reembolso) { gas -= num(m.importe); porCat[m.cat] = (porCat[m.cat] || 0) - num(m.importe); return; }
          ing += num(m.importe);
          if (m.nomina) nom += num(m.importe);
          if (m.origen === 'interes') intereses += num(m.importe);
        } else if (m.tipo === 'gasto') {
          var p = parteMia(m); gas += p; porCat[m.cat] = (porCat[m.cat] || 0) + p;
        } else if (m.tipo === 'transferencia' && m.origen === 'redondeo') {
          gas += num(m.importe); porCat[REDONDEOS] = (porCat[REDONDEOS] || 0) + num(m.importe);
        } else if (m.tipo === 'transferencia' && m.origen && m.origen.indexOf('fijo:') === 0) {
          // Transferencias fijas que cuentan en presupuesto (plan de pensiones, cuota…) = gasto
          var fj = fijosById[m.origen.slice(5)];
          if (fj && fj.compromiso) { var k = fj.cat || fj.concepto || 'Fijos'; gas += num(m.importe); porCat[k] = (porCat[k] || 0) + num(m.importe); }
        }
      });
      var hasta = c.fin < hoy ? c.fin : hoy;
      Object.keys(porCat).forEach(function (k) { porCat[k] = r2(porCat[k]); });
      return {
        inicio: c.inicio, fin: c.fin, actual: c.estimado,
        ingresos: r2(ing), nomina: r2(nom), intereses: r2(intereses), gastos: r2(gas),
        ahorro: r2(ing - gas), tasaAhorro: ing > 0 ? (ing - gas) / ing : null,
        patrimonio: patrimonio(state, hasta), porCategoria: porCat
      };
    });
  }

  // ---------- Datos de ejemplo (modo demo, sin datos reales) ----------
  function estadoEjemplo(hoy) {
    var ini = addDays(hoy, -6);
    var st = {
      config: {
        sueldo: 1500, inicioCiclo: ini, ahorroPct: 50, repartoInversion: 30,
        cuentaInversion: 'inversion', cuentaRemunerada: 'remunerada', cuentaSobrante: 'principal',
        tarjetaSobrante: 'tc_principal', cuentaNomina: 'nomina', cuentaDefecto: 'principal'
      },
      cuentas: [
        { id: 'principal', nombre: 'Principal', tipo: 'diario', saldoInicial: 900, fechaInicial: ini, orden: 1, redondeoA: 'hucha', activa: true },
        { id: 'nomina', nombre: 'Banco nómina', tipo: 'diario', saldoInicial: 150, fechaInicial: ini, orden: 2, activa: true },
        { id: 'efectivo', nombre: 'Metálico', tipo: 'efectivo', saldoInicial: 60, fechaInicial: ini, orden: 3, activa: true },
        { id: 'hucha', nombre: 'Pocket', tipo: 'pocket', saldoInicial: 120, fechaInicial: ini, orden: 4, activa: true },
        { id: 'remunerada', nombre: 'Remunerada', tipo: 'ahorro', saldoInicial: 10000, fechaInicial: ini, orden: 5, tae: 2, retencion: 19, interesesHasta: addDays(ini, -1), interesResto: 0, activa: true },
        { id: 'inversion', nombre: 'Inversión', tipo: 'inversion', saldoInicial: 3000, fechaInicial: ini, orden: 6, activa: true },
        { id: 'pension', nombre: 'Plan de pensiones', tipo: 'pension', saldoInicial: 2500, fechaInicial: ini, orden: 7, activa: true },
        { id: 'tc_nomina', nombre: 'Crédito banco nómina', tipo: 'credito', saldoInicial: -300, fechaInicial: ini, orden: 8, activa: true },
        { id: 'tc_principal', nombre: 'Crédito principal', tipo: 'credito', saldoInicial: -15, fechaInicial: ini, orden: 9, activa: true }
      ],
      categorias: categoriasBase(),
      fijos: [
        { id: 'gym', concepto: 'Gimnasio', tipo: 'gasto', importe: 25, cuenta: 'principal', cat: 'Salud y deporte', sub: 'Gimnasio', frecuencia: 'dias', cada: 28, proxima: addDays(hoy, 3), restantes: '', compromiso: true, activo: true },
        { id: 'internet', concepto: 'TV e internet', tipo: 'gasto', importe: 40, cuenta: 'principal', cat: 'Casa', sub: 'TV e internet', frecuencia: 'mensual', dia: 1, proxima: nextMonthly(hoy, 1), restantes: '', compromiso: true, activo: true }
      ],
      movimientos: [], deudas: [], debo: []
    };
    var demo = [
      [-5, 'gasto', 32.4, 'principal', 'Comida', 'Supermercado'], [-4, 'gasto', 12.9, 'principal', 'Comida', 'Restaurantes'],
      [-3, 'gasto', 60, 'principal', 'Transporte', 'Gasolina'], [-2, 'gasto', 18.5, 'efectivo', 'Ocio', 'Salir'],
      [-1, 'gasto', 2.2, 'principal', 'Comida', 'Cafés y snacks'], [0, 'gasto', 45.99, 'principal', 'Ropa', '']
    ];
    demo.forEach(function (d, i) {
      var m = { id: 'demo' + i, fecha: addDays(hoy, d[0]), tipo: d[1], importe: d[2], cuenta: d[3], destino: '', cat: d[4], sub: d[5], nota: '', miParte: '', nomina: false, reembolso: false, vinculado: '', origen: 'manual', act: 0 };
      st.movimientos.push(m);
      if (d[3] === 'principal') st.movimientos.push({ id: m.id + '-r', fecha: m.fecha, tipo: 'transferencia', importe: redondeo(d[2]), cuenta: 'principal', destino: 'hucha', cat: '', sub: '', nota: 'Redondeo', miParte: '', nomina: false, reembolso: false, vinculado: m.id, origen: 'redondeo', act: 0 });
    });
    // Ejemplo de gasto compartido: cena de 90 € entre tres
    var cena = { id: 'demo-cena', fecha: addDays(hoy, -3), tipo: 'gasto', importe: 90, cuenta: 'principal', destino: '', cat: 'Comida', sub: 'Restaurantes', nota: 'Cena cumpleaños', miParte: 30, nomina: false, reembolso: false, vinculado: '', origen: 'manual', act: 0 };
    st.movimientos.push(cena);
    st.deudas.push({ id: 'dd1', movId: cena.id, fecha: cena.fecha, persona: 'Ana', importe: 30, concepto: cena.nota });
    st.deudas.push({ id: 'dd2', movId: cena.id, fecha: cena.fecha, persona: 'Luis', importe: 30, concepto: cena.nota });
    st.movimientos.push({ id: 'demo-bizum', fecha: addDays(hoy, -1), tipo: 'ingreso', importe: 30, cuenta: 'principal', destino: '', cat: '', sub: '', nota: 'Bizum', miParte: '', nomina: false, reembolso: false, vinculado: '', pagaDeuda: 'Ana', origen: 'manual', act: 0 });
    st.debo.push({ id: 'db1', persona: 'Marta', concepto: 'Entradas del concierto', importe: 35, fecha: addDays(hoy, -2) });
    return st;
  }

  function categoriasBase() {
    var def = [
      ['Comida', '🛒', 250, ['Supermercado', 'Restaurantes', 'Cafés y snacks']],
      ['Transporte', '⛽', 90, ['Gasolina', 'Parking y peajes', 'Mantenimiento', 'Transporte público']],
      ['Casa', '🏠', 20, ['TV e internet', 'Suministros', 'Hogar']],
      ['Suscripciones', '🔁', 0, ['Claude', 'Spotify', 'Otras']],
      ['Tecnología', '💻', 15, ['Railway', 'Gadgets y software']],
      ['Salud y deporte', '💪', 25, ['Gimnasio', 'Farmacia', 'Médico']],
      ['Ocio', '🎉', 130, ['Salir', 'Viajes', 'Juegos', 'Cultura']],
      ['Ropa', '👕', 50, []],
      ['Regalos', '🎁', 30, []],
      ['Deudas', '💳', 0, ['Pago aplazado']],
      ['Otros', '📦', 40, []]
    ];
    var out = [];
    def.forEach(function (d) {
      out.push({ cat: d[0], sub: '', tipo: 'gasto', icono: d[1], presupuesto: d[2] });
      d[3].forEach(function (s) { out.push({ cat: d[0], sub: s, tipo: 'gasto', icono: '', presupuesto: '' }); });
    });
    out.push({ cat: 'Ingresos', sub: '', tipo: 'ingreso', icono: '💶', presupuesto: '' });
    ['Nómina', 'Intereses', 'Otros ingresos'].forEach(function (s) { out.push({ cat: 'Ingresos', sub: s, tipo: 'ingreso', icono: '', presupuesto: '' }); });
    return out;
  }

  return {
    toISO: toISO, parseISO: parseISO, addDays: addDays, addMonths: addMonths, diffDays: diffDays, nextMonthly: nextMonthly,
    r2: r2, num: num, fmt: fmt, uid: uid, redondeo: redondeo, interesDiario: interesDiario,
    saldos: saldos, patrimonio: patrimonio, ciclos: ciclos, cicloDe: cicloDe, ocurrencias: ocurrencias,
    presupuesto: presupuesto, alertas: alertas, pendientesCobro: pendientesCobro, propuestaNomina: propuestaNomina,
    fijosAnteriores: fijosAnteriores, REDONDEOS: REDONDEOS, ahorroReal: ahorroReal, deudas: deudas, totalMeDeben: totalMeDeben, personasConocidas: personasConocidas, clavePersona: clavePersona, SIN_ASIGNAR: SIN_ASIGNAR,
    procesarAutomaticos: procesarAutomaticos, aplicarOps: aplicarOps, estadisticas: estadisticas,
    categoriasBase: categoriasBase, estadoEjemplo: estadoEjemplo, parteMia: parteMia
  };
})();

if (typeof module !== 'undefined') module.exports = HuchaCore;
