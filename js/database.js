import { 
    collection, addDoc, serverTimestamp, onSnapshot, deleteDoc, 
    doc, updateDoc, increment, getDoc, query, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db, storage } from "./firebase-config.js";

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
        return await addDoc(collection(db, "inventario"), { 
            ...p, 
            totalDia: 0, 
            ventasHistoricas: 0, 
            gastoAcumulado: (Number(p.stock) * Number(p.costo)) 
        });
    } catch(e) { return null; }
};

export const actualizarProducto = async (id, datos) => {
    try {
        const docRef = doc(db, "inventario", id);
        await updateDoc(docRef, { 
            ...datos, 
            gastoAcumulado: (Number(datos.stock) * Number(datos.costo)) 
        });
        return true;
    } catch (e) { return false; }
};

export const obtenerProductoPorID = async (id) => {
    try {
        const docSnap = await getDoc(doc(db, "inventario", id));
        return docSnap.exists() ? docSnap.data() : null;
    } catch(e) { return null; }
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
            await addDoc(collection(db, "ingresos_servicios"), {
                monto: item.precio,
                usuario: item.usuarioAlumno,
                paginas: item.numPags,
                servicio: item.labelServicio,
                fecha: serverTimestamp()
            });
            await deleteDoc(doc(db, "cola_impresion", item.id));
        }
    }
};

export const eliminarRegistro = async (col, id) => await deleteDoc(doc(db, col, id));
