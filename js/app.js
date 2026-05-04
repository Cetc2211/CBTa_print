import { guardarNuevoProducto, actualizarProducto, eliminarRegistro, obtenerProductoPorID } from "./database.js";
import { toggleModal } from "./ui-controller.js";

// Manejo del Formulario de Inventario
const formDB = document.getElementById('form-db');

if (formDB) {
    formDB.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const id = document.getElementById('db-id').value;
        const datos = {
            nombre: document.getElementById('db-nombre').value.toUpperCase(),
            stock: Number(document.getElementById('db-stock').value),
            costo: Number(document.getElementById('db-costo').value),
            venta: Number(document.getElementById('db-venta').value)
        };

        let exito = false;
        if (id) {
            exito = await actualizarProducto(id, datos);
        } else {
            exito = await guardarNuevoProducto(datos);
        }

        if (exito) {
            alert("Inventario actualizado correctamente");
            formDB.reset();
            document.getElementById('db-id').value = "";
            const btnCancel = document.getElementById('btn-cancelar-edicion');
            if (btnCancel) btnCancel.classList.add('hidden');
        } else {
            alert("Error al procesar la solicitud.");
        }
    });
}

// Función global para preparar la edición (se llama desde ui-controller)
window.prepararEdicion = async (id) => {
    const p = await obtenerProductoPorID(id);
    if (p) {
        document.getElementById('db-id').value = id;
        document.getElementById('db-nombre').value = p.nombre;
        document.getElementById('db-stock').value = p.stock;
        document.getElementById('db-costo').value = p.costo;
        document.getElementById('db-venta').value = p.venta;
        
        const btnCancel = document.getElementById('btn-cancelar-edicion');
        if (btnCancel) btnCancel.classList.remove('hidden');
        
        document.getElementById('form-db').scrollIntoView({ behavior: 'smooth' });
    }
};

window.eliminarProducto = async (id) => {
    if (confirm("¿Estás seguro de eliminar este producto?")) {
        await eliminarRegistro("inventario", id);
    }
};
