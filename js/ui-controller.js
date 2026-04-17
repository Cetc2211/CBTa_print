export const toggleModal = (id, action) => {
    const el = document.getElementById(id);
    if (el) action === 'show' ? el.classList.remove('hidden') : el.classList.add('hidden');
};

export const setupAccessQR = (url) => {
    const cont = document.getElementById("qrcode");
    if (cont) { cont.innerHTML = ""; new QRCode(cont, { text: url, width: 200, height: 200 }); }
};

let scanner = null;
export const startScanner = async (onSuccess) => {
    const el = document.getElementById('modal-scanner');
    el.classList.remove('hidden');
    if (scanner) { await scanner.stop(); }
    scanner = new Html5Qrcode("reader");
    try {
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onSuccess);
    } catch (e) {
        alert("Error de cámara: Activa los permisos en Safari.");
        el.classList.add('hidden');
    }
};

export const stopScanner = async () => {
    if (scanner) { await scanner.stop(); scanner = null; }
    toggleModal('modal-scanner', 'hide');
};

export const renderDBTable = (prods, onDelete) => {
    const tbody = document.getElementById('tabla-db-body');
    if (!tbody) return;
    tbody.innerHTML = prods.map(p => `
        <tr class="border-b">
            <td class="p-3 font-bold uppercase">${p.nombre}</td>
            <td class="p-3 text-center">${p.stock}</td>
            <td class="p-3 text-center text-red-500">$${p.costo.toFixed(2)}</td>
            <td class="p-3 text-center text-green-600 font-bold">$${p.venta.toFixed(2)}</td>
            <td class="p-3 text-right">
                <button onclick="window.verEtiqueta('${p.id}', '${p.nombre}', ${p.venta})" class="text-indigo-500 mr-2 font-bold">QR</button>
                <button onclick="window.eliminarProducto('${p.id}')" class="text-red-300">×</button>
            </td>
        </tr>`).join("");
    window.eliminarProducto = onDelete;
};
