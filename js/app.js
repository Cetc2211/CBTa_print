import * as db from './database.js';
import * as ui from './ui-controller.js';

let carrito = [];
let saturacion = 0;
let archivo = null;
const user = localStorage.getItem('nombre_usuario') || "";

document.addEventListener('DOMContentLoaded', () => {
    // Inicialización de la App
    if (!user) {
        ui.toggleModal('modal-registro', 'show');
    } else {
        const saludoEl = document.getElementById('saludo');
        if(saludoEl) saludoEl.innerText = `Hola, ${user}`;
        
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
        
        const currentUrl = window.location.href;
        ui.setupAccessQR(currentUrl);
    }
    setupEvents();
});

// Función de Precios por Saturación
function calcularPrecioUnitario(tipo, sat) {
    if (tipo === 'laser_bn') return 0.50;
    if (sat <= 30) return 1.00;
    if (sat <= 50) return 1.50;
    if (sat <= 65) return 2.00;
    if (sat <= 85) return 2.50;
    return 3.00;
}

function setupEvents() {
    // Registro
    document.getElementById('btn-entrar')?.addEventListener('click', () => {
        const n = document.getElementById('input-nombre').value.trim();
        if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); }
    });

    // Guardado y Edición de Productos
    document.getElementById('form-db')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('db-id').value;
        const p = { 
            nombre: document.getElementById('db-nombre').value.toUpperCase(), 
            stock: parseInt(document.getElementById('db-stock').value) || 0, 
            costo: parseFloat(document.getElementById('db-costo').value) || 0, 
            venta: parseFloat(document.getElementById('db-venta').value) || 0 
        };
        
        if (id) {
            if(await db.actualizarProducto(id, p)) { alert("ACTUALIZADO"); limpiarFormDB(); }
        } else {
            if(await db.guardarNuevoProducto(p)) { alert("GUARDADO"); e.target.reset(); }
        }
    });

    // Botones de Navegación
    document.getElementById('btn-cancelar-edicion')?.addEventListener('click', limpiarFormDB);
    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    document.getElementById('btn-abrir-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'show'));
    document.getElementById('btn-cerrar-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'hide'));
    document.getElementById('btn-flotante-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'show'));
    document.getElementById('btn-cerrar-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'hide'));
    document.getElementById('btn-cerrar-etiqueta')?.addEventListener('click', () => ui.toggleModal('modal-etiqueta', 'hide'));

    // Scanner
    document.getElementById('btn-abrir-scanner')?.addEventListener('click', () => {
        ui.startScanner(async (text) => {
            const p = await db.obtenerProductoPorID(text);
            if(p) {
                ui.stopScanner();
                const op = confirm(`PROD: ${p.nombre}\n\n¿VENDER (Aceptar) o SURTIR (Cancelar)?`);
                if(op) window.agregarProdAlCarrito(text, p.nombre, p.venta);
                else {
                    const cant = prompt(`¿Cuántas piezas entran?`, "1");
                    if(cant) await db.sumarStockProducto(text, parseInt(cant), p.costo);
                }
            }
        });
    });

    document.getElementById('btn-cerrar-scanner')?.addEventListener('click', ui.stopScanner);

    // Lógica de Cobro Final
    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        if(carrito.length === 0) { alert("El carrito está vacío"); return; }
        await db.procesarCobroVenta(carrito);
        carrito = []; 
        renderCarrito(); 
        alert("Venta finalizada con éxito");
    });
}

// Funciones Globales para los Botones (Importante para que funcionen en móvil)
window.prepararEdicion = async (id) => {
    const p = await db.obtenerProductoPorID(id);
    if (p) {
        document.getElementById('db-id').value = id;
        document.getElementById('db-nombre').value = p.nombre;
        document.getElementById('db-stock').value = p.stock;
        document.getElementById('db-costo').value = p.costo;
        document.getElementById('db-venta').value = p.venta;
        const btn = document.getElementById('btn-guardar-prod');
        if(btn) {
            btn.innerText = "Actualizar";
            btn.classList.add('bg-amber-500');
        }
        document.getElementById('btn-cancelar-edicion')?.classList.remove('hidden');
    }
};

window.verEtiqueta = (id, nombre, precio) => {
    const nomEl = document.getElementById('etiqueta-nombre');
    const preEl = document.getElementById('etiqueta-precio');
    const qrCont = document.getElementById('etiqueta-qr');
    
    if(nomEl) nomEl.innerText = nombre;
    if(preEl) preEl.innerText = `$${precio.toFixed(2)}`;
    if(qrCont) {
        qrCont.innerHTML = ""; 
        new QRCode(qrCont, { text: id, width: 150, height: 150 });
    }
    ui.toggleModal('modal-etiqueta', 'show');
};

window.agregarProdAlCarrito = (id, n, p) => { 
    carrito.push({id, nombre: n, precio: p, tipo: 'producto'}); 
    renderCarrito(); 
};

window.agregarImpAlCarrito = (id, u, p) => { 
    const sel = document.getElementById(`sel-${id}`);
    const pr = sel ? parseFloat(sel.value) : 0.50; 
    carrito.push({id, nombre: `Imp: ${u}`, precio: pr*p, tipo: 'impresion'}); 
    renderCarrito(); 
};

window.quitarDelCarrito = (i) => { 
    carrito.splice(i, 1); 
    renderCarrito(); 
};

window.eliminarProducto = async (id) => {
    if(confirm("¿Seguro que quieres eliminar este producto?")) {
        await db.eliminarRegistro('inventario', id);
    }
};

// Renderizadores
function renderInv(snap) {
    const cont = document.getElementById('lista-stock-rapido');
    const prods = [];
    if(!cont) return;
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data(); p.id = docSnap.id; prods.push(p);
        cont.innerHTML += `<div class="p-2 bg-slate-50 rounded-xl mb-1 flex justify-between items-center border">
            <span class="text-[10px] font-bold uppercase">${p.nombre} (${p.stock})</span>
            <div class="flex gap-1">
                <button onclick="window.verEtiqueta('${p.id}', '${p.nombre}', ${p.venta})" class="text-indigo-500 text-[10px] font-bold px-2">QR</button>
                <button onclick="window.agregarProdAlCarrito('${p.id}', '${p.nombre}', ${p.venta})" class="bg-slate-900 text-white px-3 py-1 rounded-lg">+</button>
            </div></div>`;
    });
    ui.renderDBTable(prods, window.eliminarProducto, window.prepararEdicion);
}

