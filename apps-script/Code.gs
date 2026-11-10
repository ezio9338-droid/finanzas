/**
 * @OnlyCurrentDoc  ← el script solo puede acceder a ESTA hoja, no al resto de tu Drive.
 */
/**
 * Hucha · servidor en Google Apps Script
 *
 * Archivos de este proyecto de Apps Script:
 *   Code.gs   → este archivo
 *   Core.gs   → copia exacta de js/core.js del repositorio
 *   Datos.gs  → (opcional) tus datos iniciales, NO están en el repositorio público
 *
 * Primer uso: ejecuta la función `instalar` una vez (menú ▶ Ejecutar) y acepta los permisos.
 * Después: Implementar → Nueva implementación → Aplicación web
 *          (Ejecutar como: yo · Quién tiene acceso: Cualquier usuario).
 */

var ZONA = 'Europe/Madrid';
var API_VERSION = 4; // 2: gastos fijos desde la app · 3: deudas por persona · 4: editar categorías

var HOJAS = {
  Movimientos: {
    cols: [
      ['id', 'ID'], ['fecha', 'Fecha'], ['tipo', 'Tipo'], ['importe', 'Importe'], ['cuenta', 'Cuenta'],
      ['destino', 'Cuenta destino'], ['cat', 'Categoría'], ['sub', 'Subcategoría'], ['nota', 'Nota'],
      ['miParte', 'Mi parte'], ['nomina', 'Es nómina'], ['reembolso', 'Es reembolso'],
      ['vinculado', 'Vinculado a'], ['origen', 'Origen'], ['act', 'Actualizado'], ['pagaDeuda', 'Salda deuda de']
    ],
    fechas: ['fecha'], dinero: ['importe', 'miParte'], bool: ['nomina', 'reembolso']
  },
  Cuentas: {
    cols: [
      ['id', 'ID'], ['nombre', 'Nombre'], ['tipo', 'Tipo'], ['saldoInicial', 'Saldo inicial'],
      ['fechaInicial', 'Fecha saldo inicial'], ['orden', 'Orden'], ['redondeoA', 'Redondeo débito a'],
      ['tae', 'TAE %'], ['retencion', 'Retención %'], ['interesesHasta', 'Intereses calculados hasta'],
      ['interesResto', 'Resto intereses'], ['activa', 'Activa']
    ],
    fechas: ['fechaInicial', 'interesesHasta'], dinero: ['saldoInicial'], bool: ['activa']
  },
  Categorias: {
    cols: [['cat', 'Categoría'], ['sub', 'Subcategoría'], ['tipo', 'Tipo'], ['icono', 'Icono'], ['presupuesto', 'Presupuesto mensual']],
    fechas: [], dinero: ['presupuesto'], bool: []
  },
  Fijos: {
    cols: [
      ['id', 'ID'], ['concepto', 'Concepto'], ['tipo', 'Tipo'], ['importe', 'Importe'], ['cuenta', 'Cuenta'],
      ['destino', 'Cuenta destino'], ['cat', 'Categoría'], ['sub', 'Subcategoría'], ['frecuencia', 'Frecuencia'],
      ['dia', 'Día del mes'], ['cada', 'Cada (días)'], ['proxima', 'Próxima fecha'], ['restantes', 'Pagos restantes'],
      ['modo', 'Modo'], ['reembolso', 'Es reembolso'], ['compromiso', 'Cuenta en presupuesto'],
      ['financiaDesde', 'Se repone desde'], ['activo', 'Activo']
    ],
    fechas: ['proxima'], dinero: ['importe'], bool: ['reembolso', 'compromiso', 'activo']
  },
  Config: {
    cols: [['clave', 'Clave'], ['valor', 'Valor'], ['desc', 'Descripción']],
    fechas: [], dinero: [], bool: []
  },
  Deudas: {
    cols: [['id', 'ID'], ['movId', 'Movimiento'], ['fecha', 'Fecha'], ['persona', 'Persona'], ['importe', 'Importe'], ['concepto', 'Concepto']],
    fechas: ['fecha'], dinero: ['importe'], bool: []
  },
  Debo: {
    cols: [['id', 'ID'], ['persona', 'Persona'], ['concepto', 'Concepto'], ['importe', 'Importe'], ['fecha', 'Fecha']],
    fechas: ['fecha'], dinero: ['importe'], bool: []
  }
};

