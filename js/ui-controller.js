export const toggleModal = (id, action) => {
    const el = document.getElementById(id);
    if (el) action === 'show' ? el.classList.remove('hidden') : el.classList.add('hidden');
};

export const renderColaImpresion = (docs) => {
    const lista = document.getElementById('lista-impresiones');
    if (!lista) return;

    lista.innerHTML = docs.map(doc => {
        const precio = doc.tipoImpresion === 'laser_bn' ? 0.5 : 2.0;
        const total = (doc.paginas * precio).toFixed(2);
        const label = doc.tipoImpresion === 'laser_bn' ? 'HP LÁSER B/N' : 'SMART TANK COLOR';

        return `
        <div class="bg-slate-50 p-4 rounded-[1.5rem] border-2 border-slate-100 flex justify-between items-center">
            <div class="max-w-[60%]">
                <p class="text-[10px] font-black uppercase truncate text-indigo-600">${doc.archivo}</p>
                <p class="text-[9px] font-bold text-slate-800">${doc.usuario}</p>
                <p class="text-[8px] text-slate-400 font-bold uppercase">${label} • ${doc.paginas} PÁGS</p>
            </div>
            <div class="flex gap-2">
                <a href="${doc.archivoURL}" target="_blank" class="bg-white border p-2 rounded-xl shadow-sm">👁️</a>
                <button onclick="window.agregarAlCarrito('${doc.id}', 'IMP. ${doc.paginas} PÁGS', ${total}, 'impresion', {usuarioAlumno: '${doc.usuario}', numPags: ${doc.paginas}, labelServicio: '${label}'})" 
                        class="bg-indigo-600 text-white px-3 py-2 rounded-xl font-black text-[9px] uppercase shadow-md active:scale-95">
                    $${total}
                </button>
            </div>
        </div>`;
    }).join("");
};

export const renderStockRapido = (prods) => {
    const lista = document.getElementById('lista-stock-rapido');
    if (!lista) return;

    lista.innerHTML = prods.map(p => `
        <button onclick="window.agregarAlCarrito('${p.id}', '${p.nombre}', ${p.venta}, 'producto')" 
                class="w-full bg-white p-3 rounded-2xl border mb-1 flex justify-between items-center hover:border-indigo-500 transition-all text-left group">
            <div class="flex flex-col">
                <span class="text-[10px] font-black uppercase group-hover:text-indigo-600">${p.nombre}</span>
                <span class="text-[8px] font-bold ${p.stock < 5 ? 'text-red-500' : 'text-slate-400'} uppercase">Stock: ${p.stock}</span>
            </div>
            <span class="font-black text-xs text-slate-900">$${p.venta.toFixed(2)}</span>
        </button>
    `).join("");
};
