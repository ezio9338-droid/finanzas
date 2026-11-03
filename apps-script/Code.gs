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

var HOJAS = {
  Movimientos: {
    cols: [
      ['id', 'ID'], ['fecha', 'Fecha'], ['tipo', 'Tipo'], ['importe', 'Importe'], ['cuenta', 'Cuenta'],
      ['destino', 'Cuenta destino'], ['cat', 'Categoría'], ['sub', 'Subcategoría'], ['nota', 'Nota'],
      ['miParte', 'Mi parte'], ['nomina', 'Es nómina'], ['reembolso', 'Es reembolso'],
      ['vinculado', 'Vinculado a'], ['origen', 'Origen'], ['act', 'Actualizado']
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
  }
};

var DESC_CONFIG = {
  sueldo: 'Sueldo de referencia (se usa hasta que registres la nómina del mes)',
  inicioCiclo: 'Fecha de inicio del primer ciclo (última nómina antes de empezar a usar la app)',
  ahorroPct: 'Objetivo de ahorro, % de la nómina (incluye el plan de pensiones)',
  repartoInversion: '% del sobrante que va a inversión (el resto a la remunerada)',
  cuentaInversion: 'ID de la cuenta de inversión',
  cuentaRemunerada: 'ID de la cuenta remunerada',
  cuentaSobrante: 'ID de la cuenta cuyo saldo es "lo que sobra" al cobrar',
  tarjetaSobrante: 'ID de la tarjeta de crédito cuya deuda se descuenta del sobrante',
  cuentaNomina: 'ID de la cuenta donde entra la nómina',
  cuentaDefecto: 'Cuenta que aparece seleccionada al apuntar un gasto'
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
  if (!props.getProperty('CLAVE')) props.setProperty('CLAVE', Utilities.getUuid().replace(/-/g, ''));

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'tareasDiarias') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('tareasDiarias').timeBased().everyDays(1).atHour(5).inTimezone(ZONA).create();

  tareasDiarias();
  Logger.log('Hucha instalada. Tu clave secreta es: ' + props.getProperty('CLAVE'));
  try { SpreadsheetApp.getUi().alert('Hucha instalada ✅\n\nTu clave secreta:\n' + props.getProperty('CLAVE') + '\n\nCópiala en la app (Ajustes → Conexión).'); } catch (e) {}
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

function nuevaClave() {
  var c = Utilities.getUuid().replace(/-/g, '');
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
    var req = JSON.parse(e.postData.contents);
    var clave = PropertiesService.getScriptProperties().getProperty('CLAVE');
    if (!clave || req.clave !== clave) throw new Error('CLAVE_INCORRECTA');
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var st = leerEstado();
      var antes = firma(st);
      HuchaCore.aplicarOps(st, req.ops || []);
      HuchaCore.procesarAutomaticos(st, hoyISO());
      var despues = firma(st);
      var cambios = {};
      Object.keys(despues).forEach(function (k) { cambios[k] = despues[k] !== antes[k]; });
      escribirTodo(st, cambios);
      if (cambios.movimientos) actualizarResumen(st);
      res = { ok: true, estado: st, hoy: hoyISO(), aplicadas: (req.ops || []).length };
    } finally { lock.releaseLock(); }
  } catch (err) {
    res = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

function firma(st) {
  return {
    movimientos: JSON.stringify(st.movimientos), cuentas: JSON.stringify(st.cuentas),
    categorias: JSON.stringify(st.categorias), fijos: JSON.stringify(st.fijos), config: JSON.stringify(st.config)
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
  return { config: cfg, cuentas: cuentas, categorias: cats, fijos: fijos, movimientos: movs };
}

function escribirHoja(nombre, filas) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  var spec = HOJAS[nombre], n = spec.cols.length;
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, n).clearContent();
  if (!filas.length) return;
  var vals = filas.map(function (o) {
    return spec.cols.map(function (c) {
      var k = c[0], v = o[k];
      if (v === undefined || v === null) return '';
      if (spec.bool.indexOf(k) >= 0) return v ? 'Sí' : '';
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
