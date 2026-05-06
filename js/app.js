// ═══════════════════════════════════════════════════════════════════
// app.js — CBTa 130 POS Pro v3.0
// Integración: Firebase (database.js sin cambios) + Nuevo diseño
// ═══════════════════════════════════════════════════════════════════
import {
escucharColaImpresion,
enviarDocumentoNube,
escucharInventarioDB,
procesarCobroVenta,
guardarNuevoProducto,
actualizarProducto,
eliminarRegistro,
} from “./database.js”;
import { subirFotoProducto, eliminarFotoProducto } from “./database_additions.js”;

// ─── PRECIOS (misma config que el original) ────────────────────────
const PRECIOS = { laser_bn: 0.50, smart_tank: 2.00 };
const LABELS  = { laser_bn: ‘Láser B&N’, smart_tank: ‘Smart Tank Color’ };

// ─── ESTADO GLOBAL ─────────────────────────────────────────────────
let carrito       = [];
let metodo        = ‘Efectivo’;
let editProdId    = null;
let tipoImpAlumno = ‘laser_bn’;
let scanStream    = null;
let scanTimer     = null;
let chSem = null, chTipo = null;
let colaActual    = [];    // snapshot en tiempo real de Firebase
let inventario    = [];    // snapshot en tiempo real de Firebase

// ─── LOCAL DB (egresos y movimientos de stock — localStorage) ──────
const LS = {
get(k){ try{ return JSON.parse(localStorage.getItem(‘cbta_’+k)) || [] } catch{ return [] } },
set(k,v){ localStorage.setItem(‘cbta_’+k, JSON.stringify(v)) },
};

// ─── TOAST ─────────────────────────────────────────────────────────
function toast(msg, t=’’){
const el = document.createElement(‘div’);
el.className = `toast ${t==='ok'?'ok':t==='er'?'er':t==='wa'?'wa':''}`;
el.textContent = msg;
document.getElementById(‘toasts’).appendChild(el);
setTimeout(()=>el.style.opacity=‘0’, 2600);
setTimeout(()=>el.remove(), 3000);
}

// ─── FORMAT ────────────────────────────────────────────────────────
const $m = n => ‘$’ + (n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ‘,’);
const fd = d => { if(!d) return ‘’; const [y,mo,dd]=d.split(’-’); return `${dd}/${mo}/${y}`; };

// ─── TOPBAR DATE ───────────────────────────────────────────────────
function setDate(){
const d = new Date();
const dias = [‘Dom’,‘Lun’,‘Mar’,‘Mié’,‘Jue’,‘Vie’,‘Sáb’];
const mes  = [‘enero’,‘febrero’,‘marzo’,‘abril’,‘mayo’,‘junio’,‘julio’,‘agosto’,‘septiembre’,‘octubre’,‘noviembre’,‘diciembre’];
if(document.getElementById(‘dash-sub’))
document.getElementById(‘dash-sub’).textContent =
`${dias[d.getDay()]} ${d.getDate()} de ${mes[d.getMonth()]} de ${d.getFullYear()}`;
}

// ═══════════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════
const ADMINS = {
‘CECILIO’: ‘221182’,
‘DANIKA’:  ‘130130’,
};

let roleSelected = null;

window.selRole = (btn, role) => {
document.querySelectorAll(’.rbtn’).forEach(b=>b.classList.remove(‘sel’));
btn.classList.add(‘sel’);
roleSelected = role;
document.getElementById(‘role-select’).style.display = ‘none’;
const form = document.getElementById(‘login-form’);
form.style.display = ‘block’;
document.getElementById(‘login-label’).textContent =
role === ‘admin’ ? ‘Nombre y contraseña:’ : ‘Ingrese su nombre:’;
document.getElementById(‘login-nombre’).placeholder =
role === ‘admin’ ? ‘Nombre…’ : ‘Su nombre completo…’;
// Mostrar campo contraseña solo para admin
document.getElementById(‘login-pass-wrap’).style.display =
role === ‘admin’ ? ‘block’ : ‘none’;
document.getElementById(‘login-nombre’).focus();
};

window.resetLogin = () => {
roleSelected = null;
document.getElementById(‘role-select’).style.display = ‘block’;
document.getElementById(‘login-form’).style.display = ‘none’;
document.getElementById(‘login-nombre’).value = ‘’;
document.getElementById(‘login-pass’).value = ‘’;
};

window.entrar = () => {
const nombre = document.getElementById(‘login-nombre’).value.trim().toUpperCase();
if(!nombre){ toast(‘Ingrese su nombre’,‘er’); return; }

if(roleSelected === ‘admin’){
const pass = document.getElementById(‘login-pass’).value.trim();
if(!ADMINS[nombre]){
toast(‘Usuario no encontrado’,‘er’); return;
}
if(ADMINS[nombre] !== pass){
toast(‘Contraseña incorrecta’,‘er’); return;
}
localStorage.setItem(‘usuario_cbta’, nombre);
mostrarAdmin(nombre);
} else {
if(nombre.length < 2){ toast(‘Nombre demasiado corto’,‘er’); return; }
localStorage.setItem(‘usuario_cbta’, nombre);
mostrarAlumno(nombre);
}
};

document.getElementById(‘login-nombre’)?.addEventListener(‘keydown’, e=>{
if(e.key===‘Enter’) window.entrar();
});
document.getElementById(‘login-pass’)?.addEventListener(‘keydown’, e=>{
if(e.key===‘Enter’) window.entrar();
});

function verificarSesion(){
const params  = new URLSearchParams(window.location.search);
const destino = params.get(‘destino’);
const user    = localStorage.getItem(‘usuario_cbta’);

if(!user){
// Si viene con ?destino=impresion mostrar login alumno directamente
if(destino === ‘impresion’){
showScreen(‘scr-login’);
// Preseleccionar rol alumno
const btnAlumno = document.querySelector(’.rbtn[onclick*=“alumno”]’);
if(btnAlumno) btnAlumno.click();
} else {
// Redirigir a pantalla de bienvenida
window.location.replace(’/bienvenida’);
}
return;
} else if(ADMINS[user]){
mostrarAdmin(user);
} else {
mostrarAlumno(user);
}
}

