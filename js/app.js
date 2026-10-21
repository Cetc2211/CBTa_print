// ═══════════════════════════════════════════════════════════════════
// app.js — CBTa 130 POS Pro v3.0
// Integración: Firebase (database.js sin cambios) + Nuevo diseño
// ═══════════════════════════════════════════════════════════════════
import {
  escucharColaImpresion,
  enviarDocumentoNube,
  MAX_ARCHIVO_BYTES,
  escucharInventarioDB,
  procesarCobroVenta,
  guardarNuevoProducto,
  actualizarProducto,
  eliminarRegistro,
  enviarPedidoAlumnoDB,
  actualizarDocCola,
  escucharPedidosAlumnoDB,
} from "./database.js";
import { subirFotoProducto, eliminarFotoProducto } from "./database_additions.js";

// ─── PRECIOS (misma config que el original) ────────────────────────
const PRECIOS = { laser_bn: 1.00, smart_tank: 2.00, smart_tank_saturada: 3.00 };
const LABELS  = { laser_bn: 'Láser B&N', smart_tank: 'Smart Tank Color', qr: 'Etiquetas QR' };

// ─── ESTADO GLOBAL ─────────────────────────────────────────────────
let carrito       = [];
let metodo        = 'Efectivo';
let editProdId    = null;
let tipoImpAlumno = 'laser_bn';
let scanStream    = null;
let scanTimer     = null;
let chSem = null, chTipo = null;
let colaActual    = [];    // snapshot en tiempo real de Firebase
let inventario    = [];    // snapshot en tiempo real de Firebase
let adminIniciado = false;
let seccionAdminActiva = 'dashboard';   // sección visible del panel admin
let multiImagenes  = [];   // [{file,img,sel,url}] modo varias imágenes (alumno)
let margenImagen   = 'normal'; // 'normal' | 'cero' — margen al convertir imagen→PDF
let saturacionAlumno  = { cobertura:0, colorPct:0, saturada:false }; // detección en el archivo del alumno
let adminImgSaturacion = null;   // detección en la imagen del flujo admin (tab imagen)
let carritoAlumno  = [];   // pedido del alumno (tienda con QR)
let alumnoIniciado = false;
let scanCtx        = 'caja';  // contexto del escáner: 'caja' | 'alumno'
let qtyProdId      = null;    // producto abierto en el modal de cantidad (alumno)
let pedidosAlumno  = [];      // pedidos de alumnos (docs de cola_impresion con pedidoAlumno:true)

// ─── PRECIO UNITARIO + DETECCIÓN DE SATURACIÓN DE TINTA ────────────
// Saturada = el contenido (foto) lleva tinta en >= UMBRAL_SATURACION de su
// superficie, es decir es una impresión "de tinta por todo el área".
// Documentos con fondo blanco quedan en precio normal.
const UMBRAL_SATURACION = 0.60;

function precioUnitario(tipo, saturada){
  if(tipo === 'qr') return 0; // etiquetas de inventario: uso interno, no se cobra
  if(tipo === 'smart_tank' && saturada) return PRECIOS.smart_tank_saturada;
  return PRECIOS[tipo] || PRECIOS.laser_bn;
}

// Analiza un canvas y devuelve métricas de tinta (fracciones 0..1):
//  cobertura = tinta sobre TODA la superficie analizada
//  colorPct  = pixeles cromáticos sobre el total
//  densidad  = tinta DENTRO del área con contenido (ignora bordes blancos)
function analizarCoberturaCanvas(canvas){
  try{
    const W = canvas.width, H = canvas.height;
    if(!W || !H) return null;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, W, H).data;
    const paso = Math.max(1, Math.floor(Math.max(W, H) / 160)); // muestreo ligero
    const cols = Math.ceil(W / paso), rows = Math.ceil(H / paso);
    const tinta = new Uint8Array(cols * rows);
    const crom  = new Uint8Array(cols * rows);
    let total = 0, nTinta = 0, nCrom = 0;
    let minX = cols, maxX = -1, minY = rows, maxY = -1;
    for(let ry = 0; ry < rows; ry++){
      for(let cx = 0; cx < cols; cx++){
        const x = Math.min(W-1, cx*paso), y = Math.min(H-1, ry*paso);
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        total++;
        if(a < 16) continue;                    // transparente = sin tinta
        const lum = 0.299*r + 0.587*g + 0.114*b;
        if(lum < 243){                          // pixel con tinta (no blanco)
          tinta[ry*cols+cx] = 1; nTinta++;
          if(cx < minX) minX = cx;  if(cx > maxX) maxX = cx;
          if(ry < minY) minY = ry;  if(ry > maxY) maxY = ry;
          const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
          if(mx - mn > 28){ crom[ry*cols+cx] = 1; nCrom++; }
        }
      }
    }
    if(!total || !nTinta) return { cobertura:0, colorPct:0, densidad:0 };
    // Segunda pasada: densidad de tinta dentro de la caja que encierra el contenido
    let enCaja = 0, cajTinta = 0;
    for(let ry = minY; ry <= maxY; ry++){
      for(let cx = minX; cx <= maxX; cx++){
        enCaja++;
        if(tinta[ry*cols+cx]) cajTinta++;
      }
    }
    return {
      cobertura: nTinta/total,
      colorPct:  nCrom/total,
      densidad:  enCaja ? cajTinta/enCaja : 0,
    };
  }catch(e){ return null; }
}

// Dibuja la imagen (con rotación) en un canvas pequeño y mide su cobertura
function analizarImagen(img, rotation = 0){
  try{
    const isRot = (rotation === 90 || rotation === -90 || rotation === 270);
    const iw = isRot ? img.naturalHeight : img.naturalWidth;
    const ih = isRot ? img.naturalWidth  : img.naturalHeight;
    if(!iw || !ih) return null;
    const f = Math.min(1, 200 / Math.max(iw, ih));
    const c = document.createElement('canvas');
    c.width  = Math.max(1, Math.round(iw * f));
    c.height = Math.max(1, Math.round(ih * f));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width/2, c.height/2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.drawImage(img, -img.naturalWidth*f/2, -img.naturalHeight*f/2,
      img.naturalWidth*f, img.naturalHeight*f);
    ctx.restore();
    return analizarCoberturaCanvas(c);
  }catch(e){ return null; }
}

function recalcularSaturacionImagen(){
  if(!imagenActual){
    saturacionAlumno = { cobertura:0, colorPct:0, saturada:false };
    return;
  }
  const r = analizarImagen(imagenActual, imagenRotation);
  saturacionAlumno = (r && r.densidad !== undefined)
    ? { cobertura: r.densidad, colorPct: r.colorPct, saturada: r.densidad >= UMBRAL_SATURACION }
    : { cobertura:0, colorPct:0, saturada:false };
}

function recalcularSaturacionMulti(){
  const sel = multiSeleccionadas();
  if(!sel.length){
    saturacionAlumno = { cobertura:0, colorPct:0, saturada:false };
    return;
  }
  const promedio  = sel.reduce((a,m)=>a+(m.densidad||0), 0) / sel.length;
  const colorProm = sel.reduce((a,m)=>a+(m.colorPct||0), 0) / sel.length;
  saturacionAlumno = { cobertura: promedio, colorPct: colorProm, saturada: promedio >= UMBRAL_SATURACION };
}

function recalcularSaturacion(){
  if(multiImagenes.length) recalcularSaturacionMulti();
  else if(imagenActual)    recalcularSaturacionImagen();
  actualizarCostoAlumno();
}

function etiquetaTipoAlumno(){
  if(tipoImpAlumno !== 'smart_tank') return 'B&N';
  return saturacionAlumno.saturada ? 'Color 🔥' : 'Color';
}

function reevaluarAdminImagen(){
  if(!adminImagenActual){
    adminImgSaturacion = null;
    const det = document.getElementById('im-img-detect');
    if(det) det.textContent = '';
    adminActualizarPrecioImagen();
    return;
  }
  const an = analizarImagen(adminImagenActual, adminImagenRotation);
  adminImgSaturacion = an
    ? { cobertura: an.densidad, colorPct: an.colorPct, saturada: an.densidad >= UMBRAL_SATURACION }
    : null;
  adminActualizarPrecioImagen();
}

// ─── LOCAL DB (egresos y movimientos de stock — localStorage) ──────
const LS = {
  get(k){ try{ return JSON.parse(localStorage.getItem('cbta_'+k)) || [] } catch{ return [] } },
  set(k,v){ localStorage.setItem('cbta_'+k, JSON.stringify(v)) },
};

// ─── TOAST ─────────────────────────────────────────────────────────
function toast(msg, t=''){
  const el = document.createElement('div');
  el.className = `toast ${t==='ok'?'ok':t==='er'?'er':t==='wa'?'wa':''}`;
  el.textContent = msg;
  el.style.transition = 'opacity .4s';
  document.getElementById('toasts').appendChild(el);
  const vida = t==='er' ? 8000 : 2600;   // los errores dejan más tiempo de lectura
  setTimeout(()=>el.style.opacity='0', vida);
  setTimeout(()=>el.remove(), vida + 400);
}

