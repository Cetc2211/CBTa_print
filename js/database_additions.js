import { ref, uploadBytes, getDownloadURL, deleteObject } 
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { storage } from "./firebase-config.js";

/**
 * subirFotoProducto
 * Sube imagen a Storage en /productos/
 * Devuelve la URL pública de descarga.
 */
export const subirFotoProducto = async (archivo, nombreProducto) => {
  try {
    const extRaw  = archivo.name.includes('.') ? archivo.name.split('.').pop() : '';
    const ext     = (extRaw || 'jpg').toLowerCase();
    const nombre  = `${Date.now()}_${nombreProducto.replace(/\s+/g,'_').substring(0,30)}.${ext}`;
    const storRef = ref(storage, `productos/${nombre}`);
    const metadata = { contentType: archivo.type || 'image/jpeg' };
    const snap    = await uploadBytes(storRef, archivo, metadata);
    return await getDownloadURL(snap.ref);
  } catch(e){
    console.error('[Storage] Error subiendo foto:', e);
    return null;
  }
};

/**
 * eliminarFotoProducto
 * Borra la imagen de Storage cuando se elimina un producto.
 */
export const eliminarFotoProducto = async (fotoURL) => {
  try {
    if(!fotoURL) return;
    const storRef = ref(storage, fotoURL);
    await deleteObject(storRef);
  } catch(e){
    console.warn('[Storage] No se pudo eliminar foto:', e);
  }
};
