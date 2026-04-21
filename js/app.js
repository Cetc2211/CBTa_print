// ... (mismo código inicial de app.js)

function renderCola(snap) {
    const cont = document.getElementById('lista-impresiones');
    if(!cont) return;
    cont.innerHTML = "";
    snap.forEach(docSnap => {
        const d = docSnap.data(); 
        const id = docSnap.id;
        let precioSugerido = (d.tipoImpresion === 'laser_bn') ? 0.50 : calcularPrecioUnitario('color', d.cobertura);

        cont.innerHTML += `<div class="p-3 bg-white border rounded-xl mb-2 shadow-sm border-l-4 ${d.tipoImpresion === 'laser_bn' ? 'border-slate-400' : 'border-indigo-400'}">
            <div class="flex justify-between items-center mb-1">
                <b class="text-[10px] uppercase">${d.usuario}</b>
                <button onclick="window.cancelarArchivo('${id}')" class="text-red-500 font-bold text-xs px-2">✕</button>
            </div>
            <p class="text-[9px] text-slate-500 mb-2 truncate">${d.archivo}</p>
            <div class="flex gap-1">
                <select id="sel-${id}" class="text-[10px] bg-slate-100 border p-1 rounded font-bold flex-1">
                    <option value="0.50" ${precioSugerido == 0.50 ? 'selected' : ''}>B/N ($0.50)</option>
                    <option value="1.00" ${precioSugerido == 1.00 ? 'selected' : ''}>Col. 30% ($1.00)</option>
                    <option value="1.50" ${precioSugerido == 1.50 ? 'selected' : ''}>Col. 50% ($1.50)</option>
                    <option value="2.00" ${precioSugerido == 2.00 ? 'selected' : ''}>Col. 65% ($2.00)</option>
                    <option value="2.50" ${precioSugerido == 2.50 ? 'selected' : ''}>Col. 85% ($2.50)</option>
                    <option value="3.00" ${precioSugerido == 3.00 ? 'selected' : ''}>Col. 100% ($3.00)</option>
                </select>
                <button onclick="window.agregarImpAlCarrito('${id}', '${d.usuario}', ${d.paginas})" class="bg-green-600 text-white px-2 py-1 rounded-lg text-[9px] font-black">+ COBRAR</button>
                <a href="${d.archivoURL}" target="_blank" class="bg-slate-900 text-white px-2 py-1 rounded-lg text-[9px] font-bold text-center flex items-center">VER</a>
            </div></div>`;
    });
}

// NUEVA FUNCIÓN GLOBAL PARA CANCELAR ARCHIVOS ERRÓNEOS
window.cancelarArchivo = async (id) => {
    if(confirm("¿Eliminar este archivo de la cola? No se registrará ningún cobro.")) {
        await db.eliminarRegistro('cola_impresion', id);
    }
};

async function renderFinanzas(snap) {
    const tbody = document.getElementById('tabla-finanzas-body');
    if(!tbody) return;
    
    // Obtenemos también los ingresos de servicios (impresiones) desde Firestore
    // Esto requiere una consulta extra o usar un acumulador en el total
    let totalInv = 0, totalIngProds = 0, totalGan = 0;
    tbody.innerHTML = "";

    snap.forEach(docSnap => {
        const p = docSnap.data();
        const inv = p.gastoAcumulado || (p.stock * p.costo);
        const ing = p.totalDia || 0;
        const gan = ing - inv;
        totalInv += inv; totalIngProds += ing;
        if(gan > 0) totalGan += gan;
        
        tbody.innerHTML += `<tr class="border-b bg-white text-left">
            <td class="p-4 uppercase font-bold">${p.nombre}</td>
            <td class="p-4 text-center">$${inv.toFixed(2)}</td>
            <td class="p-4 text-center">${p.ventasHistoricas || 0}</td>
            <td class="p-4 text-center text-green-600 font-bold">$${ing.toFixed(2)}</td>
            <td class="p-4 text-center"><span class="px-2 py-1 rounded-full text-[8px] font-black ${ing >= inv ? 'bg-green-500 text-white':'bg-amber-100 text-amber-600'}">${ing >= inv ? 'OK':'...'}</span></td>
            <td class="p-4 text-right font-black ${gan > 0 ? 'text-indigo-600':'text-slate-300'}">$${gan.toFixed(2)}</td>
        </tr>`;
    });

    // Para mostrar el total real incluyendo impresiones, actualizamos las etiquetas:
    document.getElementById('fin-inversion-total').innerText = `$${totalInv.toFixed(2)}`;
    document.getElementById('fin-ingresos-totales').innerText = `$${totalIngProds.toFixed(2)}`; 
    // Nota: Aquí podrías sumar los ingresos de impresiones si haces un fetch de 'ingresos_servicios'
}
