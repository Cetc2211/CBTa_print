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
            db.escucharInventarioDB((snap) => {
                renderInv(snap);
                renderFinanzas(snap);
            });
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

    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    document.getElementById('btn-abrir-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'show'));
    document.getElementById('btn-cerrar-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'hide'));
    document.getElementById('btn-cerrar-etiqueta')?.addEventListener('click', () => ui.toggleModal('modal-etiqueta', 'hide'));
    document.getElementById('btn-flotante-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'show'));
    document.getElementById('btn-cerrar-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'hide'));

    document.getElementById('form-db')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const p = { 
            nombre: document.getElementById('db-nombre').value.toUpperCase(), 
            stock: parseInt(document.getElementById('db-stock').value), 
            costo: parseFloat(document.getElementById('db-costo').value), 
            venta: parseFloat(document.getElementById('db-venta').value) 
        };
        if(await db.guardarNuevoProducto(p)) { alert("✅ GUARDADO"); e.target.reset(); }
    });

    document.getElementById('btn-abrir-scanner')?.addEventListener('click', () => {
        ui.startScanner(async (text) => {
            const p = await db.obtenerProductoPorID(text);
            if(p) {
                ui.stopScanner();
                const op = confirm(`PRODUCTO: ${p.nombre}\n\n¿VENDER (Aceptar) o SURTIR STOCK (Cancelar)?`);
                if(op) window.agregarProdAlCarrito(text, p.nombre, p.venta);
                else {
                    const cant = prompt(`Surtir ${p.nombre}. ¿Cantidad?`, "1");
                    if(cant) await db.sumarStockProducto(text, parseInt(cant), p.costo);
                }
            }
        });
    });

    document.getElementById('btn-cerrar-scanner')?.addEventListener('click', ui.stopScanner);

    document.getElementById('input-archivo')?.addEventListener('change', async (e) => {
        archivo = e.target.files[0];
        if (!archivo) return;
        document.getElementById('info-status').innerText = "Analizando...";
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
            saturacion = 25; updateAlumnoPrecio();
        }
    });

    document.getElementById('btn-enviar-archivo')?.addEventListener('click', async () => {
        const res = await db.enviarDocumentoNube({ usuario: user, archivo, paginas: parseInt(document.getElementById('alumno-pags').value), cobertura: saturacion });
        if(res) ui.toggleModal('modal-exito', 'show');
    });

    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        if(carrito.length === 0) return;
        await db.procesarCobroVenta(carrito);
        carrito = []; renderCarrito(); alert("Venta finalizada");
    });
}

function updateAlumnoPrecio() {
    const pags = parseInt(document.getElementById('alumno-pags').value) || 1;
    const pU = calcularPrecioUnitario(document.getElementById('alumno-imp').value, saturacion);
    document.getElementById('alumno-total').innerText = `$${(pags * pU).toFixed(2)}`;
    document.getElementById('info-status').innerText = `Sat: ${saturacion.toFixed(1)}%`;
}

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones');
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); const id = docSnap.id;
        const pU = calcularPrecioUnitario('color', d.cobertura);
        cont.innerHTML += `<div class="p-3 bg-white border rounded-xl mb-2 shadow-sm">
            <div class="flex justify-between items-center mb-1"><b class="text-[11px] uppercase">${d.usuario}</b><span class="text-[9px] font-bold text-indigo-600">${d.cobertura.toFixed(1)}% Sat.</span></div>
            <div class="flex gap-1">
                <select id="sel-${id}" class="text-[10px] bg-slate-100 border p-1 rounded font-bold flex-1">
                    <option value="0.50">B/N ($0.50)</option>
                    <option value="1.00" ${pU==1.00?'selected':''}>Col. 30% ($1.00)</option>
                    <option value="1.50" ${pU==1.50?'selected':''}>Col. 50% ($1.50)</option>
                    <option value="2.00" ${pU==2.00?'selected':''}>Col. 65% ($2.00)</option>
                    <option value="2.50" ${pU==2.50?'selected':''}>Col. 85% ($2.50)</option>
                    <option value="3.00" ${pU==3.00?'selected':''}>Col. 100% ($3.00)</option>
                </select>
                <button onclick="window.agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[10px] font-black">+ COBRAR</button>
                <a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[10px] font-bold">VER</a>
            </div></div>`;
    });
}

