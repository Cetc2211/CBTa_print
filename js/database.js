import {
    collection, addDoc, serverTimestamp, onSnapshot, deleteDoc,
    doc, updateDoc, increment, getDoc, query, orderBy, limit, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

// ─── Almacenamiento de impresiones (SIN Firebase Storage) ─────────
// Desde el 1 de octubre de 2025 Google exige el plan Blaze (pago) para
// usar CUALQUIER bucket de Cloud Storage, incluso los existentes. Para
// no depender de eso, los archivos de impresión se guardan COMPRIMIDOS
// en base64 dentro del propio documento de Firestore (plan Spark, gratis).
//
// Límite duro de un documento Firestore: 1,048,576 bytes. El base64
// crece 4/3, así que el tope seguro de PDF real es ~700 KB. Las fotos
// se comprimen en app.js antes de convertirse a PDF.
export const MAX_ARCHIVO_BYTES = 700000;

// Convierte un Blob/File a base64 puro (sin el prefijo data:)
const blobABase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(blob);
});

// Escuchar Cola de Impresión
export const escucharColaImpresion = (callback) => {
    const q = query(collection(db, "cola_impresion"), orderBy("fecha", "desc"));
    return onSnapshot(q, callback);
};

const guardarDocumentoEnCola = async (datos, extras = {}) => {
    if (!datos.archivo) throw new Error('No se proporcionó archivo');
    if (!datos.usuario) throw new Error('No se proporcionó nombre de usuario');

    if (datos.archivo.size > MAX_ARCHIVO_BYTES) {
        const mb = (datos.archivo.size / 1048576).toFixed(2);
        throw new Error(
            `El archivo pesa ${mb} MB y el límite es ${(MAX_ARCHIVO_BYTES / 1048576).toFixed(1)} MB. ` +
            `Consejo: toma foto al documento y envíala como imagen (la app la comprime automáticamente).`
        );
    }

    const base64 = await blobABase64(datos.archivo);

    // Registra en Firestore. El campo archivoURL se deja vacío por
    // compatibilidad con las reglas de seguridad y los documentos antiguos.
    const colaRef = await addDoc(collection(db, 'cola_impresion'), {
        usuario: datos.usuario,
        archivo: datos.archivo.name,
        archivoURL: '',
        archivoBase64: base64,
        archivoTipo: 'application/pdf',
        archivoBytes: datos.archivo.size,
        paginas: Number(datos.paginas),
        tipoImpresion: datos.tipoImpresion,
        saturada: !!datos.saturada,
        fecha: serverTimestamp(),
        estatus: 'pendiente',
        ...extras,
    });

    return { colaRef, archivoURL: '' };
};

// Enviar Archivo (Alumno)
export const enviarDocumentoNube = async (datos) => guardarDocumentoEnCola(datos);

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
