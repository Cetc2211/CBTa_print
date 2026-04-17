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
            db.escucharColaImpresion(renderCola);
            db.escucharInventarioDB(renderInv);
        } else {
            ui.toggleModal('panel-alumno', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
            ui.setupAccessQR(window.location.href);
        }
    }
    setupEvents();
});

function setupEvents() {
    document.getElementById('btn-entrar')?.addEventListener('click', () => {
        const n = document.getElementById('input-nombre').value;
        if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); }
    });
    document.getElementById('input-archivo')?.addEventListener('change', async (e) => {
        archivo = e.target.files[0];
        if (!archivo) return;
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
                for(let i=0; i<data.length; i+=4) if(Math.abs(data[i]-data[i+1])>15 || Math.abs(data[i]-data[i+2])>15) color++;
                saturacion = (color / (data.length / 4)) * 100;
                updateAlumnoPrecio();
            };
            reader.readAsArrayBuffer(archivo);
        } else {
            document.getElementById('alumno-pags').value = 1;
            saturacion = 20; updateAlumnoPrecio();
        }
    });
    document.getElementById('alumno-imp')?.addEventListener('change', updateAlumnoPrecio);
    document.getElementById('btn-enviar-archivo')?.addEventListener('click', async () => {
        const res = await db.enviarDocumentoNube({ usuario: user, archivo, paginas: parseInt(document.getElementById('alumno-pags').value), cobertura: saturacion });
        if(res) ui.toggleModal('modal-exito', 'show');
    });
    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    document.getElementById('btn-abrir-scanner')?.addEventListener('click', () => ui.startScanner(async (text) => {
        const p = await db.obtenerProductoPorID(text);
        if(p) { window.agregarProdAlCarrito(text, p.nombre, p.venta); ui.stopScanner(); }
    }));
    document.getElementById('btn-cerrar-scanner')?.addEventListener('click', ui.stopScanner);
    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        await db.procesarCobroVenta(carrito);
        carrito = []; renderCarrito(); alert("Cobro exitoso");
    });
    document.getElementById('form-db')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await db.guardarNuevoProducto({ nombre: document.getElementById('db-nombre').value, stock: parseInt(document.getElementById('db-stock').value), costo: parseFloat(document.getElementById('db-costo').value), venta: parseFloat(document.getElementById('db-venta').value) });
        e.target.reset();
    });
}

function updateAlumnoPrecio() {
    const pags = parseInt(document.getElementById('alumno-pags').value) || 1;
    const imp = document.getElementById('alumno-imp').value;
    const pU = (imp === 'laser_bn') ? 0.50 : (saturacion > 15 ? 3.50 : 1.50);
    document.getElementById('alumno-total').innerText = `$${(pags * pU).toFixed(2)}`;
    document.getElementById('info-status').innerText = `Sat: ${saturacion.toFixed(1)}%`;
}

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones');
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); const id = docSnap.id;
        const sugerencia = d.cobertura > 15 ? "3.50" : (d.cobertura > 0.5 ? "1.50" : "0.50");
        cont.innerHTML += `<div class="p-3 bg-white border rounded-xl mb-2 shadow-sm"><div class="flex justify-between items-center mb-1"><b class="text-[11px] uppercase">${d.usuario}</b><span class="text-[9px] font-bold text-indigo-600">${d.cobertura.toFixed(1)}% Sat.</span></div><div class="flex gap-1"><select id="sel-${id}" class="text-[10px] bg-slate-100 border p-1 rounded font-bold flex-1"><option value="0.50" ${sugerencia=="0.50"?'selected':''}>B/N ($0.50)</option><option value="1.50" ${sugerencia=="1.50"?'selected':''}>Col. Poco ($1.50)</option><option value="3.50" ${sugerencia=="3.50"?'selected':''}>Col. Mucho ($3.50)</option></select><button onclick="window.agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[10px] font-black">+ COBRAR</button><a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[10px] font-bold">VER</a></div></div>`;
    });
}

function renderInv(snap) {
    const cont = document.getElementById('lista-stock-rapido');
    const prods = [];
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data(); p.id = docSnap.id; prods.push(p);
        cont.innerHTML += `<div class="p-2 bg-slate-50 rounded-xl mb-1 flex justify-between items-center border"><span class="text-[10px] font-bold uppercase">${p.nombre} (${p.stock})</span><button onclick="window.agregarProdAlCarrito('${p.id}', '${p.nombre}', ${p.venta})" class="bg-slate-900 text-white px-3 py-1 rounded-lg">+</button></div>`;
    });
    ui.renderDBTable(prods, (id) => db.eliminarRegistro('inventario', id));
}

function renderCarrito() {
    const cont = document.getElementById('items-carrito');
    let total = 0; cont.innerHTML = "";
    carrito.forEach((item, index) => {
        total += item.precio;
        cont.innerHTML += `<div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 text-[11px] border"><span>${item.nombre}</span><span>$${item.precio.toFixed(2)} <button onclick="window.quitarDelCarrito(${index})" class="text-red-500 font-bold">×</button></span></div>`;
    });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}

window.quitarDelCarrito = (i) => { carrito.splice(i,1); renderCarrito(); };
window.agregarImpAlCarrito = (id, u, p) => { const pr = parseFloat(document.getElementById(`sel-${id}`).value); carrito.push({id, nombre: `Imp: ${u}`, precio: pr*p, tipo: 'impresion'}); renderCarrito(); };
window.agregarProdAlCarrito = (id, n, p) => { carrito.push({id, nombre: n, precio: p, tipo: 'producto'}); renderCarrito(); };
