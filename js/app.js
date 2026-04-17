// js/app.js
import * as db from './database.js';
import * as ui from './ui-controller.js';

// --- ESTADO GLOBAL ---
let carrito = [];
let saturacionGlobal = 0;
let archivoSeleccionado = null;
const nombreUsuario = localStorage.getItem('nombre_usuario') || "";

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    configurarListeners();
    validarAcceso();
});

function validarAcceso() {
    if (!nombreUsuario) {
        ui.toggleModal('modal-registro', 'show');
    } else {
        document.getElementById('saludo').innerText = `Hola, ${nombreUsuario}`;
        const esAdmin = nombreUsuario.toLowerCase().includes("cecilio") || 
                        nombreUsuario.toLowerCase().includes("danika landeros");
        
        if (esAdmin) {
            ui.toggleModal('panel-admin', 'show');
            db.escucharColaImpresion(renderizarColaImpresiones);
            db.escucharInventarioDB(renderizarInventario);
        } else {
            ui.toggleModal('panel-alumno', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
            ui.setupAccessQR(window.location.href);
        }
    }
}

// --- LÓGICA DE IMPRESIONES (ALUMNO) ---
async function procesarAnalisisArchivo(e) {
    archivoSeleccionado = e.target.files[0];
    if (!archivoSeleccionado) return;

    document.getElementById('info-status').innerText = "Analizando saturación...";
    
    if (archivoSeleccionado.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = async function() {
            const pdf = await pdfjsLib.getDocument(new Uint8Array(this.result)).promise;
            document.getElementById('alumno-pags').value = pdf.numPages;
            
            // Analizar primera página para color
            const page = await pdf.getPage(1);
            const canvas = document.createElement('canvas');
            const viewport = page.getViewport({ scale: 0.2 });
            canvas.height = viewport.height; canvas.width = viewport.width;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            
            const data = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
            let colorPixels = 0;
            for(let i=0; i<data.length; i+=4) {
                if(Math.abs(data[i]-data[i+1])>15 || Math.abs(data[i]-data[i+2])>15) colorPixels++;
            }
            saturacionGlobal = (colorPixels / (data.length / 4)) * 100;
            actualizarCalculoAlumno();
        };
        reader.readAsArrayBuffer(archivoSeleccionado);
    } else {
        document.getElementById('alumno-pags').value = 1;
        saturacionGlobal = 20;
        actualizarCalculoAlumno();
    }
}

function actualizarCalculoAlumno() {
    const pags = parseInt(document.getElementById('alumno-pags').value) || 1;
    const tipo = document.getElementById('alumno-imp').value;
    let precioUni = (tipo === 'laser_bn') ? 0.50 : (saturacionGlobal > 15 ? 3.50 : 1.50);
    document.getElementById('alumno-total').innerText = `$${(pags * precioUni).toFixed(2)}`;
    document.getElementById('info-status').innerText = `Saturación: ${saturacionGlobal.toFixed(1)}%`;
}

// --- GESTIÓN DEL CARRITO (ADMIN) ---
window.agregarImpAlCarrito = (id, usuario, pags) => {
    const precio = parseFloat(document.getElementById(`sel-${id}`).value);
    carrito.push({ id, nombre: `Imp: ${usuario} (${pags}p)`, precio: precio * pags, tipo: 'impresion' });
    actualizarCarritoUI();
};

window.agregarProdAlCarrito = (id, nombre, precio) => {
    carrito.push({ id, nombre, precio, tipo: 'producto' });
    actualizarCarritoUI();
};

window.quitarDelCarrito = (index) => {
    carrito.splice(index, 1);
    actualizarCarritoUI();
};

function actualizarCarritoUI() {
    const cont = document.getElementById('items-carrito');
    let total = 0;
    cont.innerHTML = "";
    
    carrito.forEach((item, index) => {
        total += item.precio;
        cont.innerHTML += `
            <div class="flex justify-between p-2 bg-slate-50 rounded-lg mb-1 text-[11px] border">
                <span class="truncate w-32 font-medium">${item.nombre}</span>
                <span class="font-bold">$${item.precio.toFixed(2)} 
                    <button onclick="quitarDelCarrito(${index})" class="text-red-500 ml-1">×</button>
                </span>
            </div>`;
    });
    document.getElementById('total-carrito').innerText = `$${total.toFixed(2)}`;
}

// --- HANDLERS DE EVENTOS ---
function configurarListeners() {
    // Registro
    document.getElementById('btn-entrar')?.addEventListener('click', () => {
        const n = document.getElementById('input-nombre').value;
        if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); }
    });

    // Alumno
    document.getElementById('input-archivo')?.addEventListener('change', procesarAnalisisArchivo);
    document.getElementById('alumno-imp')?.addEventListener('change', actualizarCalculoAlumno);
    document.getElementById('btn-enviar-archivo')?.addEventListener('click', async () => {
        const res = await db.enviarDocumentoNube({
            usuario: nombreUsuario, archivo: archivoSeleccionado,
            paginas: parseInt(document.getElementById('alumno-pags').value),
            cobertura: saturacionGlobal
        });
        if(res) ui.toggleModal('modal-exito', 'show');
    });

    // Admin
    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    document.getElementById('btn-abrir-scanner')?.addEventListener('click', () => ui.startScanner(onScanSuccess));
    document.getElementById('btn-cerrar-scanner')?.addEventListener('click', ui.stopScanner);
    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        await db.procesarCobroVenta(carrito);
        carrito = [];
        actualizarCarritoUI();
        alert("Venta procesada con éxito");
    });

    document.getElementById('form-db')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await db.guardarNuevoProducto({
            nombre: document.getElementById('db-nombre').value,
            stock: parseInt(document.getElementById('db-stock').value),
            costo: parseFloat(document.getElementById('db-costo').value),
            venta: parseFloat(document.getElementById('db-venta').value)
        });
        e.target.reset();
    });
}

