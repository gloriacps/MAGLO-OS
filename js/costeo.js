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
  const abiertos = new Set(['confeccion']);
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
