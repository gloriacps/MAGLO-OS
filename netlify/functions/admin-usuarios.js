// Crea usuarios y cambia claves. Solo lo pueden usar administradoras con sesión iniciada.
// Variables de entorno en Netlify: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY
const URL_SB = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const json = (status, body) => ({ statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function sbAdmin(path, opts = {}) {
  const r = await fetch(URL_SB + path, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const texto = await r.text();
  let data = null;
  try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; }
  return { ok: r.ok, status: r.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido' });
  if (!URL_SB || !KEY) return json(500, { error: 'Faltan las variables SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Netlify' });

  // 1. Verificar quién llama
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sin sesión' });
  const yo = await fetch(URL_SB + '/auth/v1/user', { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  if (!yo.ok) return json(401, { error: 'Sesión vencida, vuelve a entrar' });
  const usuario = await yo.json();
  const perfil = await sbAdmin(`/rest/v1/perfiles?id=eq.${usuario.id}&select=es_admin,activo`);
  if (!perfil.ok || !perfil.data?.[0]?.es_admin || !perfil.data[0].activo) return json(403, { error: 'Solo una administradora puede hacer esto' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Datos inválidos' }); }

  // 2. Crear usuario
  if (body.accion === 'crear') {
    const email = String(body.email || '').trim().toLowerCase();
    const clave = String(body.clave || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Correo inválido' });
    if (clave.length < 6) return json(400, { error: 'La clave debe tener mínimo 6 caracteres' });
    const r = await sbAdmin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password: clave, email_confirm: true }) });
    if (!r.ok) {
      const msg = r.data?.msg || r.data?.message || r.data?.error_description || 'No se pudo crear el usuario';
      return json(400, { error: /already/i.test(msg) ? 'Ya existe un usuario con ese correo' : msg });
    }
    const id = r.data.id;
    const upd = await sbAdmin(`/rest/v1/perfiles?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ nombre: body.nombre || null, es_admin: !!body.es_admin, modulos: Array.isArray(body.modulos) ? body.modulos : [] }),
    });
    if (!upd.ok) return json(500, { error: 'El usuario se creó pero no se guardaron sus permisos' });
    return json(200, { ok: true, id });
  }

  // 3. Cambiar clave
  if (body.accion === 'clave') {
    const clave = String(body.clave || '');
    if (clave.length < 6) return json(400, { error: 'La clave debe tener mínimo 6 caracteres' });
    const r = await sbAdmin(`/auth/v1/admin/users/${encodeURIComponent(body.id)}`, { method: 'PUT', body: JSON.stringify({ password: clave }) });
    if (!r.ok) return json(400, { error: 'No se pudo cambiar la clave' });
    return json(200, { ok: true });
  }

  return json(400, { error: 'Acción desconocida' });
};
