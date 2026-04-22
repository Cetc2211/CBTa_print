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
    if (el) el.classList.remove('hidden');
    
    if (scanner) {
        try { await scanner.stop(); } catch(e) {}
    }

    scanner = new Html5Qrcode("reader");
    try {
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 }, onSuccess);
    } catch (e) {
        alert("Error de cámara: Activa los permisos.");
        if (el) el.classList.add('hidden');
    }
};

export const stopScanner = async () => {
    const el = document.getElementById('modal-scanner');
    if (scanner) {
        try {
            if (scanner.isScanning) {
                await scanner.stop();
            }
        } catch (e) {
            console.warn("Scanner detenido con advertencia");
        } finally {
            scanner = null;
        }
    }
    if (el) el.classList.add('hidden');
};

export const renderDBTable = (prods, onDelete, onEdit) => {
    const tbody = document.getElementById('tabla-db-body');
    if (!tbody) return;
    tbody.innerHTML = prods.map(p => `
        <tr class="border-b hover:bg-slate-50">
            <td class="p-3 font-bold uppercase text-left">${p.nombre}</td>
            <td class="p-3 text-center">${p.stock || 0}</td>
            <td class="p-3 text-center text-red-500">$${(p.costo || 0).toFixed(2)}</td>
            <td class="p-3 text-center text-green-600 font-bold">$${(p.venta || 0).toFixed(2)}</td>
            <td class="p-3 text-right">
                <div class="flex gap-2 justify-end">
                    <button onclick="window.prepararEdicion('${p.id}')" class="text-amber-500 font-black uppercase text-[9px]">Editar</button>
                    <button onclick="window.verEtiqueta('${p.id}', '${p.nombre}', ${p.venta || 0})" class="text-indigo-500 font-black uppercase text-[9px]">QR</button>
                    <button onclick="window.eliminarProducto('${p.id}')" class="text-red-300 font-bold text-lg">✕</button>
                </div>
            </td>
        </tr>`).join("");
    window.eliminarProducto = (id) => { if(confirm("¿Eliminar artículo definitivamente?")) onDelete(id); };
    window.prepararEdicion = onEdit;
};
