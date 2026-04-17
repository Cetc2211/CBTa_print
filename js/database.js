// js/database.js
import { 
    collection, addDoc, serverTimestamp, onSnapshot, 
    deleteDoc, doc, updateDoc, increment, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db, storage } from "./firebase-config.js";

// --- FUNCIONES DE IMPRESIÓN ---
export const enviarDocumentoNube = async (datos) => {
    const storageRef = ref(storage, `impresiones/${Date.now()}_${datos.archivo.name}`);
    const snapshot = await uploadBytes(storageRef, datos.archivo);
    const url = await getDownloadURL(snapshot.ref);

    return await addDoc(collection(db, "cola_impresion"), {
        usuario: datos.usuario,
        archivo: datos.archivo.name,
        archivoURL: url,
        paginas: datos.paginas,
        cobertura: datos.cobertura,
        fecha: serverTimestamp()
    });
};

export const escucharColaImpresion = (callback) => {
    return onSnapshot(collection(db, "cola_impresion"), callback);
};

// --- FUNCIONES DE INVENTARIO ---
export const escucharInventarioDB = (callback) => {
    return onSnapshot(collection(db, "inventario"), callback);
};

export const guardarNuevoProducto = async (p) => {
    return await addDoc(collection(db, "inventario"), {
        ...p,
        totalDia: 0
    });
};

export const obtenerProductoPorID = async (id) => {
    const docRef = doc(db, "inventario", id);
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
};

// --- PROCESO DE VENTA FINAL ---
export const procesarCobroVenta = async (carrito) => {
    for (const item of carrito) {
        if (item.tipo === 'producto') {
            await updateDoc(doc(db, "inventario", item.id), { 
                stock: increment(-1),
                totalDia: increment(item.precio)
            });
        } else {
            await deleteDoc(doc(db, "cola_impresion", item.id));
        }
    }
};

export const eliminarRegistro = async (coleccion, id) => {
    await deleteDoc(doc(db, coleccion, id));
};