var DESC_CONFIG = {
  sueldo: 'Sueldo de referencia (se usa hasta que registres la nómina del mes)',
  inicioCiclo: 'Fecha de inicio del primer ciclo (última nómina antes de empezar a usar la app)',
  ahorroPct: 'Objetivo de ahorro, % de la nómina (el plan de pensiones solo cuenta como ahorro si su fijo NO cuenta en el presupuesto)',
  repartoInversion: '% del sobrante que va a inversión (el resto a la remunerada)',
  cuentaInversion: 'ID de la cuenta de inversión',
  cuentaRemunerada: 'ID de la cuenta remunerada',
  cuentaSobrante: 'ID de la cuenta cuyo saldo es "lo que sobra" al cobrar',
  tarjetaSobrante: 'ID de la tarjeta de crédito cuya deuda se descuenta del sobrante',
  cuentaNomina: 'ID de la cuenta donde entra la nómina',
  cuentaDefecto: 'Cuenta que aparece seleccionada al apuntar un gasto',
  extrasDesde: 'Desde qué fecha los ingresos extra cuentan como la nómina (50 % ahorro / 50 % gasto)'
};

// ---------------------------------------------------------------- Instalación

function instalar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(ZONA);
  var hoy = hoyISO();
  var datos = (typeof DATOS_INICIALES === 'function') ? DATOS_INICIALES(hoy) : plantillaVacia(hoy);

  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    if (sh.getLastRow() === 0) {
      var spec = HOJAS[nombre];
      sh.getRange(1, 1, 1, spec.cols.length).setValues([spec.cols.map(function (c) { return c[1]; })])
        .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  });

  var st = leerEstado();
  if (!st.cuentas.length) st.cuentas = datos.cuentas;
  if (!st.categorias.length) st.categorias = datos.categorias;
  if (!st.fijos.length) st.fijos = datos.fijos;
  Object.keys(datos.config).forEach(function (k) { if (st.config[k] === undefined) st.config[k] = datos.config[k]; });
  escribirTodo(st, { cuentas: true, categorias: true, fijos: true, config: true, movimientos: true });

  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CLAVE')) props.setProperty('CLAVE', claveAleatoria());
  try { props.setProperty('EMAIL', Session.getEffectiveUser().getEmail()); } catch (e) {}

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tareasDiarias') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareasDiarias').timeBased().everyDays(1).atHour(5).inTimezone(ZONA).create();

  tareasDiarias();
  Logger.log('Hucha instalada. Tu clave secreta es: ' + props.getProperty('CLAVE'));
  // Aviso no bloqueante: una ventana (alert) dejaría la ejecución esperando y acabaría en "tiempo de espera agotado".
  try { SpreadsheetApp.getActiveSpreadsheet().toast('Instalación completada. Ve a menú Hucha → Ver clave secreta.', 'Hucha ✅', 15); } catch (e) {}
}

function plantillaVacia(hoy) {
  return {
    config: {
      sueldo: 0, inicioCiclo: hoy, ahorroPct: 50, repartoInversion: 30,
      cuentaInversion: 'inversion', cuentaRemunerada: 'remunerada', cuentaSobrante: 'principal',
      tarjetaSobrante: '', cuentaNomina: 'principal', cuentaDefecto: 'principal'
    },
    cuentas: [
      { id: 'principal', nombre: 'Cuenta principal', tipo: 'diario', saldoInicial: 0, fechaInicial: hoy, orden: 1, activa: true },
      { id: 'efectivo', nombre: 'Metálico', tipo: 'efectivo', saldoInicial: 0, fechaInicial: hoy, orden: 2, activa: true },
      { id: 'remunerada', nombre: 'Remunerada', tipo: 'ahorro', saldoInicial: 0, fechaInicial: hoy, orden: 3, tae: 0, retencion: 19, interesesHasta: HuchaCore.addDays(hoy, -1), interesResto: 0, activa: true },
      { id: 'inversion', nombre: 'Inversión', tipo: 'inversion', saldoInicial: 0, fechaInicial: hoy, orden: 4, activa: true }
    ],
    categorias: HuchaCore.categoriasBase(),
    fijos: []
  };
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Hucha')
    .addItem('Ejecutar automáticos y actualizar resumen', 'tareasDiarias')
    .addItem('Ver clave secreta', 'verClave')
    .addItem('Cambiar clave secreta', 'nuevaClave')
    .addToUi();
}

