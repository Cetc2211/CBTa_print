// js/ui-controller.js

// Función para manejar la apertura y cierre de modales
export const toggleModal = (id, action) => {
    const modal = document.getElementById(id);
    if (!modal) return;
    
    if (action === 'show') {
        modal.classList.remove('hidden');
    } else {
        modal.classList.add('hidden');
    }
};

// Limpiar la interfaz del alumno después de enviar
export const resetAlumnoUI = () => {
    document.getElementById('input-archivo').value = "";
    document.getElementById('alumno-pags').value = 0;
    document.getElementById('alumno-total').innerText = "$0.00";
    document.getElementById('info-status').innerText = "Esperando archivo";
};

// Generar el código QR de acceso (para que otros escaneen el iPad)
export const setupAccessQR = (url) => {
    const qrContainer = document.getElementById("qrcode");
    if (qrContainer) {
        qrContainer.innerHTML = "";
        new QRCode(qrContainer, {
            text: url,
            width: 200,
            height: 200,
            colorDark : "#0f172a",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }
};

// Manejo del Escáner de Cámara (Html5Qrcode)
let html5QrCode = null;

export const startScanner = async (onScanSuccess) => {
    toggleModal('modal-scanner', 'show');
    html5QrCode = new Html5Qrcode("reader");
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    
    try {
        await html5QrCode.start(
            { facingMode: "environment" }, 
            config, 
            onScanSuccess
        );
    } catch (err) {
        console.error("Error al iniciar cámara:", err);
        alert("No se pudo acceder a la cámara.");
        toggleModal('modal-scanner', 'hide');
    }
};

export const stopScanner = async () => {
    if (html5QrCode) {
        await html5QrCode.stop();
        html5QrCode = null;
    }
    toggleModal('modal-scanner', 'hide');
};

// Renderizar la tabla administrativa de productos
export const renderDBTable = (productos, onDelete) => {
    const tbody = document.getElementById('tabla-db-body');
    if (!tbody) return;
    tbody.innerHTML = "";

    productos.forEach(p => {
        const tr = document.createElement('tr');
        tr.className = "text-[10px] border-b hover:bg-slate-50 transition-colors";
        tr.innerHTML = `
            <td class="p-3 font-bold uppercase text-slate-700">${p.nombre}</td>
            <td class="p-3 text-center">${p.stock}</td>
            <td class="p-3 text-center text-red-500 font-medium">$${p.costo.toFixed(2)}</td>
            <td class="p-3 text-center text-green-600 font-black">$${p.venta.toFixed(2)}</td>
            <td class="p-3 text-right">
                <button class="btn-delete text-red-300 hover:text-red-600 transition-colors" data-id="${p.id}">
                    ELIMINAR
                </button>
            </td>
        `;
        
        // Listener para el botón borrar
        tr.querySelector('.btn-delete').onclick = () => onDelete(p.id);
        tbody.appendChild(tr);
    });
};