// ─── FORMAT ────────────────────────────────────────────────────────
const $m = n => '$' + (n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const fd = d => { if(!d) return ''; const [y,mo,dd]=d.split('-'); return `${dd}/${mo}/${y}`; };

function esVentaCobrada(v){
  if(typeof v?.cobrado === 'boolean') return v.cobrado;
  return (v?.metodo||'').toLowerCase() !== 'fiado';
}

function fechaContableVenta(v){
  if(!esVentaCobrada(v)) return null;
  return v.fechaCobro || v.fecha;
}

function ventasCobradas(arr=[]){
  return arr.filter(v=>esVentaCobrada(v));
}

function getWeekKey(date = new Date()){
  const base = new Date(date);
  base.setHours(0,0,0,0);
  const day = (base.getDay() + 6) % 7;
  base.setDate(base.getDate() - day);
  return base.toISOString().slice(0,10);
}

// ─── TOPBAR DATE ───────────────────────────────────────────────────
function setDate(){
  const d = new Date();
  const dias = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  const mes  = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  if(document.getElementById('dash-sub'))
    document.getElementById('dash-sub').textContent =
      `${dias[d.getDay()]} ${d.getDate()} de ${mes[d.getMonth()]} de ${d.getFullYear()}`;
}

// ═══════════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════
const ADMINS = {
  'CECILIO': '221182',
  'DANIKA':  '130130',
};

let roleSelected = null;

window.selRole = (btn, role) => {
  document.querySelectorAll('.rbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  roleSelected = role;
  document.getElementById('role-select').style.display = 'none';
  const form = document.getElementById('login-form');
  form.style.display = 'block';
  document.getElementById('login-label').textContent =
    role === 'admin' ? 'Nombre y contraseña:' : 'Ingrese su nombre:';
  document.getElementById('login-nombre').placeholder =
    role === 'admin' ? 'Nombre…' : 'Su nombre completo…';
  // Mostrar campo contraseña solo para admin
  document.getElementById('login-pass-wrap').style.display =
    role === 'admin' ? 'block' : 'none';
  document.getElementById('login-nombre').focus();
};

window.resetLogin = () => {
  roleSelected = null;
  document.getElementById('role-select').style.display = 'block';
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('login-nombre').value = '';
  document.getElementById('login-pass').value = '';
};

window.entrar = () => {
  const nombre = document.getElementById('login-nombre').value.trim().toUpperCase();
  if(!nombre){ toast('Ingrese su nombre','er'); return; }

  if(roleSelected === 'admin'){
    const pass = document.getElementById('login-pass').value.trim();
    if(!ADMINS[nombre]){
      toast('Usuario no encontrado','er'); return;
    }
    if(ADMINS[nombre] !== pass){
      toast('Contraseña incorrecta','er'); return;
    }
    localStorage.setItem('usuario_cbta', nombre);
    localStorage.removeItem('rol_cbta');
    mostrarAdmin(nombre);
  } else {
    if(nombre.length < 2){ toast('Nombre demasiado corto','er'); return; }
    localStorage.setItem('usuario_cbta', nombre);
    localStorage.setItem('rol_cbta', 'alumno');
    mostrarAlumno(nombre);
  }
};

document.getElementById('login-nombre')?.addEventListener('keydown', e=>{
  if(e.key==='Enter') window.entrar();
});
document.getElementById('login-pass')?.addEventListener('keydown', e=>{
  if(e.key==='Enter') window.entrar();
});

function verificarSesion(){
  const user = localStorage.getItem('usuario_cbta');
  if(!user){
    const params = new URLSearchParams(location.search);
    if(!params.get('destino') && !params.get('admin')){
      location.replace('/bienvenida.html');
      return;
    }
    showScreen('scr-login');
  } else if(ADMINS[user]){
    mostrarAdmin(user);
  } else if(localStorage.getItem('rol_cbta') === 'alumno') {
    mostrarAlumno(user);
  } else {
    mostrarAlumno(user);
  }
}

function mostrarAdmin(nombre){
  showScreen('scr-admin');
  document.getElementById('admin-nombre').textContent = 'Prof. ' + nombre;
  iniciarAdmin();
  setDate();
}

function mostrarAlumno(nombre){
  showScreen('scr-alumno');
  document.getElementById('alumno-saludo').textContent = `Hola, ${nombre} 👋`;
  iniciarAlumno(nombre);
}

window.cerrarSesion = () => {
  localStorage.removeItem('usuario_cbta');
  localStorage.removeItem('rol_cbta');
  location.reload();
};

function showScreen(id){
  document.querySelectorAll('[id^="scr-"]').forEach(s=>s.classList.remove('on'));
  document.getElementById(id).classList.add('on');
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN — LISTENERS FIREBASE EN TIEMPO REAL
// ═══════════════════════════════════════════════════════════════════
function iniciarAdmin(){
  if(adminIniciado){
    renderDash();
    return;
  }
  adminIniciado = true;

  // Cola de impresión — tiempo real desde Firestore
  escucharColaImpresion(snap => {
    colaActual = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    pedidosAlumno = colaActual.filter(d => d.pedidoAlumno);   // pedidos de alumnos (QR)
    actualizarColaBadge();
    renderColaImpresion();
    renderColaVenta();
    actualizarPedidosBadge();
    renderPedidosAlumno();
    // Si el admin está viendo la cola, refrescarla en vivo
    if (seccionAdminActiva === 'cola') renderColaFull();
  });

  // Inventario — tiempo real desde Firestore
  escucharInventarioDB(snap => {
    inventario = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProds();
    renderProdList();
    renderStockSelect();
    renderDash();
  });

  renderDash();
}

// ─── Cola badge en sidebar y topbar ────────────────────────────────
// Solo impresiones: los pedidos de alumnos viven en la misma colección
// (marcador pedidoAlumno) y se manejan aparte.
const impresionesActuales = () => colaActual.filter(d => !d.pedidoAlumno);

function actualizarColaBadge(){
  const n = impresionesActuales().length;
  const badge = document.getElementById('cola-badge');
  const navBadge = document.getElementById('nav-cola-badge');
  const countEl = document.getElementById('cola-count');

  if(badge){
    badge.textContent = n;
    badge.classList.toggle('show', n > 0);
  }
  if(navBadge){
    navBadge.textContent = n;
    navBadge.style.display = n > 0 ? 'inline-block' : 'none';
    const bnBadge = document.getElementById('bn-cola-badge');
    if(bnBadge){
      bnBadge.textContent = n;
      bnBadge.style.display = n > 0 ? 'inline-block' : 'none';
    }
  }
  if(countEl) countEl.textContent = `${n} pendiente${n!==1?'s':''}`;
}

// ═══════════════════════════════════════════════════════════════════
// NAVEGACIÓN ADMIN
// ═══════════════════════════════════════════════════════════════════
window.go = (s) => {
  document.querySelectorAll('.sec').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('.bni').forEach(x=>x.classList.remove('on'));
  document.getElementById('s-'+s).classList.add('on');
  document.querySelectorAll('.nav-btn').forEach(x=>{
    if(x.getAttribute('onclick')?.includes("'"+s+"'")) x.classList.add('on');
  });
  const bnMatch = document.getElementById('bn-'+s);
  if(bnMatch) bnMatch.classList.add('on');
  seccionAdminActiva = s;
  if(s==='dashboard') renderDash();
  if(s==='productos') renderProds();
  if(s==='historial') renderHist();
  if(s==='stock')     renderStockSelect();
  if(s==='finanzas')  renderFinanzas();
  if(s==='venta')     { renderProdList(); renderCart(); renderColaVenta(); renderPedidosAlumno(); syncMetodoPagoUI(); }
  if(s==='cola')      { renderColaFull(); renderPedidosAlumno(); }
};

window.toggleBotMore = () => {
  const d = document.getElementById('bot-more-drawer');
  if(d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
};
window.eliminarDeCola = async (id, nombre) => {
  if(!confirm(`¿Eliminar "${nombre}" de la cola sin cobrar?`)) return;
  try {
    await eliminarRegistro('cola_impresion', id);
    toast('Eliminado de la cola','ok');
  } catch(e){
    toast('Error: '+e.message,'er');
  }
};

// Convierte el base64 de un documento de la cola a Blob PDF
function docColaABlob(d){
  const bin = atob(d.archivoBase64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes], { type: d.archivoTipo || 'application/pdf' });
}

// Abre el PDF de una impresión de la cola. Los documentos nuevos traen el
// archivo en base64 (campo archivoBase64); los antiguos tenían URL de Storage.
window.abrirPDFCola = (id) => {
  const d = colaActual.find(x=>x.id===id);
  if(!d){ toast('Documento no encontrado','er'); return; }
  if(!d.archivoBase64 && d.archivoURL){
    window.open(d.archivoURL,'_blank');   // compatibilidad con documentos antiguos
    return;
  }
  if(!d.archivoBase64){ toast('Este documento no tiene archivo adjunto','wa'); return; }
  try {
    const url = URL.createObjectURL(docColaABlob(d));
    const w   = window.open(url,'_blank');
    if(!w){   // popup bloqueado → descargar directamente
      descargarPDFCola(id);
    }
    setTimeout(()=>URL.revokeObjectURL(url), 600000);   // 10 min por si imprime desde el visor
  } catch(e){
    console.error('[abrirPDFCola]', e);
    toast('Error al abrir el PDF: '+e.message,'er');
  }
};

// Descarga el PDF de la cola como archivo real. Es la vía garantizada:
// un archivo en disco siempre imprime bien desde cualquier programa.
window.descargarPDFCola = (id) => {
  const d = colaActual.find(x=>x.id===id);
  if(!d){ toast('Documento no encontrado','er'); return; }
  if(!d.archivoBase64){
    if(d.archivoURL){ window.open(d.archivoURL,'_blank'); }
    else { toast('Este documento no tiene archivo adjunto','wa'); }
    return;
  }
  try {
    const url = URL.createObjectURL(docColaABlob(d));
    const a = document.createElement('a');
    a.href = url;
    a.download = d.archivo || 'documento.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 120000);
    toast('⬇️ Descargando PDF…','ok');
  } catch(e){
    console.error('[descargarPDFCola]', e);
    toast('Error al descargar: '+e.message,'er');
  }
};

// Imprime el PDF de la cola con un iframe oculto. NO se usa el botón de
// imprimir del visor de pestañas porque Chrome/Edge fallan silenciosamente
// al imprimir PDFs abiertos por blob: URL (el trabajo nunca llega a la
// impresora). Con el iframe el trabajo entra normal a la cola del sistema.
window.imprimirPDFCola = (id) => {
  const d = colaActual.find(x=>x.id===id);
  if(!d){ toast('Documento no encontrado','er'); return; }
  if(!d.archivoBase64){
    toast('Documento antiguo: ábrelo con 👁️, descárgalo e imprime desde tu programa PDF','wa');
    return;
  }
  toast('🖨️ Preparando impresión…','');
  try {
    const url = URL.createObjectURL(docColaABlob(d));
    const iframe = document.createElement('iframe');
    // 1px y casi invisible: con display:none algunos navegadores se saltan la impresión
    iframe.setAttribute('aria-hidden','true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;border:0;';
    iframe.src = url;
    iframe.onload = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch(ePrint){
        console.warn('[imprimirPDFCola] print() no disponible, descargando respaldo', ePrint);
        descargarPDFCola(id);
        toast('La impresión directa no está disponible en este dispositivo: se descargó el PDF para imprimirlo desde tu programa PDF.','wa');
      }
    };
    document.body.appendChild(iframe);
    setTimeout(()=>{ iframe.remove(); URL.revokeObjectURL(url); }, 120000);
  } catch(e){
    console.error('[imprimirPDFCola]', e);
    toast('Error al preparar la impresión: '+e.message,'er');
  }
};

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function renderDash(){
  const ventas   = LS.get('ventas');
  const egresos  = LS.get('egresos');
  const hoy      = new Date().toISOString().split('T')[0];
  const mes      = hoy.slice(0,7);

  const ventasPagadas = ventasCobradas(ventas);
  const fiadosPend = ventas.filter(v=>!esVentaCobrada(v));
  const fiadosPendMonto = fiadosPend.reduce((a,v)=>a+(v.total||0),0);
  const vH = ventasPagadas.filter(v=>fechaContableVenta(v)===hoy);
  const vM = ventasPagadas.filter(v=>fechaContableVenta(v)?.startsWith(mes));
  const eM = egresos.filter(e=>e.fecha.startsWith(mes));

  const tH   = vH.reduce((a,v)=>a+v.total,0);
  const tM   = vM.reduce((a,v)=>a+v.total,0);
  const tE   = eM.reduce((a,e)=>a+e.monto,0);
  const util = tM - tE;

  // Productos agotados del inventario Firebase
  const agot = inventario.filter(p=>p.stock===0).length;
  const bajo = inventario.filter(p=>p.stock>0 && p.stock<=(p.stockMin||5)).length;
  const cola = colaActual.length;

  const grid = document.getElementById('kpi-grid');
  if(!grid) return;
  grid.innerHTML = [
    {ic:'💵', v:$m(tH),    l:'Ventas hoy',          c:''},
    {ic:'📋', v:vH.length,  l:'Transacciones hoy',    c:'t'},
    {ic:'🖨️', v:cola,       l:'Impresiones pendientes',c:'i'},
    {ic:'📝', v:$m(fiadosPendMonto), l:`Fiado pendiente (${fiadosPend.length})`, c:'r', act:'irAFiadosPendientes()'},
    {ic:'📈', v:$m(tM),    l:'Ingresos del mes',      c:'b'},
    {ic:'✅', v:$m(util),   l:'Utilidad estimada',     c:util>=0?'gr':'r'},
    {ic:'🔴', v:agot,       l:'Productos agotados',    c:agot>0?'r':'gr'},
  ].map(k=>`<div class="kcard ${k.c}" ${k.act?`onclick="${k.act}" style="cursor:pointer" title="Ver en historial"`:''}><span class="kic">${k.ic}</span><div class="kval">${k.v}</div><div class="klbl">${k.l}</div></div>`).join('');

  // Alerta stock
  const al = document.getElementById('al-stock');
  if(al){
    if(agot>0||bajo>0){
      al.classList.add('show');
      document.getElementById('al-txt').textContent=`${agot} agotado(s) y ${bajo} con stock bajo. Revise inventario.`;
    } else al.classList.remove('show');
  }

  // Gráfica 7 días
  const labs=[], vals=[];
  for(let i=6;i>=0;i--){
    const dt=new Date(); dt.setDate(dt.getDate()-i);
    const ds=dt.toISOString().split('T')[0];
    labs.push(['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][dt.getDay()]);
    vals.push(ventasPagadas.filter(v=>fechaContableVenta(v)===ds).reduce((a,v)=>a+v.total,0));
  }
  if(chSem) chSem.destroy();
  const cSem = document.getElementById('c-sem');
  if(cSem) chSem = new Chart(cSem,{type:'bar',
    data:{labels:labs,datasets:[{data:vals,backgroundColor:'rgba(212,82,26,.75)',borderColor:'#d4521a',borderWidth:2,borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
      scales:{y:{beginAtZero:true,ticks:{callback:v=>$m(v)}}}}});

  // Gráfica impresiones vs productos
  const impTotal = ventasPagadas.flatMap(v=>v.items||[]).filter(i=>i.tipo==='impresion').reduce((a,i)=>a+(i.precio||0),0);
  const prodTotal = ventasPagadas.flatMap(v=>v.items||[]).filter(i=>i.tipo==='producto').reduce((a,i)=>a+(i.precio||0),0);
  if(chTipo) chTipo.destroy();
  const cTipo = document.getElementById('c-tipo');
  if(cTipo) chTipo = new Chart(cTipo,{type:'doughnut',
    data:{labels:['Impresiones','Papelería/Productos'],
      datasets:[{data:[impTotal,prodTotal],backgroundColor:['rgba(67,56,202,.8)','rgba(212,82,26,.8)'],borderWidth:0}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:'bottom',labels:{font:{family:'DM Sans',size:11}}}}}});

  // Top 5
  const cnt={};
  ventasPagadas.forEach(v=>(v.items||[]).forEach(i=>{
    if(!cnt[i.nombre]) cnt[i.nombre]={q:0,r:0};
    cnt[i.nombre].q+=1; cnt[i.nombre].r+=(i.precio||0);
  }));
  const top = Object.entries(cnt).sort((a,b)=>b[1].q-a[1].q).slice(0,5);
  const t5 = document.getElementById('top5');
  if(t5) t5.innerHTML = top.length
    ? top.map(([n,d],i)=>`<tr><td><strong>#${i+1}</strong></td><td>${n}</td><td>${d.q}</td><td>${$m(d.r)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Sin ventas aún</td></tr>';
}

window.irAFiadosPendientes = () => {
  go('historial');
  const est = document.getElementById('h-estado');
  if(est) est.value = 'fiados';
  renderHist();
};

// ═══════════════════════════════════════════════════════════════════
// COLA DE IMPRESIÓN — renderizado con nuevo diseño
// ═══════════════════════════════════════════════════════════════════
function renderColaImpresion(){
  // Para el panel de venta rápida (mini)
  const miniCount = document.getElementById('cola-venta-count');
  if(miniCount) miniCount.textContent = impresionesActuales().length;
}

function renderColaVenta(){
  const el = document.getElementById('cola-venta-list');
  if(!el) return;
  const imps = impresionesActuales();
  if(imps.length===0){
    el.innerHTML='<div class="empty">Sin impresiones pendientes</div>';
    return;
  }
  el.innerHTML = imps.map(doc=>{
    const esQR = doc.tipoImpresion==='qr';
    const precio = esQR ? 0 : precioUnitario(doc.tipoImpresion, doc.tipoImpresion==='smart_tank' && doc.saturada===true);
    const total  = (doc.paginas * precio).toFixed(2);
    const label  = (LABELS[doc.tipoImpresion]||'B&N') + (doc.tipoImpresion==='smart_tank'&&doc.saturada?' (saturada)':'');
    return `<div class="imp-item">
      <span class="imp-icon">${esQR?'🏷️':(doc.tipoImpresion==='smart_tank'?'🎨':'🖨️')}</span>
      <div class="imp-info">
        <div class="imp-name">${doc.archivo||'Documento'}</div>
        <div class="imp-meta">${doc.usuario} · ${label} · ${doc.paginas} pág${doc.paginas!==1?'s':''}</div>
      </div>
      <div class="imp-actions">
        ${(doc.archivoBase64||doc.archivoURL)?`<button class="btn bs bsm bic" title="Ver PDF" onclick="abrirPDFCola('${doc.id}')">👁️</button>`:''}
        ${esQR
          ? `<button class="btn br bsm" title="Eliminar (uso interno, no se cobra)" onclick="eliminarDeCola('${doc.id}','${doc.archivo}')">🗑️</button>`
          : `<button class="btn bi bsm" onclick="addImpToCart('${doc.id}','${doc.archivo}',${total},'${doc.usuario}',${doc.paginas},'${label}')">\n          +$${total}\n        </button>`}
      </div>
    </div>`;
  }).join('');
}

function renderColaFull(){
  const el = document.getElementById('cola-full-list');
  if(!el) return;
  const imps = impresionesActuales();
  if(imps.length===0){
    el.innerHTML='<div class="card"><div class="empty">Sin impresiones pendientes 🎉</div></div>';
    return;
  }
  el.innerHTML = imps.map(doc=>{
    const esQR = doc.tipoImpresion==='qr';
    const precio = esQR ? 0 : precioUnitario(doc.tipoImpresion, doc.tipoImpresion==='smart_tank' && doc.saturada===true);
    const total  = (doc.paginas * precio).toFixed(2);
    const label  = (LABELS[doc.tipoImpresion]||'B&N') + (doc.tipoImpresion==='smart_tank'&&doc.saturada?' (saturada)':'');
    const fecha  = doc.fecha?.toDate ? doc.fecha.toDate().toLocaleString('es-MX') : '—';
    const badgeEstado = '<span class="badge bpend">⏳ Pendiente</span>';
    const accionPrincipal = esQR
      ? '<span class="badge bok" style="align-self:center">🏷️ Uso interno — sin cobro</span>'
      : `<button class="btn bi bsm wf" style="justify-content:center"
          onclick="addImpToCart('${doc.id}','${doc.archivo}',${total},'${doc.usuario}',${doc.paginas},'${label}');go('venta')">
          🛒 Cobrar $${total}
        </button>`;
    return `<div class="imp-item card" style="margin-bottom:10px;padding:16px 18px">
      <span class="imp-icon" style="font-size:2rem">${esQR?'🏷️':(doc.tipoImpresion==='smart_tank'?'🎨':'🖨️')}</span>
      <div class="imp-info">
        <div class="imp-name" style="font-size:.9rem">${doc.archivo||'Documento'}</div>
        <div class="imp-meta">👤 ${doc.usuario} &nbsp;·&nbsp; ${label} &nbsp;·&nbsp; ${doc.paginas} páginas &nbsp;·&nbsp; ${fecha}</div>
        <div style="margin-top:6px">${badgeEstado}</div>
      </div>
      <div class="imp-actions" style="flex-direction:column;gap:6px">
        ${(doc.archivoBase64||doc.archivoURL)?`<button class="btn bi bsm wf" style="justify-content:center" onclick="imprimirPDFCola('${doc.id}')">🖨️ Imprimir</button>
        <button class="btn bs bsm wf" style="justify-content:center" onclick="abrirPDFCola('${doc.id}')">👁️ Ver</button>
        ${doc.archivoBase64?`<button class="btn bs bsm wf" style="justify-content:center" onclick="descargarPDFCola('${doc.id}')">⬇️ Descargar</button>`:''}`:''}
        ${accionPrincipal}
         <button class="btn br bsm wf" style="justify-content:center"
          onclick="eliminarDeCola('${doc.id}','${doc.archivo||'archivo'}')">
          🗑️ Eliminar sin cobrar
        </button>

      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════
// PEDIDOS DE ALUMNOS — aparecen en Nueva Venta para el cobro
// ═══════════════════════════════════════════════════════════════════
function actualizarPedidosBadge(){
  const np = pedidosAlumno.filter(d=>d.estatus==='pendiente').length;
  const set = (id) => {
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = np;
    el.style.display = np>0 ? 'inline-block' : 'none';
  };
  set('nav-ped-badge'); set('ped-badge'); set('bn-venta-badge'); set('ped-cola-count');
  const cnt = document.getElementById('ped-venta-count');
  if(cnt) cnt.textContent = np;
  const tc = document.getElementById('ped-count');
  if(tc) tc.textContent = `${np} pedido${np!==1?'s':''}`;
}

function renderPedidosAlumno(){
  actualizarPedidosBadge();
  const activos = pedidosAlumno
    .filter(d=>d.estatus==='pendiente'||d.estatus==='en_cobro')
    .sort((a,b)=>(b.fecha?.toDate?.()?.getTime()||0)-(a.fecha?.toDate?.()?.getTime()||0));
  const html = !activos.length
    ? '<div class="empty">Sin pedidos de alumnos — los pedidos enviados desde la tienda aparecerán aquí</div>'
    : activos.map(d=>{
    const t = d.fecha?.toDate?.();
    const hace = t ? haceRango(t) : 'ahora';
    const items = (d.items||[]).map(i=>`${i.nombre} ×${i.qty}`).join(' · ');
    const enCobro = d.estatus==='en_cobro';
    const usuarioSeg = String(d.usuario||'').replace(/</g,'&lt;').replace(/'/g,'');
    return `<div class="ped-it${enCobro?' en-cobro':''}">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:.9rem">🎒 ${usuarioSeg}</b>
        <span class="badge ${enCobro?'bind':'bpend'}">${enCobro?'🧾 En el carrito':'⏳ Pendiente'}</span>
        <div class="sp"></div>
        <span style="font-size:.72rem;color:var(--ink3)">${hace}</span>
      </div>
      <div style="font-size:.78rem;color:var(--ink2);margin-top:6px">${items}</div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap">
        <b style="color:var(--accent);font-size:.95rem">${$m(d.total||0)}</b>
        <div class="sp"></div>
        ${enCobro
          ? `<button class="btn bs bsm" onclick="liberarPedido('${d.id}')">↩️ Liberar</button>`
          : `<button class="btn bp bsm" onclick="cobrarPedido('${d.id}')">🛒 Cobrar</button>
             <button class="btn br bsm" onclick="rechazarPedido('${d.id}','${usuarioSeg}')">🗑️</button>`}
      </div>
    </div>`;
  }).join('');
  // Se pinta en Nueva Venta Y en la Cola de Impresión (mismo contenido)
  for(const elId of ['pedidos-list','pedidos-cola-list']){
    const el = document.getElementById(elId);
    if(el) el.innerHTML = html;
  }
}

window.cobrarPedido = (id) => {
  const d = pedidosAlumno.find(x=>x.id===id);
  if(!d){ toast('Pedido no encontrado','er'); return; }
  if(d.estatus!=='pendiente'){ toast('Ese pedido ya está en el carrito','wa'); return; }
  let agregados = 0;
  const avisos = [];
  for(const it of (d.items||[])){
    const p = inventario.find(x=>x.id===it.id);
    const yaEnCarrito = carrito.filter(c=>c.id===it.id && c.tipo==='producto')
      .reduce((a,c)=>a+(c.qty||0),0);
    const disp = Math.max(0, (p?.stock||0) - yaEnCarrito);
    const q = Math.min(Number(it.qty)||1, disp);
    if(q<=0){ avisos.push(`${it.nombre}: sin stock`); continue; }
    carrito.push({
      id: it.id, nombre: it.nombre,
      precio: (p?.venta ?? it.precio) * q,
      tipo:'producto', qty:q, pedidoId:id, pedidoUsuario:d.usuario,
    });
    if(q < it.qty) avisos.push(`${it.nombre}: quedaban ${disp} de ${it.qty}`);
    agregados++;
  }
  renderCart();
  if(agregados>0){
    actualizarDocCola(id,{ estatus:'en_cobro' }).catch(e=>console.error(e));
    toast(`✓ Pedido de ${d.usuario} agregado al carrito — ${$m(d.total||0)}`,'ok');
    // Llevar al admin al carrito para que vea la lista y el total real del pedido
    if(seccionAdminActiva!=='venta') go('venta');
  } else {
    toast('Nada que agregar — sin stock','er');
  }
  if(avisos.length) toast('⚠️ '+avisos.join(' · '),'wa');
};

window.rechazarPedido = async (id, usuario) => {
  if(!confirm(`¿Rechazar el pedido de ${usuario||'el alumno'}? Desaparecerá de la lista.`)) return;
  try {
    await eliminarRegistro('cola_impresion', id);
    toast('Pedido rechazado','ok');
  } catch(e){ toast('Error: '+e.message,'er'); }
};

window.liberarPedido = async (id) => {
  if(!confirm('¿Devolver el pedido a "pendiente" y quitar sus líneas del carrito?')) return;
  try {
    carrito = carrito.filter(c=>c.pedidoId!==id);
    renderCart();
    await actualizarDocCola(id,{ estatus:'pendiente' });
    toast('Pedido liberado','ok');
  } catch(e){ toast('Error: '+e.message,'er'); }
};

// ═══════════════════════════════════════════════════════════════════
// CARRITO — Unifica impresiones + productos
// ═══════════════════════════════════════════════════════════════════
window.addImpToCart = (id, nombre, precio, usuario, paginas, label) => {
  // ── Red de seguridad ──
  // Un pedido de alumno NUNCA se cobra como impresión B/N: si un botón viejo
  // (JavaScript en caché) manda el doc del pedido aquí, se carga el pedido
  // real con sus productos y su total.
  const doc = colaActual.find(x=>x.id===id);
  if(doc && doc.pedidoAlumno){ window.cobrarPedido(id); return; }
  if(doc && doc.tipoImpresion==='qr'){
    toast('🏷️ Las etiquetas QR son uso interno — no se cobran','wa');
    return;
  }
  carrito.push({
    id, nombre: `🖨️ ${nombre} (${paginas} págs)`,
    precio: parseFloat(precio), tipo: 'impresion',
    usuarioAlumno: usuario, numPags: paginas, labelServicio: label
  });
  renderCart();
  toast(`✓ Impresión de ${usuario} agregada`, 'ok');
};

window.agregarAlCarrito = (id, nombre, precio, tipo, extra={}) => {
  const idx = carrito.findIndex(c=>c.id===id && c.tipo===tipo);
  if(idx>=0 && tipo==='producto'){
    const prod = inventario.find(p=>p.id===id);
    if(prod && carrito[idx].qty >= prod.stock){ toast('Stock insuficiente','er'); return; }
    carrito[idx].qty = (carrito[idx].qty||1)+1;
    carrito[idx].precio = precio * carrito[idx].qty;
  } else {
    carrito.push({ id, nombre, precio, tipo, qty:1, ...extra });
  }
  renderCart();
  toast('✓ ' + nombre.split(' ').slice(0,3).join(' '), 'ok');
};

function addProdToCart(id){
  const p = inventario.find(p=>p.id===id);
  if(!p){ toast('Producto no encontrado','er'); return; }
  if((p.stock||0) <= 0){ toast('Sin stock disponible','er'); return; }
  const idx = carrito.findIndex(c=>c.id===id && c.tipo==='producto');
  if(idx>=0){
    if(carrito[idx].qty >= (p.stock||0)){ toast('Stock máximo','er'); return; }
    carrito[idx].qty++;
    carrito[idx].precio = (p.venta||0) * carrito[idx].qty;
  } else {
    carrito.push({ id:p.id, nombre:p.nombre, precio:p.venta||0, tipo:'producto', qty:1 });
  }
  renderCart();
  toast('✓ '+p.nombre.split(' ').slice(0,3).join(' '),'ok');
}
window.addProdToCart = addProdToCart;

function renderCart(){
  const c     = document.getElementById('cart-items');
  const tot   = document.getElementById('ctot');
  const count = document.getElementById('cart-count');
  if(!c) return;

  if(!carrito.length){
    c.innerHTML='<div class="empty">Carrito vacío</div>';
    if(tot) tot.style.display='none';
    if(count) count.textContent='0 items';
    return;
  }

  let sub=0, iva=0;
  c.innerHTML = carrito.map((item,i)=>{
    const price = item.precio;
    const ivaI  = item.tipo==='impresion' ? price*0.16 : 0;
    sub+=price; iva+=ivaI;
    return `<div class="ci">
      <div class="ci-info">
        <div class="ci-name">${item.nombre}</div>
        <div class="ci-sub">${item.tipo==='impresion'?'Servicio de impresión':(item.pedidoUsuario?`🛒 Pedido de ${item.pedidoUsuario}`:'Producto')}</div>
      </div>
      ${item.tipo==='producto'?`
        <div class="qb">
          <button class="qq" onclick="chQty(${i},-1)">−</button>
          <span style="min-width:20px;text-align:center;font-size:.82rem;font-weight:600">${item.qty||1}</span>
          <button class="qq" onclick="chQty(${i},1)">+</button>
        </div>`:'<div style="width:70px"></div>'}
      <div class="ci-price">${$m(price)}</div>
      <button class="ci-del" onclick="rmCart(${i})">✕</button>
    </div>`;
  }).join('');

  if(tot) tot.style.display='block';
  if(count) count.textContent=`${carrito.length} item${carrito.length!==1?'s':''}`;
  document.getElementById('t-sub').textContent=$m(sub);
  document.getElementById('t-iva').textContent=$m(iva);
  document.getElementById('t-tot').textContent=$m(sub+iva);
}

window.chQty = (i,d) => {
  if(!carrito[i]) return;
  const nq = (carrito[i].qty||1)+d;
  if(nq<=0){ rmCart(i); return; }
  const prod = inventario.find(p=>p.id===carrito[i].id);
  if(prod && nq>prod.stock){ toast('Stock máximo','er'); return; }
  carrito[i].qty = nq;
  carrito[i].precio = (prod?.venta||carrito[i].precio/((carrito[i].qty-d)||1)) * nq;
  renderCart();
};

window.rmCart = (i) => {
  const it = carrito[i];
  carrito.splice(i,1); renderCart();
  // Si la línea venía de un pedido de alumno y ya no está en el carrito,
  // devolver el pedido a "pendiente" para que no se pierda.
  if(it?.pedidoId && !carrito.some(c=>c.pedidoId===it.pedidoId)){
    actualizarDocCola(it.pedidoId,{ estatus:'pendiente' }).catch(()=>{});
  }
};
window.limpiarCarrito = () => {
  const pids = [...new Set(carrito.filter(i=>i.pedidoId).map(i=>i.pedidoId))];
  carrito=[]; renderCart();
  pids.forEach(pid=>actualizarDocCola(pid,{ estatus:'pendiente' }).catch(()=>{}));
};

window.selPago = (btn, met) => {
  document.querySelectorAll('.pbtn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  metodo = met;
  syncMetodoPagoUI();
};

function syncMetodoPagoUI(){
  const fiadoWrap = document.getElementById('v-fiado-wrap');
  const fiadoInput = document.getElementById('v-fiado-nombre');
  if(fiadoWrap) fiadoWrap.style.display = metodo === 'Fiado' ? 'block' : 'none';
  if(fiadoInput && metodo !== 'Fiado') fiadoInput.value = '';

  // Re-sincroniza selección visual en botones, útil al volver a la vista de venta.
  document.querySelectorAll('.pbtn').forEach(b=>{
    b.classList.toggle('sel', b.dataset.met === metodo);
  });
}

window.confirmarVenta = async () => {
  if(!carrito.length){ toast('El carrito está vacío','er'); return; }
  if(!confirm('¿Confirmar cobro y registrar venta?')) return;

  try {
    // procesarCobroVenta de database.js — sin cambios
    const ok = await procesarCobroVenta(carrito);
    if(!ok) throw new Error('Error en Firebase');

    // Guardar en localStorage para dashboard/historial
    const ventas = LS.get('ventas');
    const now    = new Date();
    const esFiado = metodo === 'Fiado';
    const cuentaNombre = (document.getElementById('v-fiado-nombre')?.value||'').trim();
    if(esFiado && !cuentaNombre){
      toast('Indique la cuenta a nombre de para registrar fiado','er');
      return;
    }
    const vendedor = localStorage.getItem('usuario_cbta') || '—';
    const fechaHoy = now.toISOString().split('T')[0];
    const horaHoy = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    ventas.push({
      id: 'V-'+String(ventas.length+1).padStart(4,'0'),
      fecha: fechaHoy,
      hora:  horaHoy,
      items: carrito.map(i=>({nombre:i.nombre,precio:i.precio,tipo:i.tipo,qty:i.qty||1})),
      vendedor,
      cuentaNombre: esFiado ? cuentaNombre : '',
      metodo,
      notas: document.getElementById('v-notas')?.value||'',
      total: carrito.reduce((a,i)=>a+i.precio,0),
      cobrado: !esFiado,
      fechaCobro: esFiado ? '' : fechaHoy,
      horaCobro: esFiado ? '' : horaHoy,
      metodoCobroFinal: esFiado ? '' : metodo,
    });
    LS.set('ventas', ventas);

    if(esFiado) toast(`📝 Fiado pendiente registrado — ${$m(carrito.reduce((a,i)=>a+i.precio,0))}`, 'wa');
    else toast(`✅ Cobro registrado — ${$m(carrito.reduce((a,i)=>a+i.precio,0))}`, 'ok');

    // Los pedidos de alumnos incluidos en la venta se consumen (se eliminan)
    const pids = [...new Set(carrito.filter(i=>i.pedidoId).map(i=>i.pedidoId))];
    for(const pid of pids){
      try{ await eliminarRegistro('cola_impresion', pid); }catch(e){ console.error(e); }
    }

    carrito=[];
    renderCart();
    if(document.getElementById('v-notas')) document.getElementById('v-notas').value='';
    if(document.getElementById('v-fiado-nombre')) document.getElementById('v-fiado-nombre').value='';
    renderDash();
  } catch(e) {
    toast('Error al registrar: '+e.message, 'er');
    console.error(e);
  }
};

// ═══════════════════════════════════════════════════════════════════
// INVENTARIO — desde Firebase (inventario[]) + nuevo diseño
// ═══════════════════════════════════════════════════════════════════
function qrUrl(data, size=80){
  return `https://quickchart.io/qr?text=${encodeURIComponent(data)}&size=${size}&dark=0f1923&light=FFFFFF&margin=1`;
}

function renderProds(){
  const q = (document.getElementById('p-buscar')?.value||'').toLowerCase();
  const f = q ? inventario.filter(p=>p.nombre?.toLowerCase().includes(q)||p.id?.toLowerCase().includes(q)) : inventario;
  const tbody = document.getElementById('t-prods');
  if(!tbody) return;

  tbody.innerHTML = f.length===0
    ? '<tr><td colspan="7" class="empty">Sin productos en inventario</td></tr>'
    : f.map(p=>{
        const stock = p.stock||0;
        const min   = p.stockMin||5;
        let badge   = stock===0
          ? '<span class="badge bout">🔴 Agotado</span>'
          : stock<=min
            ? '<span class="badge blow">🟡 Stock bajo</span>'
            : '<span class="badge bok">🟢 OK</span>';
        const mg = p.costo>0 ? ((p.venta-p.costo)/p.venta*100).toFixed(0)+'%' : '—';
        return `<tr>
          <td><img src="${qrUrl(p.id,52)}" class="qr-th" onclick="verQR('${p.id}')" title="Ver QR" onerror="this.outerHTML='<span style=font-size:1.2rem;cursor:pointer onclick=verQR(&quot;${p.id}&quot;)>📷</span>'"></td>
          <td><div style="font-weight:600">${p.nombre}</div><div style="font-size:.72rem;color:var(--ink3)">${p.categoria||''} · Margen: ${mg}</div></td>
          <td><strong>${$m(p.venta||0)}</strong></td>
          <td>${$m(p.costo||0)}</td>
          <td>
            <div>${stock} uds.</div>
            <div class="sbar"><div class="sbar-f" style="width:${Math.min(100,min>0?stock/min*33:100)}%;background:${stock===0?'var(--red)':stock<=min?'var(--gold)':'var(--green)'}"></div></div>
           </td>
          <td>${badge}</td>
          <td><div style="display:flex;gap:3px">
            <button class="btn bs bsm bic" onclick="verQR('${p.id}')" title="QR">📷</button>
            <button class="btn bs bsm bic" onclick="openProdModal('${p.id}')" title="Editar">✏️</button>
            <button class="btn br bsm bic" onclick="delProd('${p.id}')" title="Eliminar">🗑️</button>
          </div></td>
        </tr>`;
      }).join('');
}

function renderProdList(){
  const q = (document.getElementById('v-buscar')?.value||'').toLowerCase();
  const f = q
    ? inventario.filter(p=>p.nombre?.toLowerCase().includes(q)||p.id?.toLowerCase().includes(q))
    : inventario.slice(0,12);
  const el = document.getElementById('prod-list');
  if(!el) return;
  el.innerHTML = f.map(p=>{
    const ok = (p.stock||0)>0;
    return `<button onclick="${ok?`addProdToCart('${p.id}')`:''}"
      style="display:flex;align-items:center;gap:9px;padding:9px 11px;background:${ok?'#fff':'var(--paper2)'};border:1.5px solid var(--paper3);border-radius:var(--rs);cursor:${ok?'pointer':'not-allowed'};opacity:${ok?1:.55};width:100%;text-align:left;font-family:var(--f)"
      ${!ok?'disabled':''}>
      <span style="font-size:1.2rem">📦</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div>
        <div style="font-size:.72rem;color:var(--ink3)">Stock: ${p.stock||0}</div>
      </div>
      <div style="font-size:.88rem;font-weight:700;color:var(--accent)">${$m(p.venta||0)}</div>
    </button>`;
  }).join('')||'<div style="color:var(--ink3);font-size:.82rem;padding:6px">Sin productos</div>';
}

window.openProdModal = (id=null) => {
  editProdId = id;
  document.getElementById('mp-title').textContent = id ? 'Editar Producto' : 'Nuevo Producto';
  // Limpiar preview foto
  document.getElementById('mp-foto-preview').style.display='none';
  document.getElementById('mp-foto-placeholder').style.display='flex';
  document.getElementById('mp-foto-input').value='';

  if(id){
    const p = inventario.find(p=>p.id===id);
    if(!p) return;
    document.getElementById('mp-nom').value   = p.nombre||'';
    document.getElementById('mp-cat').value   = p.categoria||'Otros';
    document.getElementById('mp-desc').value  = p.descripcion||'';
    document.getElementById('mp-cost').value  = p.costo||0;
    document.getElementById('mp-venta').value = p.venta||0;
    document.getElementById('mp-stk').value   = p.stock||0;
    document.getElementById('mp-min').value   = p.stockMin||5;
    // Mostrar foto existente si tiene
    if(p.fotoURL){
      document.getElementById('mp-foto-preview').src = p.fotoURL;
      document.getElementById('mp-foto-preview').style.display='block';
      document.getElementById('mp-foto-placeholder').style.display='none';
    }
  } else {
    ['mp-nom','mp-cost','mp-venta','mp-desc'].forEach(i=>document.getElementById(i).value='');
    document.getElementById('mp-stk').value=0;
    document.getElementById('mp-min').value=5;
  }
  document.getElementById('ov-prod').classList.add('on');
};

window.saveProd = async () => {
  const nom   = document.getElementById('mp-nom').value.trim();
  const venta = parseFloat(document.getElementById('mp-venta').value)||0;
  const costo = parseFloat(document.getElementById('mp-cost').value)||0;
  if(!nom||venta<=0){ toast('Complete campos obligatorios','er'); return; }

  // Subir foto si seleccionaron una
  const fotoFile = document.getElementById('mp-foto-input').files[0];
  let fotoURL    = editProdId ? (inventario.find(p=>p.id===editProdId)?.fotoURL||null) : null;

  if(fotoFile){
    toast('Subiendo foto…','');
    try {
      fotoURL = await subirFotoProducto(fotoFile, nom);
      if(!fotoURL){ toast('No se obtuvo URL de la foto','er'); return; }
    } catch(e){
      toast('Error subiendo foto: ' + (e?.code || e?.message || 'revise Storage Rules'), 'er');
      return;
    }
  }

  const datos = {
    nombre:      nom,
    categoria:   document.getElementById('mp-cat').value,
    descripcion: document.getElementById('mp-desc').value.trim(),
    costo, venta,
    stock:    parseInt(document.getElementById('mp-stk').value)||0,
    stockMin: parseInt(document.getElementById('mp-min').value)||5,
    fotoURL,
    fotoUrl: fotoURL,
    foto: fotoURL,
  };

  try {
    if(editProdId){
      await actualizarProducto(editProdId, datos);
      toast('✅ Producto actualizado','ok');
    } else {
      await guardarNuevoProducto(datos);
      toast('✅ Producto agregado','ok');
    }
    closeModal('ov-prod');
  } catch(e){
    toast('Error al guardar: '+e.message,'er');
  }
};

// Preview de foto antes de subir
window.previewFoto = (input) => {
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('mp-foto-preview');
    const placeholder = document.getElementById('mp-foto-placeholder');
    preview.src = e.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
};

window.delProd = async (id) => {
  if(!confirm('¿Eliminar este producto del inventario? No se puede deshacer.')) return;
  try {
    await eliminarRegistro('inventario', id);
    toast('Producto eliminado');
  } catch(e){ toast('Error: '+e.message,'er'); }
};

window.verQR = (id) => {
  const p = inventario.find(p=>p.id===id);
  if(!p) return;
  document.getElementById('qr-title').textContent = 'QR: '+p.nombre;
  document.getElementById('qr-info').textContent  = `ID: ${id} · ${p.categoria||''} · ${$m(p.venta||0)}`;
  document.getElementById('qr-img-wrap').innerHTML =
    `<img src="${qrUrl(id,200)}" style="border-radius:10px;border:2px solid var(--paper3);max-width:200px" onerror="this.parentElement.innerHTML='<p style=color:var(--red)>Sin conexión a internet</p>'">`;
  document.getElementById('ov-qr').classList.add('on');
};

window.printQR = () => {
  const img  = document.getElementById('qr-img-wrap').querySelector('img');
  const info = document.getElementById('qr-info').textContent;
  const name = document.getElementById('qr-title').textContent.replace('QR: ','');
  if(!img) return;
  const w = window.open('','_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Etiqueta QR</title>
  <style>body{font-family:Arial;text-align:center;padding:30px}
  .et{border:2px solid #0f1923;padding:18px;display:inline-block;border-radius:10px;max-width:240px}
  h3{font-size:12px;margin:10px 0 4px;line-height:1.3}p{font-size:10px;color:#5a7184}
  @media print{button{display:none}}</style></head><body>
  <div class="et"><p style="font-size:9px;color:#8fa3b1;margin-bottom:8px">CBTa 130 — Papelería</p>
  <img src="${img.src}" style="width:170px;height:170px;border-radius:8px">
  <h3>${name}</h3><p>${info}</p></div><br>
  <button onclick="window.print()" style="margin-top:14px;padding:10px 20px;background:#d4521a;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ Imprimir</button>
  </body></html>`);
  w.document.close();
};

// ═══════════════════════════════════════════════════════════════════
// IMPRESIÓN MASIVA DE CÓDIGOS QR — hojas carta para recortar
// ═══════════════════════════════════════════════════════════════════
// Tamaños de etiqueta (mm): qr=código, cw/ch=celda, px=calidad quickchart,
// f1/f2=tipografía nombre/precio. cols×rows caben en carta con margen 6mm.
const TAMS_QR = {
  chica  : { qr:20, cw:26, ch:34, cols:7, rows:7, px:220, f1:6.5, f2:8.5  },
  mediana: { qr:27, cw:33, ch:44, cols:5, rows:5, px:300, f1:8,   f2:10.5 },
  grande : { qr:38, cw:46, ch:60, cols:4, rows:4, px:420, f1:10,  f2:13   },
};
const qrSel = new Set();

window.abrirQRMasivo = () => {
  if(!inventario.length){ toast('No hay productos en el inventario','er'); return; }
  qrSel.clear();
  inventario.forEach(p=>qrSel.add(p.id));
  const b=document.getElementById('qrs-buscar'); if(b) b.value='';
  renderQrsLista();
  document.getElementById('ov-qrs').classList.add('on');
};

function renderQrsLista(){
  const q=(document.getElementById('qrs-buscar')?.value||'').toLowerCase();
  const f=q?inventario.filter(p=>p.nombre?.toLowerCase().includes(q)||p.id?.toLowerCase().includes(q)):inventario;
  const el=document.getElementById('qrs-lista');
  if(!el) return;
  el.innerHTML = f.length===0
    ? '<div style="grid-column:1/-1;color:var(--ink3);font-size:.8rem;text-align:center;padding:8px">Sin resultados</div>'
    : f.map(p=>`
      <label class="qrs-it ${qrSel.has(p.id)?'sel':''}">
        <input type="checkbox" ${qrSel.has(p.id)?'checked':''} onchange="qrsToggle('${p.id}')">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.nombre}</span>
        <b style="color:var(--accent);flex-shrink:0">${$m(p.venta||0)}</b>
      </label>`).join('');
  renderQrsPreview();
}

window.qrsToggle = (id) => { qrSel.has(id)?qrSel.delete(id):qrSel.add(id); renderQrsLista(); };
window.qrsTodos  = (on) => { qrSel.clear(); if(on) inventario.forEach(p=>qrSel.add(p.id)); renderQrsLista(); };

function qrsOpciones(){
  return {
    tam   : document.getElementById('qrs-tam')?.value   || 'mediana',
    copias: parseInt(document.getElementById('qrs-copias')?.value) || 1,
    nombre: !!document.getElementById('qrs-nombre')?.checked,
    precio: !!document.getElementById('qrs-precio')?.checked,
    borde : !!document.getElementById('qrs-borde')?.checked,
  };
}

function qrLabelHTML(p, t, o){
  const T=TAMS_QR[t];
  const nom=(p.nombre||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
  return `<div class="lbl" style="width:${T.cw}mm;height:${T.ch}mm;border:${o.borde?'1px dashed #9aa7b5':'none'}">`+
    `<img src="${qrUrl(p.id,T.px)}" style="width:${T.qr}mm;height:${T.qr}mm">`+
    (o.nombre?`<div class="nm" style="font-size:${T.f1}pt">${nom}</div>`:'')+
    (o.precio?`<div class="pr" style="font-size:${T.f2}pt">${$m(p.venta||0)}</div>`:'')+
  `</div>`;
}

function construirPaginasQR(){
  const o=qrsOpciones(), T=TAMS_QR[o.tam], cap=T.cols*T.rows;
  const items=[];
  inventario.filter(p=>qrSel.has(p.id)).forEach(p=>{
    for(let i=0;i<o.copias;i++) items.push({ p, t:o.tam });
  });
  const pags=[];
  for(let i=0;i<items.length;i+=cap) pags.push(items.slice(i,i+cap));
  return { o, T, pags, total:items.length };
}

function renderQrsPreview(){
  const res=document.getElementById('qrs-resumen'), prev=document.getElementById('qrs-prev');
  if(!res||!prev) return;
  const { o, T, pags, total }=construirPaginasQR();
  if(total===0){
    res.innerHTML='<span style="color:var(--red)">Seleccione al menos un producto</span>';
    prev.innerHTML=''; return;
  }
  res.innerHTML=`📦 ${qrSel.size} producto(s) · 🧾 <b>${total}</b> etiqueta(s) · 📄 <b>${pags.length}</b> hoja(s) carta · ${T.cols}×${T.rows} por hoja · QR ${T.qr/10} cm`;
  const p1=pags[0].map(it=>qrLabelHTML(it.p,it.t,o)), filas=Math.ceil(p1.length/T.cols), hMm=filas*T.ch+(filas-1)*2;
  prev.innerHTML=`
    <div style="font-size:.72rem;color:var(--ink3);margin:2px 0 5px">Vista previa · página 1 (50 %):</div>
    <div style="width:${204*0.5}mm;max-width:100%;margin:0 auto;height:${hMm*0.5}mm;overflow:hidden;border:1px solid var(--paper3);border-radius:6px">
      <div style="transform:scale(.5);transform-origin:top left;width:204mm;display:grid;grid-template-columns:repeat(${T.cols},${T.cw}mm);gap:2mm;justify-content:center;padding-top:1mm">
        ${p1.join('')}
      </div>
    </div>`;
}

// QR local con qrcode-generator (sin depender de quickchart.io ni CORS):
// matriz de módulos → canvas con zona silenciosa estándar → JPEG dataURL
// (JPEG y no PNG: jsPDF incrusta el JPEG tal cual (~10 KB); los PNG de canvas
//  traen canal alfa y jsPDF los descomprime a RGB crudo ~300 KB por QR)
function qrDataURL(data, px=270){
  if(!window.qrcode) throw new Error('Generador de QR no disponible (revisa tu conexión a internet)');
  const qr=qrcode(0,'M');
  qr.addData(String(data));
  qr.make();
  const n=qr.getModuleCount(), quiet=3;
  const scale=Math.max(4, Math.floor(px/(n+quiet*2)));
  const size=(n+quiet*2)*scale;
  const cv=document.createElement('canvas');
  cv.width=cv.height=size;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,size,size);
  ctx.fillStyle='#0f1923';
  for(let r=0;r<n;r++) for(let c=0;c<n;c++)
    if(qr.isDark(r,c)) ctx.fillRect((c+quiet)*scale,(r+quiet)*scale,scale,scale);
  return cv.toDataURL('image/jpeg', 0.85);
}

// PDF carta con las etiquetas (jsPDF, unidades pt; 1 mm = 2.83465 pt)
function generarPdfQREtiquetas(T, pags, o){
  const { jsPDF }=window.jspdf;
  const doc=new jsPDF({ orientation:'p', unit:'pt', format:'letter' });
  const mm=2.83465;
  const cw=T.cw*mm, ch=T.ch*mm, gap=2*mm;
  const gridW=T.cols*cw+(T.cols-1)*gap;
  const gridH=T.rows*ch+(T.rows-1)*gap;
  const offX=(612-gridW)/2, offY=(792-gridH)/2;
  const padTop=2.5*mm, gapTxt=(T.qr>=27?1:0.8)*mm;
  const cache={};
  pags.forEach((pg,pi)=>{
    if(pi>0) doc.addPage('letter','p');
    pg.forEach((it,li)=>{
      const col=li%T.cols, row=Math.floor(li/T.cols);
      const x=offX+col*(cw+gap), y=offY+row*(ch+gap);
      if(o.borde){
        doc.setDrawColor(154,167,181);
        doc.setLineWidth(0.6);
        doc.setLineDashPattern([2,2],0);
        doc.roundedRect(x,y,cw,ch,3,3);
        doc.setLineDashPattern([],0);
      }
      if(!cache[it.p.id]) cache[it.p.id]=qrDataURL(it.p.id, Math.round(T.qr*10));
      const qrPt=T.qr*mm;
      doc.addImage(cache[it.p.id],'JPEG', x+(cw-qrPt)/2, y+padTop, qrPt, qrPt);
      let cy=y+padTop+qrPt+2.2*mm;
      doc.setFont('helvetica','bold');
      if(o.nombre && it.p.nombre){
        doc.setFontSize(T.f1);
        doc.setTextColor(15,25,35);
        const lineas=doc.splitTextToSize(it.p.nombre, cw-2*mm).slice(0,2);
        doc.text(lineas, x+cw/2, cy, { align:'center', baseline:'top' });
        cy+=lineas.length*(T.f1*1.15)+gapTxt;
      }
      if(o.precio){
        doc.setFontSize(T.f2);
        doc.setTextColor(212,82,26);
        doc.text($m(it.p.venta||0), x+cw/2, cy, { align:'center', baseline:'top' });
      }
    });
  });
  return doc;
}

// Genera el PDF de etiquetas y lo envía a la Cola de Impresión
// (mismo flujo validado que los archivos de los alumnos: cola → 🖨️ Imprimir)
window.enviarQRsACola = async () => {
  const { o, T, pags, total }=construirPaginasQR();
  if(total===0){ toast('Seleccione al menos un producto','er'); return; }
  toast(`⏳ Generando PDF con ${total} etiquetas en ${pags.length} hoja(s)…`,'wa');
  try{
    const doc=generarPdfQREtiquetas(T, pags, o);
    const blob=doc.output('blob');
    if(blob.size > MAX_ARCHIVO_BYTES){
      throw new Error(`el PDF pesa ${(blob.size/1048576).toFixed(1)} MB y el límite es 0.7 MB — reduzca la selección de productos o las copias`);
    }
    const fecha=new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'short'});
    const archivo=new File([blob],`Etiquetas QR ${fecha}.pdf`,{type:'application/pdf'});
    const usuario=localStorage.getItem('usuario_cbta')||'Admin';
    await enviarDocumentoNube({ usuario, archivo, paginas:pags.length, tipoImpresion:'qr' });
    closeModal('ov-qrs');
    go('cola');
    toast(`✅ ${total} etiquetas (${pags.length} hoja(s)) enviadas a la cola de impresión`,'ok');
  }catch(e){
    console.error('[enviarQRsACola]',e);
    toast('Error al generar el PDF: '+e.message,'er');
  }
};

// ─── Stock select para ajustes ──────────────────────────────────────
function renderStockSelect(){
  const sel = document.getElementById('sk-prod');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— Seleccione —</option>' +
    inventario.map(p=>`<option value="${p.id}">${p.nombre} (Stock: ${p.stock||0})</option>`).join('');
  if(prev) sel.value=prev;
}

// ─── Ajuste de stock (local) ────────────────────────────────────────
window.regStock = async () => {
  const pid  = document.getElementById('sk-prod').value;
  const tipo = document.getElementById('sk-tipo').value;
  const qty  = parseInt(document.getElementById('sk-qty').value)||0;
  const cost = parseFloat(document.getElementById('sk-cost').value)||0;
  const prov = document.getElementById('sk-prov').value;
  const ref  = document.getElementById('sk-ref').value;
  if(!pid){ toast('Seleccione un producto','er'); return; }
  if(qty<=0){ toast('Cantidad inválida','er'); return; }

  const p = inventario.find(p=>p.id===pid);
  if(!p) return;
  const ant = p.stock||0;
  let nuevo  = ant;
  if(tipo==='ENTRADA'||tipo==='AJUSTE+') nuevo = ant+qty;
  else { if(qty>ant){ toast('Stock insuficiente','er'); return; } nuevo=ant-qty; }

  try {
    await actualizarProducto(pid, { ...p, stock: nuevo });
    const movs = LS.get('stockMovs');
    movs.push({fecha:new Date().toISOString().split('T')[0],nomProd:p.nombre,tipo,qty,cost,prov,ref,ant,nuevo});
    LS.set('stockMovs',movs);
    renderStockLog();
    toast(`✅ Stock: ${ant} → ${nuevo}`,'ok');
    ['sk-qty','sk-cost','sk-prov','sk-ref'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.value=id==='sk-qty'?1:'';
    });
  } catch(e){ toast('Error: '+e.message,'er'); }
};

function renderStockLog(){
  const movs = LS.get('stockMovs');
  const tbody = document.getElementById('t-stock');
  if(!tbody) return;
  tbody.innerHTML = [...movs].reverse().slice(0,25).map(m=>`<tr>
    <td>${fd(m.fecha)}</td>
    <td>${m.nomProd}</td>
    <td><span class="badge ${m.tipo==='ENTRADA'?'bok':m.tipo==='AJUSTE+'?'bsrv':'bout'}">${m.tipo}</span></td>
    <td>${m.qty}</td>
    <td>${m.cost>0?$m(m.qty*m.cost):'—'}</td>
  </tr>`).join('')||'<tr><td colspan="5" class="empty">Sin movimientos</td></tr>';
}

// ═══════════════════════════════════════════════════════════════════
// HISTORIAL — desde localStorage
// ═══════════════════════════════════════════════════════════════════
window.renderHist = () => {
  const todas = LS.get('ventas');
  let v = [...todas];
  const d = document.getElementById('h-desde')?.value;
  const h = document.getElementById('h-hasta')?.value;
  const est = document.getElementById('h-estado')?.value || 'todos';
  const q = (document.getElementById('h-q')?.value||'').toLowerCase();
  if(d) v=v.filter(x=>x.fecha>=d);
  if(h) v=v.filter(x=>x.fecha<=h);
  if(est==='fiados') v=v.filter(x=>!esVentaCobrada(x));
  if(est==='cobradas') v=v.filter(x=>esVentaCobrada(x));
  if(q) v=v.filter(x=>(x.items||[]).some(i=>i.nombre?.toLowerCase().includes(q))||x.metodo?.toLowerCase().includes(q)||x.vendedor?.toLowerCase().includes(q)||x.cuentaNombre?.toLowerCase().includes(q));

  const fiadosPend = todas.filter(x=>!esVentaCobrada(x));
  const hKpi = document.getElementById('h-kpi');
  if(hKpi){
    hKpi.innerHTML = [
      {ic:'📝', v:fiadosPend.length, l:'Fiados pendientes', c:'r'},
      {ic:'💰', v:$m(fiadosPend.reduce((a,x)=>a+(x.total||0),0)), l:'Monto pendiente por cobrar', c:'r'},
      {ic:'📄', v:v.length, l:'Registros en vista actual', c:'t'},
    ].map(k=>`<div class="kcard ${k.c}"><span class="kic">${k.ic}</span><div class="kval">${k.v}</div><div class="klbl">${k.l}</div></div>`).join('');
  }

  const tbody = document.getElementById('t-hist');
  if(!tbody) return;
  tbody.innerHTML=[...v].reverse().map(v=>{
    const pendiente = !esVentaCobrada(v);
    const pagoTxt = pendiente
      ? `<span style="color:var(--red);font-weight:700">📝 Fiado pendiente${v.cuentaNombre?` · ${v.cuentaNombre}`:''}</span>`
      : (v.metodoCobroFinal||v.metodo||'—');
    const totalTxt = pendiente
      ? `<strong style="color:var(--red)">${$m(v.total)}</strong>`
      : `<strong>${$m(v.total)}</strong>`;
    const accion = pendiente
      ? `<button class="btn bt bsm" onclick="marcarFiadoPagado('${v.id}')">✅ Marcar pagado</button>`
      : `<span style="font-size:.72rem;color:var(--green);font-weight:700">Cobrado ${v.fechaCobro?fd(v.fechaCobro):''}</span>`;
    return `<tr style="${pendiente?'background:var(--rl)':''}">
    <td><code style="font-family:var(--m);font-size:.77rem">${v.id}</code></td>
    <td>${fd(v.fecha)}</td>
    <td>${v.hora||'—'}</td>
    <td>${v.vendedor||'—'}</td>
    <td>${v.cuentaNombre||'—'}</td>
    <td style="max-width:190px">${(v.items||[]).map(i=>`<div style="font-size:.77rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.qty||1}× ${i.nombre}</div>`).join('')}</td>
    <td>${pagoTxt}</td>
    <td>${totalTxt}</td>
    <td>${accion}</td>
  </tr>`;
  }).join('')||'<tr><td colspan="9" class="empty">Sin ventas en este período</td></tr>';
};

window.marcarFiadoPagado = (id) => {
  const ventas = LS.get('ventas');
  const idx = ventas.findIndex(v=>v.id===id);
  if(idx<0){ toast('Venta no encontrada','er'); return; }
  if(esVentaCobrada(ventas[idx])){ toast('Esta venta ya está cobrada','wa'); return; }

  const metodoPago = prompt('Método de pago recibido (ej. Efectivo, Transferencia):', 'Efectivo');
  if(metodoPago===null) return;

  const now = new Date();
  ventas[idx].cobrado = true;
  ventas[idx].fechaCobro = now.toISOString().split('T')[0];
  ventas[idx].horaCobro = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  ventas[idx].metodoCobroFinal = metodoPago.trim() || 'Efectivo';
  LS.set('ventas', ventas);

  renderHist();
  renderDash();
  renderFinanzas();
  toast('✅ Fiado marcado como pagado','ok');
};

// ═══════════════════════════════════════════════════════════════════
// FINANZAS — desde localStorage
// ═══════════════════════════════════════════════════════════════════
function renderFinanzas(){
  const eg  = LS.get('egresos');
  const ven = LS.get('ventas');
  const mes = new Date().toISOString().split('T')[0].slice(0,7);
  const venPagadas = ventasCobradas(ven);
  const iM  = venPagadas.filter(v=>fechaContableVenta(v)?.startsWith(mes)).reduce((a,v)=>a+v.total,0);
  const eM  = eg.filter(e=>e.fecha.startsWith(mes)).reduce((a,e)=>a+e.monto,0);
  const ut  = iM-eM;

  const kf = document.getElementById('kpi-fin');
  if(kf) kf.innerHTML=[
    {ic:'📈',v:$m(iM),l:'Ingresos del mes',c:'t'},
    {ic:'📉',v:$m(eM),l:'Egresos del mes',c:'r'},
    {ic:ut>=0?'💚':'❤️',v:$m(ut),l:'Utilidad estimada',c:ut>=0?'gr':'r'},
    {ic:'📊',v:iM>0?(ut/iM*100).toFixed(1)+'%':'0%',l:'Margen neto',c:'g'},
  ].map(k=>`<div class="kcard ${k.c}"><span class="kic">${k.ic}</span><div class="kval">${k.v}</div><div class="klbl">${k.l}</div></div>`).join('');

  const tbody = document.getElementById('t-egr');
  if(!tbody) return;
  tbody.innerHTML=[...eg].reverse().map(e=>`<tr>
    <td>${fd(e.fecha)}</td>
    <td>${e.tipo}</td>
    <td>${e.desc}</td>
    <td><strong>${$m(e.monto)}</strong></td>
    <td><code style="font-size:.72rem">${e.comp||'—'}</code></td>
    <td><button class="btn br bsm bic" onclick="delEgreso('${e.id}')">🗑️</button></td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">Sin egresos</td></tr>';
}

window.regEgreso = () => {
  const monto = parseFloat(document.getElementById('e-monto').value)||0;
  const desc  = document.getElementById('e-desc').value.trim();
  if(monto<=0){ toast('Monto inválido','er'); return; }
  if(!desc){ toast('Ingrese descripción','er'); return; }
  const eg = LS.get('egresos');
  eg.push({id:'E-'+Date.now(),fecha:new Date().toISOString().split('T')[0],
    tipo:document.getElementById('e-tipo').value,desc,monto,
    comp:document.getElementById('e-comp').value,
    pago:document.getElementById('e-pago').value});
  LS.set('egresos',eg);
  ['e-monto','e-desc','e-comp'].forEach(id=>document.getElementById(id).value='');
  renderFinanzas();
  toast('✅ Egreso registrado','ok');
};

window.delEgreso = (id) => {
  if(!confirm('¿Eliminar egreso?')) return;
  LS.set('egresos',LS.get('egresos').filter(e=>e.id!==id));
  renderFinanzas();
  toast('Egreso eliminado');
};

// ═══════════════════════════════════════════════════════════════════
// SCANNER QR (jsQR)
// ═══════════════════════════════════════════════════════════════════
let scanFacing = 'environment';

function updateScannerCameraButton(){
  const btn = document.getElementById('qr-switch-btn');
  if(!btn) return;
  btn.textContent = scanFacing === 'environment' ? '🔄 Cámara frontal' : '🔄 Cámara trasera';
}

function stopCam(){
  clearInterval(scanTimer); scanTimer = null;
  if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream = null; }
  const v = document.getElementById('qr-video');
  if(v) v.srcObject = null;
}

async function startCam(){
  stopCam();
  const video = document.getElementById('qr-video');
  const st    = document.getElementById('qr-st');
  updateScannerCameraButton();
  try {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:{ ideal: scanFacing }, width:{ideal:1280}, height:{ideal:720} }
      });
    } catch(e1){
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }
    scanStream = stream; video.srcObject = stream;
    st.textContent = 'Apunte al código QR del producto…';
    scanTimer = setInterval(scanFrame, 200);
  } catch(e){
    if(st) st.textContent = 'No se pudo acceder a la cámara: ' + e.message;
  }
}

window.toggleScannerCamera = async () => {
  scanFacing = scanFacing === 'environment' ? 'user' : 'environment';
  await startCam();
};

window.openScanner = (ctx = 'caja') => {
  scanCtx = ctx;
  document.getElementById('ov-scan').classList.add('on');
  document.getElementById('qr-ok').style.display='none';
  startCam();
};

function scanFrame(){
  const video=document.getElementById('qr-video');
  const canvas=document.getElementById('qr-canvas');
  if(!video||video.readyState!==video.HAVE_ENOUGH_DATA) return;
  canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  const ctx=canvas.getContext('2d'); ctx.drawImage(video,0,0);
  const img=ctx.getImageData(0,0,canvas.width,canvas.height);
  const code=jsQR(img.data,img.width,img.height,{inversionAttempts:'dontInvert'});
  if(code){
    const dato=code.data.trim();
    const prod=inventario.find(p=>p.id===dato);
    if(prod){
      document.getElementById('qr-ok').style.display='block';
      document.getElementById('qr-ok-name').textContent=prod.nombre;
      clearInterval(scanTimer); scanTimer=null;
      if(scanCtx==='alumno'){
        // Flujo tienda del alumno: pedir la CANTIDAD antes de agregar al pedido
        setTimeout(()=>{ abrirQtyAlumno(prod.id); },450);
      } else {
        setTimeout(()=>{ closeScanner(); addProdToCart(prod.id); },700);
      }
    } else {
      if(document.getElementById('qr-st'))
        document.getElementById('qr-st').textContent='⚠️ ID no encontrado: '+dato;
    }
  }
}

window.closeScanner = () => {
  stopCam();
  closeModal('ov-scan');
};

// ═══════════════════════════════════════════════════════════════════
// PANEL ALUMNO
// ═══════════════════════════════════════════════════════════════════
window.selTipo = (el, tipo) => {
  document.querySelectorAll('#tipo-grid .tipo-card').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  tipoImpAlumno = tipo;
  recalcularSaturacion();
  document.getElementById('alumno-tipo-label').textContent = etiquetaTipoAlumno();
};

document.getElementById('input-archivo')?.addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if(!files.length) return;

  // Ocultar previews previos
  ocultarPreviewImagen();

  // Varias imágenes → modo cuadrícula con distribución por hoja
  if(files.length > 1){
    if(files.some(f => !esImagen(f))){
      toast('Para varias imágenes solo se aceptan imágenes (JPG, PNG, WEBP). Para un PDF, mándalo solo.','er');
      e.target.value = '';
      return;
    }
    if(files.length > 20){ toast('Máximo 20 imágenes por envío','er'); e.target.value=''; return; }
    await cargarMultiImagenes(files);
    return;
  }

  const file = files[0];

  if(esImagen(file)){
    // Flujo de imagen
    document.getElementById('up-filename').textContent = file.name;
    document.getElementById('alumno-cost-sub').textContent = 'Procesando imagen…';
    mostrarPreviewImagen(file);
    return;
  }

  if(file.type!=='application/pdf'){ toast('Solo se aceptan archivos PDF o imágenes (JPG, PNG, WEBP)','er'); return; }
  document.getElementById('up-filename').textContent = file.name;
  document.getElementById('alumno-cost-sub').textContent = 'Leyendo PDF…';

  const reader = new FileReader();
  reader.onload = async function(){
    try {
      const arr = new Uint8Array(this.result);
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
      const pdf = await pdfjsLib.getDocument(arr).promise;
      document.getElementById('alumno-pags').textContent = pdf.numPages;
      document.getElementById('pags-info').style.display = 'flex';
      // Detección de saturación: renderiza la página 1 y mide la tinta
      try {
        const page = await pdf.getPage(1);
        const vp = page.getViewport({ scale: 0.35 });
        const c = document.createElement('canvas');
        c.width  = Math.max(1, Math.ceil(vp.width));
        c.height = Math.max(1, Math.ceil(vp.height));
        const cx = c.getContext('2d');
        cx.fillStyle = '#ffffff';
        cx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: cx, viewport: vp, background: '#ffffff' }).promise;
        const r = analizarCoberturaCanvas(c);
        saturacionAlumno = (r && r.densidad !== undefined)
          ? { cobertura: r.densidad, colorPct: r.colorPct, saturada: r.densidad >= UMBRAL_SATURACION }
          : { cobertura:0, colorPct:0, saturada:false };
      } catch(err){
        saturacionAlumno = { cobertura:0, colorPct:0, saturada:false };
      }
      actualizarCostoAlumno(pdf.numPages);
    } catch(e){ toast('Error al leer PDF: '+e.message,'er'); }
  };
  reader.readAsArrayBuffer(file);
});

function actualizarCostoAlumno(pags){
  const n = pags || parseInt(document.getElementById('alumno-pags').textContent)||0;
  const pu = precioUnitario(tipoImpAlumno, saturacionAlumno.saturada);
  const c = (n * pu).toFixed(2);
  document.getElementById('alumno-total').textContent = `$${c}`;
  const lblTipo = document.getElementById('alumno-tipo-label');
  if(lblTipo) lblTipo.textContent = etiquetaTipoAlumno();
  const extraSat = (tipoImpAlumno==='smart_tank' && saturacionAlumno.saturada) ? ' · color saturado 🔥' : '';
  document.getElementById('alumno-cost-sub').textContent =
    n>0 ? `${n} página${n!==1?'s':''} × $${pu.toFixed(2)}${extraSat}` : 'Seleccione un archivo';
}

window.enviarArchivo = async () => {
  const input  = document.getElementById('input-archivo');
  const paginas = parseInt(document.getElementById('alumno-pags').textContent)||0;
  const usuario = localStorage.getItem('usuario_cbta');
  const selMulti = multiSeleccionadas();
  const esMulti  = input.files.length > 1 && selMulti.length > 0;
  if(input.files.length === 0){ toast('Seleccione un archivo PDF','er'); return; }
  if(paginas===0){ toast('El archivo no tiene páginas detectadas','er'); return; }

  const btn = document.getElementById('btn-enviar');
  btn.disabled=true; btn.textContent='Enviando…';

  let archivoFinal = null;

  // Varias imágenes → un solo PDF con cuadrícula
  if(esMulti){
    try {
      btn.textContent = 'Convirtiendo imágenes a PDF…';
      const { por } = multiPaginas();
      const pdfBlob = await construirPdfMultiImagenes(selMulti, por);
      archivoFinal = new File([pdfBlob], `imagenes_${selMulti.length}.pdf`, { type: 'application/pdf' });
    } catch(e){
      toast('Error al combinar imágenes: '+e.message,'er');
      btn.disabled=false; btn.innerHTML='📤 Enviar al Profr. Cecilio';
      return;
    }
  } else {
    const archivo = input.files[0];
    archivoFinal = archivo;
    // Si es imagen, convertir a PDF primero
    if(esImagen(archivo) && imagenActual){
      try {
        btn.textContent = 'Convirtiendo imagen a PDF…';
        const pdfBlob = await imagenAPdfBlob(imagenActual, imagenRotation);
        archivoFinal = new File([pdfBlob], archivo.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
      } catch(e){
        toast('Error al convertir imagen: '+e.message,'er');
        btn.disabled=false; btn.innerHTML='📤 Enviar al Profr. Cecilio';
        return;
      }
    }
  }

  // Los archivos viven dentro de Firestore (sin Storage): validar tamaño
  if(archivoFinal.size > MAX_ARCHIVO_BYTES){
    const mb = (archivoFinal.size/1048576).toFixed(2);
    toast(`El PDF pesa ${mb} MB (límite 0.7 MB). Truco: manda foto del documento, la app la comprime sola.`, 'er');
    btn.disabled=false; btn.innerHTML='📤 Enviar al Profr. Cecilio';
    return;
  }

  try {
    btn.textContent = '☁️ Guardando en la nube…';
    const esSaturada = tipoImpAlumno==='smart_tank' && !!saturacionAlumno.saturada;
    const ok = await enviarDocumentoNube({ usuario, archivo: archivoFinal, paginas, tipoImpresion:tipoImpAlumno, saturada: esSaturada });
    btn.disabled=false; btn.innerHTML='📤 Enviar al Profr. Cecilio';
    if(ok){ document.getElementById('ov-exito').classList.add('on'); }
  } catch(err) {
    btn.disabled=false; btn.innerHTML='📤 Enviar al Profr. Cecilio';
    console.error('[enviarArchivo] Error detallado:', err);
    toast('Error: ' + err.message, 'er');
  }
};

window.resetAlumno = () => {
  document.getElementById('input-archivo').value='';
  document.getElementById('up-filename').textContent='Ningún archivo seleccionado';
  document.getElementById('alumno-pags').textContent='0';
  document.getElementById('pags-info').style.display='none';
  document.getElementById('alumno-total').textContent='$0.00';
  document.getElementById('alumno-cost-sub').textContent='Seleccione un archivo para calcular';
  ocultarPreviewImagen();
};

// ═══════════════════════════════════════════════════════════════════
// TIENDA DEL ALUMNO — escaneo QR → cantidad → carrito → pedido al admin
// Los pedidos se guardan en cola_impresion con pedidoAlumno:true
// (ver database.js) y el administrador los ve en "Nueva Venta".
// ═══════════════════════════════════════════════════════════════════
function iniciarAlumno(nombre){
  if(!alumnoIniciado){
    alumnoIniciado = true;
    // Inventario en vivo (precios y stock reales para el pedido)
    escucharInventarioDB(snap => {
      inventario = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAlLista();
      renderCarritoAlumno();
    });
    // Pedidos propios en vivo (para saber si ya lo están cobrando)
    escucharPedidosAlumnoDB(snap => {
      pedidosAlumno = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderMisPedidos();
    });
  }
  // Reanudar el pedido pendiente del mismo alumno (persistencia local)
  try { carritoAlumno = JSON.parse(localStorage.getItem('carrito_alumno_'+nombre) || '[]') || []; }
  catch(e){ carritoAlumno = []; }
  if(!Array.isArray(carritoAlumno)) carritoAlumno = [];
  renderCarritoAlumno();
  renderAlLista();
}

window.alumnoTab = (t) => {
  document.getElementById('altab-imp')?.classList.toggle('on', t==='imp');
  document.getElementById('altab-tienda')?.classList.toggle('on', t==='tienda');
  const imp = document.getElementById('alumno-imp');
  const tie = document.getElementById('alumno-tienda');
  if(imp) imp.style.display = t==='imp' ? 'block' : 'none';
  if(tie) tie.style.display = t==='tienda' ? 'block' : 'none';
};

// Lista manual por nombre (respaldo cuando la cámara no está disponible)
window.renderAlLista = () => {
  const el = document.getElementById('al-lista'); if(!el) return;
  const q = (document.getElementById('al-buscar')?.value||'').toLowerCase();
  const f = (q ? inventario.filter(p=>p.nombre?.toLowerCase().includes(q)) : inventario)
    .filter(p=>(p.stock||0)>0).slice(0,30);
  el.innerHTML = f.length===0
    ? '<div class="empty" style="padding:8px">Sin productos disponibles</div>'
    : f.map(p=>`
      <button class="al-it" onclick="abrirQtyAlumno('${p.id}')">
        ${p.foto?`<img src="${p.foto}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:7px;flex-shrink:0">`:'<span style="font-size:1.1rem">📦</span>'}
        <div style="flex:1;min-width:0">
          <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div>
          <div style="font-size:.7rem;color:var(--ink3)">Stock: ${p.stock||0}</div>
        </div>
        <div style="font-size:.85rem;font-weight:700;color:var(--accent)">${$m(p.venta||0)}</div>
      </button>`).join('');
};

// ── Modal de cantidad: escaneo → indicar cantidad → enviar al pedido ──
function abrirQtyAlumno(id){
  const p = inventario.find(x=>x.id===id);
  if(!p){ toast('Producto no encontrado','er'); return; }
  if((p.stock||0)<=0){ toast('Producto sin stock','er'); return; }
  qtyProdId = id;
  const enCar = carritoAlumno.find(x=>x.id===id);
  const num = document.getElementById('qty-num');
  if(num){ num.value = enCar ? enCar.qty : 1; num.max = p.stock; }
  const foto = document.getElementById('qty-foto');
  if(p.foto){ foto.src=p.foto; foto.style.display='block'; } else { foto.style.display='none'; foto.src=''; }
  document.getElementById('qty-nombre').textContent = p.nombre;
  document.getElementById('qty-precio').textContent = `${$m(p.venta||0)} c/u`;
  document.getElementById('qty-stock').textContent = `Stock disponible: ${p.stock}`;
  document.getElementById('qty-encarrito').textContent = enCar ? `Ya tienes ${enCar.qty} en tu pedido — se actualizará` : '';
  qtyAlumnoPinta();
  document.getElementById('ov-qty-al').classList.add('on');
}
window.abrirQtyAlumno = abrirQtyAlumno;

function qtyAlumnoVal(){
  const p = inventario.find(x=>x.id===qtyProdId);
  let v = parseInt(document.getElementById('qty-num')?.value)||0;
  if(v<1) v = 1;
  if(p && v>(p.stock||1)) v = p.stock||1;
  return v;
}
function qtyAlumnoPinta(){
  const p = inventario.find(x=>x.id===qtyProdId); if(!p) return;
  const v = qtyAlumnoVal();
  const el = document.getElementById('qty-total');
  if(el) el.innerHTML = `Total: <b>${$m((p.venta||0)*v)}</b>`;
}
window.qtyAlumnoStep = (d) => {
  const num = document.getElementById('qty-num'); if(!num) return;
  let v = qtyAlumnoVal() + d;
  const p = inventario.find(x=>x.id===qtyProdId);
  if(p && v > (p.stock||0)){ v = p.stock; toast('Stock máximo: '+p.stock,'wa'); }
  if(v < 1) v = 1;
  num.value = v;
  qtyAlumnoPinta();
};
window.qtyAlumnoInput = () => qtyAlumnoPinta();

window.confirmarQtyAlumno = () => {
  const p = inventario.find(x=>x.id===qtyProdId);
  if(!p){ cerrarQtyAlumno(); return; }
  const v = qtyAlumnoVal();
  const ex = carritoAlumno.find(x=>x.id===p.id);
  if(ex) ex.qty = v;
  else carritoAlumno.push({ id:p.id, nombre:p.nombre, precioUnit:p.venta||0, qty:v });
  guardarCarritoAlumno();
  renderCarritoAlumno();
  toast(`✓ ${v} × ${p.nombre.split(' ').slice(0,3).join(' ')} al pedido`,'ok');
  cerrarQtyAlumno();
};
window.cerrarQtyAlumno = () => {
  closeModal('ov-qty-al');
  qtyProdId = null;
  // Si el escáner sigue abierto (flujo alumno), continuar escaneando
  const ov = document.getElementById('ov-scan');
  if(ov?.classList.contains('on') && scanCtx==='alumno'){
    const ok = document.getElementById('qr-ok');
    if(ok) ok.style.display='none';
    const st = document.getElementById('qr-st');
    if(st) st.textContent='Apunte al código QR del producto…';
    if(!scanTimer) scanTimer = setInterval(scanFrame, 200);
  }
};

// ── Carrito visual del alumno ───────────────────────────────────────
function guardarCarritoAlumno(){
  const nombre = localStorage.getItem('usuario_cbta') || '';
  try { localStorage.setItem('carrito_alumno_'+nombre, JSON.stringify(carritoAlumno)); } catch(e){}
}
function renderCarritoAlumno(){
  const el  = document.getElementById('al-cart');
  const tot = document.getElementById('al-total');
  const sub = document.getElementById('al-cart-sub');
  if(!el) return;
  if(!carritoAlumno.length){
    el.innerHTML = '<div class="empty" style="padding:14px">Escanea o busca productos para agregarlos</div>';
    if(tot) tot.textContent = '$0.00';
    if(sub) sub.textContent = 'Escanea o busca productos para agregarlos';
    return;
  }
  el.innerHTML = carritoAlumno.map((it,i)=>{
    const p = inventario.find(x=>x.id===it.id);
    const stockReal = p ? (p.stock||0) : null;
    const aviso = (stockReal!==null && it.qty>stockReal) ? ` · ⚠️ stock actual: ${stockReal}` : '';
    return `<div class="al-it" style="cursor:default">
      ${p?.foto?`<img src="${p.foto}" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:7px;flex-shrink:0">`:'<span style="font-size:1.1rem">📦</span>'}
      <div style="flex:1;min-width:0">
        <div style="font-size:.8rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.nombre}</div>
        <div style="font-size:.72rem;color:var(--ink3)">${$m(it.precioUnit)} c/u${aviso}</div>
      </div>
      <div class="qb">
        <button class="qq" onclick="alQty(${i},-1)">−</button>
        <span style="min-width:20px;text-align:center;font-size:.82rem;font-weight:700">${it.qty}</span>
        <button class="qq" onclick="alQty(${i},1)">+</button>
      </div>
      <div style="font-size:.85rem;font-weight:700;min-width:52px;text-align:right">${$m(it.precioUnit*it.qty)}</div>
      <button class="ci-del" onclick="alRm(${i})">✕</button>
    </div>`;
  }).join('');
  const t = carritoAlumno.reduce((a,i)=>a+i.precioUnit*i.qty,0);
  const n = carritoAlumno.reduce((a,i)=>a+i.qty,0);
  if(tot) tot.textContent = $m(t);
  if(sub) sub.textContent = `${n} artículo(s) en tu pedido`;
}
window.alQty = (i,d) => {
  const it = carritoAlumno[i]; if(!it) return;
  const nq = it.qty + d;
  if(nq<=0){ alRm(i); return; }
  const p = inventario.find(x=>x.id===it.id);
  if(p && nq > (p.stock||0)){ toast('Stock máximo: '+p.stock,'wa'); return; }
  it.qty = nq; guardarCarritoAlumno(); renderCarritoAlumno();
};
window.alRm = (i) => { carritoAlumno.splice(i,1); guardarCarritoAlumno(); renderCarritoAlumno(); };

// ── Enviar el pedido al administrador ───────────────────────────────
window.enviarPedidoAlumno = async () => {
  if(!carritoAlumno.length){ toast('Tu pedido está vacío','er'); return; }
  for(const it of carritoAlumno){
    const p = inventario.find(x=>x.id===it.id);
    if(!p){ toast(`"${it.nombre}" ya no está disponible. Quítalo del pedido.`, 'er'); return; }
    if(it.qty > (p.stock||0)){ toast(`Solo hay ${p.stock} de "${p.nombre}". Ajusta la cantidad.`, 'er'); return; }
  }
  const btn = document.getElementById('btn-pedido');
  const nombre = localStorage.getItem('usuario_cbta') || 'Alumno';
  if(btn){ btn.disabled = true; btn.textContent = '☁️ Enviando…'; }
  try {
    const total = carritoAlumno.reduce((a,i)=>a+i.precioUnit*i.qty,0);
    await enviarPedidoAlumnoDB({
      usuario: nombre,
      items: carritoAlumno.map(i=>({ id:i.id, nombre:i.nombre, precio:i.precioUnit, qty:i.qty })),
      total,
    });
    carritoAlumno = []; guardarCarritoAlumno(); renderCarritoAlumno();
    if(btn){ btn.disabled=false; btn.textContent='📤 Enviar pedido al administrador'; }
    document.getElementById('ov-exito-ped')?.classList.add('on');
  } catch(e){
    if(btn){ btn.disabled=false; btn.textContent='📤 Enviar pedido al administrador'; }
    console.error('[enviarPedidoAlumno]', e);
    toast('Error al enviar el pedido: '+e.message,'er');
  }
};

// Estado de los pedidos propios (lo ve el alumno en su pantalla)
function renderMisPedidos(){
  const el = document.getElementById('al-mispedidos'); if(!el) return;
  const nombre = localStorage.getItem('usuario_cbta') || '';
  const mios = pedidosAlumno
    .filter(d=>d.usuario===nombre && (d.estatus==='pendiente'||d.estatus==='en_cobro'))
    .sort((a,b)=>(b.fecha?.toDate?.()?.getTime()||0)-(a.fecha?.toDate?.()?.getTime()||0))
    .slice(0,4);
  el.innerHTML = mios.length===0 ? '' :
    `<label style="font-size:.82rem;font-weight:600;color:var(--ink2);display:block;margin-bottom:6px">Tus pedidos en espera</label>` +
    mios.map(d=>{
      const t = d.fecha?.toDate?.();
      const hace = t ? haceRango(t) : 'enviando…';
      const enCaja = d.estatus==='en_cobro';
      return `<div style="background:${enCaja?'var(--il)':'var(--grl)'};border-radius:var(--rs);padding:9px 12px;margin-bottom:6px;font-size:.78rem">
        ${enCaja?'🧾 <b>En caja — te están cobrando</b>':'⏳ <b>Esperando cobro en caja</b>'} · ${$m(d.total||0)} · ${(d.items||[]).length} producto(s) · ${hace}
      </div>`;
    }).join('');
}

function haceRango(t){
  const s = Math.floor((Date.now()-t.getTime())/1000);
  if(s<60) return 'hace un momento';
  if(s<3600) return 'hace '+Math.floor(s/60)+' min';
  if(s<86400) return 'hace '+Math.floor(s/3600)+' h';
  return 'hace '+Math.floor(s/86400)+' d';
}

// ═══════════════════════════════════════════════════════════════════
// SOPORTE DE IMAGENES
// ═══════════════════════════════════════════════════════════════════

let imagenActual = null;       // Image object actual (con rotaciones)
let imagenRotation = 0;        // grados de rotación actuales
let imagenOriginalSrc = null;  // data URL de la imagen original

function esImagen(file) {
  return file && file.type.startsWith('image/');
}

function mostrarPreviewImagen(file) {
  const wrap = document.getElementById('img-preview-wrap');
  const canvas = document.getElementById('img-preview-canvas');
  if (!wrap || !canvas) return;

  const img = new Image();
  const reader = new FileReader();
  reader.onload = (e) => {
    imagenOriginalSrc = e.target.result;
    img.onload = () => {
      imagenActual = img;
      imagenRotation = 0;
      dibujarImagenEnCanvas(canvas, img, 0);
      wrap.style.display = 'block';
      const opWrap = document.getElementById('opciones-imagen-wrap');
      if (opWrap) opWrap.style.display = 'block';

      // 1 imagen = 1 hoja
      document.getElementById('alumno-pags').textContent = '1';
      document.getElementById('pags-info').style.display = 'flex';
      recalcularSaturacionImagen();
      actualizarCostoAlumno(1);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function dibujarImagenEnCanvas(canvas, img, rotation) {
  const ctx = canvas.getContext('2d');
  const isRotated = (rotation === 90 || rotation === -90 || rotation === 270);
  const w = isRotated ? img.naturalHeight : img.naturalWidth;
  const h = isRotated ? img.naturalWidth : img.naturalHeight;

  // Max display size (the canvas CSS is 100% width, we set intrinsic size)
  const maxW = 600;
  const scale = Math.min(1, maxW / w, maxW / h);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth * scale / 2, -img.naturalHeight * scale / 2,
    img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.restore();
}

window.rotarImagenPreview = (deg) => {
  if (!imagenActual) return;
  imagenRotation = (imagenRotation + deg + 360) % 360;
  const canvas = document.getElementById('img-preview-canvas');
  dibujarImagenEnCanvas(canvas, imagenActual, imagenRotation);
  recalcularSaturacionImagen();
  actualizarCostoAlumno();
};

window.aplicarOrientacionImagen = () => {
  if (!imagenActual) return;
  const sel = document.getElementById('img-orientacion')?.value;
  if (sel === 'portrait') imagenRotation = 0;
  else if (sel === 'landscape') imagenRotation = 90;
  const canvas = document.getElementById('img-preview-canvas');
  dibujarImagenEnCanvas(canvas, imagenActual, imagenRotation);
  recalcularSaturacionImagen();
  actualizarCostoAlumno();
};

async function renderImagenAPdf(img, rotation, maxDim, calidad, margenPt = 36) {
  const isRotated = (rotation === 90 || rotation === -90 || rotation === 270);
  const imgW = isRotated ? img.naturalHeight : img.naturalWidth;
  const imgH = isRotated ? img.naturalWidth : img.naturalHeight;

  const CARTA_W = 612, CARTA_H = 792;
  const margen = margenPt;

  // Con margen 0 (borde a borde) se prueba también la página horizontal
  // y se queda la orientación que haga la imagen más grande.
  let pageW = CARTA_W, pageH = CARTA_H, scaleImg;
  if (margen === 0) {
    const sVert = Math.min(CARTA_W / imgW, CARTA_H / imgH);
    const sHorz = Math.min(CARTA_H / imgW, CARTA_W / imgH);
    if (sHorz > sVert) { pageW = CARTA_H; pageH = CARTA_W; scaleImg = sHorz; }
    else { scaleImg = sVert; }
  } else {
    const usableW0 = CARTA_W - 2 * margen;
    const usableH0 = CARTA_H - 2 * margen;
    scaleImg = Math.min(usableW0 / imgW, usableH0 / imgH, 1);
  }

  const drawW = imgW * scaleImg;
  const drawH = imgH * scaleImg;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: pageW > pageH ? 'l' : 'p', unit: 'pt', format: 'letter' });

  // Centrar imagen
  const x = (pageW - drawW) / 2;
  const y = (pageH - drawH) / 2;

  // Canvas reducido: el PDF se forma con la imagen ya comprimida para que
  // el documento quepa en Firestore (límite 1 MB)
  const factor = Math.min(1, maxDim / Math.max(imgW, imgH));
  const cw = Math.max(1, Math.round(imgW * factor));
  const ch = Math.max(1, Math.round(imgH * factor));
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cw;
  tempCanvas.height = ch;
  const tCtx = tempCanvas.getContext('2d');
  tCtx.save();
  tCtx.translate(cw / 2, ch / 2);
  tCtx.rotate((rotation * Math.PI) / 180);
  tCtx.drawImage(img,
    -img.naturalWidth * factor / 2, -img.naturalHeight * factor / 2,
    img.naturalWidth * factor, img.naturalHeight * factor);
  tCtx.restore();

  const dataUrl = tempCanvas.toDataURL('image/jpeg', calidad);
  doc.addImage(dataUrl, 'JPEG', x, y, drawW, drawH);

  return doc.output('blob');
}

async function imagenAPdfBlob(img, rotation) {
  // Escalera de compresión: intenta la mejor calidad y baja hasta caber
  const margenPt = margenImagen === 'cero' ? 0 : 36;
  const intentos = [
    { maxDim: 1600, calidad: 0.78 },
    { maxDim: 1200, calidad: 0.62 },
    { maxDim: 900,  calidad: 0.50 },
  ];
  let ultimo = null;
  for (const it of intentos) {
    ultimo = await renderImagenAPdf(img, rotation, it.maxDim, it.calidad, margenPt);
    if (ultimo.size <= MAX_ARCHIVO_BYTES) return ultimo;
  }
  return ultimo; // el tamaño se valida al enviar
}

// Construye un PDF con varias imágenes distribuidas en cuadrícula:
// 1 = una imagen por hoja, 2 = 1×2, 4 = 2×2, 6 = 2×3, 9 = 3×3.
// Cada imagen se escala proporcionalmente dentro de su celda.
async function construirPdfMultiImagenes(items, porHoja){
  const margenPt = margenImagen === 'cero' ? 0 : 36;
  const GAP = margenPt === 0 ? 4 : 14;
  // Más imágenes por hoja = cada una puede pesar menos
  const MAXDIM = { 1: 1600, 2: 1200, 4: 900, 6: 800, 9: 700 }[porHoja] || 900;

  const aDataUrl = (img, maxDim, q) => {
    const factor = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round(img.naturalWidth * factor));
    const ch = Math.max(1, Math.round(img.naturalHeight * factor));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d').drawImage(img, 0, 0, cw, ch);
    return c.toDataURL('image/jpeg', q);
  };

  const GEOMETRIA = {
    1: { cols: 1, rows: 1 },
    2: { cols: 1, rows: 2 },
    4: { cols: 2, rows: 2 },
    6: { cols: 2, rows: 3 },
    9: { cols: 3, rows: 3 },
  }[porHoja] || { cols: 2, rows: 2 };

  const { jsPDF } = window.jspdf;
  let quality = 0.72;
  let blob = null;

  for(let intento = 0; intento < 3; intento++){
    let doc = null;
    const grupos = [];
    for(let i = 0; i < items.length; i += porHoja) grupos.push(items.slice(i, i + porHoja));

    for(const grupo of grupos){
      const dataUrls = grupo.map(m => aDataUrl(m.img, MAXDIM, quality));

      // Con 1 por hoja, cada página adopta la orientación de su imagen
      const horiz = porHoja === 1
        ? grupo[0].img.naturalWidth > grupo[0].img.naturalHeight
        : false;
      if(!doc) doc = new jsPDF({ orientation: horiz ? 'l' : 'p', unit: 'pt', format: 'letter' });
      else     doc.addPage('letter', horiz ? 'l' : 'p');

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const usableW = pageW - 2*margenPt;
      const usableH = pageH - 2*margenPt;
      const cellW = (usableW - (GEOMETRIA.cols-1)*GAP) / GEOMETRIA.cols;
      const cellH = (usableH - (GEOMETRIA.rows-1)*GAP) / GEOMETRIA.rows;

      grupo.forEach((m, idx) => {
        const col = idx % GEOMETRIA.cols;
        const row = Math.floor(idx / GEOMETRIA.cols);
        const cellX = margenPt + col*(cellW+GAP);
        const cellY = margenPt + row*(cellH+GAP);
        const iw = m.img.naturalWidth, ih = m.img.naturalHeight;
        const s = Math.min(cellW/iw, cellH/ih, margenPt === 0 ? Infinity : 1);
        const dw = iw*s, dh = ih*s;
        doc.addImage(dataUrls[idx], 'JPEG', cellX + (cellW-dw)/2, cellY + (cellH-dh)/2, dw, dh);
      });
    }

    blob = doc.output('blob');
    if(blob.size <= MAX_ARCHIVO_BYTES) return blob;
    quality = Math.max(0.42, quality - 0.14);   // reintenta más comprimido
  }
  return blob; // el límite se valida al enviar
}

function ocultarPreviewImagen() {
  const wrap = document.getElementById('img-preview-wrap');
  if (wrap) wrap.style.display = 'none';
  const opWrap = document.getElementById('opciones-imagen-wrap');
  if (opWrap) opWrap.style.display = 'none';
  const mw = document.getElementById('multi-img-wrap');
  if (mw) mw.style.display = 'none';
  imagenActual = null;
  imagenRotation = 0;
  imagenOriginalSrc = null;
  multiImagenes = [];
  saturacionAlumno = { cobertura:0, colorPct:0, saturada:false };
}

// ═══════════════════════════════════════════════════════════════
// MODO VARIAS IMÁGENES — cuadrícula + distribución por hoja
// ═══════════════════════════════════════════════════════════════

async function cargarMultiImagenes(files){
  document.getElementById('up-filename').textContent = `${files.length} imágenes seleccionadas`;
  document.getElementById('alumno-cost-sub').textContent = 'Cargando imágenes…';
  const items = [];
  for(const f of files){
    try {
      const url = URL.createObjectURL(f);
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('imagen no válida'));
        i.src = url;
      });
      const an = analizarImagen(img, 0);
      items.push({ file: f, img, sel: true, url,
        densidad: an ? an.densidad : 0, colorPct: an ? an.colorPct : 0 });
    } catch(err){
      toast(`No se pudo leer "${f.name}"`,'wa');
    }
  }
  multiImagenes = items;
  if(!items.length){
    toast('Ninguna imagen válida','er');
    document.getElementById('input-archivo').value = '';
    document.getElementById('up-filename').textContent = 'Ningún archivo seleccionado';
    return;
  }
  renderMultiGrid();
  document.getElementById('multi-img-wrap').style.display = 'block';
  document.getElementById('opciones-imagen-wrap').style.display = 'block';
  document.getElementById('pags-info').style.display = 'flex';
  actualizarMulti();
}

function renderMultiGrid(){
  const grid = document.getElementById('multi-img-grid');
  if(!grid) return;
  grid.innerHTML = multiImagenes.map((m, i) => `
    <button type="button" onclick="toggleMultiImg(${i})" style="position:relative;padding:0;border:2px solid ${m.sel?'#d4521a':'var(--paper3)'};border-radius:8px;overflow:hidden;background:var(--paper2);cursor:pointer;opacity:${m.sel?1:.35}">
      <img src="${m.url}" style="width:100%;height:64px;object-fit:cover;display:block" alt="">
      <span style="position:absolute;top:2px;right:2px;background:${m.sel?'#d4521a':'#999'};color:#fff;border-radius:50%;width:18px;height:18px;font-size:.62rem;line-height:18px">${m.sel?'✓':''}</span>
    </button>
  `).join('');
}

window.toggleMultiImg = (i) => {
  if(!multiImagenes[i]) return;
  multiImagenes[i].sel = !multiImagenes[i].sel;
  renderMultiGrid();
  actualizarMulti();
};

window.cambiarPorHoja = () => { actualizarMulti(); };
window.cambiarMargenImagen = (v) => {
  margenImagen = v;
  if(imagenActual) recalcularSaturacionImagen();
  else if(multiImagenes.length) recalcularSaturacionMulti();
  actualizarCostoAlumno();
};

function multiSeleccionadas(){ return multiImagenes.filter(m => m.sel); }

function multiPaginas(){
  const n = multiSeleccionadas().length;
  const por = parseInt(document.getElementById('multi-porhoja')?.value)||4;
  return { n, por, pags: n ? Math.ceil(n/por) : 0 };
}

function actualizarMulti(){
  const { n, por, pags } = multiPaginas();
  const nombre = document.getElementById('up-filename');
  if(nombre) nombre.textContent = n ? `${n} imagen${n!==1?'es':''} · ${pags} hoja${pags!==1?'s':''} (${por} por hoja)` : '0 imágenes seleccionadas';
  document.getElementById('alumno-pags').textContent = pags;
  recalcularSaturacionMulti();
  actualizarCostoAlumno(pags);
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════
window.exportar = () => {
  const data={ventas:LS.get('ventas'),egresos:LS.get('egresos'),stockMovs:LS.get('stockMovs'),fecha:new Date().toISOString()};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  a.download=`cbta_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  toast('✅ Datos exportados','ok');
};

// ═══════════════════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════════════════
window.closeModal = (id) => document.getElementById(id)?.classList.remove('on');
document.querySelectorAll('.ov').forEach(o=>{
  o.addEventListener('click',e=>{
    if(e.target===o){
      if(o.id==='ov-scan') window.closeScanner();
      else if(o.id==='ov-qty-al') window.cerrarQtyAlumno();
      else window.closeModal(o.id);
    }
  });
});

// ─── COMPATIBILIDAD: funciones que el ui-controller original expone ──
// Por si algún módulo externo las llama directamente
window.agregarAlCarritoImpresion = window.addImpToCart;

// ═══════════════════════════════════════════════════════════════════
// IMPRESIÓN DE IMÁGENES — ADMIN (clientes presenciales con USB/foto)
// ═══════════════════════════════════════════════════════════════════

let adminImagenActual = null;
let adminImagenRotation = 0;
let adminManualTab = 'manual'; // 'manual' o 'imagen'

window.imprimirManualTab = (tab) => {
  adminManualTab = tab;
  document.getElementById('im-tab-manual-content').style.display = tab === 'manual' ? 'block' : 'none';
  document.getElementById('im-tab-imagen-content').style.display = tab === 'imagen' ? 'block' : 'none';
  document.getElementById('im-tab-manual').className = tab === 'manual' ? 'btn bp bsm' : 'btn bs bsm';
  document.getElementById('im-tab-imagen').className = tab === 'imagen' ? 'btn bp bsm' : 'btn bs bsm';

  // Cambiar el botón de acción
  const btnAgregar = document.getElementById('btn-agregar-imp-manual');
  if (tab === 'imagen') {
    btnAgregar.setAttribute('onclick', 'agregarImpresionImagenAdmin()');
    btnAgregar.innerHTML = '🖼️ Procesar imagen y agregar';
  } else {
    btnAgregar.setAttribute('onclick', 'agregarImpresionManual()');
    btnAgregar.innerHTML = '➕ Agregar al carrito';
  }
};

window.adminImagenSeleccionada = (input) => {
  const file = input.files[0];
  if (!file || !file.type.startsWith('image/')) {
    if (file) toast('Solo se aceptan imágenes', 'er');
    return;
  }

  document.getElementById('admin-img-filename').textContent = file.name;

  const img = new Image();
  const reader = new FileReader();
  reader.onload = (e) => {
    img.onload = () => {
      adminImagenActual = img;
      adminImagenRotation = 0;
      const canvas = document.getElementById('admin-img-preview-canvas');
      dibujarImagenEnCanvas(canvas, img, 0);
      reevaluarAdminImagen();
      document.getElementById('admin-img-preview-wrap').style.display = 'block';
      document.getElementById('admin-img-orientacion').value = 'auto';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

window.adminRotarImagen = (deg) => {
  if (!adminImagenActual) return;
  adminImagenRotation = (adminImagenRotation + deg + 360) % 360;
  const canvas = document.getElementById('admin-img-preview-canvas');
  dibujarImagenEnCanvas(canvas, adminImagenActual, adminImagenRotation);
  reevaluarAdminImagen();
};

window.adminAplicarOrientacion = () => {
  if (!adminImagenActual) return;
  const sel = document.getElementById('admin-img-orientacion')?.value;
  if (sel === 'portrait') adminImagenRotation = 0;
  else if (sel === 'landscape') adminImagenRotation = 90;
  const canvas = document.getElementById('admin-img-preview-canvas');
  dibujarImagenEnCanvas(canvas, adminImagenActual, adminImagenRotation);
  reevaluarAdminImagen();
};

window.adminActualizarPrecioImagen = () => {
  const tipo = document.getElementById('im-tipo-img')?.value || 'laser_bn';
  const precio = precioUnitario(tipo, adminImgSaturacion?.saturada);
  const el = document.getElementById('im-total-img');
  if (el) el.textContent = `$${precio.toFixed(2)}`;
  const det = document.getElementById('im-img-detect');
  if (det) {
    if (tipo !== 'smart_tank' || !adminImgSaturacion) det.textContent = '';
    else det.textContent = adminImgSaturacion.saturada
      ? `🎯 Imagen saturada de color (${Math.round(adminImgSaturacion.cobertura*100)}% de tinta) — $3.00`
      : `Tinta ${Math.round(adminImgSaturacion.cobertura*100)}% de la hoja — precio normal $2.00`;
  }
};

window.agregarImpresionImagenAdmin = async () => {
  if (!adminImagenActual) {
    toast('Seleccione una imagen primero', 'er');
    return;
  }

  const btnAgregar = document.getElementById('btn-agregar-imp-manual');
  const tipo = document.getElementById('im-tipo-img')?.value || 'laser_bn';
  const usuario = document.getElementById('im-usuario-img')?.value.trim() || 'Presencial';
  const label = (LABELS[tipo] || 'B&N') + (tipo==='smart_tank' && adminImgSaturacion?.saturada ? ' (saturada)' : '');
  const precio = precioUnitario(tipo, adminImgSaturacion?.saturada);

  btnAgregar.disabled = true;
  btnAgregar.innerHTML = '⏳ Convirtiendo a PDF…';

  try {
    // Convertir imagen a PDF
    const pdfBlob = await imagenAPdfBlob(adminImagenActual, adminImagenRotation);

    // Subir a Firebase Storage como impresión
    const nombreArchivo = `img_${Date.now()}_${usuario.replace(/\s+/g, '_')}.pdf`;
    const pdfFile = new File([pdfBlob], nombreArchivo, { type: 'application/pdf' });

    const ok = await (async () => {
      btnAgregar.innerHTML = '☁️ Subiendo a la nube…';
      return enviarDocumentoNube({
        usuario,
        archivo: pdfFile,
        paginas: 1,
        tipoImpresion: tipo,
        saturada: tipo==='smart_tank' && !!adminImgSaturacion?.saturada,
      });
    })();

    if (ok) {
      // Agregar al carrito automáticamente
      carrito.push({
        id: 'img-' + Date.now(),
        nombre: `🖼️ Imagen (${label})`,
        precio,
        tipo: 'impresion',
        usuarioAlumno: usuario,
        numPags: 1,
        labelServicio: label,
        esManual: true,
      });
      renderCart();
      closeModal('ov-imp-manual');
      go('venta');
      toast(`✓ Imagen procesada — $${precio.toFixed(2)}`, 'ok');
    } else {
      toast('Error al subir imagen a Firebase', 'er');
    }
  } catch (e) {
    toast('Error al procesar imagen: ' + e.message, 'er');
    console.error(e);
  }

  btnAgregar.disabled = false;
  btnAgregar.innerHTML = adminManualTab === 'imagen' ? '🖼️ Procesar imagen y agregar' : '➕ Agregar al carrito';
};

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
window.abrirImpresionManual = () => {
  document.getElementById('ov-imp-manual').classList.add('on');
  // Reset tabs a manual
  imprimirManualTab('manual');
  document.getElementById('im-paginas').value='';
  document.getElementById('im-usuario').value='';
  document.getElementById('im-tipo').value='laser_bn';
  calcularManual();
  // Limpiar estado de imagen
  adminImagenActual = null;
  adminImagenRotation = 0;
  adminImgSaturacion = null;
  const detEl = document.getElementById('im-img-detect');
  if (detEl) detEl.textContent = '';
  const imgWrap = document.getElementById('admin-img-preview-wrap');
  if (imgWrap) imgWrap.style.display = 'none';
  const imgInput = document.getElementById('admin-input-imagen');
  if (imgInput) imgInput.value = '';
  const imgFilename = document.getElementById('admin-img-filename');
  if (imgFilename) imgFilename.textContent = 'Ninguna imagen seleccionada';
};

window.calcularManual = () => {
  const pags  = parseInt(document.getElementById('im-paginas')?.value)||0;
  const tipo  = document.getElementById('im-tipo')?.value||'laser_bn';
  const satWrap = document.getElementById('im-sat-wrap');
  if(satWrap) satWrap.style.display = tipo==='smart_tank' ? 'block' : 'none';
  const saturada = tipo==='smart_tank' && !!document.getElementById('im-sat')?.checked;
  const total = pags*precioUnitario(tipo, saturada);
  const el    = document.getElementById('im-total');
  if(el) el.textContent=`$${total.toFixed(2)}`;
};

window.agregarImpresionManual = () => {
  const pags    = parseInt(document.getElementById('im-paginas').value)||0;
  const tipo    = document.getElementById('im-tipo').value;
  const usuario = document.getElementById('im-usuario').value.trim()||'Presencial';
  if(pags<=0){ toast('Ingrese número de páginas','er'); return; }
  const saturada = tipo==='smart_tank' && !!document.getElementById('im-sat')?.checked;
  const precio  = pags*precioUnitario(tipo, saturada);
  const label   = (LABELS[tipo]||'B&N') + (saturada?' (saturada)':'');
  carrito.push({
    id:'manual-'+Date.now(),
    nombre:`🖨️ Impresión ${pags} págs (${label})`,
    precio, tipo:'impresion',
    usuarioAlumno:usuario,
    numPags:pags, labelServicio:label, esManual:true,
  });
  renderCart();
  closeModal('ov-imp-manual');
  go('venta');
  toast(`✓ Impresión manual — $${precio.toFixed(2)}`,'ok');
};

document.addEventListener('DOMContentLoaded', () => {
  setDate();
  setInterval(setDate, 60000);
  verificarSesion();

  // Búsqueda en tiempo real inventario
  document.getElementById('p-buscar')?.addEventListener('input', renderProds);
  document.getElementById('v-buscar')?.addEventListener('input', renderProdList);

  // Tienda del alumno: búsqueda manual de productos
  document.getElementById('al-buscar')?.addEventListener('input', renderAlLista);

  // QR masivo: búsqueda y recálculo de vista previa en vivo
  document.getElementById('qrs-buscar')?.addEventListener('input', renderQrsLista);
  ['qrs-tam','qrs-copias','qrs-nombre','qrs-precio','qrs-borde'].forEach(id=>{
    document.getElementById(id)?.addEventListener('change', renderQrsPreview);
  });
});