function verClave() {
  SpreadsheetApp.getUi().alert('Clave secreta:\n' + PropertiesService.getScriptProperties().getProperty('CLAVE'));
}

function claveAleatoria() {
  // 2 UUID v4 → 244 bits aleatorios
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function nuevaClave() {
  var c = claveAleatoria();
  PropertiesService.getScriptProperties().setProperty('CLAVE', c);
  SpreadsheetApp.getUi().alert('Nueva clave (actualízala en la app):\n' + c);
}

// ---------------------------------------------------------------- Tareas

function tareasDiarias() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var st = leerEstado();
    var nuevos = HuchaCore.procesarAutomaticos(st, hoyISO());
    escribirTodo(st, { movimientos: nuevos.length > 0, fijos: true, cuentas: true });
    actualizarResumen(st);
  } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- API web

function doGet() {
  return ContentService.createTextOutput('Hucha API funcionando. Usa la app para conectar.');
}

function doPost(e) {
  var res;
  try {
    var cuerpo = e && e.postData && e.postData.contents || '';
    if (cuerpo.length > 1000000) throw new Error('PETICION_INVALIDA');
    var req;
    try { req = JSON.parse(cuerpo); } catch (x) { throw new Error('PETICION_INVALIDA'); }
    var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if (!clave || !igualSeguro(String(req && req.clave || ''), clave)) {
      registrarFallo('Clave incorrecta');
      throw new Error('CLAVE_INCORRECTA');
    }
    var ops = validarOps(req.ops || []);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var st = leerEstado();
      var antes = firma(st);
      HuchaCore.aplicarOps(st, ops);
      HuchaCore.procesarAutomaticos(st, hoyISO());
      var despues = firma(st);
      var cambios = {};
      Object.keys(despues).forEach(function (k) { cambios[k] = despues[k] !== antes[k]; });
      escribirTodo(st, cambios);
      if (cambios.movimientos) actualizarResumen(st);
      res = { ok: true, version: API_VERSION, estado: st, hoy: hoyISO(), aplicadas: ops.length, seguridad: resumenSeguridad() };
    } finally { lock.releaseLock(); }
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- Seguridad

/** Comparación en tiempo constante (no revela cuántos caracteres coinciden). */
function igualSeguro(a, b) {
  var d = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) d |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  return d === 0;
}

function registrarFallo(motivo) {
  var props = PropertiesService.getScriptProperties(), ahora = Date.now();
  var lista = [];
  try { lista = JSON.parse(props.getProperty('FALLOS') || '[]'); } catch (x) {}
  lista.push(ahora);
  lista = lista.filter(function (t) { return ahora - t < 30 * 86400000; }).slice(-300);
  props.setProperty('FALLOS', JSON.stringify(lista));
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Seguridad') || ss.insertSheet('Seguridad');
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, 2).setValues([['Fecha y hora', 'Evento']]).setFontWeight('bold');
    sh.appendRow([new Date(), motivo]);
  } catch (x) {}
  var email = props.getProperty('EMAIL'), ultimo = +(props.getProperty('ULTIMO_EMAIL') || 0);
  if (email && ahora - ultimo > 3600000) {
    var dia = lista.filter(function (t) { return ahora - t < 86400000; }).length;
    try {
      MailApp.sendEmail(email, '⚠️ Hucha: intento de acceso con clave incorrecta',
        'Alguien ha intentado acceder a tu hoja de Hucha con una clave secreta incorrecta.\n\n' +
        'Intentos en las últimas 24 horas: ' + dia + '\n' +
        'Último: ' + Utilities.formatDate(new Date(ahora), ZONA, 'dd/MM/yyyy HH:mm') + '\n\n' +
        'Si no has sido tú (por ejemplo, al escribir mal la clave), te recomendamos:\n' +
        '1. Abrir la hoja → menú Hucha → Cambiar clave secreta.\n' +
        '2. Poner la nueva clave en la app (Ajustes → Conexión).\n\n' +
        'Tus datos no se han enviado: sin la clave correcta la API no devuelve nada.\n' +
        'Solo recibirás un aviso como máximo cada hora.');
      props.setProperty('ULTIMO_EMAIL', String(ahora));
    } catch (x) {}
  }
  Utilities.sleep(1500); // frena los intentos automáticos
}

