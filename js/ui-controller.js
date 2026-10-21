// ═══════════════════════════════════════════════════════════════════
// ui-controller.js — CBTa 130 POS Pro v3.0
// Nota: Este archivo mantiene las funciones exportadas originales
// para compatibilidad, pero el rendering principal ahora se hace
// desde app.js con el nuevo sistema de diseño.
// ═══════════════════════════════════════════════════════════════════

/**
 * toggleElement — igual que el original
 */
export const toggleElement = (id, action) => {
  const el = document.getElementById(id);
  if(el) action === 'show' ? el.classList.remove('hidden') : el.classList.add('hidden');
};

/**
 * renderColaImpresion — ahora delega al sistema de app.js
 * Se mantiene exportada para compatibilidad con imports existentes.
 * La lógica visual real está en app.js → renderColaVenta() y renderColaFull()
 */
export const renderColaImpresion = (docs) => {
  // El nuevo app.js maneja el rendering directamente desde el listener de Firebase.
  // Esta función existe por compatibilidad si algún módulo externo la importa.
  console.log('[ui-controller] renderColaImpresion: delegado a app.js', docs.length, 'docs');
};

/**
 * renderStockRapido — delega al nuevo sistema
 * La lista de productos en la pantalla de venta ahora se renderiza
 * desde app.js → renderProdList() usando el array inventario[] en tiempo real.
 */
export const renderStockRapido = (prods) => {
  console.log('[ui-controller] renderStockRapido: delegado a app.js', prods.length, 'productos');
};

/**
 * actualizarUIDescuento — mantener por si se usa en módulos externos
 */
export const actualizarUIDescuento = (descuento) => {
  console.log('[ui-controller] actualizarUIDescuento:', descuento);
};
