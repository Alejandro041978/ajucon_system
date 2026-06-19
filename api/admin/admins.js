import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function verifySuperAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' && p.rol === 'super_admin' ? p : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (!verifySuperAdmin(req)) return res.status(403).json({ error: 'Solo el super administrador puede gestionar administradores.' });

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('admin_users')
      .select('id, nombre, apellido, email, rol, permisos, activo, created_at')
      .order('created_at', { ascending: false });
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const { nombre, apellido, email, rol } = req.body;
    if (!nombre || !apellido || !email) {
      return res.status(400).json({ error: 'Nombre, apellido y email son requeridos.' });
    }
    const { error } = await supabase.from('admin_users').insert({
      nombre, apellido, email, rol: rol || 'admin', activo: true,
    });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { id, nombre, apellido, email, rol, permisos, activo } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (apellido !== undefined) update.apellido = apellido;
    if (email !== undefined) update.email = email;
    if (rol !== undefined) update.rol = rol;
    if (permisos !== undefined) update.permisos = permisos;
    if (activo !== undefined) update.activo = activo;
    const { error } = await supabase.from('admin_users').update(update).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
