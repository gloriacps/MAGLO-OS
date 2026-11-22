/* MAGLO OS — utilidades compartidas */
const SUPABASE_URL = 'https://sihsdehoxhmrwwrtfsge.supabase.co';
const SUPABASE_KEY = 'sb_publishable__n4vkOpfoRoQ4-OPVDq2Sg_HwfvZZ0x';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const MODULOS = [
  { clave: 'ordenes',     nombre: 'Órdenes',     icono: 'ti-clipboard-list', url: 'ordenes.html' },
  { clave: 'produccion',  nombre: 'Producción',  icono: 'ti-needle-thread',  url: 'produccion.html' },
  { clave: 'nomina',      nombre: 'Nómina',      icono: 'ti-cash',           url: 'nomina.html' },
  { clave: 'costeo',      nombre: 'Costeo',      icono: 'ti-calculator',     url: 'costeo.html' },
  { clave: 'operarios',   nombre: 'Operarios',   icono: 'ti-users',          url: 'operarios.html' },
  { clave: 'clientes',    nombre: 'Clientes',    icono: 'ti-building-store', url: 'clientes.html' },
  { clave: 'operaciones', nombre: 'Operaciones', icono: 'ti-list-details',   url: 'operaciones.html' },
  { clave: 'admin',       nombre: 'Admin',       icono: 'ti-settings',       url: 'admin.html' },
];

let PERFIL = null;

/* Sesión y permisos: llamar al inicio de cada módulo */
async function iniciarModulo(clave) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.href = 'index.html'; return null; }
  const { data: perfil } = await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
  if (!perfil || !perfil.activo) {
    await sb.auth.signOut();
    location.href = 'index.html?inactivo=1';
    return null;
  }
  PERFIL = perfil;
  if (clave && clave !== 'panel' && !tieneAcceso(clave)) {
    alert('No tienes acceso a este módulo.');
    location.href = 'panel.html';
    return null;
  }
  pintarEncabezado();
  return perfil;
}

function tieneAcceso(clave) {
  if (!PERFIL) return false;
  if (PERFIL.es_admin) return true;
  if (clave === 'admin') return false;
  return (PERFIL.modulos || []).includes(clave);
}

function pintarEncabezado() {
  const top = document.createElement('header');
  top.className = 'top';
  const nombre = PERFIL.nombre || PERFIL.email.split('@')[0];
  top.innerHTML = `
    <a class="marca" href="panel.html"><div class="logo">M</div>MAGLO OS</a>
    <div class="der"><span><i class="ti ti-user"></i> ${esc(nombre)}</span>
    <button id="btnSalir"><i class="ti ti-logout"></i> Salir</button></div>`;
  document.body.prepend(top);
  document.getElementById('btnSalir').onclick = async () => { await sb.auth.signOut(); location.href = 'index.html'; };
}

/* Formatos */
const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
function pesos(n) { return '$' + fmt.format(Math.round(Number(n) || 0)); }
function numero(n) { return fmt.format(Math.round(Number(n) || 0)); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function capitalizar(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fechaCorta(f) {
  if (!f) return '';
  const d = new Date(f + (f.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}
function hoyISO() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
/* Lee un valor escrito como "1.200.000" o "1200000" */
function leerNumero(v) { if (v === '' || v == null) return 0; return Number(String(v).replace(/\./g, '').replace(',', '.')) || 0; }

/* Aviso flotante */
function aviso(msg, error = false) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = error ? 'error' : '';
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.display = 'none'), error ? 5000 : 2600);
}
/* Mensaje claro a partir de un error de Supabase */
function mensajeError(e) {
  const m = (e && (e.message || e.error_description)) || 'Algo salió mal';
  if (/duplicate key/i.test(m)) return 'Ese registro ya existe';
  if (/violates foreign key/i.test(m)) return 'No se puede borrar: está siendo usado en otra parte';
  return m;
}

/* Ventana modal sencilla: devuelve el contenedor */
function abrirModal(titulo, html, { ancho } = {}) {
  cerrarModal();
  const f = document.createElement('div');
  f.className = 'modal-fondo';
  f.id = 'modalFondo';
  f.innerHTML = `<div class="modal" ${ancho ? `style="max-width:${ancho}px"` : ''}><h2>${titulo}</h2>${html}</div>`;
  f.addEventListener('mousedown', e => { if (e.target === f) cerrarModal(); });
  document.body.appendChild(f);
  const primero = f.querySelector('input,select,textarea');
  if (primero) setTimeout(() => primero.focus(), 50);
  return f.querySelector('.modal');
}
function cerrarModal() { const f = document.getElementById('modalFondo'); if (f) f.remove(); }

/* Buscador con sugerencias. fuente(texto) -> [{id, texto, extra}] */
function buscador(input, fuente, alElegir) {
  const cont = input.parentElement;
  let lista = null, items = [], act = -1;
  const cerrar = () => { if (lista) { lista.remove(); lista = null; } act = -1; };
  const pintar = () => {
    cerrar();
    if (!items.length) return;
    lista = document.createElement('div');
    lista.className = 'sugerencias';
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.innerHTML = `<span>${esc(it.texto)}</span>${it.extra ? `<b>${esc(it.extra)}</b>` : ''}`;
      d.onmousedown = e => { e.preventDefault(); elegir(i); };
      lista.appendChild(d);
    });
    cont.appendChild(lista);
  };
  const elegir = i => { const it = items[i]; cerrar(); if (it) alElegir(it); };
  input.addEventListener('input', async () => { items = await fuente(input.value.trim()); pintar(); });
  input.addEventListener('focus', async () => { items = await fuente(input.value.trim()); pintar(); });
  input.addEventListener('blur', () => setTimeout(cerrar, 150));
  input.addEventListener('keydown', e => {
    if (!lista) return;
    const divs = lista.querySelectorAll('div');
    if (e.key === 'ArrowDown') { act = Math.min(act + 1, divs.length - 1); }
    else if (e.key === 'ArrowUp') { act = Math.max(act - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); elegir(act < 0 ? 0 : act); return; }
    else if (e.key === 'Escape') { cerrar(); return; }
    else return;
    divs.forEach((d, i) => d.classList.toggle('act', i === act));
  });
}
function normalizar(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/* Pestañas: botones .tab[data-tab] y paneles [data-panel] */
function activarPestanas(alCambiar) {
  document.querySelectorAll('.tab').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('act', x === b));
      document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('oculto', p.dataset.panel !== b.dataset.tab));
      if (alCambiar) alCambiar(b.dataset.tab);
    };
  });
}
