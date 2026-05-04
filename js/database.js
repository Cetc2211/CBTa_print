import { 
    collection, addDoc, serverTimestamp, onSnapshot, deleteDoc, 
    doc, updateDoc, increment, getDoc, query, orderBy, limit, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db, storage } from "./firebase-config.js";

// Escuchar Cola de Impresión
export const escucharColaImpresion = (callback) => {
    const q = query(collection(db, "cola_impresion"), orderBy("fecha", "desc"));
    return onSnapshot(q, callback);
};

// Enviar Archivo (Alumno)
export const enviarDocumentoNube = async (datos) => {
    try {
        if (!datos.archivo) return null;
        const extension = datos.archivo.name.split('.').pop();
        const nombreFinal = `${Date.now()}_${datos.usuario.replace(/\s+/g, '_')}.${extension}`;
        const storageRef = ref(storage, `impresiones/${nombreFinal}`);
        
        const snapshot = await uploadBytes(storageRef, datos.archivo);
        const url = await getDownloadURL(snapshot.ref);

        return await addDoc(collection(db, "cola_impresion"), {
            usuario: datos.usuario,
            archivo: datos.archivo.name,
            archivoURL: url,
            paginas: Number(datos.paginas),
            tipoImpresion: datos.tipoImpresion, // 'laser_bn' o 'smart_tank'
            fecha: serverTimestamp(),
            estatus: 'pendiente'
        });
    } catch(e) { 
        console.error("Error en subida:", e);
        return null; 
    }
};

// Inventario
export const escucharInventarioDB = (callback) => onSnapshot(collection(db, "inventario"), callback);

export const guardarNuevoProducto = async (p) => {
    return await addDoc(collection(db, "inventario"), { 
        ...p, 
        totalDia: 0, 
        ventasHistoricas: 0, 
        gastoAcumulado: (Number(p.stock) * Number(p.costo)) 
    });
};

export const actualizarProducto = async (id, datos) => {
    const docRef = doc(db, "inventario", id);
    await updateDoc(docRef, { 
        ...datos, 
        gastoAcumulado: (Number(datos.stock) * Number(datos.costo)) 
    });
    return true;
};

// Proceso de Cobro Final
export const procesarCobroVenta = async (carrito) => {
    for (const item of carrito) {
        if (item.tipo === 'producto') {
            await updateDoc(doc(db, "inventario", item.id), { 
                stock: increment(-1), 
                totalDia: increment(item.precio), 
                ventasHistoricas: increment(1) 
            });
        } else if (item.tipo === 'impresion') {
            // 1. Registrar el ingreso
            await addDoc(collection(db, "ingresos_servicios"), {
                monto: item.precio,
                usuario: item.usuarioAlumno,
                paginas: item.numPags,
                servicio: item.labelServicio,
                fecha: serverTimestamp()
            });

            // 2. Descontar hoja de papel blanca del inventario automáticamente
            const q = query(collection(db, "inventario"), where("nombre", "==", "HOJA BLANCA"));
            const snap = await getDocs(q);
            if (!snap.empty) {
                await updateDoc(doc(db, "inventario", snap.docs[0].id), {
                    stock: increment(-item.numPags)
                });
            }

            // 3. Eliminar de la cola
            await deleteDoc(doc(db, "cola_impresion", item.id));
        }
    }
    return true;
};

export const eliminarRegistro = async (col, id) => await deleteDoc(doc(db, col, id));
export const obtenerProductoPorID = async (id) => {
    const docSnap = await getDoc(doc(db, "inventario", id));
    return docSnap.exists() ? docSnap.data() : null;
};