function mostrarAdmin(nombre){
showScreen(‘scr-admin’);
document.getElementById(‘admin-nombre’).textContent = ’Prof. ’ + nombre;
iniciarAdmin();
setDate();
}

function mostrarAlumno(nombre){
showScreen(‘scr-alumno’);
document.getElementById(‘alumno-saludo’).textContent = `Hola, ${nombre} 👋`;
}

window.cerrarSesion = () => {
localStorage.removeItem(‘usuario_cbta’);
location.reload();
};

function showScreen(id){
document.querySelectorAll(’[id^=“scr-”]’).forEach(s=>s.classList.remove(‘on’));
document.getElementById(id).classList.add(‘on’);
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN — LISTENERS FIREBASE EN TIEMPO REAL
// ═══════════════════════════════════════════════════════════════════
function iniciarAdmin(){
// Cola de impresión — tiempo real desde Firestore
escucharColaImpresion(snap => {
colaActual = snap.docs.map(d => ({ id: d.id, …d.data() }));
actualizarColaBadge();
renderColaImpresion();
renderColaVenta();
});

// Inventario — tiempo real desde Firestore
escucharInventarioDB(snap => {
inventario = snap.docs.map(d => ({ id: d.id, …d.data() }));
renderProds();
renderProdList();
renderStockSelect();
renderDash();
});

renderDash();
}

// ─── Cola badge en sidebar y topbar ────────────────────────────────
function actualizarColaBadge(){
const n = colaActual.length;
const badge = document.getElementById(‘cola-badge’);
const navBadge = document.getElementById(‘nav-cola-badge’);
const countEl = document.getElementById(‘cola-count’);

if(badge){
badge.textContent = n;
badge.classList.toggle(‘show’, n > 0);
}
if(navBadge){
navBadge.textContent = n;
navBadge.style.display = n > 0 ? ‘inline-block’ : ‘none’;
}
if(countEl) countEl.textContent = `${n} pendiente${n!==1?'s':''}`;
}

// ═══════════════════════════════════════════════════════════════════
// NAVEGACIÓN ADMIN
// ═══════════════════════════════════════════════════════════════════
window.go = (s) => {
document.querySelectorAll(’.sec’).forEach(x=>x.classList.remove(‘on’));
document.querySelectorAll(’.nav-btn’).forEach(x=>x.classList.remove(‘on’));
document.getElementById(‘s-’+s).classList.add(‘on’);
document.querySelectorAll(’.nav-btn’).forEach(x=>{
if(x.getAttribute(‘onclick’)?.includes(”’”+s+”’”)) x.classList.add(‘on’);
});
if(s===‘dashboard’) renderDash();
if(s===‘productos’) renderProds();
if(s===‘historial’) renderHist();
if(s===‘stock’)     renderStockSelect();
if(s===‘finanzas’)  renderFinanzas();
if(s===‘venta’)     { renderProdList(); renderCart(); renderColaVenta(); }
if(s===‘cola’)      renderColaFull();
};
window.eliminarDeCola = async (id, nombre) => {
if(!confirm(`¿Eliminar "${nombre}" de la cola sin cobrar?`)) return;
try {
await eliminarRegistro(‘cola_impresion’, id);
toast(‘Eliminado de la cola’,‘ok’);
} catch(e){
toast(’Error: ’+e.message,‘er’);
}
};

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function renderDash(){
const ventas   = LS.get(‘ventas’);
const egresos  = LS.get(‘egresos’);
const hoy      = new Date().toISOString().split(‘T’)[0];
const mes      = hoy.slice(0,7);

const vH = ventas.filter(v=>v.fecha===hoy);
const vM = ventas.filter(v=>v.fecha.startsWith(mes));
const eM = egresos.filter(e=>e.fecha.startsWith(mes));

const tH   = vH.reduce((a,v)=>a+v.total,0);
const tM   = vM.reduce((a,v)=>a+v.total,0);
const tE   = eM.reduce((a,e)=>a+e.monto,0);
const util = tM - tE;

// Productos agotados del inventario Firebase
const agot = inventario.filter(p=>p.stock===0).length;
const bajo = inventario.filter(p=>p.stock>0 && p.stock<=(p.stockMin||5)).length;
const cola = colaActual.length;

const grid = document.getElementById(‘kpi-grid’);
if(!grid) return;
grid.innerHTML = [
{ic:‘💵’, v:$m(tH),    l:‘Ventas hoy’,          c:’’},
{ic:‘📋’, v:vH.length,  l:‘Transacciones hoy’,    c:‘t’},
{ic:‘🖨️’, v:cola,       l:‘Impresiones pendientes’,c:‘i’},
{ic:‘📈’, v:$m(tM),    l:‘Ingresos del mes’,      c:‘b’},
{ic:‘✅’, v:$m(util),   l:‘Utilidad estimada’,     c:util>=0?‘gr’:‘r’},
{ic:‘🔴’, v:agot,       l:‘Productos agotados’,    c:agot>0?‘r’:‘gr’},
].map(k=>`<div class="kcard ${k.c}"><span class="kic">${k.ic}</span><div class="kval">${k.v}</div><div class="klbl">${k.l}</div></div>`).join(’’);

// Alerta stock
const al = document.getElementById(‘al-stock’);
if(al){
if(agot>0||bajo>0){
al.classList.add(‘show’);
document.getElementById(‘al-txt’).textContent=`${agot} agotado(s) y ${bajo} con stock bajo. Revise inventario.`;
} else al.classList.remove(‘show’);
}

// Gráfica 7 días
const labs=[], vals=[];
for(let i=6;i>=0;i–){
const dt=new Date(); dt.setDate(dt.getDate()-i);
const ds=dt.toISOString().split(‘T’)[0];
labs.push([‘Dom’,‘Lun’,‘Mar’,‘Mié’,‘Jue’,‘Vie’,‘Sáb’][dt.getDay()]);
vals.push(ventas.filter(v=>v.fecha===ds).reduce((a,v)=>a+v.total,0));
}
if(chSem) chSem.destroy();
const cSem = document.getElementById(‘c-sem’);
if(cSem) chSem = new Chart(cSem,{type:‘bar’,
data:{labels:labs,datasets:[{data:vals,backgroundColor:‘rgba(212,82,26,.75)’,borderColor:’#d4521a’,borderWidth:2,borderRadius:6}]},
options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
scales:{y:{beginAtZero:true,ticks:{callback:v=>$m(v)}}}}});

// Gráfica impresiones vs productos
const impTotal = ventas.flatMap(v=>v.items||[]).filter(i=>i.tipo===‘impresion’).reduce((a,i)=>a+(i.precio||0),0);
const prodTotal = ventas.flatMap(v=>v.items||[]).filter(i=>i.tipo===‘producto’).reduce((a,i)=>a+(i.precio||0),0);
if(chTipo) chTipo.destroy();
const cTipo = document.getElementById(‘c-tipo’);
if(cTipo) chTipo = new Chart(cTipo,{type:‘doughnut’,
data:{labels:[‘Impresiones’,‘Papelería/Productos’],
datasets:[{data:[impTotal,prodTotal],backgroundColor:[‘rgba(67,56,202,.8)’,‘rgba(212,82,26,.8)’],borderWidth:0}]},
options:{responsive:true,maintainAspectRatio:false,
plugins:{legend:{position:‘bottom’,labels:{font:{family:‘DM Sans’,size:11}}}}}});

// Top 5
const cnt={};
ventas.forEach(v=>(v.items||[]).forEach(i=>{
if(!cnt[i.nombre]) cnt[i.nombre]={q:0,r:0};
cnt[i.nombre].q+=1; cnt[i.nombre].r+=(i.precio||0);
}));
const top = Object.entries(cnt).sort((a,b)=>b[1].q-a[1].q).slice(0,5);
const t5 = document.getElementById(‘top5’);
if(t5) t5.innerHTML = top.length
? top.map(([n,d],i)=>`<tr><td><strong>#${i+1}</strong></td><td>${n}</td><td>${d.q}</td><td>${$m(d.r)}</td></tr>`).join(’’)
: ‘<tr><td colspan="4" class="empty">Sin ventas aún</td></tr>’;
}

// ═══════════════════════════════════════════════════════════════════
// COLA DE IMPRESIÓN — renderizado con nuevo diseño
// ═══════════════════════════════════════════════════════════════════
function renderColaImpresion(){
// Para el panel de venta rápida (mini)
const miniEl = document.getElementById(‘cola-venta-list’);
const miniCount = document.getElementById(‘cola-venta-count’);
if(miniCount) miniCount.textContent = colaActual.length;
}

function renderColaVenta(){
const el = document.getElementById(‘cola-venta-list’);
if(!el) return;
if(colaActual.length===0){
el.innerHTML=’<div class="empty">Sin impresiones pendientes</div>’;
return;
}
el.innerHTML = colaActual.map(doc=>{
const precio = PRECIOS[doc.tipoImpresion]||0.5;
const total  = (doc.paginas * precio).toFixed(2);
const label  = LABELS[doc.tipoImpresion]||‘B&N’;
return `<div class="imp-item"> <span class="imp-icon">${doc.tipoImpresion==='smart_tank'?'🎨':'🖨️'}</span> <div class="imp-info"> <div class="imp-name">${doc.archivo||'Documento'}</div> <div class="imp-meta">${doc.usuario} · ${label} · ${doc.paginas} pág${doc.paginas!==1?'s':''}</div> </div> <div class="imp-actions"> ${doc.archivoURL?`<a href="${doc.archivoURL}" target="_blank" class="btn bs bsm bic" title="Ver PDF">👁️</a>`:''} <button class="btn bi bsm" onclick="addImpToCart('${doc.id}','${doc.archivo}',${total},'${doc.usuario}',${doc.paginas},'${label}')"> +$${total} </button> </div> </div>`;
}).join(’’);
}

function renderColaFull(){
const el = document.getElementById(‘cola-full-list’);
if(!el) return;
if(colaActual.length===0){
el.innerHTML=’<div class="card"><div class="empty">Sin impresiones pendientes 🎉</div></div>’;
return;
}
el.innerHTML = colaActual.map(doc=>{
const precio = PRECIOS[doc.tipoImpresion]||0.5;
const total  = (doc.paginas * precio).toFixed(2);
const label  = LABELS[doc.tipoImpresion]||‘B&N’;
const fecha  = doc.fecha?.toDate ? doc.fecha.toDate().toLocaleString(‘es-MX’) : ‘—’;
return `<div class="imp-item card" style="margin-bottom:10px;padding:16px 18px"> <span class="imp-icon" style="font-size:2rem">${doc.tipoImpresion==='smart_tank'?'🎨':'🖨️'}</span> <div class="imp-info"> <div class="imp-name" style="font-size:.9rem">${doc.archivo||'Documento'}</div> <div class="imp-meta">👤 ${doc.usuario} &nbsp;·&nbsp; ${label} &nbsp;·&nbsp; ${doc.paginas} páginas &nbsp;·&nbsp; ${fecha}</div> <div style="margin-top:6px"><span class="badge bpend">⏳ Pendiente</span></div> </div> <div class="imp-actions" style="flex-direction:column;gap:6px"> ${doc.archivoURL?`<a href="${doc.archivoURL}" target="_blank" class="btn bs bsm wf" style="justify-content:center">👁️ Ver PDF</a>`:’’}
<button class="btn bi bsm wf" style="justify-content:center"
onclick="addImpToCart('${doc.id}','${doc.archivo}',${total},'${doc.usuario}',${doc.paginas},'${label}');go('venta')">
🛒 Cobrar $${total}
</button>
<button class="btn br bsm wf" style="justify-content:center"
onclick="eliminarDeCola('${doc.id}','${doc.archivo||'archivo'}')">
🗑️ Eliminar sin cobrar
</button>

```
  </div>
</div>`;
```

}).join(’’);
}

// ═══════════════════════════════════════════════════════════════════
// CARRITO — Unifica impresiones + productos
// ═══════════════════════════════════════════════════════════════════
window.addImpToCart = (id, nombre, precio, usuario, paginas, label) => {
carrito.push({
id, nombre: `🖨️ ${nombre} (${paginas} págs)`,
precio: parseFloat(precio), tipo: ‘impresion’,
usuarioAlumno: usuario, numPags: paginas, labelServicio: label
});
renderCart();
toast(`✓ Impresión de ${usuario} agregada`, ‘ok’);
};

window.agregarAlCarrito = (id, nombre, precio, tipo, extra={}) => {
const idx = carrito.findIndex(c=>c.id===id && c.tipo===tipo);
if(idx>=0 && tipo===‘producto’){
const prod = inventario.find(p=>p.id===id);
if(prod && carrito[idx].qty >= prod.stock){ toast(‘Stock insuficiente’,‘er’); return; }
carrito[idx].qty = (carrito[idx].qty||1)+1;
carrito[idx].precio = precio * carrito[idx].qty;
} else {
carrito.push({ id, nombre, precio, tipo, qty:1, …extra });
}
renderCart();
toast(‘✓ ’ + nombre.split(’ ‘).slice(0,3).join(’ ’), ‘ok’);
};

function addProdToCart(id){
const p = inventario.find(p=>p.id===id);
if(!p){ toast(‘Producto no encontrado’,‘er’); return; }
if((p.stock||0) <= 0){ toast(‘Sin stock disponible’,‘er’); return; }
const idx = carrito.findIndex(c=>c.id===id && c.tipo===‘producto’);
if(idx>=0){
if(carrito[idx].qty >= (p.stock||0)){ toast(‘Stock máximo’,‘er’); return; }
carrito[idx].qty++;
carrito[idx].precio = (p.venta||0) * carrito[idx].qty;
} else {
carrito.push({ id:p.id, nombre:p.nombre, precio:p.venta||0, tipo:‘producto’, qty:1 });
}
renderCart();
toast(’✓ ‘+p.nombre.split(’ ‘).slice(0,3).join(’ ’),‘ok’);
}
window.addProdToCart = addProdToCart;

function renderCart(){
const c     = document.getElementById(‘cart-items’);
const tot   = document.getElementById(‘ctot’);
const count = document.getElementById(‘cart-count’);
if(!c) return;

if(!carrito.length){
c.innerHTML=’<div class="empty">Carrito vacío</div>’;
if(tot) tot.style.display=‘none’;
if(count) count.textContent=‘0 items’;
return;
}

let sub=0, iva=0;
c.innerHTML = carrito.map((item,i)=>{
const price = item.precio;
const ivaI  = item.tipo===‘impresion’ ? price*0.16 : 0;
sub+=price; iva+=ivaI;
return `<div class="ci"> <div class="ci-info"> <div class="ci-name">${item.nombre}</div> <div class="ci-sub">${item.tipo==='impresion'?'Servicio de impresión':'Producto'}</div> </div> ${item.tipo==='producto'?`
<div class="qb">
<button class="qq" onclick="chQty(${i},-1)">−</button>
<span style="min-width:20px;text-align:center;font-size:.82rem;font-weight:600">${item.qty||1}</span>
<button class="qq" onclick="chQty(${i},1)">+</button>
</div>`:'<div style="width:70px"></div>'} <div class="ci-price">${$m(price)}</div> <button class="ci-del" onclick="rmCart(${i})">✕</button> </div>`;
}).join(’’);

if(tot) tot.style.display=‘block’;
if(count) count.textContent=`${carrito.length} item${carrito.length!==1?'s':''}`;
document.getElementById(‘t-sub’).textContent=$m(sub);
document.getElementById(‘t-iva’).textContent=$m(iva);
document.getElementById(‘t-tot’).textContent=$m(sub+iva);
}

window.chQty = (i,d) => {
if(!carrito[i]) return;
const nq = (carrito[i].qty||1)+d;
if(nq<=0){ rmCart(i); return; }
const prod = inventario.find(p=>p.id===carrito[i].id);
if(prod && nq>prod.stock){ toast(‘Stock máximo’,‘er’); return; }
carrito[i].qty = nq;
carrito[i].precio = (prod?.venta||carrito[i].precio/((carrito[i].qty-d)||1)) * nq;
renderCart();
};

window.rmCart = (i) => { carrito.splice(i,1); renderCart(); };
window.limpiarCarrito = () => { carrito=[]; renderCart(); };

window.selPago = (btn, met) => {
document.querySelectorAll(’.pbtn’).forEach(b=>b.classList.remove(‘sel’));
btn.classList.add(‘sel’);
metodo = met;
};

window.confirmarVenta = async () => {
if(!carrito.length){ toast(‘El carrito está vacío’,‘er’); return; }
if(!confirm(’¿Confirmar cobro y registrar venta?’)) return;

try {
// procesarCobroVenta de database.js — sin cambios
const ok = await procesarCobroVenta(carrito);
if(!ok) throw new Error(‘Error en Firebase’);

```
// Guardar en localStorage para dashboard/historial
const ventas = LS.get('ventas');
const now    = new Date();
ventas.push({
  id: 'V-'+String(ventas.length+1).padStart(4,'0'),
  fecha: now.toISOString().split('T')[0],
  hora:  `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,
  items: carrito.map(i=>({nombre:i.nombre,precio:i.precio,tipo:i.tipo,qty:i.qty||1})),
  metodo,
  notas: document.getElementById('v-notas')?.value||'',
  total: carrito.reduce((a,i)=>a+i.precio,0),
});
LS.set('ventas', ventas);

toast(`✅ Cobro registrado — ${$m(carrito.reduce((a,i)=>a+i.precio,0))}`, 'ok');
carrito=[];
renderCart();
if(document.getElementById('v-notas')) document.getElementById('v-notas').value='';
renderDash();
```

} catch(e) {
toast(’Error al registrar: ’+e.message, ‘er’);
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
const q = (document.getElementById(‘p-buscar’)?.value||’’).toLowerCase();
const f = q ? inventario.filter(p=>p.nombre?.toLowerCase().includes(q)||p.id?.toLowerCase().includes(q)) : inventario;
const tbody = document.getElementById(‘t-prods’);
if(!tbody) return;

tbody.innerHTML = f.length===0
? ‘<tr><td colspan="7" class="empty">Sin productos en inventario</td></tr>’
: f.map(p=>{
const stock = p.stock||0;
const min   = p.stockMin||5;
let badge   = stock===0
? ‘<span class="badge bout">🔴 Agotado</span>’
: stock<=min
? ‘<span class="badge blow">🟡 Stock bajo</span>’
: ‘<span class="badge bok">🟢 OK</span>’;
const mg = p.costo>0 ? ((p.venta-p.costo)/p.venta*100).toFixed(0)+’%’ : ‘—’;
return `<tr> <td><img src="${qrUrl(p.id,52)}" class="qr-th" onclick="verQR('${p.id}')" title="Ver QR" onerror="this.outerHTML='<span style=font-size:1.2rem;cursor:pointer onclick=verQR(&quot;${p.id}&quot;)>📷</span>'"></td> <td><div style="font-weight:600">${p.nombre}</div><div style="font-size:.72rem;color:var(--ink3)">${p.categoria||''} · Margen: ${mg}</div></td> <td><strong>${$m(p.venta||0)}</strong></td> <td>${$m(p.costo||0)}</td> <td> <div>${stock} uds.</div> <div class="sbar"><div class="sbar-f" style="width:${Math.min(100,min>0?stock/min*33:100)}%;background:${stock===0?'var(--red)':stock<=min?'var(--gold)':'var(--green)'}"></div></div> </td> <td>${badge}</td> <td><div style="display:flex;gap:3px"> <button class="btn bs bsm bic" onclick="verQR('${p.id}')" title="QR">📷</button> <button class="btn bs bsm bic" onclick="openProdModal('${p.id}')" title="Editar">✏️</button> <button class="btn br bsm bic" onclick="delProd('${p.id}')" title="Eliminar">🗑️</button> </div></td> </tr>`;
}).join(’’);
}

function renderProdList(){
const q = (document.getElementById(‘v-buscar’)?.value||’’).toLowerCase();
const f = q
? inventario.filter(p=>p.nombre?.toLowerCase().includes(q)||p.id?.toLowerCase().includes(q))
: inventario.slice(0,12);
const el = document.getElementById(‘prod-list’);
if(!el) return;
el.innerHTML = f.map(p=>{
const ok = (p.stock||0)>0;
return `<button onclick="${ok?`addProdToCart(’${p.id}’)`:''}" style="display:flex;align-items:center;gap:9px;padding:9px 11px;background:${ok?'#fff':'var(--paper2)'};border:1.5px solid var(--paper3);border-radius:var(--rs);cursor:${ok?'pointer':'not-allowed'};opacity:${ok?1:.55};width:100%;text-align:left;font-family:var(--f)" ${!ok?'disabled':''}> <span style="font-size:1.2rem">📦</span> <div style="flex:1;min-width:0"> <div style="font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div> <div style="font-size:.72rem;color:var(--ink3)">Stock: ${p.stock||0}</div> </div> <div style="font-size:.88rem;font-weight:700;color:var(--accent)">${$m(p.venta||0)}</div> </button>`;
}).join(’’)||’<div style="color:var(--ink3);font-size:.82rem;padding:6px">Sin productos</div>’;
}

