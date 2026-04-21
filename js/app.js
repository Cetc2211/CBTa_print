import * as db from './database.js';
import * as ui from './ui-controller.js';

let carrito = [];
let saturacion = 0;
let archivo = null;
const user = localStorage.getItem('nombre_usuario') || "";

document.addEventListener('DOMContentLoaded', () => {
    if (!user) ui.toggleModal('modal-registro', 'show');
    else {
        const isAdmin = user.toLowerCase().includes("cecilio") || user.toLowerCase().includes("danika landeros");
        if(document.getElementById('saludo')) document.getElementById('saludo').innerText = `Hola, ${user}`;
        if (isAdmin) {
            ui.toggleModal('panel-admin', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
            db.escucharColaImpresion(renderCola);
            db.escucharInventarioDB((snap) => { renderInv(snap); renderFinanzas(snap); });
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

function setupEvents() {
    document.getElementById('btn-entrar')?.addEventListener('click', () => {
        const n = document.getElementById('input-nombre').value.trim();
        if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); }
    });

    // BOTÓN ENVIAR ALUMNO
    const btnEnviar = document.getElementById('btn-enviar-archivo');
    if (btnEnviar) {
        btnEnviar.addEventListener('click', async () => {
            if (!archivo) { alert("⚠️ Selecciona un archivo."); return; }
            btnEnviar.disabled = true; btnEnviar.innerText = "⏳ SUBIENDO...";
            const tipo = document.getElementById('alumno-imp').value;
            const res = await db.enviarDocumentoNube({ 
                usuario: user, archivo, paginas: parseInt(document.getElementById('alumno-pags').value) || 1, 
                cobertura: saturacion, tipoImpresion: tipo 
            });
            if(res) ui.toggleModal('modal-exito', 'show');
            else { alert("Error al subir"); btnEnviar.disabled = false; btnEnviar.innerText = "Enviar al Profr. Cecilio"; }
        });
    }

    // EVENTOS ADMIN
    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        if(carrito.length === 0) return;
        await db.procesarCobroVenta(carrito);
        carrito = []; renderCarrito(); alert("Cobro finalizado e historico guardado.");
    });
}

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones');
    if(!cont) return;
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); const id = docSnap.id;
        let pU = (d.tipoImpresion === 'laser_bn') ? 0.50 : calcularPrecioUnitario('color', d.cobertura);
        cont.innerHTML += `<div class="p-3 bg-white border rounded-xl mb-2 shadow-sm border-l-4 ${d.tipoImpresion === 'laser_bn' ? 'border-slate-400':'border-indigo-500'}">
            <div class="flex justify-between items-center mb-1">
                <b class="text-[10px] uppercase">${d.usuario}</b>
                <button onclick="window.cancelarArchivo('${id}')" class="text-red-500 font-bold px-2">✕</button>
            </div>
            <p class="text-[9px] text-slate-400 truncate mb-2">${d.archivo}</p>
            <div class="flex gap-1">
                <select id="sel-${id}" class="text-[10px] bg-slate-50 border p-1 rounded font-bold flex-1">
                    <option value="0.50" ${pU==0.50?'selected':''}>B/N ($0.50)</option>
                    <option value="1.00" ${pU==1.00?'selected':''}>Col 30% ($1.00)</option>
                    <option value="1.50" ${pU==1.50?'selected':''}>Col 50% ($1.50)</option>
                    <option value="2.00" ${pU==2.00?'selected':''}>Col 65% ($2.00)</option>
                    <option value="2.50" ${pU==2.50?'selected':''}>Col 85% ($2.50)</option>
                    <option value="3.00" ${pU==3.00?'selected':''}>Col 100% ($3.00)</option>
                </select>
                <button onclick="window.agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[9px] font-black">+ COBRAR</button>
                <a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[9px] font-bold text-center flex items-center">VER</a>
            </div></div>`;
    });
}

// FUNCIONES GLOBALES
window.cerrarSesion = () => { if(confirm("¿Cerrar sesión?")) { localStorage.removeItem('nombre_usuario'); location.reload(); }};
window.cancelarArchivo = async (id) => { if(confirm("¿Borrar este archivo por error?")) await db.eliminarRegistro('cola_impresion', id); };
window.agregarProdAlCarrito = (id, n, p) => { carrito.push({id, nombre: n, precio: p, tipo: 'producto'}); renderCarrito(); };
window.agregarImpAlCarrito = (id, u, p) => { 
    const sel = document.getElementById(`sel-${id}`);
    const pr = sel ? parseFloat(sel.value) : 0.50;
    carrito.push({id, nombre: `Imp: ${u}`, precio: pr*p, tipo: 'impresion'}); 
    renderCarrito(); 
};
window.quitarDelCarrito = (i) => { carrito.splice(i,1); renderCarrito(); };

function renderCarrito() {
    const cont = document.getElementById('items-carrito');
    if(!cont) return;
    let total = 0; cont.innerHTML = "";
    carrito.forEach((item, index) => {
        total += item.precio;
        cont.innerHTML += `<div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 border text-[10px]"><span>${item.nombre}</span><span>$${item.precio.toFixed(2)} <button onclick="window.quitarDelCarrito(${index})" class="text-red-500">×</button></span></div>`;
    });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}
// ... resto de funciones de renderInv y renderFinanzas se mantienen igual ...
