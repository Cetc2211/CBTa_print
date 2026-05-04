export const toggleModal = (id, action) => {
    const el = document.getElementById(id);
    if (el) action === 'show' ? el.classList.remove('hidden') : el.classList.add('hidden');
};

export const renderDBTable = (prods) => {
    const tbody = document.getElementById('tabla-db-body');
    if (!tbody) return;
    
    if (!prods || prods.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-5 text-center text-gray-400 font-bold uppercase text-[10px]">Sin productos</td></tr>`;
        return;
    }

    tbody.innerHTML = prods.map(p => `
        <tr class="border-b hover:bg-slate-50 transition-colors">
            <td class="p-3 font-bold uppercase text-left text-slate-700">${p.nombre}</td>
            <td class="p-3 text-center font-bold">${p.stock || 0}</td>
            <td class="p-3 text-center text-red-500 font-bold">$${(p.costo || 0).toFixed(2)}</td>
            <td class="p-3 text-center text-green-600 font-bold">$${(p.venta || 0).toFixed(2)}</td>
            <td class="p-3 text-right">
                <div class="flex gap-2 justify-end">
                    <button onclick="window.prepararEdicion('${p.id}')" class="bg-amber-100 text-amber-600 px-3 py-1 rounded-lg font-black uppercase text-[9px]">Editar</button>
                    <button onclick="window.eliminarProducto('${p.id}')" class="bg-red-100 text-red-500 px-3 py-1 rounded-lg font-bold text-lg">✕</button>
                </div>
            </td>
        </tr>`).join("");
};