window.openProdModal = (id=null) => {
editProdId = id;
document.getElementById(‘mp-title’).textContent = id ? ‘Editar Producto’ : ‘Nuevo Producto’;
// Limpiar preview foto
document.getElementById(‘mp-foto-preview’).style.display=‘none’;
document.getElementById(‘mp-foto-placeholder’).style.display=‘flex’;
document.getElementById(‘mp-foto-input’).value=’’;

if(id){
const p = inventario.find(p=>p.id===id);
if(!p) return;
document.getElementById(‘mp-nom’).value   = p.nombre||’’;
document.getElementById(‘mp-cat’).value   = p.categoria||‘Otros’;
document.getElementById(‘mp-desc’).value  = p.descripcion||’’;
document.getElementById(‘mp-cost’).value  = p.costo||0;
document.getElementById(‘mp-venta’).value = p.venta||0;
document.getElementById(‘mp-stk’).value   = p.stock||0;
document.getElementById(‘mp-min’).value   = p.stockMin||5;
// Mostrar foto existente si tiene
if(p.fotoURL){
document.getElementById(‘mp-foto-preview’).src = p.fotoURL;
document.getElementById(‘mp-foto-preview’).style.display=‘block’;
document.getElementById(‘mp-foto-placeholder’).style.display=‘none’;
}
} else {
[‘mp-nom’,‘mp-cost’,‘mp-venta’,‘mp-desc’].forEach(i=>document.getElementById(i).value=’’);
document.getElementById(‘mp-stk’).value=0;
document.getElementById(‘mp-min’).value=5;
}
document.getElementById(‘ov-prod’).classList.add(‘on’);
};