function resumenSeguridad() {
  var lista = [];
  try { lista = JSON.parse(PropertiesService.getScriptProperties().getProperty('FALLOS') || '[]'); } catch (x) {}
  var ahora = Date.now(), sem = lista.filter(function (t) { return ahora - t < 7 * 86400000; });
  return { fallos7d: sem.length, ultimo: sem.length ? sem[sem.length - 1] : null };
}

var RE_ID = /^[A-Za-z0-9_-]{1,80}$/, RE_FECHA = /^\d{4}-\d{2}-\d{2}$/, RE_ORIGEN = /^(manual|redondeo|interes|fijo:[A-Za-z0-9_-]{1,60})$/;

function invalida() { return new Error('PETICION_INVALIDA'); }
function vTexto(v, max) { v = v === null || v === undefined ? '' : String(v); if (v.length > max) throw invalida(); return v; }
function vId(v, opcional) { v = vTexto(v, 80); if (v === '' && opcional) return ''; if (!RE_ID.test(v)) throw invalida(); return v; }
function vNum(v, opcional) {
  if ((v === '' || v === null || v === undefined) && opcional) return '';
  if (typeof v !== 'number' || !isFinite(v) || Math.abs(v) > 1e7) throw invalida();
  return Math.round(v * 100) / 100;
}

function vEntero(v, min, max) {
  if (typeof v !== 'number' || Math.floor(v) !== v || v < min || v > max) throw invalida();
  return v;
}

