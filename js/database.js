import { 
    collection, addDoc, serverTimestamp, onSnapshot, deleteDoc, 
    doc, updateDoc, increment, getDoc, query, orderBy, limit, where, getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { db, storage, app } from "./firebase-config.js";

// ─── Protecciones de subida a Storage ─────────────────────────────
// Evita que la UI se quede colgada cuando el bucket no responde
// (cuota agotada, bucket inexistente o CORS sin configurar).
const TIMEOUT_BUCKET_PRINCIPAL = 60000; // 60 s para subidas reales
const TIMEOUT_BUCKET_FALLBACK  = 20000; // 20 s (el fallback es un último recurso)

function conTimeout(promesa, ms, etiqueta) {
  let timer;
  const vencido = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(
        `${etiqueta}: la subida superó ${Math.round(ms/1000)} s sin respuesta. ` +
        `Posible falta de cuota en el bucket o bucket no disponible.`
      )),
      ms
    );
  });
  return Promise.race([promesa, vencido]).finally(() => clearTimeout(timer));
}

const ERRORES_STORAGE = {
  'storage/quota-exceeded':
    'La cuota de almacenamiento del proyecto Firebase está agotada. No se pueden subir archivos hasta liberar espacio o ampliar el plan (ver consola de Firebase → Storage).',
  'storage/unauthorized':
    'No hay permiso para subir archivos al almacenamiento (revisa storage.rules / autenticación).',
  'storage/canceled': 'La subida fue cancelada.',
  'storage/retry-limit-exceeded':
    'La red no respondió y se agotaron los reintentos de subida.',
};

function mensajeStorage(e) {
  return ERRORES_STORAGE[e?.code] || e?.message || 'Error desconocido de almacenamiento';
}

// Escuchar Cola de Impresión
export const escucharColaImpresion = (callback) => {
    const q = query(collection(db, "cola_impresion"), orderBy("fecha", "desc"));
    return onSnapshot(q, callback);
};

const subirDocumentoACola = async (datos, extras = {}) => {
    if (!datos.archivo) throw new Error('No se proporcionó archivo');
    if (!datos.usuario) throw new Error('No se proporcionó nombre de usuario');

    const extension = datos.archivo.name.split('.').pop();
    const nombreFinal = `${Date.now()}_${datos.usuario.replace(/\s+/g, '_')}.${extension}`;
    const storagePath = `impresiones/${nombreFinal}`;

    // Intentar subida con el bucket principal
    let url;
    try {
        const storageRef = ref(storage, storagePath);
        const snapshot = await conTimeout(
            uploadBytes(storageRef, datos.archivo),
            TIMEOUT_BUCKET_PRINCIPAL,
            'Storage (bucket principal)'
        );
        url = await getDownloadURL(snapshot.ref);
    } catch(storageErr) {
        // Cuota agotada: el fallback apunta al mismo proyecto, no tiene sentido insistir.
        // Se informa de inmediato con un mensaje accionable.
        if (storageErr?.code === 'storage/quota-exceeded') {
            console.error('[Storage] Cuota agotada en bucket principal');
            throw new Error(ERRORES_STORAGE['storage/quota-exceeded']);
        }
        // Fallback al bucket legacy appspot (compatibilidad), con tope de tiempo
        console.warn('[Storage] Bucket principal falló, intentando fallback:', storageErr.code || storageErr.message);
        try {
            const legacyStorage = getStorage(app, 'gs://academic-tracker-qeoxi.appspot.com');
            const legacyRef = ref(legacyStorage, storagePath);
            const snapshot = await conTimeout(
                uploadBytes(legacyRef, datos.archivo),
                TIMEOUT_BUCKET_FALLBACK,
                'Storage (bucket de respaldo)'
            );
            url = await getDownloadURL(snapshot.ref);
        } catch(fallbackErr) {
            console.error('[Storage] Fallback también falló:', fallbackErr.code || fallbackErr.message);
            throw new Error('No se pudo subir el archivo. ' + mensajeStorage(fallbackErr));
        }
    }

    // Registrar en Firestore
    const colaRef = await addDoc(collection(db, 'cola_impresion'), {
        usuario: datos.usuario,
        archivo: datos.archivo.name,
        archivoURL: url,
        paginas: Number(datos.paginas),
        tipoImpresion: datos.tipoImpresion,
        fecha: serverTimestamp(),
        estatus: 'pendiente',
        ...extras,
    });

    return { colaRef, archivoURL: url };
};

// Enviar Archivo (Alumno)
export const enviarDocumentoNube = async (datos) => subirDocumentoACola(datos);

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