window.saveProd = async () => {
const nom   = document.getElementById(‘mp-nom’).value.trim();
const venta = parseFloat(document.getElementById(‘mp-venta’).value)||0;
const costo = parseFloat(document.getElementById(‘mp-cost’).value)||0;
if(!nom||venta<=0){ toast(‘Complete campos obligatorios’,‘er’); return; }

// Subir foto si seleccionaron una
const fotoFile = document.getElementById(‘mp-foto-input’).files[0];
let fotoURL    = editProdId ? (inventario.find(p=>p.id===editProdId)?.fotoURL||null) : null;

if(fotoFile){
toast(‘Subiendo foto…’,’’);
fotoURL = await subirFotoProducto(fotoFile, nom);
if(!fotoURL){ toast(‘Error subiendo foto, intente de nuevo’,‘er’); return; }
}

const datos = {
nombre:      nom,
categoria:   document.getElementById(‘mp-cat’).value,
descripcion: document.getElementById(‘mp-desc’).value.trim(),
costo, venta,
stock:    parseInt(document.getElementById(‘mp-stk’).value)||0,
stockMin: parseInt(document.getElementById(‘mp-min’).value)||5,
fotoURL,
};

try {
if(editProdId){
await actualizarProducto(editProdId, datos);
toast(‘✅ Producto actualizado’,‘ok’);
} else {
await guardarNuevoProducto(datos);
toast(‘✅ Producto agregado’,‘ok’);
}
closeModal(‘ov-prod’);
} catch(e){
toast(’Error al guardar: ’+e.message,‘er’);
}
};

