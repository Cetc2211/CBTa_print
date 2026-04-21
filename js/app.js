import * as db from './database.js';
import * as ui from './ui-controller.js';

let carrito = [];
let saturacion = 0;
let archivo = null;
const user = localStorage.getItem('nombre_usuario') || "";

document.addEventListener('DOMContentLoaded', () => {
    if (!user) {
        ui.toggleModal('modal-registro', 'show');
    } else {
        const isAdmin = user.toLowerCase().includes("cecilio") || user.toLowerCase().includes("danika landeros");
        if(document.getElementById('saludo')) document.getElementById('saludo').innerText = `Hola, ${user}`;
        if (isAdmin) {
            ui.toggleModal('panel-admin', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
            db.escucharColaImpresion(renderCola);
            db.escucharInventarioDB((snap) => { renderInv(snap); renderFinanzas(snap); });
            db.escucharIngresosServicios(renderBitacoraImpresiones);
        } else {
            ui.toggleModal('panel-alumno', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
        }
        ui.setupAccessQR(window.location.href);
    }
    setupEvents();
});

function calcularPrecioUnitario(tipo, sat) {
    if (tipo === 'laser_bn') return 0.50;
    if (sat <= 30) return 1.00;
    if (sat <= 50) return 1.50;
    if (sat <= 65) return 2.00;
    if (sat <= 85) return 2.50;
    return 3.00;
}

function renderBitacoraImpresiones(snap) {
    const tbody = document.getElementById('tabla-impresiones-historial-body');
    if(!tbody) return;
    tbody.innerHTML = "";
    let totalServicios = 0;
    snap.forEach(docSnap => {
        const d = docSnap.data();
        totalServicios += d.monto || 0;
        const f = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-MX', {hour:'2-digit', minute:'2-digit'}) : '...';
        tbody.innerHTML += `<tr class="border-b hover:bg-indigo-50 transition-colors"><td class="p-3 text-slate-500">${f}</td><td class="p-3 font-bold uppercase">${d.usuario}</td><td class="p-3 text-center"><span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-[8px] font-black uppercase">${d.servicio}</span></td><td class="p-3 text-center font-bold">${d.paginas}</td><td class="p-3 text-right font-black text-green-600">$${d.monto.toFixed(2)}</td></tr>`;
    });
    window.totalIngresosServicios = totalServicios;
}

function renderFinanzas(snap) {
    const tbody = document.getElementById('tabla-finanzas-body');
    if(!tbody) return;
    let totalInv = 0, totalIngProds = 0, totalGan = 0;
    tbody.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data();
        const inv = p.gastoAcumulado || ((p.stock || 0) * (p.costo || 0));
        const ing = p.totalDia || 0;
        const gan = ing - inv;
        totalInv += inv; totalIngProds += ing;
        if(gan > 0) totalGan += gan;
        tbody.innerHTML += `<tr class="border-b bg-white text-left text-slate-800"><td class="p-4 uppercase font-bold">${p.nombre}</td><td class="p-4 text-center">$${inv.toFixed(2)}</td><td class="p-4 text-center font-bold">${p.ventasHistoricas || 0}</td><td class="p-4 text-center text-green-600 font-bold">$${ing.toFixed(2)}</td><td class="p-4 text-center"><span class="px-2 py-1 rounded-full text-[8px] font-black ${ing >= inv ? 'bg-green-500 text-white':'bg-amber-100 text-amber-600'}">${ing >= inv ? 'OK':'...'}</span></td><td class="p-4 text-right font-black ${gan > 0 ? 'text-indigo-600':'text-slate-300'}">$${gan.toFixed(2)}</td></tr>`;
    });
    const ingGlobal = totalIngProds + (window.totalIngresosServicios || 0);
    document.getElementById('fin-inversion-total').innerText = `$${totalInv.toFixed(2)}`;
    document.getElementById('fin-ingresos-totales').innerText = `$${ingGlobal.toFixed(2)}`;
    document.getElementById('fin-utilidad-total').innerText = `$${(totalGan + (window.totalIngresosServicios || 0)).toFixed(2)}`;
}