/** Solo se aceptan operaciones conocidas y con datos del tipo y tamaño esperados. */
function validarOps(ops) {
  if (!Array.isArray(ops) || ops.length > 500) throw invalida();
  var cfgOk = Object.keys(DESC_CONFIG);
  return ops.map(function (op) {
    if (!op || typeof op !== 'object') throw invalida();
    if (op.op === 'mov') {
      var m = op.mov || {};
      var fecha = vTexto(m.fecha, 10);
      if (!RE_FECHA.test(fecha)) throw invalida();
      if (['gasto', 'ingreso', 'transferencia', 'ajuste'].indexOf(m.tipo) < 0) throw invalida();
      var origen = vTexto(m.origen || 'manual', 70);
      if (!RE_ORIGEN.test(origen)) throw invalida();
      return { op: 'mov', mov: {
        id: vId(m.id), fecha: fecha, tipo: m.tipo, importe: vNum(m.importe),
        cuenta: vId(m.cuenta), destino: vId(m.destino, true), cat: vTexto(m.cat, 60), sub: vTexto(m.sub, 60),
        nota: vTexto(m.nota, 200), miParte: vNum(m.miParte, true), nomina: m.nomina === true, reembolso: m.reembolso === true,
        pagaDeuda: m.tipo === 'ingreso' ? vTexto(m.pagaDeuda, 40).trim() : '',
        vinculado: vId(m.vinculado, true), origen: origen, act: typeof m.act === 'number' && isFinite(m.act) ? m.act : Date.now()
      } };
    }
    if (op.op === 'borrar') return { op: 'borrar', id: vId(op.id) };
    if (op.op === 'config') {
      if (cfgOk.indexOf(op.clave) < 0) throw invalida();
      var v = typeof op.valor === 'number' ? vNum(op.valor) : vTexto(op.valor, 100);
      return { op: 'config', clave: op.clave, valor: v };
    }
    if (op.op === 'fijo') {
      var f = op.fijo || {};
      if (['gasto', 'ingreso', 'transferencia'].indexOf(f.tipo) < 0) throw invalida();
      if (['mensual', 'dias'].indexOf(f.frecuencia) < 0) throw invalida();
      var prox = vTexto(f.proxima, 10);
      if (!RE_FECHA.test(prox)) throw invalida();
      var concepto = vTexto(f.concepto, 80).trim();
      if (!concepto) throw invalida();
      var importe = vNum(f.importe);
      if (importe < 0) throw invalida();
      return { op: 'fijo', fijo: {
        id: vId(f.id), concepto: concepto, tipo: f.tipo, importe: importe,
        cuenta: vId(f.cuenta), destino: f.tipo === 'transferencia' ? vId(f.destino) : '',
        cat: vTexto(f.cat, 60), sub: vTexto(f.sub, 60), frecuencia: f.frecuencia,
        dia: f.frecuencia === 'mensual' ? vEntero(f.dia, 1, 31) : '',
        cada: f.frecuencia === 'dias' ? vEntero(f.cada, 1, 366) : '',
        proxima: prox, restantes: f.restantes === '' || f.restantes === null || f.restantes === undefined ? '' : vEntero(f.restantes, 0, 1000),
        modo: f.modo === 'liquidar' ? 'liquidar' : '', reembolso: f.reembolso === true, compromiso: f.compromiso === true,
        financiaDesde: vId(f.financiaDesde, true), activo: f.activo !== false
      } };
    }
    if (op.op === 'borrarFijo') return { op: 'borrarFijo', id: vId(op.id) };
    if (op.op === 'deudas') {
      var movId = vId(op.movId);
      if (!Array.isArray(op.lista) || op.lista.length > 50) throw invalida();
      return { op: 'deudas', movId: movId, lista: op.lista.map(function (d) {
        var persona = vTexto(d.persona, 40).trim(), fd = vTexto(d.fecha, 10);
        if (!persona || !RE_FECHA.test(fd)) throw invalida();
        var imp = vNum(d.importe);
        if (!(imp > 0)) throw invalida();
        return { id: vId(d.id), movId: movId, fecha: fd, persona: persona, importe: imp, concepto: vTexto(d.concepto, 120) };
      }) };
    }
    if (op.op === 'debo') {
      var b = op.debo || {}, pb = vTexto(b.persona, 40).trim(), fb = vTexto(b.fecha, 10);
      if (!pb || !RE_FECHA.test(fb)) throw invalida();
      var ib = vNum(b.importe, true);
      if (ib !== '' && ib < 0) throw invalida();
      return { op: 'debo', debo: { id: vId(b.id), persona: pb, concepto: vTexto(b.concepto, 120), importe: ib, fecha: fb } };
    }
    if (op.op === 'borrarDebo') return { op: 'borrarDebo', id: vId(op.id) };
    if (op.op === 'categoria') {
      if (['gasto', 'ingreso'].indexOf(op.tipo) < 0) throw invalida();
      var nombre = vTexto(op.cat, 40).trim(), antes = vTexto(op.antes, 40);
      if (!nombre) throw invalida();
      if (antes === 'Ingresos' && nombre !== 'Ingresos') throw invalida();
      if (!Array.isArray(op.subs) || op.subs.length > 40) throw invalida();
      var vistos = {};
      var subs = op.subs.map(function (sb) {
        var n = vTexto(sb && sb.nombre, 40).trim();
        if (!n || vistos[n.toLowerCase()]) throw invalida();
        vistos[n.toLowerCase()] = true;
        return { antes: vTexto(sb.antes, 40), nombre: n };
      });
      if (nombre === 'Ingresos') ['Nómina', 'Intereses'].forEach(function (fija) { if (!vistos[fija.toLowerCase()]) throw invalida(); });
      var pres = op.presupuesto === '' || op.presupuesto === undefined ? '' : vNum(op.presupuesto);
      if (pres !== '' && pres < 0) throw invalida();
      return { op: 'categoria', tipo: op.tipo, antes: antes, cat: nombre, icono: vTexto(op.icono, 16), presupuesto: pres, subs: subs };
    }
    if (op.op === 'borrarCategoria') {
      var bc = vTexto(op.cat, 40);
      if (!bc || bc === 'Ingresos' || ['gasto', 'ingreso'].indexOf(op.tipo) < 0) throw invalida();
      return { op: 'borrarCategoria', cat: bc, tipo: op.tipo };
    }
    if (op.op === 'presupuesto') {
      var val = op.valor === '' ? '' : vNum(op.valor);
      if (val !== '' && val < 0) throw invalida();
      return { op: 'presupuesto', cat: vTexto(op.cat, 60), valor: val };
    }
    throw invalida();
  });
}

