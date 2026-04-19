import { collection, addDoc, serverTimestamp, onSnapshot, deleteDoc, doc, updateDoc, increment, getDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db, storage } from "./firebase-config.js";

export const enviarDocumentoNube = async (datos) => {
    try {
        const storageRef = ref(storage, `impresiones/${Date.now()}_${datos.archivo.name}`);
        const snapshot = await uploadBytes(storageRef, datos.archivo);
        const url = await getDownloadURL(snapshot.ref);
        return await addDoc(collection(db, "cola_impresion"), {
            usuario: datos.usuario, archivo: datos.archivo.name, archivoURL: url,
            paginas: datos.paginas, cobertura: datos.cobertura, fecha: serverTimestamp()
        });
    } catch(e) { console.error(e); return null; }
};

export const escucharColaImpresion = (callback) => onSnapshot(query(collection(db, "cola_impresion"), orderBy("fecha", "desc")), callback);
export const escucharInventarioDB = (callback) => onSnapshot(collection(db, "inventario"), callback);

export const guardarNuevoProducto = async (p) => {
    try {
        return await addDoc(collection(db, "inventario"), { ...p, totalDia: 0, ventasHistoricas: 0, gastoAcumulado: (p.stock * p.costo) });
    } catch(e) { alert("Error Firebase: " + e.message); return null; }
};

export const obtenerProductoPorID = async (id) => {
    const docSnap = await getDoc(doc(db, "inventario", id));
    return docSnap.exists() ? docSnap.data() : null;
};

export const sumarStockProducto = async (id, cantidad, costoActual) => {
    return await updateDoc(doc(db, "inventario", id), { 
        stock: increment(cantidad),
        gastoAcumulado: increment(cantidad * costoActual)
    });
};

export const procesarCobroVenta = async (carrito) => {
    for (const item of carrito) {
        if (item.tipo === 'producto') {
            await updateDoc(doc(db, "inventario", item.id), { 
                stock: increment(-1), 
                totalDia: increment(item.precio),
                ventasHistoricas: increment(1)
            });
        } else {
            // Guardamos registro de ingreso por servicio para finanzas globales
            await addDoc(collection(db, "ingresos_servicios"), {
                monto: item.precio,
                fecha: serverTimestamp(),
                usuario: item.nombre
            });
            await deleteDoc(doc(db, "cola_impresion", item.id));
        }
    }
};

export const eliminarRegistro = async (col, id) => await deleteDoc(doc(db, col, id));
