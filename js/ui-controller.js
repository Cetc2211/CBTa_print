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
    if (scanner) { try { await scanner.stop(); } catch(e) {} }
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
        try { if (scanner.isScanning) await scanner.stop(); } catch (e) {} finally { scanner = null; }
    }
    if (el) el.classList.add('hidden');
};

// ESTA FUNCIÓN ES LA QUE DIBUJA LA TABLA EN EL MODAL DE STOCK
export const renderDBTable = (prods) => {
    const tbody = document.getElementById('tabla-db-body');
    if (!tbody) return;
    
    tbody.innerHTML = prods.map(p => `
        <tr class="border-b hover:bg-slate-50 transition-colors">
            <td class="p-3 font-bold uppercase text-left text-slate-700">${p.nombre}</td>
            <td class="p-3 text-center font-bold">${p.stock || 0}</td>
            <td class="p-3 text-center text-red-500 font-bold">$${(p.costo || 0).toFixed(2)}</td>
            <td class="p-3 text-center text-green-600 font-bold">$${(p.venta || 0).toFixed(2)}</td>
            <td class="p-3 text-right">
                <div class="flex gap-2 justify-end">
                    <button onclick="window.prepararEdicion('${p.id}')" class="bg-amber-100 text-amber-600 px-3 py-1 rounded-lg font-black uppercase text-[9px] hover:bg-amber-200">Editar</button>
                    <button onclick="window.verEtiqueta('${p.id}', '${p.nombre}', ${p.venta || 0})" class="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-lg font-black uppercase text-[9px] hover:bg-indigo-200">QR</button>
                    <button onclick="window.eliminarProducto('${p.id}')" class="bg-red-100 text-red-500 px-3 py-1 rounded-lg font-bold text-lg hover:bg-red-200">✕</button>
                </div>
            </td>
        </tr>`).join("");
};