function setupEvents() {
    document.getElementById('btn-entrar')?.addEventListener('click', () => { const n = document.getElementById('input-nombre').value.trim(); if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); } });
    document.getElementById('form-db')?.addEventListener('submit', async (e) => { e.preventDefault(); const id = document.getElementById('db-id').value; const p = { nombre: document.getElementById('db-nombre').value.toUpperCase(), stock: parseInt(document.getElementById('db-stock').value), costo: parseFloat(document.getElementById('db-costo').value), venta: parseFloat(document.getElementById('db-venta').value) }; if (id) { if(await db.actualizarProducto(id, p)) { alert("ACTUALIZADO"); limpiarFormDB(); } } else { if(await db.guardarNuevoProducto(p)) { alert("GUARDADO"); e.target.reset(); } } });
    document.getElementById('btn-finalizar')?.addEventListener('click', async () => { if(carrito.length === 0) return; await db.procesarCobroVenta(carrito); carrito = []; renderCarrito(); alert("Cobro finalizado con éxito."); });

    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    document.getElementById('btn-abrir-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'show'));
    document.getElementById('btn-cerrar-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'hide'));
    document.getElementById('btn-cerrar-etiqueta')?.addEventListener('click', () => ui.toggleModal('modal-etiqueta', 'hide'));

    document.getElementById('btn-abrir-scanner')?.addEventListener('click', () => {
        ui.startScanner(async (text) => {
            const p = await db.obtenerProductoPorID(text);
            if(p) { ui.stopScanner(); const op = confirm(`PROD: ${p.nombre}\n\n¿VENDER (Aceptar) o SURTIR (Cancelar)?`); if(op) window.agregarProdAlCarrito(text, p.nombre, p.venta); else { const cant = prompt(`¿Piezas que entran?`, "1"); if(cant) await db.sumarStockProducto(text, parseInt(cant), p.costo); } }
        });
    });

    document.getElementById('input-archivo')?.addEventListener('change', async (e) => {
        archivo = e.target.files[0]; if (!archivo) return;
        document.getElementById('info-status').innerText = "Analizando...";
        if (archivo.type === 'application/pdf') {
            const reader = new FileReader(); reader.onload = async function() { const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise; document.getElementById('alumno-pags').value = pdf.numPages; const page = await pdf.getPage(1); const canvas = document.createElement('canvas'); const viewport = page.getViewport({ scale: 0.2 }); canvas.height = viewport.height; canvas.width = viewport.width; await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; let color = 0; for(let i=0; i<data.length; i+=4) if(Math.abs(data[i]-data[i+1])>15 || Math.abs(data[i]-data[i+2])>15) color++; saturacion = (color / (data.length / 4)) * 100; updateAlumnoPrecio(); }; reader.readAsArrayBuffer(archivo);
        } else { document.getElementById('alumno-pags').value = 1; saturacion = 25; updateAlumnoPrecio(); }
    });

    document.getElementById('btn-enviar-archivo')?.addEventListener('click', async () => {
        const res = await db.enviarDocumentoNube({ usuario: user, archivo, paginas: parseInt(document.getElementById('alumno-pags').value) || 1, cobertura: saturacion, tipoImpresion: document.getElementById('alumno-imp').value });
        if(res) ui.toggleModal('modal-exito', 'show');
    });
}

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones'); if(!cont) return; cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); const id = docSnap.id;
        let pU = (d.tipoImpresion === 'laser_bn') ? 0.50 : calcularPrecioUnitario('color', d.cobertura || 0);
        cont.innerHTML += `<div class="p-3 bg-white border rounded-xl mb-2 shadow-sm border-l-4 ${d.tipoImpresion === 'laser_bn' ? 'border-slate-400':'border-indigo-500'}">
            <div class="flex justify-between items-center mb-1"><b class="text-[10px] uppercase">${d.usuario}</b><button onclick="window.cancelarArchivo('${id}')" class="text-red-500 font-bold px-2">✕</button></div>
            <p class="text-[9px] text-slate-400 truncate mb-2">${d.archivo || 'Archivo'}</p>
            <div class="flex gap-1">
                <select id="sel-${id}" class="text-[10px] bg-slate-50 border p-1 rounded font-bold flex-1"><option value="0.50" ${pU==0.50?'selected':''}>B/N ($0.50)</option><option value="1.00" ${pU==1.00?'selected':''}>Col 30% ($1.00)</option><option value="1.50" ${pU==1.50?'selected':''}>Col 50% ($1.50)</option><option value="2.00" ${pU==2.00?'selected':''}>Col 65% ($2.00)</option><option value="2.50" ${pU==2.50?'selected':''}>Col 85% ($2.50)</option><option value="3.00" ${pU==3.00?'selected':''}>Col 100% ($3.00)</option></select>
                <button onclick="window.agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[9px] font-black">+ COBRAR</button>
                <a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[9px] font-bold text-center flex items-center">VER</a>
            </div></div>`;
    });
}

