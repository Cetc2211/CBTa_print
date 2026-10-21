// Las fotos de producto ya NO usan Firebase Storage (Google exige plan
// de pago para Storage desde octubre 2025). En su lugar, cada foto se
// comprime en el navegador y se guarda como dataURL base64 dentro del
// documento del producto en Firestore (los <img src> la leen igual).

const comprimirImagenADataUrl = (archivo, maxDim = 500, calidad = 0.7) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      try {
        const factor = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const cw = Math.max(1, Math.round(img.naturalWidth * factor));
        const ch = Math.max(1, Math.round(img.naturalHeight * factor));
        const c = document.createElement('canvas');
        c.width = cw;
        c.height = ch;
        c.getContext('2d').drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', calidad));
      } catch(e){
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen no válida')); };
    img.src = url;
  });

/**
 * subirFotoProducto
 * Comprime la imagen (máx 500px, JPEG 70%) y devuelve el dataURL base64
 * para guardarse directamente en el documento del producto.
 */
export const subirFotoProducto = async (archivo, _nombreProducto) => {
  return await comprimirImagenADataUrl(archivo, 500, 0.7);
};

/**
 * eliminarFotoProducto
 * La foto ahora vive dentro del documento de Firestore, así que se
 * elimina junto con el producto. Se conserva la función para no romper
 * las importaciones existentes.
 */
export const eliminarFotoProducto = async () => {};
