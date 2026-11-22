/* Editor de costeo — se usa en Costeo y dentro de cada Orden */
async function cargarDatosCosteo() {
  const [p, o, t, g, pm, c] = await Promise.all([
    sb.from('procesos').select('*').eq('activo', true).order('orden'),
    sb.from('operaciones').select('*').eq('activo', true).order('nombre'),
    sb.from('v_operaciones_terminacion').select('*'),
    sb.from('costos_adicionales').select('*').eq('activo', true).order('id'),
    sb.from('v_prendas_mes').select('*').maybeSingle(),
    sb.from('configuracion').select('*'),
  ]);
  const err = p.error || o.error || g.error;
  if (err) throw err;
  const term = Object.fromEntries((t.data || []).map(x => [x.operacion_id, Number(x.precio_real)]));
  const cfg = Object.fromEntries((c.data || []).map(x => [x.clave, Number(x.valor)]));
  const prendas = Number(pm.data?.prendas_mes) || cfg.prendas_mes || 1;
  const ops = o.data.map(x => ({ ...x, precio: term[x.id] != null ? term[x.id] : Number(x.precio) }));
  return { procesos: p.data, ops, gastos: g.data, prendas, margen: cfg.margen_ganancia || 0 };
}

/* Crea el editor dentro de `cont`. seleccion: [{operacion_id, cantidad}] o null para uno nuevo */
function crearEditorCosteo(cont, D, seleccion, alCambiar) {
  const sel = new Map();
  const proc = id => D.procesos.find(p => p.id === id);
  const opsDe = pid => D.ops.filter(o => o.proceso_id === pid);
  const abiertos = new Set(); // todo arranca cerrado
  const filtros = {};

  if (seleccion && seleccion.length) seleccion.forEach(s => sel.set(s.operacion_id, Number(s.cantidad)));
  else {
    // Nuevo: terminación, hilos y unida de pretina vienen marcados
    D.procesos.filter(p => p.etapa === 'terminacion' || p.nombre === 'Unida de pretina')
      .forEach(p => opsDe(p.id).forEach(o => sel.set(o.id, 1)));
  }

  const subtotal = pid => opsDe(pid).reduce((s, o) => s + (sel.has(o.id) ? o.precio * sel.get(o.id) : 0), 0);
  const totalEtapa = et => D.procesos.filter(p => p.etapa === et).reduce((s, p) => s + subtotal(p.id), 0);
  const totalPlanta = () => D.gastos.reduce((s, g) => s + Number(g.valor), 0) / D.prendas;
  const costo = () => totalEtapa('confeccion') + totalEtapa('terminacion') + totalPlanta();
  const deberia = () => Math.ceil(costo() * (1 + D.margen / 100) / 50) * 50;

  function pintar() {
    cont.querySelectorAll('details[data-k]').forEach(d => d.open ? abiertos.add(d.dataset.k) : abiertos.delete(d.dataset.k));
    const ab = k => abiertos.has(k) ? 'open' : '';
    const confe = D.procesos.filter(p => p.etapa === 'confeccion');
    const termi = D.procesos.filter(p => p.etapa === 'terminacion');
    cont.innerHTML = `
      <details class="grupo" data-k="confeccion" ${ab('confeccion')}>
        <summary><span><i class="ti ti-chevron-right flecha"></i>Costo de confección</span><span>${pesos(totalEtapa('confeccion'))}</span></summary>
        <div class="cuerpo">${confe.map(p => bloqueProceso(p, ab('p' + p.id))).join('')}</div>
      </details>
      <details class="grupo" data-k="terminacion" ${ab('terminacion')}>
        <summary><span><i class="ti ti-chevron-right flecha"></i>Costo de terminación</span><span>${pesos(totalEtapa('terminacion'))}</span></summary>
        <div class="cuerpo">${termi.map(p => opsDe(p.id).map(o => filaSiNo(o)).join('')).join('')}</div>
      </details>
      <details class="grupo" data-k="planta" ${ab('planta')}>
        <summary><span><i class="ti ti-chevron-right flecha"></i>Costo de planta</span><span>${pesos(totalPlanta())}</span></summary>
        <div class="cuerpo">${D.gastos.map(g => `<div class="entre" style="padding:6px 0;border-bottom:1px solid var(--borde)"><span>${esc(g.nombre)}</span><span>${pesos(g.valor / D.prendas)}</span></div>`).join('')}
          <div class="muted" style="margin-top:8px">Gastos del mes repartidos entre ${numero(D.prendas)} prendas</div></div>
      </details>
      <div class="total-box"><span>Cada prenda cuesta</span><b>${pesos(costo())}</b></div>
      <div class="total-box cel"><span><i class="ti ti-bulb"></i> Debería cobrar</span><b>${pesos(deberia())}</b></div>`;
    enlazar();
    if (alCambiar) alCambiar();
  }

  function bloqueProceso(p, abierto) {
    const ops = opsDe(p.id);
    let cuerpo = '';
    if (p.tipo_seleccion === 'unica') {
      cuerpo = `<div class="opciones">${ops.map(o => `<div class="opcion ${sel.has(o.id) ? 'sel' : ''}" data-unica="${p.id}" data-op="${o.id}">
        ${sel.has(o.id) ? '<i class="ti ti-circle-check"></i>' : '<i class="ti ti-circle"></i>'} ${esc(o.nombre)}<small>${pesos(o.precio)}</small></div>`).join('')}</div>
        <div class="muted" style="margin-top:6px">Elige una sola. Toca otra vez para quitarla.</div>`;
    } else if (p.tipo_seleccion === 'si_no') {
      cuerpo = ops.map(o => filaSiNo(o)).join('');
    } else if (p.tipo_seleccion === 'cantidad') {
      cuerpo = ops.map(o => `<div class="entre"><span>${esc(o.nombre)} · ${pesos(o.precio)} c/u</span>
        <span style="display:flex;align-items:center;gap:10px"><span class="muted">Cantidad</span>
        <input class="cant" data-op="${o.id}" inputmode="numeric" style="width:90px;text-align:right" value="${sel.get(o.id) || ''}" placeholder="0">
        <b style="min-width:80px;text-align:right">${pesos(sel.has(o.id) ? o.precio * sel.get(o.id) : 0)}</b></span></div>`).join('');
    } else {
      // Tabla completa: las marcadas arriba, luego el resto. El buscador solo filtra la tabla.
      const filtro = normalizar(filtros[p.id] || '');
      const orden = [...ops.filter(o => sel.has(o.id)), ...ops.filter(o => !sel.has(o.id))];
      const visibles = orden.filter(o => sel.has(o.id) || !filtro || normalizar(o.nombre).includes(filtro));
      const n = ops.filter(o => sel.has(o.id)).length;
      cuerpo = `<div class="entre" style="margin-bottom:10px">
          <div class="buscador" style="flex:1;max-width:420px"><i class="ti ti-search"></i><input class="filtra-op" data-proc="${p.id}" value="${esc(filtros[p.id] || '')}" placeholder="Filtrar operaciones de ${esc(p.nombre)}"></div>
          <span class="muted">${n} ${n === 1 ? 'marcada' : 'marcadas'}</span></div>
        <table class="tabla"><thead><tr><th style="width:44px"></th><th>Operación</th><th class="num">Valor</th><th class="num" style="width:110px">Cantidad</th><th class="num">Subtotal</th></tr></thead><tbody>
        ${visibles.map(o => { const si = sel.has(o.id); return `<tr style="${si ? 'background:var(--rey-claro)' : ''}">
          <td><button class="icono-btn" data-marca="${o.id}" title="${si ? 'Quitar' : 'Agregar'}" style="color:${si ? 'var(--rey)' : 'var(--texto2)'};font-size:22px"><i class="ti ${si ? 'ti-square-check' : 'ti-square'}"></i></button></td>
          <td style="cursor:pointer" data-marca="${o.id}">${si ? '<b>' + esc(o.nombre) + '</b>' : esc(o.nombre)}</td>
          <td class="num">${pesos(o.precio)}</td>
          <td class="num">${si ? `<input class="cant" data-op="${o.id}" inputmode="numeric" style="width:80px;text-align:right" value="${sel.get(o.id)}">` : ''}</td>
          <td class="num">${si ? `<b>${pesos(o.precio * sel.get(o.id))}</b>` : ''}</td></tr>`; }).join('')}
        </tbody></table>`;
    }
    return `<details class="grupo" data-k="p${p.id}" ${abierto} style="margin-bottom:8px">
      <summary style="background:#fff;font-size:16px"><span><i class="ti ti-chevron-right flecha"></i>${esc(p.nombre)}</span><span>${pesos(subtotal(p.id))}</span></summary>
      <div class="cuerpo">${cuerpo}</div></details>`;
  }

  function filaSiNo(o) {
    const si = sel.has(o.id);
    return `<div class="entre" style="padding:6px 0;border-bottom:1px solid var(--borde)">
      <span>${esc(o.nombre)} <span class="muted">${pesos(o.precio)}</span></span>
      <span class="opciones" style="flex-wrap:nowrap">
        <div class="opcion sino ${si ? 'si-on' : ''}" data-sino="${o.id}" data-v="1">${si ? '<i class="ti ti-check"></i> ' : ''}Sí</div>
        <div class="opcion sino ${!si ? 'no-on' : ''}" data-sino="${o.id}" data-v="0">No</div>
      </span></div>`;
  }

  function enlazar() {
    cont.querySelectorAll('[data-unica]').forEach(el => el.onclick = () => {
      const pid = Number(el.dataset.unica), oid = Number(el.dataset.op);
      const estaba = sel.has(oid);
      opsDe(pid).forEach(o => sel.delete(o.id));
      if (!estaba) sel.set(oid, 1);
      pintar();
    });
    cont.querySelectorAll('[data-sino]').forEach(el => el.onclick = () => {
      const oid = Number(el.dataset.sino);
      el.dataset.v === '1' ? sel.set(oid, 1) : sel.delete(oid);
      pintar();
    });
    cont.querySelectorAll('input.cant').forEach(inp => inp.onchange = () => {
      const oid = Number(inp.dataset.op), v = leerNumero(inp.value);
      v > 0 ? sel.set(oid, v) : sel.delete(oid);
      pintar();
    });
    cont.querySelectorAll('[data-marca]').forEach(b => b.onclick = () => {
      const oid = Number(b.dataset.marca);
      if (sel.has(oid)) { sel.delete(oid); pintar(); return; }
      sel.set(oid, 1); pintar();
      const nuevo = cont.querySelector(`input.cant[data-op="${oid}"]`);
      if (nuevo) { nuevo.focus(); nuevo.select(); }
    });
    cont.querySelectorAll('input.filtra-op').forEach(inp => {
      inp.oninput = () => {
        filtros[inp.dataset.proc] = inp.value;
        const pos = inp.selectionStart;
        pintar();
        const nuevo = cont.querySelector(`input.filtra-op[data-proc="${inp.dataset.proc}"]`);
        if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
      };
    });
  }

  pintar();
  return {
    costo, deberia,
    lineasCotizacion: () => D.procesos.filter(p => p.nombre !== 'Hilos').map(p => ({
      proceso: p.nombre, etapa: p.etapa,
      ops: opsDe(p.id).filter(o => sel.has(o.id)).map(o => ({ nombre: o.nombre, cantidad: sel.get(o.id) })),
    })).filter(x => x.ops.length),
    seleccion: () => [...sel.entries()].map(([operacion_id, cantidad]) => ({
      operacion_id, cantidad, precio: D.ops.find(o => o.id === operacion_id)?.precio || 0,
    })),
    procesosConOperario: () => D.procesos.filter(p => p.requiere_operario && subtotal(p.id) > 0),
  };
}

