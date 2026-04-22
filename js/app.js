import * as db from './database.js';
import * as ui from './ui-controller.js';

let carrito = [];
let saturacion = 0;
let archivo = null;
let productosGlobales = [];
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
            
            // ESCUCHADOR DE INVENTARIO
            db.escucharInventarioDB((snap) => {
                productosGlobales = [];
                snap.forEach(d => { 
                    const p = d.data(); 
                    p.id = d.id; 
                    productosGlobales.push(p); 
                });
                
                // 1. Mandar a la lista de búsqueda (Pantalla Principal)
                filtrarYMostrarProductos(""); 
                // 2. Mandar al listado del modal de Stock
                ui.renderDBTable(productosGlobales); 
                // 3. Actualizar Finanzas
                renderFinanzas(snap);
            });
            
            db.escucharIngresosServicios(renderBitacoraImpresiones);
        } else {
            ui.toggleModal('panel-alumno', 'show');
            ui.toggleModal('btn-flotante-qr', 'show');
        }
        ui.setupAccessQR(window.location.href);
    }
    setupEvents();
});

function setupEvents() {
    document.getElementById('btn-entrar')?.addEventListener('click', () => {
        const n = document.getElementById('input-nombre').value.trim();
        if(n) { localStorage.setItem('nombre_usuario', n); location.reload(); }
    });

    document.getElementById('busqueda-producto')?.addEventListener('input', (e) => filtrarYMostrarProductos(e.target.value));

    // FORMULARIO DE STOCK (Añadir o Editar)
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
            if(await db.actualizarProducto(id, p)) { 
                alert("✅ PRODUCTO ACTUALIZADO"); 
                limpiarFormDB(); 
            }
        } else {
            if(await db.guardarNuevoProducto(p)) { 
                alert("✅ PRODUCTO GUARDADO"); 
                e.target.reset(); 
            }
        }
    });

    document.getElementById('btn-cancelar-edicion')?.addEventListener('click', limpiarFormDB);
    document.getElementById('btn-abrir-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'show'));
    document.getElementById('btn-cerrar-db')?.addEventListener('click', () => ui.toggleModal('modal-db', 'hide'));
    document.getElementById('btn-abrir-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'show'));
    document.getElementById('btn-cerrar-finanzas')?.addEventListener('click', () => ui.toggleModal('modal-finanzas', 'hide'));
    document.getElementById('btn-cerrar-etiqueta')?.addEventListener('click', () => ui.toggleModal('modal-etiqueta', 'hide'));
    document.getElementById('btn-cerrar-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'hide'));
    document.getElementById('btn-flotante-qr')?.addEventListener('click', () => ui.toggleModal('modal-qr', 'show'));

    document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
        if(carrito.length === 0) return;
        await db.procesarCobroVenta(carrito);
        carrito = []; renderCarrito(); alert("✅ Cobro finalizado");
        document.getElementById('busqueda-producto').value = "";
        filtrarYMostrarProductos("");
    });

    // ... resto de eventos (scanner, archivos) se mantienen igual ...
}

// --- FUNCIONES GLOBALES PARA LA TABLA DE STOCK ---

window.prepararEdicion = async (id) => {
    const p = await db.obtenerProductoPorID(id);
    if (p) {
        document.getElementById('db-id').value = id;
        document.getElementById('db-nombre').value = p.nombre;
        document.getElementById('db-stock').value = p.stock;
        document.getElementById('db-costo').value = p.costo;
        document.getElementById('db-venta').value = p.venta;
        
        const btn = document.getElementById('btn-guardar-prod');
        btn.innerText = "Actualizar Cambios";
        btn.classList.replace('bg-indigo-600', 'bg-amber-500');
        document.getElementById('btn-cancelar-edicion').classList.remove('hidden');
        
        // Hacer scroll hacia arriba en el modal para ver el formulario
        document.querySelector('#modal-db > div').scrollTop = 0;
    }
};

window.eliminarProducto = async (id) => {
    if(confirm("⚠️ ¿Estás seguro de eliminar este producto del inventario definitivamente?")) {
        await db.eliminarRegistro('inventario', id);
    }
};

function limpiarFormDB() {
    document.getElementById('db-id').value = "";
    document.getElementById('form-db').reset();
    const btn = document.getElementById('btn-guardar-prod');
    btn.innerText = "Añadir Producto";
    btn.classList.replace('bg-amber-500', 'bg-indigo-600');
    document.getElementById('btn-cancelar-edicion').classList.add('hidden');
}

// (IMPORTANTE: Mantener las demás funciones de renderizado renderCola, renderInv, filtrarYMostrarProductos, etc.)
// ...