function renderFinanzas(snap) {
    const tbody = document.getElementById('tabla-finanzas-body');
    if(!tbody) return;
    let totalInv = 0, totalIng = 0, totalGan = 0;
    tbody.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data();
        const inv = p.gastoAcumulado || (p.stock * p.costo);
        const ing = p.totalDia || 0;
        const gan = ing - inv;
        totalInv += inv; totalIng += ing;
        if(gan > 0) totalGan += gan;
        tbody.innerHTML += `<tr class="border-b bg-white"><td class="p-4 uppercase font-bold">${p.nombre}</td><td class="p-4 text-center">$${inv.toFixed(2)}</td><td class="p-4 text-center">${p.ventasHistoricas || 0}</td><td class="p-4 text-center text-green-600">$${ing.toFixed(2)}</td><td class="p-4 text-center"><span class="px-2 py-1 rounded-full text-[8px] font-black ${ing >= inv ? 'bg-green-500 text-white':'bg-amber-100 text-amber-600'}">${ing >= inv ? 'OK':'...'}</span></td><td class="p-4 text-right font-black ${gan > 0 ? 'text-indigo-600':'text-slate-300'}">$${gan.toFixed(2)}</td></tr>`;
    });
    document.getElementById('fin-inversion-total').innerText = `$${totalInv.toFixed(2)}`;
    document.getElementById('fin-ingresos-totales').innerText = `$${totalIng.toFixed(2)}`;
    document.getElementById('fin-utilidad-total').innerText = `$${totalGan.toFixed(2)}`;
}

function renderCarrito() {
    const cont = document.getElementById('items-carrito');
    if(!cont) return;
    let total = 0; cont.innerHTML = "";
    carrito.forEach((item, index) => {
        total += item.precio;
        cont.innerHTML += `<div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 border"><span>${item.nombre}</span><span>$${item.precio.toFixed(2)} <button onclick="window.quitarDelCarrito(${index})" class="text-red-500 font-bold">×</button></span></div>`;
    });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones');
    if(!cont) return;
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

function limpiarFormDB() {
    const idField = document.getElementById('db-id');
    const form = document.getElementById('form-db');
    const btn = document.getElementById('btn-guardar-prod');
    if(idField) idField.value = "";
    if(form) form.reset();
    if(btn) {
        btn.innerText = "Añadir Producto";
        btn.classList.remove('bg-amber-500');
    }
    document.getElementById('btn-cancelar-edicion')?.classList.add('hidden');
}