/* Guarda la selección de un costeo (borra lo anterior y escribe lo nuevo) */
async function guardarSeleccionCosteo(costeoId, seleccion) {
  const { error: e1 } = await sb.from('costeo_operaciones').delete().eq('costeo_id', costeoId);
  if (e1) throw e1;
  if (seleccion.length) {
    const { error: e2 } = await sb.from('costeo_operaciones').insert(seleccion.map(s => ({ costeo_id: costeoId, ...s })));
    if (e2) throw e2;
  }
}

/* Lleva la misma selección a todos los costeos con esa referencia: el guardado y las órdenes en producción.
   Las órdenes finalizadas no se tocan, para no cambiar la historia. */
async function sincronizarCosteos(referencia, clienteId, seleccion, exceptoId) {
  const ref = String(referencia || '').trim();
  if (!ref) return 0;
  const { data, error } = await sb.from('costeos').select('id, cliente_id, referencia, orden_id, ordenes(estado, cliente_id)').ilike('referencia', ref);
  if (error) throw error;
  const destino = (data || []).filter(c => {
    if (c.id === exceptoId || normalizar(c.referencia) !== normalizar(ref)) return false;
    if (c.orden_id) return c.ordenes?.estado === 'produccion' && (!clienteId || c.ordenes?.cliente_id === clienteId);
    return !c.cliente_id || !clienteId || c.cliente_id === clienteId;
  });
  for (const c of destino) await guardarSeleccionCosteo(c.id, seleccion);
  return destino.length;
}