// Preview de foto antes de subir
window.previewFoto = (input) => {
const file = input.files[0];
if(!file) return;
const reader = new FileReader();
reader.onload = e => {
const preview = document.getElementById(‘mp-foto-preview’);
const placeholder = document.getElementById(‘mp-foto-placeholder’);
preview.src = e.target.result;
preview.style.display = ‘block’;
placeholder.style.display = ‘none’;
};
reader.readAsDataURL(file);
};

window.delProd = async (id) => {
if(!confirm(’¿Eliminar este producto del inventario? No se puede deshacer.’)) return;
try {
await eliminarRegistro(‘inventario’, id);
toast(‘Producto eliminado’);
} catch(e){ toast(’Error: ’+e.message,‘er’); }
};

window.verQR = (id) => {
const p = inventario.find(p=>p.id===id);
if(!p) return;
document.getElementById(‘qr-title’).textContent = ’QR: ’+p.nombre;
document.getElementById(‘qr-info’).textContent  = `ID: ${id} · ${p.categoria||''} · ${$m(p.venta||0)}`;
document.getElementById(‘qr-img-wrap’).innerHTML =
`<img src="${qrUrl(id,200)}" style="border-radius:10px;border:2px solid var(--paper3);max-width:200px" onerror="this.parentElement.innerHTML='<p style=color:var(--red)>Sin conexión a internet</p>'">`;
document.getElementById(‘ov-qr’).classList.add(‘on’);
};