function firma(st) {
  return {
    movimientos: JSON.stringify(st.movimientos), cuentas: JSON.stringify(st.cuentas),
    categorias: JSON.stringify(st.categorias), fijos: JSON.stringify(st.fijos), config: JSON.stringify(st.config),
    deudas: JSON.stringify(st.deudas), debo: JSON.stringify(st.debo)
  };
}

// ---------------------------------------------------------------- Lectura / escritura

function hoyISO() { return Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd'); }

function aISO(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function aBool(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'sí' || s === 'si' || s === 'true' || s === 'x' || s === '1';
}

function leerHoja(nombre) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!sh || sh.getLastRow() < 2) return [];
  var spec = HOJAS[nombre];
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, spec.cols.length).getValues();
  return vals.filter(function (r) { return r.join('') !== ''; }).map(function (r) {
    var o = {};
    spec.cols.forEach(function (c, i) {
      var k = c[0], v = r[i];
      if (spec.fechas.indexOf(k) >= 0) v = aISO(v);
      else if (spec.bool.indexOf(k) >= 0) v = aBool(v);
      else if (spec.dinero.indexOf(k) >= 0) v = v === '' ? '' : HuchaCore.num(v);
      else if (v instanceof Date) v = aISO(v);
      o[k] = v;
    });
    return o;
  });
}

function leerEstado() {
  var cfg = {};
  leerHoja('Config').forEach(function (r) { if (r.clave) cfg[r.clave] = r.valor instanceof Date ? aISO(r.valor) : r.valor; });
  ['sueldo', 'ahorroPct', 'repartoInversion'].forEach(function (k) { if (cfg[k] !== undefined && cfg[k] !== '') cfg[k] = HuchaCore.num(cfg[k]); });
  if (cfg.inicioCiclo) cfg.inicioCiclo = aISO(cfg.inicioCiclo);
  var movs = leerHoja('Movimientos').map(function (m) {
    m.tipo = String(m.tipo).toLowerCase();
    m.id = String(m.id);
    m.act = +m.act || 0;
    return m;
  });
  var fijos = leerHoja('Fijos').map(function (f) {
    f.id = String(f.id); f.tipo = String(f.tipo).toLowerCase(); f.frecuencia = String(f.frecuencia || 'mensual').toLowerCase();
    f.dia = f.dia === '' ? '' : +f.dia; f.cada = f.cada === '' ? '' : +f.cada;
    f.restantes = f.restantes === '' ? '' : +f.restantes;
    return f;
  });
  var cuentas = leerHoja('Cuentas').map(function (c) {
    c.id = String(c.id); c.orden = +c.orden || 0;
    c.tae = c.tae === '' ? '' : HuchaCore.num(c.tae); c.retencion = c.retencion === '' ? '' : HuchaCore.num(c.retencion);
    c.interesResto = HuchaCore.num(c.interesResto);
    return c;
  });
  var cats = leerHoja('Categorias').map(function (c) { c.tipo = String(c.tipo || 'gasto').toLowerCase(); return c; });
  var deudas = leerHoja('Deudas').map(function (d) { d.id = String(d.id); d.movId = String(d.movId); d.persona = String(d.persona).trim(); d.concepto = String(d.concepto); return d; });
  var debo = leerHoja('Debo').map(function (d) { d.id = String(d.id); d.persona = String(d.persona).trim(); d.concepto = String(d.concepto); return d; });
  movs.forEach(function (m) { m.pagaDeuda = m.pagaDeuda ? String(m.pagaDeuda).trim() : ''; });
  return { config: cfg, cuentas: cuentas, categorias: cats, fijos: fijos, movimientos: movs, deudas: deudas, debo: debo };
}