function renderInv(snap) {
    const cont = document.getElementById('lista-stock-rapido'); if(!cont) return; cont.innerHTML = ""; const prods = [];
    snap.forEach(docSnap => {
        const p = docSnap.data(); p.id = docSnap.id; prods.push(p);
        cont.innerHTML += `<div class="p-2 bg-slate-50 rounded-xl mb-1 flex justify-between items-center border"><span class="text-[10px] font-bold uppercase">${p.nombre} (${p.stock || 0})</span><div class="flex gap-1"><button onclick="window.verEtiqueta('${p.id}', '${p.nombre}', ${p.venta || 0})" class="text-indigo-500 text-[10px] font-bold px-2 uppercase">QR</button><button onclick="window.agregarProdAlCarrito('${p.id}', '${p.nombre}', ${p.venta || 0})" class="bg-slate-900 text-white px-3 py-1 rounded-lg">+</button></div></div>`;
    });
    ui.renderDBTable(prods, (id) => db.eliminarRegistro('inventario', id), window.prepararEdicion);
}

// FUNCIONES GLOBALES
window.cerrarSesion = () => { if(confirm("¿Cerrar sesión?")) { localStorage.removeItem('nombre_usuario'); location.reload(); } };
window.cancelarArchivo = async (id) => { if(confirm("¿Borrar archivo de la lista?")) await db.eliminarRegistro('cola_impresion', id); };
window.agregarProdAlCarrito = (id, n, p) => { carrito.push({id, nombre: n, precio: p, tipo: 'producto'}); renderCarrito(); };
window.agregarImpAlCarrito = (id, u, p) => { 
    const sel = document.getElementById(`sel-${id}`); const pr = sel ? parseFloat(sel.value) : 0.50; const label = sel ? sel.options[sel.selectedIndex].text : "Imp";
    carrito.push({id, nombre: `Imp: ${u}`, usuarioAlumno: u, numPags: p, labelServicio: label, precio: pr*p, tipo: 'impresion'}); renderCarrito(); 
};
window.quitarDelCarrito = (i) => { carrito.splice(i,1); renderCarrito(); };
window.prepararEdicion = async (id) => {
    const p = await db.obtenerProductoPorID(id); if (p) { document.getElementById('db-id').value = id; document.getElementById('db-nombre').value = p.nombre; document.getElementById('db-stock').value = p.stock; document.getElementById('db-costo').value = p.costo; document.getElementById('db-venta').value = p.venta; const btn = document.getElementById('btn-guardar-prod'); btn.innerText = "Actualizar"; btn.classList.add('bg-amber-500'); document.getElementById('btn-cancelar-edicion').classList.remove('hidden'); }
};
window.verEtiqueta = (id, nombre, precio) => { document.getElementById('etiqueta-nombre').innerText = nombre; document.getElementById('etiqueta-precio').innerText = `$${precio.toFixed(2)}`; const qrCont = document.getElementById('etiqueta-qr'); if(qrCont) { qrCont.innerHTML = ""; new QRCode(qrCont, { text: id, width: 150, height: 150 }); } ui.toggleModal('modal-etiqueta', 'show'); };

function renderCarrito() {
    const cont = document.getElementById('items-carrito'); if(!cont) return; let total = 0; cont.innerHTML = "";
    carrito.forEach((item, index) => { total += item.precio; cont.innerHTML += `<div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 border text-[10px]"><span>${item.nombre}</span><span>$${item.precio.toFixed(2)} <button onclick="window.quitarDelCarrito(${index})" class="text-red-500 font-bold">✕</button></span></div>`; });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}
function updateAlumnoPrecio() { const pags = parseInt(document.getElementById('alumno-pags').value) || 1; const pU = calcularPrecioUnitario(document.getElementById('alumno-imp').value, saturacion); document.getElementById('alumno-total').innerText = `$${(pags * pU).toFixed(2)}`; document.getElementById('info-status').innerText = `Sat: ${saturacion.toFixed(1)}%`; }
function limpiarFormDB() { document.getElementById('db-id').value = ""; document.getElementById('form-db').reset(); const btn = document.getElementById('btn-guardar-prod'); btn.innerText = "Añadir Producto"; btn.classList.remove('bg-amber-500'); document.getElementById('btn-cancelar-edicion').classList.add('hidden'); }