window.printQR = () => {
const img  = document.getElementById(‘qr-img-wrap’).querySelector(‘img’);
const info = document.getElementById(‘qr-info’).textContent;
const name = document.getElementById(‘qr-title’).textContent.replace(‘QR: ‘,’’);
if(!img) return;
const w = window.open(’’,’_blank’);
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

// ─── Stock select para ajustes ──────────────────────────────────────
function renderStockSelect(){
const sel = document.getElementById(‘sk-prod’);
if(!sel) return;
const prev = sel.value;
sel.innerHTML = ‘<option value="">— Seleccione —</option>’ +
inventario.map(p=>`<option value="${p.id}">${p.nombre} (Stock: ${p.stock||0})</option>`).join(’’);
if(prev) sel.value=prev;
}

// ─── Ajuste de stock (local) ────────────────────────────────────────
window.regStock = async () => {
const pid  = document.getElementById(‘sk-prod’).value;
const tipo = document.getElementById(‘sk-tipo’).value;
const qty  = parseInt(document.getElementById(‘sk-qty’).value)||0;
const cost = parseFloat(document.getElementById(‘sk-cost’).value)||0;
const prov = document.getElementById(‘sk-prov’).value;
const ref  = document.getElementById(‘sk-ref’).value;
if(!pid){ toast(‘Seleccione un producto’,‘er’); return; }
if(qty<=0){ toast(‘Cantidad inválida’,‘er’); return; }

const p = inventario.find(p=>p.id===pid);
if(!p) return;
const ant = p.stock||0;
let nuevo  = ant;
if(tipo===‘ENTRADA’||tipo===‘AJUSTE+’) nuevo = ant+qty;
else { if(qty>ant){ toast(‘Stock insuficiente’,‘er’); return; } nuevo=ant-qty; }

try {
await actualizarProducto(pid, { …p, stock: nuevo });
const movs = LS.get(‘stockMovs’);
movs.push({fecha:new Date().toISOString().split(‘T’)[0],nomProd:p.nombre,tipo,qty,cost,prov,ref,ant,nuevo});
LS.set(‘stockMovs’,movs);
renderStockLog();
toast(`✅ Stock: ${ant} → ${nuevo}`,‘ok’);
[‘sk-qty’,‘sk-cost’,‘sk-prov’,‘sk-ref’].forEach(id=>{
const el=document.getElementById(id);
if(el) el.value=id===‘sk-qty’?1:’’;
});
} catch(e){ toast(’Error: ’+e.message,‘er’); }
};

function renderStockLog(){
const movs = LS.get(‘stockMovs’);
const tbody = document.getElementById(‘t-stock’);
if(!tbody) return;
tbody.innerHTML = […movs].reverse().slice(0,25).map(m=>`<tr>
<td>${fd(m.fecha)}</td>
<td>${m.nomProd}</td>
<td><span class="badge ${m.tipo==='ENTRADA'?'bok':m.tipo==='AJUSTE+'?'bsrv':'bout'}">${m.tipo}</span></td>
<td>${m.qty}</td>
<td>${m.cost>0?$m(m.qty*m.cost):’—’}</td>

  </tr>`).join('')||'<tr><td colspan="5" class="empty">Sin movimientos</td></tr>';
}

// ═══════════════════════════════════════════════════════════════════
// HISTORIAL — desde localStorage
// ═══════════════════════════════════════════════════════════════════
window.renderHist = () => {
let v = LS.get(‘ventas’);
const d = document.getElementById(‘h-desde’)?.value;
const h = document.getElementById(‘h-hasta’)?.value;
const q = (document.getElementById(‘h-q’)?.value||’’).toLowerCase();
if(d) v=v.filter(x=>x.fecha>=d);
if(h) v=v.filter(x=>x.fecha<=h);
if(q) v=v.filter(x=>(x.items||[]).some(i=>i.nombre?.toLowerCase().includes(q))||x.metodo?.toLowerCase().includes(q));
const tbody = document.getElementById(‘t-hist’);
if(!tbody) return;
tbody.innerHTML=[…v].reverse().map(v=>`<tr> <td><code style="font-family:var(--m);font-size:.77rem">${v.id}</code></td> <td>${fd(v.fecha)}</td> <td>${v.hora||'—'}</td> <td style="max-width:190px">${(v.items||[]).map(i=>`<div style="font-size:.77rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.qty||1}× ${i.nombre}</div>`).join(’’)}</td>
<td>${v.metodo||’—’}</td>
<td><strong>${$m(v.total)}</strong></td>

  </tr>`).join('')||'<tr><td colspan="6" class="empty">Sin ventas en este período</td></tr>';
};

// ═══════════════════════════════════════════════════════════════════
// FINANZAS — desde localStorage
// ═══════════════════════════════════════════════════════════════════
function renderFinanzas(){
const eg  = LS.get(‘egresos’);
const ven = LS.get(‘ventas’);
const mes = new Date().toISOString().split(‘T’)[0].slice(0,7);
const iM  = ven.filter(v=>v.fecha.startsWith(mes)).reduce((a,v)=>a+v.total,0);
const eM  = eg.filter(e=>e.fecha.startsWith(mes)).reduce((a,e)=>a+e.monto,0);
const ut  = iM-eM;

const kf = document.getElementById(‘kpi-fin’);
if(kf) kf.innerHTML=[
{ic:‘📈’,v:$m(iM),l:‘Ingresos del mes’,c:‘t’},
{ic:‘📉’,v:$m(eM),l:‘Egresos del mes’,c:‘r’},
{ic:ut>=0?‘💚’:‘❤️’,v:$m(ut),l:‘Utilidad estimada’,c:ut>=0?‘gr’:‘r’},
{ic:‘📊’,v:iM>0?(ut/iM*100).toFixed(1)+’%’:‘0%’,l:‘Margen neto’,c:‘g’},
].map(k=>`<div class="kcard ${k.c}"><span class="kic">${k.ic}</span><div class="kval">${k.v}</div><div class="klbl">${k.l}</div></div>`).join(’’);

const tbody = document.getElementById(‘t-egr’);
if(!tbody) return;
tbody.innerHTML=[…eg].reverse().map(e=>`<tr>
<td>${fd(e.fecha)}</td>
<td>${e.tipo}</td>
<td>${e.desc}</td>
<td><strong>${$m(e.monto)}</strong></td>
<td><code style="font-size:.72rem">${e.comp||’—’}</code></td>
<td><button class="btn br bsm bic" onclick="delEgreso('${e.id}')">🗑️</button></td>

  </tr>`).join('')||'<tr><td colspan="6" class="empty">Sin egresos</td></tr>';
}

window.regEgreso = () => {
const monto = parseFloat(document.getElementById(‘e-monto’).value)||0;
const desc  = document.getElementById(‘e-desc’).value.trim();
if(monto<=0){ toast(‘Monto inválido’,‘er’); return; }
if(!desc){ toast(‘Ingrese descripción’,‘er’); return; }
const eg = LS.get(‘egresos’);
eg.push({id:‘E-’+Date.now(),fecha:new Date().toISOString().split(‘T’)[0],
tipo:document.getElementById(‘e-tipo’).value,desc,monto,
comp:document.getElementById(‘e-comp’).value,
pago:document.getElementById(‘e-pago’).value});
LS.set(‘egresos’,eg);
[‘e-monto’,‘e-desc’,‘e-comp’].forEach(id=>document.getElementById(id).value=’’);
renderFinanzas();
toast(‘✅ Egreso registrado’,‘ok’);
};

window.delEgreso = (id) => {
if(!confirm(’¿Eliminar egreso?’)) return;
LS.set(‘egresos’,LS.get(‘egresos’).filter(e=>e.id!==id));
renderFinanzas();
toast(‘Egreso eliminado’);
};

// ═══════════════════════════════════════════════════════════════════
// SCANNER QR (jsQR)
// ═══════════════════════════════════════════════════════════════════
window.openScanner = () => {
document.getElementById(‘ov-scan’).classList.add(‘on’);
document.getElementById(‘qr-ok’).style.display=‘none’;
startCam();
};

function startCam(){
const video = document.getElementById(‘qr-video’);
const st    = document.getElementById(‘qr-st’);
navigator.mediaDevices.getUserMedia({video:{facingMode:‘environment’,width:{ideal:1280},height:{ideal:720}}})
.then(stream=>{
scanStream=stream; video.srcObject=stream;
st.textContent=‘Apunte al código QR del producto…’;
scanTimer=setInterval(scanFrame,200);
}).catch(e=>{ if(st) st.textContent=’No se pudo acceder a la cámara: ’+e.message; });
}

function scanFrame(){
const video=document.getElementById(‘qr-video’);
const canvas=document.getElementById(‘qr-canvas’);
if(!video||video.readyState!==video.HAVE_ENOUGH_DATA) return;
canvas.width=video.videoWidth; canvas.height=video.videoHeight;
const ctx=canvas.getContext(‘2d’); ctx.drawImage(video,0,0);
const img=ctx.getImageData(0,0,canvas.width,canvas.height);
const code=jsQR(img.data,img.width,img.height,{inversionAttempts:‘dontInvert’});
if(code){
const dato=code.data.trim();
const prod=inventario.find(p=>p.id===dato);
if(prod){
document.getElementById(‘qr-ok’).style.display=‘block’;
document.getElementById(‘qr-ok-name’).textContent=prod.nombre;
clearInterval(scanTimer);
setTimeout(()=>{ closeScanner(); addProdToCart(prod.id); },700);
} else {
if(document.getElementById(‘qr-st’))
document.getElementById(‘qr-st’).textContent=’⚠️ ID no encontrado: ’+dato;
}
}
}

window.closeScanner = () => {
clearInterval(scanTimer); scanTimer=null;
if(scanStream){ scanStream.getTracks().forEach(t=>t.stop()); scanStream=null; }
const v=document.getElementById(‘qr-video’);
if(v) v.srcObject=null;
closeModal(‘ov-scan’);
};

// ═══════════════════════════════════════════════════════════════════
// PANEL ALUMNO
// ═══════════════════════════════════════════════════════════════════
window.selTipo = (el, tipo) => {
document.querySelectorAll(’.tipo-card’).forEach(c=>c.classList.remove(‘sel’));
el.classList.add(‘sel’);
tipoImpAlumno = tipo;
actualizarCostoAlumno();
document.getElementById(‘alumno-tipo-label’).textContent = tipo===‘laser_bn’?‘B&N’:‘Color’;
};

document.getElementById(‘input-archivo’)?.addEventListener(‘change’, async (e) => {
const file = e.target.files[0];
if(!file||file.type!==‘application/pdf’){ toast(‘Solo se aceptan archivos PDF’,‘er’); return; }
document.getElementById(‘up-filename’).textContent = file.name;
document.getElementById(‘alumno-cost-sub’).textContent = ‘Leyendo PDF…’;

const reader = new FileReader();
reader.onload = async function(){
try {
const arr = new Uint8Array(this.result);
pdfjsLib.GlobalWorkerOptions.workerSrc =
‘https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js’;
const pdf = await pdfjsLib.getDocument(arr).promise;
document.getElementById(‘alumno-pags’).textContent = pdf.numPages;
document.getElementById(‘pags-info’).style.display = ‘flex’;
actualizarCostoAlumno(pdf.numPages);
} catch(e){ toast(’Error al leer PDF: ’+e.message,‘er’); }
};
reader.readAsArrayBuffer(file);
});

function actualizarCostoAlumno(pags){
const n = pags || parseInt(document.getElementById(‘alumno-pags’).textContent)||0;
const c = (n * PRECIOS[tipoImpAlumno]).toFixed(2);
document.getElementById(‘alumno-total’).textContent = `$${c}`;
document.getElementById(‘alumno-cost-sub’).textContent =
n>0 ? `${n} página${n!==1?'s':''} × $${PRECIOS[tipoImpAlumno].toFixed(2)}` : ‘Seleccione un archivo’;
}

window.enviarArchivo = async () => {
const archivo = document.getElementById(‘input-archivo’).files[0];
const paginas = parseInt(document.getElementById(‘alumno-pags’).textContent)||0;
const usuario = localStorage.getItem(‘usuario_cbta’);
if(!archivo){ toast(‘Seleccione un archivo PDF’,‘er’); return; }
if(paginas===0){ toast(‘El archivo no tiene páginas detectadas’,‘er’); return; }

const btn = document.getElementById(‘btn-enviar’);
btn.disabled=true; btn.textContent=‘Enviando…’;

const ok = await enviarDocumentoNube({ usuario, archivo, paginas, tipoImpresion:tipoImpAlumno });
btn.disabled=false; btn.innerHTML=‘📤 Enviar al Profr. Cecilio’;

if(ok){ document.getElementById(‘ov-exito’).classList.add(‘on’); }
else   { toast(‘Error al enviar. Verifique conexión.’,‘er’); }
};

window.resetAlumno = () => {
document.getElementById(‘input-archivo’).value=’’;
document.getElementById(‘up-filename’).textContent=‘Ningún archivo seleccionado’;
document.getElementById(‘alumno-pags’).textContent=‘0’;
document.getElementById(‘pags-info’).style.display=‘none’;
document.getElementById(‘alumno-total’).textContent=’$0.00’;
document.getElementById(‘alumno-cost-sub’).textContent=‘Seleccione un archivo para calcular’;
};

// ═══════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════
window.exportar = () => {
const data={ventas:LS.get(‘ventas’),egresos:LS.get(‘egresos’),stockMovs:LS.get(‘stockMovs’),fecha:new Date().toISOString()};
const a=document.createElement(‘a’);
a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:‘application/json’}));
a.download=`cbta_backup_${new Date().toISOString().split('T')[0]}.json`;
a.click();
toast(‘✅ Datos exportados’,‘ok’);
};

// ═══════════════════════════════════════════════════════════════════
// MODALES
// ═══════════════════════════════════════════════════════════════════
window.closeModal = (id) => document.getElementById(id)?.classList.remove(‘on’);
document.querySelectorAll(’.ov’).forEach(o=>{
o.addEventListener(‘click’,e=>{
if(e.target===o){
if(o.id===‘ov-scan’) window.closeScanner();
else window.closeModal(o.id);
}
});
});

// ─── COMPATIBILIDAD: funciones que el ui-controller original expone ──
// Por si algún módulo externo las llama directamente
window.agregarAlCarritoImpresion = window.addImpToCart;

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
window.abrirImpresionManual = () => {
document.getElementById(‘ov-imp-manual’).classList.add(‘on’);
document.getElementById(‘im-paginas’).value=’’;
document.getElementById(‘im-usuario’).value=’’;
document.getElementById(‘im-tipo’).value=‘laser_bn’;
calcularManual();
};

window.calcularManual = () => {
const pags  = parseInt(document.getElementById(‘im-paginas’)?.value)||0;
const tipo  = document.getElementById(‘im-tipo’)?.value||‘laser_bn’;
const total = pags*(PRECIOS[tipo]||0.5);
const el    = document.getElementById(‘im-total’);
if(el) el.textContent=`$${total.toFixed(2)}`;
};

window.agregarImpresionManual = () => {
const pags    = parseInt(document.getElementById(‘im-paginas’).value)||0;
const tipo    = document.getElementById(‘im-tipo’).value;
const usuario = document.getElementById(‘im-usuario’).value.trim()||‘Presencial’;
if(pags<=0){ toast(‘Ingrese número de páginas’,‘er’); return; }
const precio  = pags*(PRECIOS[tipo]||0.5);
const label   = LABELS[tipo]||‘B&N’;
carrito.push({
id:‘manual-’+Date.now(),
nombre:`🖨️ Impresión ${pags} págs (${label})`,
precio, tipo:‘impresion’,
usuarioAlumno:usuario,
numPags:pags, labelServicio:label, esManual:true,
});
renderCart();
closeModal(‘ov-imp-manual’);
go(‘venta’);
toast(`✓ Impresión manual — $${precio.toFixed(2)}`,‘ok’);
};

document.addEventListener(‘DOMContentLoaded’, () => {
setDate();
setInterval(setDate, 60000);
verificarSesion();

// Búsqueda en tiempo real inventario
document.getElementById(‘p-buscar’)?.addEventListener(‘input’, renderProds);
document.getElementById(‘v-buscar’)?.addEventListener(‘input’, renderProdList);
});
