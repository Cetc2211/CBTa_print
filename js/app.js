import { 
    escucharColaImpresion, 
    enviarDocumentoNube, 
    escucharInventarioDB,
    procesarCobroVenta 
} from "./database.js";
import { renderColaImpresion, renderStockRapido, actualizarUIDescuento } from "./ui-controller.js";

// Configuración de Precios CBTa 130
const PRECIOS = { laser_bn: 0.50, smart_tank: 2.00 };
let carrito = [];

// --- LÓGICA DE INICIO DE SESIÓN ---
const verificarSesion = () => {
    const user = localStorage.getItem('usuario_cbta');
    if (!user) {
        document.getElementById('modal-registro').classList.remove('hidden');
    } else {
        if (user === "CECILIO") {
            document.getElementById('panel-admin').classList.remove('hidden');
            iniciarAdmin();
        } else {
            document.getElementById('panel-alumno').classList.remove('hidden');
            document.getElementById('saludo').innerText = `HOLA, ${user}`;
        }
    }
};

// --- PANEL ALUMNO: LECTURA DE PDF Y ENVÍO ---
const inputArchivo = document.getElementById('input-archivo');
const displayPags = document.getElementById('alumno-pags');
const selectImp = document.getElementById('alumno-imp');

inputArchivo?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file && file.type === "application/pdf") {
        const reader = new FileReader();
        reader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            displayPags.value = pdf.numPages;
            actualizarTotalAlumno();
        };
        reader.readAsArrayBuffer(file);
    }
});

const actualizarTotalAlumno = () => {
    const total = (Number(displayPags.value) * PRECIOS[selectImp.value]).toFixed(2);
    document.getElementById('alumno-total').innerText = `$${total}`;
};

selectImp?.addEventListener('change', actualizarTotalAlumno);

document.getElementById('btn-enviar-archivo')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-enviar-archivo');
    btn.disabled = true;
    btn.innerText = "ENVIANDO...";

    const ok = await enviarDocumentoNube({
        usuario: localStorage.getItem('usuario_cbta'),
        archivo: inputArchivo.files[0],
        paginas: displayPags.value,
        tipoImpresion: selectImp.value
    });

    if (ok) {
        document.getElementById('modal-exito').classList.remove('hidden');
    } else {
        alert("Error al enviar archivo.");
        btn.disabled = false;
        btn.innerText = "Enviar al Profr. Cecilio";
    }
});

// --- PANEL ADMIN: GESTIÓN DE COBRO ---
function iniciarAdmin() {
    escucharColaImpresion(snap => {
        const docs = snap.docs.map(d => ({id: d.id, ...d.data()}));
        renderColaImpresion(docs);
    });

    escucharInventarioDB(snap => {
        const prods = snap.docs.map(d => ({id: d.id, ...d.data()}));
        renderStockRapido(prods);
    });
}

window.agregarAlCarrito = (id, nombre, precio, tipo, extra = {}) => {
    carrito.push({ id, nombre, precio, tipo, ...extra });
    renderizarCarrito();
};

function renderizarCarrito() {
    const container = document.getElementById('items-carrito');
    const totalEl = document.getElementById('total-carrito');
    
    container.innerHTML = carrito.map((item, index) => `
        <div class="flex justify-between items-center py-2 border-b">
            <div>
                <p class="font-black">${item.nombre}</p>
                <p class="text-[9px] text-slate-400">${item.tipo === 'impresion' ? item.usuarioAlumno : 'Producto'}</p>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold">$${item.precio.toFixed(2)}</span>
                <button onclick="quitarDelCarrito(${index})" class="text-red-500 font-black">✕</button>
            </div>
        </div>
    `).join("");

    const total = carrito.reduce((acc, cur) => acc + cur.precio, 0);
    totalEl.innerText = `$${total.toFixed(2)}`;
}

window.quitarDelCarrito = (index) => {
    carrito.splice(index, 1);
    renderizarCarrito();
};

document.getElementById('btn-finalizar')?.addEventListener('click', async () => {
    if (carrito.length === 0) return;
    if (confirm("¿Confirmar cobro y finalizar?")) {
        const ok = await procesarCobroVenta(carrito);
        if (ok) {
            carrito = [];
            renderizarCarrito();
            alert("¡Cobro exitoso!");
        }
    }
});

// Inicializar
verificarSesion();
