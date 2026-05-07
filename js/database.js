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

const subirDocumentoACola = async (datos, extras = {}) => {
    try {
        if (!datos.archivo) return null;
        const extension = datos.archivo.name.split('.').pop();
        const nombreFinal = `${Date.now()}_${datos.usuario.replace(/\s+/g, '_')}.${extension}`;
        const carpetaStorage = (extras.esDocente || datos.origen === 'docente') ? 'Docentes' : 'impresiones';
        const storageRef = ref(storage, `${carpetaStorage}/${nombreFinal}`);
        
        const snapshot = await uploadBytes(storageRef, datos.archivo);
        const url = await getDownloadURL(snapshot.ref);

        const colaRef = await addDoc(collection(db, "cola_impresion"), {
            usuario: datos.usuario,
            archivo: datos.archivo.name,
            archivoURL: url,
            paginas: Number(datos.paginas),
            tipoImpresion: datos.tipoImpresion, // 'laser_bn' o 'smart_tank'
            fecha: serverTimestamp(),
            estatus: 'pendiente',
            carpetaStorage,
            ...extras,
        });

        return { colaRef, archivoURL: url, carpetaStorage };
    } catch(e) { 
        console.error("Error en subida:", e);
        return null; 
    }
};

// Enviar Archivo (Alumno)
export const enviarDocumentoNube = async (datos) => subirDocumentoACola(datos);

export const registrarDocumentoDocente = async (datos) => {
    const costoGenerado = Number(datos.paginas) * Number(datos.precioUnitario || 0);
    const gratuita = Boolean(datos.gratuita);
    const costoExcedente = gratuita ? 0 : costoGenerado;

    const subida = await subirDocumentoACola(datos, {
        origen: 'docente',
        esDocente: true,
        gratuita,
        costoGenerado,
        costoExcedente,
        docente: datos.usuario,
        weekKey: datos.weekKey,
    });

    if (!subida) return null;
    const { colaRef, archivoURL, carpetaStorage } = subida;

    const historialRef = await addDoc(collection(db, "uso_docentes"), {
        usuario: datos.usuario,
        archivo: datos.archivo.name,
        paginas: Number(datos.paginas),
        tipoImpresion: datos.tipoImpresion,
        precioUnitario: Number(datos.precioUnitario || 0),
        costoGenerado,
        costoExcedente,
        gratuita,
        weekKey: datos.weekKey,
        colaId: colaRef.id,
        fecha: serverTimestamp(),
    });

    return { colaRef, historialRef, costoGenerado, costoExcedente, gratuita, archivoURL, carpetaStorage };
};

export const contarUsoDocenteSemanal = async (usuario, weekKey) => {
    const q = query(
        collection(db, "uso_docentes"),
        where("usuario", "==", usuario),
        where("weekKey", "==", weekKey)
    );
    const snap = await getDocs(q);
    return snap.size;
};

export const escucharUsoDocentes = (callback) => {
    const q = query(collection(db, "uso_docentes"), orderBy("fecha", "desc"), limit(100));
    return onSnapshot(q, callback);
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
            const qty = Number(item.qty) || 1;
            await updateDoc(doc(db, "inventario", item.id), { 
                stock: increment(-qty), 
                totalDia: increment(item.precio), 
                ventasHistoricas: increment(qty) 
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
            if (!item.esManual && item.id) {
                await deleteDoc(doc(db, "cola_impresion", item.id));
            }
        }
    }
    return true;
};

export const eliminarRegistro = async (col, id) => await deleteDoc(doc(db, col, id));
export const obtenerProductoPorID = async (id) => {
    const docSnap = await getDoc(doc(db, "inventario", id));
    return docSnap.exists() ? docSnap.data() : null;
};