/* Cotización en PDF: operaciones sin costos, solo el precio a cobrar */
function pedirDatosCotizacion(deberia, alGenerar) {
  const m = abrirModal('Cotización en PDF', `
    <div class="fila"><div><label>Precio por prenda</label><input id="qPrecio" inputmode="numeric" value="${numero(deberia)}"></div>
    <div><label>Cantidad (opcional)</label><input id="qCant" inputmode="numeric" placeholder="Ej: 200"></div></div>
    <div class="fila"><div><label>Válida por (días)</label><input id="qDias" inputmode="numeric" value="15"></div><div></div></div>
    <div class="campo"><label>Notas (opcional)</label><textarea id="qNotas" rows="2" placeholder="Ej: La tela y los insumos los entrega la marca"></textarea></div>
    <div id="qErr" class="err"></div>
    <div class="acciones"><button class="btn sec" onclick="cerrarModal()">Cancelar</button><button class="btn" id="qGen"><i class="ti ti-file-download"></i> Descargar PDF</button></div>`);
  m.querySelector('#qGen').onclick = async () => {
    const precio = leerNumero(m.querySelector('#qPrecio').value);
    if (!precio) return (m.querySelector('#qErr').textContent = 'Escribe el precio por prenda');
    const btn = m.querySelector('#qGen'); btn.disabled = true; btn.textContent = 'Generando...';
    await alGenerar({ precio, cantidad: leerNumero(m.querySelector('#qCant').value), dias: leerNumero(m.querySelector('#qDias').value) || 15, notas: m.querySelector('#qNotas').value.trim() });
    cerrarModal();
  };
}
async function generarCotizacionPDF({ cliente, referencia, prenda, lineas, precio, cantidad, dias, notas }) {
  const hoy = new Date();
  const vence = new Date(); vence.setDate(vence.getDate() + dias);
  const f = d => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
  const bloque = (titulo, ls) => ls.length ? `<div style="margin-top:14px"><div style="font-weight:800;color:#1E40AF;font-size:15px;border-bottom:2px solid #1E40AF;padding-bottom:4px;margin-bottom:6px">${titulo}</div>
    ${ls.map(l => `<div style="display:flex;gap:10px;padding:5px 0;border-bottom:1px solid #E3E8F2"><div style="width:150px;font-weight:700">${esc(l.proceso)}</div>
      <div style="flex:1">${l.ops.map(o => esc(o.nombre) + (o.cantidad > 1 ? ` <span style="color:#4A5675">(x${numero(o.cantidad)})</span>` : '')).join(' · ')}</div></div>`).join('')}</div>` : '';
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;font-family:"Nunito Sans",Arial,sans-serif;color:#0F1E4D;font-size:14px';
  div.innerHTML = `
    <div style="background:#1E40AF;color:#fff;padding:26px 36px;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:12px"><div style="width:46px;height:46px;border-radius:11px;background:#fff;color:#1E40AF;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:26px">M</div>
      <div><div style="font-size:24px;font-weight:900;letter-spacing:1px">MAGLO</div><div style="font-size:13px;color:#DCE6FB">Confecciones</div></div></div>
      <div style="text-align:right"><div style="font-size:26px;font-weight:900">COTIZACIÓN</div><div style="font-size:13px;color:#DCE6FB">${f(hoy)}</div></div>
    </div>
    <div style="padding:26px 36px">
      <div style="display:flex;gap:16px">
        <div style="flex:1;background:#EEF2FC;border-radius:10px;padding:12px 16px"><div style="font-size:12px;color:#4A5675;font-weight:700">CLIENTE</div><div style="font-size:17px;font-weight:800">${esc(cliente || '—')}</div></div>
        <div style="flex:1;background:#EEF2FC;border-radius:10px;padding:12px 16px"><div style="font-size:12px;color:#4A5675;font-weight:700">REFERENCIA</div><div style="font-size:17px;font-weight:800">${esc(referencia || '—')}</div>${prenda ? `<div>${esc(prenda)}</div>` : ''}</div>
      </div>
      ${bloque('Operaciones de confección', lineas.filter(l => l.etapa === 'confeccion'))}
      ${bloque('Terminación', lineas.filter(l => l.etapa === 'terminacion'))}
      <div style="margin-top:22px;background:#1E40AF;color:#fff;border-radius:12px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:16px">Precio por prenda</div><div style="font-size:26px;font-weight:900">${pesos(precio)}</div></div>
      ${cantidad ? `<div style="margin-top:8px;background:#E3F6FD;color:#005F86;border-radius:12px;padding:12px 20px;display:flex;justify-content:space-between"><div>${numero(cantidad)} unidades</div><div style="font-weight:900;font-size:18px">${pesos(precio * cantidad)}</div></div>` : ''}
      ${notas ? `<div style="margin-top:16px"><b>Notas:</b> ${esc(notas)}</div>` : ''}
      <div style="margin-top:22px;color:#4A5675;font-size:12px">Cotización válida hasta el ${f(vence)}.</div>
    </div>`;
  document.body.appendChild(div);
  try {
    const canvas = await html2canvas(div, { scale: 2, backgroundColor: '#ffffff' });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const w = pdf.internal.pageSize.getWidth(), h = canvas.height * w / canvas.width;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
    pdf.save(`Cotizacion ${referencia || ''} ${cliente || ''}`.trim().replace(/\s+/g, ' ') + '.pdf');
  } catch (e) { aviso('No se pudo crear el PDF', true); }
  div.remove();
}
