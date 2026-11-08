/* Hucha · iconos de línea (24×24, trazo) */
var HuchaIconos = (function () {
  'use strict';
  var P = {
    cart: '<path d="M3 4h2l2.4 11h10.2L20 8H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    utensils: '<path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.2 1.2-3.5 3.8-3.5 7v3H17"/>',
    coffee: '<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z"/><path d="M16 9h1.5a2.5 2.5 0 0 1 0 5H16M7 3v2M10 3v2M13 3v2M3 21h14"/>',
    fuel: '<path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M3 20h12M14 9h2.5A1.5 1.5 0 0 1 18 10.5V16a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h4"/>',
    car: '<path d="M5 11l1.6-4.2A2 2 0 0 1 8.5 5.5h7a2 2 0 0 1 1.9 1.3L19 11M3.5 17V13a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v4h-17Z"/><path d="M5.5 17v2M18.5 17v2"/><circle cx="7.5" cy="14" r=".6" fill="currentColor"/><circle cx="16.5" cy="14" r=".6" fill="currentColor"/>',
    bus: '<rect x="4.5" y="3.5" width="15" height="14" rx="2.5"/><path d="M4.5 11h15M7 17.5V20M17 17.5V20"/><circle cx="8" cy="14.5" r=".6" fill="currentColor"/><circle cx="16" cy="14.5" r=".6" fill="currentColor"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
    tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M9 3l3 3 3-3"/>',
    repeat: '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 12V10A4 4 0 0 1 7.5 6h13M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12v2a4 4 0 0 1-4 4h-13"/>',
    laptop: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19.5h20"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    pill: '<rect x="2.8" y="8.2" width="18.4" height="7.6" rx="3.8" transform="rotate(-45 12 12)"/><path d="m9.3 9.3 5.4 5.4"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>',
    party: '<path d="M5 20 9 8l7 7-11 5Z"/><path d="M14 4v2M19 9h2M17.5 5.5 16 7M12 3l1 1"/>',
    plane: '<path d="M10.5 13.5 3 11l1.5-1.5 8 .5 4-4.5a2 2 0 0 1 3 3l-4.5 4 .5 8L14 22l-2.5-7.5L8 18v3l-1.5 1-1-3.5L2 17.5l1-1.5h3Z"/>',
    gamepad: '<path d="M7 7h10a4.5 4.5 0 0 1 4.4 5.5l-1 4.4a2.3 2.3 0 0 1-4 .9L14.5 15h-5l-1.9 2.8a2.3 2.3 0 0 1-4-.9l-1-4.4A4.5 4.5 0 0 1 7 7Z"/><path d="M8 10v3M6.5 11.5h3"/><circle cx="16" cy="11" r=".7" fill="currentColor"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2V5Z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/>',
    shirt: '<path d="M8 3 3 6l2 4 2-1v11h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0Z"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8.5h14V12M12 8v12.5M12 8C10 4 6.5 4.5 7 7c.3 1 2 1 5 1Zm0 0c2-4 5.5-3.5 5-1-.3 1-2 1-5 1Z"/>',
    paw: '<circle cx="7" cy="10" r="1.8"/><circle cx="10.5" cy="6.5" r="1.8"/><circle cx="14.5" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/><path d="M8.5 17.5c0-2.5 1.6-5 3.5-5s3.5 2.5 3.5 5c0 1.6-1.6 2.5-3.5 2-1.9.5-3.5-.4-3.5-2Z"/>',
    baby: '<circle cx="12" cy="12" r="8.5"/><path d="M9 15a4 4 0 0 0 6 0"/><circle cx="9" cy="10.5" r=".6" fill="currentColor"/><circle cx="15" cy="10.5" r=".6" fill="currentColor"/><path d="M12 3.5c-1 1.5-1 3 .5 3"/>',
    grad: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5Z"/><path d="M6.5 11v5c3 2.5 8 2.5 11 0v-5M21.5 9v5"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v2M3 12.5h18"/>',
    chart: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    bank: '<path d="M3 9.5 12 4l9 5.5M4 10h16M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    jar: '<path d="M8 3.5h8M7.5 6h9l.5 2.5c1.5 1 2 2.5 2 4.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-5c0-2 .5-3.5 2-4.5Z"/><path d="M9 13h6"/>',
    piggy: '<path d="M19 11c0-3.3-3.1-6-7-6-1.4 0-2.7.3-3.8.9L6 4.5V8a6 6 0 0 0-2 3H2.5v3.5h1.8A7 7 0 0 0 7 17.3V20h3v-1.6a8 8 0 0 0 4 0V20h3v-2.7a5.7 5.7 0 0 0 2-4.3"/><path d="M19 11h1.5"/><circle cx="15" cy="10" r=".6" fill="currentColor"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.7 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.8 7.5-9.5V6Z"/><path d="m9 12 2 2 4-4"/>',
    transfer: '<path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5"/>',
    arrowIn: '<path d="M12 4v12M6.5 10.5 12 16l5.5-5.5M5 20h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    handcoins: '<path d="M3 15h3l4.5 3h4.5l5-4a1.5 1.5 0 0 0-2-2.2L15 14h-4"/><path d="M11 14h2.5a1.5 1.5 0 0 0 0-3H9.5L6 13.5"/><circle cx="15.5" cy="5.5" r="2.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
    receipt: '<path d="M5.5 3h13v18l-2.2-1.5-2.1 1.5-2.2-1.5L9.8 21l-2.1-1.5L5.5 21Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    scale: '<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0Zm14 0-2.5 6a3 3 0 0 0 5 0Z"/>',
    question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    tag: '<path d="M3.5 12V4.5a1 1 0 0 1 1-1H12l8.5 8.5-8.5 8.5Z"/><circle cx="8" cy="8" r="1.3"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'
  };
  var DESDE_EMOJI = {
    '🛒': 'cart', '🍽': 'utensils', '🍽️': 'utensils', '☕': 'coffee', '⛽': 'fuel', '🚗': 'car', '🚌': 'bus', '🏠': 'home', '💡': 'bolt',
    '📺': 'tv', '🔁': 'repeat', '💻': 'laptop', '📱': 'phone', '💪': 'dumbbell', '💊': 'pill', '❤️': 'heart', '🎉': 'party',
    '✈️': 'plane', '🎮': 'gamepad', '📚': 'book', '👕': 'shirt', '💅': 'sparkle', '🎁': 'gift', '🐶': 'paw', '👶': 'baby',
    '🎓': 'grad', '💳': 'card', '📦': 'box', '💶': 'cash', '💵': 'cash', '💼': 'briefcase', '📈': 'chart', '📊': 'chart', '🏦': 'bank'
  };
  /** Iconos que se ofrecen al editar una categoría. */
  var ELEGIBLES = ['cart', 'utensils', 'coffee', 'fuel', 'car', 'bus', 'home', 'bolt', 'tv', 'repeat', 'laptop', 'phone', 'dumbbell', 'pill',
    'heart', 'party', 'plane', 'gamepad', 'book', 'shirt', 'sparkle', 'gift', 'paw', 'baby', 'grad', 'card', 'box', 'cash', 'briefcase', 'chart', 'bank', 'tag'];

  function clave(nombre) {
    if (!nombre) return '';
    if (P[nombre]) return nombre;
    return DESDE_EMOJI[nombre] || DESDE_EMOJI[String(nombre).replace(/️/g, '')] || '';
  }
  /** SVG del icono; si es un emoji desconocido lo devuelve como texto. */
  function svg(nombre, clase) {
    var k = clave(nombre) || (nombre ? '' : 'tag');
    if (!k) return '<span class="ic-txt">' + String(nombre).replace(/[<>&"]/g, '') + '</span>';
    return '<svg class="ic' + (clase ? ' ' + clase : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + P[k] + '</svg>';
  }
  return { svg: svg, clave: clave, ELEGIBLES: ELEGIBLES };
})();