// --- CALLBACKS DE FIREBASE ---
function renderizarColaImpresiones(snap) {
    const cont = document.getElementById('lista-impresiones');
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); const id = docSnap.id;
        const sugerencia = d.cobertura > 15 ? "3.50" : (d.cobertura > 0.5 ? "1.50" : "0.50");
        cont.innerHTML += `
            <div class="p-3 bg-white border rounded-xl mb-2 shadow-sm">
                <div class="flex justify-between items-center mb-1">
                    <b class="text-[11px] uppercase">${d.usuario}</b>
                    <span class="text-[9px] font-bold text-indigo-600">${d.cobertura.toFixed(1)}% Sat.</span>
                </div>
                <div class="flex gap-1">
                    <select id="sel-${id}" class="text-[10px] bg-slate-100 border p-1 rounded font-bold flex-1">
                        <option value="0.50" ${sugerencia=="0.50"?'selected':''}>B/N ($0.50)</option>
                        <option value="1.50" ${sugerencia=="1.50"?'selected':''}>Col. Poco ($1.50)</option>
                        <option value="3.50" ${sugerencia=="3.50"?'selected':''}>Col. Mucho ($3.50)</option>
                    </select>
                    <button onclick="agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[10px] font-black">+ COBRAR</button>
                    <a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[10px] font-bold">VER</a>
                </div>
            </div>`;
    });
}

function renderizarInventario(snap) {
    const contStock = document.getElementById('lista-stock-rapido');
    const prods = [];
    contStock.innerHTML = "";
    snap.forEach(docSnap => {
        const p = docSnap.data(); p.id = docSnap.id;
        prods.push(p);
        contStock.innerHTML += `
            <div class="p-2 bg-slate-50 rounded-xl mb-1 flex justify-between items-center border">
                <span class="text-[10px] font-bold uppercase">${p.nombre} (${p.stock})</span>
                <button onclick="agregarProdAlCarrito('${p.id}', '${p.nombre}', ${p.venta})" class="bg-slate-900 text-white px-3 py-1 rounded-lg">+</button>
            </div>`;
    });
    ui.renderDBTable(prods, (id) => db.eliminarRegistro('inventario', id));
}

async function onScanSuccess(decodedText) {
    const p = await db.obtenerProductoPorID(decodedText);
    if (p) {
        agregarProdAlCarrito(decodedText, p.nombre, p.venta);
        ui.stopScanner();
    }
}

// Hacer funciones disponibles globalmente para los onclick de los botones dinámicos
window.quitarDelCarrito = quitarDelCarrito;
window.agregarImpAlCarrito = agregarImpAlCarrito;
window.agregarProdAlCarrito = agregarProdAlCarrito;
