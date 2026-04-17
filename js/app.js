// js/app.js - Actualizado con escala de precios por saturación de color

import * as db from './database.js';
import * as ui from './ui-controller.js';

let carrito = [];
let saturacion = 0;
let archivo = null;
const user = localStorage.getItem('nombre_usuario') || "";

document.addEventListener('DOMContentLoaded', () => {
    if (!user) ui.toggleModal('modal-registro', 'show');
    else {
        document.getElementById('saludo').innerText = `Hola, ${user}`;
        const isAdmin = user.toLowerCase().includes("cecilio") || user.toLowerCase().includes("danika landeros");
        
        if (isAdmin) {
            ui.toggleModal('panel-admin', 'show');
            ui.toggleModal('btn-flotante-qr', 'show'); 
            db.escucharColaImpresion(renderCola);
            db.escucharInventarioDB(renderInv);
        } else {
            ui.toggleModal('panel-alumno', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
        }
        ui.setupAccessQR(window.location.href);
    }
    setupEvents();
});

// NUEVA FUNCIÓN: Lógica de precios por saturación
function calcularPrecioUnitario(tipo, sat) {
    if (tipo === 'laser_bn') return 0.50;
    
    // Escala solicitada para color
    if (sat <= 30) return 1.00;
    if (sat <= 50) return 1.50;
    if (sat <= 65) return 2.00;
    if (sat <= 85) return 2.50;
    return 3.00; // 86% a 100%
}

function setupEvents() {
    document.getElementById('btn-entrar')?.addEventListener('click', () => {
        const n = document.getElementById('input-nombre').value;
        if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); }
    });

    document.getElementById('btn-flotante-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'show'));
    document.getElementById('btn-cerrar-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'hide'));

    document.getElementById('input-archivo')?.addEventListener('change', async (e) => {
        archivo = e.target.files[0];
        if (!archivo) return;
        document.getElementById('info-status').innerText = "Analizando cobertura...";
        
        if (archivo.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = async function() {
                const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
                document.getElementById('alumno-pags').value = pdf.numPages;
                
                const page = await pdf.getPage(1);
                const canvas = document.createElement('canvas');
                const viewport = page.getViewport({ scale: 0.2 });
                canvas.height = viewport.height; canvas.width = viewport.width;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
                let color = 0;
                for(let i=0; i<data.length; i+=4) {
                    if(Math.abs(data[i]-data[i+1])>15 || Math.abs(data[i]-data[i+2])>15) color++;
                }
                saturacion = (color / (data.length / 4)) * 100;
                updateAlumnoPrecio();
            };
            reader.readAsArrayBuffer(archivo);
        } else {
            document.getElementById('alumno-pags').value = 1;
            saturacion = 25; // Imagen predeterminada 25%
            updateAlumnoPrecio();
        }
    });

    document.getElementById('alumno-imp')?.addEventListener('change', updateAlumnoPrecio);

    document.getElementById('btn-enviar-archivo')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-enviar-archivo');
        btn.disabled = true; btn.innerText = "Subiendo...";
        const res = await db.enviarDocumentoNube({ 
            usuario: user, 
            archivo, 
            paginas: parseInt(document.getElementById('alumno-pags').value), 
            cobertura: saturacion 
        });
        if(res) ui.toggleModal('modal-exito', 'show');
        btn.disabled = false; btn.innerText = "ENVIAR AL PROFESOR";
    });

    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    
    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        if (carrito.length === 0) return;
        await db.procesarCobroVenta(carrito);
        carrito = []; renderCarrito(); alert("Venta finalizada con éxito");
    });
}

function updateAlumnoPrecio() {
    const pags = parseInt(document.getElementById('alumno-pags').value) || 1;
    const tipo = document.getElementById('alumno-imp').value;
    const pU = calcularPrecioUnitario(tipo, saturacion);
    
    document.getElementById('alumno-total').innerText = `$${(pags * pU).toFixed(2)}`;
    document.getElementById('info-status').innerText = `Cobertura Color: ${saturacion.toFixed(1)}%`;
}

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones');
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); const id = docSnap.id;
        const pU = calcularPrecioUnitario('color', d.cobertura);
        
        cont.innerHTML += `
            <div class="p-3 bg-white border rounded-xl mb-2 shadow-sm">
                <div class="flex justify-between items-center mb-1">
                    <b class="text-[11px] uppercase">${d.usuario}</b>
                    <span class="text-[9px] font-bold text-indigo-600">${d.cobertura.toFixed(1)}% Color</span>
                </div>
                <div class="flex gap-1">
                    <select id="sel-${id}" class="text-[10px] bg-slate-100 border p-1 rounded font-bold flex-1">
                        <option value="0.50">Láser B/N ($0.50)</option>
                        <option value="1.00" ${pU==1.00?'selected':''}>Color 30% ($1.00)</option>
                        <option value="1.50" ${pU==1.50?'selected':''}>Color 50% ($1.50)</option>
                        <option value="2.00" ${pU==2.00?'selected':''}>Color 65% ($2.00)</option>
                        <option value="2.50" ${pU==2.50?'selected':''}>Color 85% ($2.50)</option>
                        <option value="3.00" ${pU==3.00?'selected':''}>Color Full ($3.00)</option>
                    </select>
                    <button onclick="window.agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[10px] font-black">+ COBRAR</button>
                    <a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[10px] font-bold">VER</a>
                </div>
            </div>`;
    });
}

function renderInv(snap) {
    const cont = document.getElementById('lista-stock-rapido');
    const prods = [];
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data(); p.id = docSnap.id; prods.push(p);
        cont.innerHTML += `
            <div class="p-2 bg-slate-50 rounded-xl mb-1 flex justify-between items-center border">
                <span class="text-[10px] font-bold uppercase">${p.nombre} (${p.stock})</span>
                <button onclick="window.agregarProdAlCarrito('${p.id}', '${p.nombre}', ${p.venta})" class="bg-slate-900 text-white px-3 py-1 rounded-lg">+</button>
            </div>`;
    });
    ui.renderDBTable(prods, (id) => db.eliminarRegistro('inventario', id));
}

function renderCarrito() {
    const cont = document.getElementById('items-carrito');
    let total = 0; cont.innerHTML = "";
    carrito.forEach((item, index) => {
        total += item.precio;
        cont.innerHTML += `
            <div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 text-[11px] border">
                <span>${item.nombre}</span>
                <span>$${item.precio.toFixed(2)} <button onclick="window.quitarDelCarrito(${index})" class="text-red-500 font-bold">×</button></span>
            </div>`;
    });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}

window.quitarDelCarrito = (i) => { carrito.splice(i,1); renderCarrito(); };
window.agregarImpAlCarrito = (id, u, p) => { 
    const pr = parseFloat(document.getElementById(`sel-${id}`).value); 
    carrito.push({id, nombre: `Imp: ${u} (${p} pág)`, precio: pr*p, tipo: 'impresion'}); 
    renderCarrito(); 
};
window.agregarProdAlCarrito = (id, n, p) => { carrito.push({id, nombre: n, precio: p, tipo: 'producto'}); renderCarrito(); };