function escribirHoja(nombre, filas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
  var spec = HOJAS[nombre], n = spec.cols.length;
  // Cabecera siempre al día (las versiones nuevas pueden añadir columnas al final)
  sh.getRange(1, 1, 1, n).setValues([spec.cols.map(function (c) { return c[1]; })])
    .setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (!filas.length) return;
  var vals = filas.map(function (o) {
    return spec.cols.map(function (c) {
      var k = c[0], v = o[k];
      if (v === undefined || v === null) return '';
      if (spec.bool.indexOf(k) >= 0) return v ? 'Sí' : '';
      // Evita la inyección de fórmulas: un texto que empiece por = + - @ se guarda como texto literal.
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
      if (spec.fechas.indexOf(k) >= 0 && v) { var p = String(v).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
      return v;
    });
  });
  sh.getRange(2, 1, vals.length, n).setValues(vals);
  spec.fechas.forEach(function (k) {
    var i = spec.cols.map(function (c) { return c[0]; }).indexOf(k);
    sh.getRange(2, i + 1, vals.length, 1).setNumberFormat('dd/mm/yyyy');
  });
  spec.dinero.forEach(function (k) {
    var i = spec.cols.map(function (c) { return c[0]; }).indexOf(k);
    sh.getRange(2, i + 1, vals.length, 1).setNumberFormat('#,##0.00 "€"');
  });
}

function escribirTodo(st, que) {
  if (que.movimientos) {
    st.movimientos.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.act || 0) - (b.act || 0); });
    escribirHoja('Movimientos', st.movimientos);
  }
  if (que.cuentas) escribirHoja('Cuentas', st.cuentas.slice().sort(function (a, b) { return a.orden - b.orden; }));
  if (que.categorias) escribirHoja('Categorias', st.categorias);
  if (que.fijos) escribirHoja('Fijos', st.fijos);
  if (que.deudas) escribirHoja('Deudas', (st.deudas || []).slice().sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; }));
  if (que.debo) escribirHoja('Debo', st.debo || []);
  if (que.config) escribirHoja('Config', Object.keys(st.config).map(function (k) {
    return { clave: k, valor: st.config[k], desc: DESC_CONFIG[k] || '' };
  }));
}

// ---------------------------------------------------------------- Resumen mensual

function actualizarResumen(st) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Resumen') || ss.insertSheet('Resumen');
  var hoy = hoyISO();
  var stats = HuchaCore.estadisticas(st, hoy);
  var cats = HuchaCore.categoriasBase().filter(function (c) { return c.tipo === 'gasto' && !c.sub; }).map(function (c) { return c.cat; });
  (st.categorias || []).forEach(function (c) { if (c.tipo === 'gasto' && !c.sub && cats.indexOf(c.cat) < 0) cats.push(c.cat); });
  var cab = ['Inicio ciclo', 'Fin ciclo', 'Nómina', 'Ingresos totales', 'Intereses', 'Gastos', 'Ahorro', 'Tasa de ahorro', 'Patrimonio'].concat(cats);
  var filas = stats.map(function (s) {
    var f = [s.inicio, s.fin, s.nomina, s.ingresos, s.intereses, s.gastos, s.ahorro, s.tasaAhorro === null ? '' : s.tasaAhorro, s.patrimonio];
    cats.forEach(function (c) { f.push(s.porCategoria[c] || 0); });
    return f.map(function (v, i) {
      if (i < 2) { var p = String(v).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
      return v;
    });
  }).reverse();
  sh.clear();
  sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (filas.length) {
    sh.getRange(2, 1, filas.length, cab.length).setValues(filas);
    sh.getRange(2, 1, filas.length, 2).setNumberFormat('dd/mm/yyyy');
    sh.getRange(2, 3, filas.length, 5).setNumberFormat('#,##0.00 "€"');
    sh.getRange(2, 8, filas.length, 1).setNumberFormat('0.0%');
    sh.getRange(2, 9, filas.length, cab.length - 8).setNumberFormat('#,##0.00 "€"');
  }
  sh.getRange(filas.length + 3, 1).setValue('Ciclo = de nómina a nómina. Se actualiza solo cada día y con cada cambio desde la app.').setFontStyle('italic').setFontColor('#777777');
}
