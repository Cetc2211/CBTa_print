import { 
    collection, addDoc, serverTimestamp, onSnapshot, deleteDoc, 
    doc, updateDoc, increment, getDoc, query, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
// IMPORTANTE: Asegúrate de que 'auth' esté exportado en tu firebase-config.js
import { db, storage, auth } from "./firebase-config.js";

export const escucharIngresosServicios = (callback) => {
    const q = query(collection(db, "ingresos_servicios"), orderBy("fecha", "desc"), limit(50));
    return onSnapshot(q, callback);
};

export const enviarDocumentoNube = async (datos) => {
    try {
        if (!datos.archivo) return null;
        const nombreLimpio = datos.archivo.name.replace(/[^a-zA-Z0-9.]/g, '_');
        const storageRef = ref(storage, `impresiones/${Date.now()}_${nombreLimpio}`);
        const snapshot = await uploadBytes(storageRef, datos.archivo);
        const url = await getDownloadURL(snapshot.ref);
        return await addDoc(collection(db, "cola_impresion"), {
            usuario: datos.usuario, archivo: datos.archivo.name, archivoURL: url,
            paginas: datos.paginas, cobertura: datos.cobertura, tipoImpresion: datos.tipoImpresion,
            fecha: serverTimestamp()
        });
    } catch(e) { return null; }
};

export const escucharColaImpresion = (callback) => onSnapshot(query(collection(db, "cola_impresion"), orderBy("fecha", "desc")), callback);
export const escucharInventarioDB = (callback) => onSnapshot(collection(db, "inventario"), callback);

export const guardarNuevoProducto = async (p) => {
    try {
        return await addDoc(collection(db, "inventario"), { ...p, totalDia: 0, ventasHistoricas: 0, gastoAcumulado: (p.stock * p.costo) });
    } catch(e) { return null; }
};

export const actualizarProducto = async (id, datos) => {
    try {
        await updateDoc(doc(db, "inventario", id), { ...datos, gastoAcumulado: (datos.stock * datos.costo) });
        return true;
    } catch (e) { return false; }
};

export const sumarStockProducto = async (id, cantidad, costoActual) => {
    try {
        return await updateDoc(doc(db, "inventario", id), { stock: increment(cantidad), gastoAcumulado: increment(cantidad * (costoActual || 0)) });
    } catch(e) { return null; }
};

export const obtenerProductoPorID = async (id) => {
    try {
        const docSnap = await getDoc(doc(db, "inventario", id));
        return docSnap.exists() ? docSnap.data() : null;
    } catch(e) { return null; }
};

/**
 * FUNCIÓN ACTUALIZADA: procesarCobroVenta
 * Ahora registra qué administrador realizó la operación.
 */
export const procesarCobroVenta = async (carrito) => {
    // 1. Obtenemos al usuario (administrador) actual
    const adminActual = auth.currentUser;
    const vendedorNombre = adminActual?.displayName || adminActual?.email || "Admin Desconocido";
    const vendedorId = adminActual?.uid || "no-auth";

    for (const item of carrito) {
        if (item.tipo === 'producto') {
            // Actualización de stock en inventario
            await updateDoc(doc(db, "inventario", item.id), { 
                stock: increment(-1), 
                totalDia: increment(item.precio), 
                ventasHistoricas: increment(1) 
            });

            // OPCIONAL: Registrar la venta del producto en una colección histórica
            // para saber quién vendió cada unidad física.
            await addDoc(collection(db, "historial_ventas"), {
                tipo: "producto",
                nombre: item.labelServicio || "Producto",
                monto: item.precio,
                vendedor: vendedorNombre,
                vendedorId: vendedorId,
                fecha: serverTimestamp()
            });

        } else {
            // Registro de servicios (Impresiones, etc)
            await addDoc(collection(db, "ingresos_servicios"), {
                monto: item.precio,
                usuario: item.usuarioAlumno,
                paginas: item.numPags,
                servicio: item.labelServicio,
                // --- REGISTRO DEL VENDEDOR ---
                vendedor: vendedorNombre,
                vendedorId: vendedorId,
                // -----------------------------
                fecha: serverTimestamp()
            });
            await deleteDoc(doc(db, "cola_impresion", item.id));
        }
    }
};

export const eliminarRegistro = async (col, id) => await deleteDoc(doc(db, col, id));