function renderInv(snap) {
    const cont = document.getElementById('lista-stock-rapido');
    const prods = [];
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data(); p.id = docSnap.id; prods.push(p);
        cont.innerHTML += `<div class="p-2 bg-slate-50 rounded-xl mb-1 flex justify-between items-center border">
            <span class="text-[10px] font-bold uppercase">${p.nombre} (${p.stock})</span>
            <div class="flex gap-1">
                <button onclick="window.verEtiqueta('${p.id}', '${p.nombre}', ${p.venta})" class="text-indigo-500 text-[10px] font-bold uppercase">Etiqueta</button>
                <button onclick="window.agregarProdAlCarrito('${p.id}', '${p.nombre}', ${p.venta})" class="bg-slate-900 text-white px-3 py-1 rounded-lg">+</button>
            </div></div>`;
    });
    ui.renderDBTable(prods, (id) => db.eliminarRegistro('inventario', id));
}

function renderFinanzas(snap) {
    const tbody = document.getElementById('tabla-finanzas-body');
    let totalInv = 0, totalIng = 0, totalGan = 0;
    tbody.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data();
        const inversion = p.gastoAcumulado || (p.stock * p.costo);
        const ingresos = p.totalDia || 0;
        const ganancia = ingresos - inversion;
        const meta = ingresos >= inversion;
        
        totalInv += inversion; totalIng += ingresos;
        if(ganancia > 0) totalGan += ganancia;

        tbody.innerHTML += `<tr class="border-b bg-white hover:bg-slate-50 transition-colors">
            <td class="p-4 font-black uppercase">${p.nombre}</td>
            <td class="p-4 text-center font-bold text-blue-600">$${inversion.toFixed(2)}</td>
            <td class="p-4 text-center font-bold">${p.ventasHistoricas || 0} pzas</td>
            <td class="p-4 text-center font-bold text-green-600">$${ingresos.toFixed(2)}</td>
            <td class="p-4 text-center">
                <span class="px-3 py-1 rounded-full text-[8px] font-black uppercase ${meta ? 'bg-green-500 text-white' : 'bg-amber-100 text-amber-600'}">
                    ${meta ? 'RECUPERADO' : 'PENDIENTE'}
                </span>
            </td>
            <td class="p-4 text-right font-black ${ganancia > 0 ? 'text-indigo-600' : 'text-slate-300'}">$${ganancia.toFixed(2)}</td>
        </tr>`;
    });
    document.getElementById('fin-inversion-total').innerText = `$${totalInv.toFixed(2)}`;
    document.getElementById('fin-ingresos-totales').innerText = `$${totalIng.toFixed(2)}`;
    document.getElementById('fin-utilidad-total').innerText = `$${totalGan.toFixed(2)}`;
}

function renderCarrito() {
    const cont = document.getElementById('items-carrito');
    let total = 0; cont.innerHTML = "";
    carrito.forEach((item, index) => {
        total += item.precio;
        cont.innerHTML += `<div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 border"><span>${item.nombre}</span><span>$${item.precio.toFixed(2)} <button onclick="window.quitarDelCarrito(${index})" class="text-red-500 font-bold">×</button></span></div>`;
    });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}

window.verEtiqueta = (id, nombre, precio) => {
    document.getElementById('etiqueta-nombre').innerText = nombre;
    document.getElementById('etiqueta-precio').innerText = `$${precio.toFixed(2)}`;
    const qrCont = document.getElementById('etiqueta-qr');
    qrCont.innerHTML = ""; new QRCode(qrCont, { text: id, width: 150, height: 150 });
    ui.toggleModal('modal-etiqueta', 'show');
};
window.quitarDelCarrito = (i) => { carrito.splice(i,1); renderCarrito(); };
window.agregarImpAlCarrito = (id, u, p) => { const pr = parseFloat(document.getElementById(`sel-${id}`).value); carrito.push({id, nombre: `Imp: ${u}`, precio: pr*p, tipo: 'impresion'}); renderCarrito(); };
window.agregarProdAlCarrito = (id, n, p) => { carrito.push({id, nombre: n, precio: p, tipo: 'producto'}); renderCarrito(); };
