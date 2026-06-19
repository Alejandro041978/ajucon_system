import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' ? p : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  // GET — listar admins
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('admin_users')
      .select('id, nombre, apellido, email, activo, created_at')
      .order('created_at', { ascending: false });
    return res.status(200).json(data || []);
  }

  // POST — crear admin
  if (req.method === 'POST') {
    const { nombre, apellido, email, password } = req.body;
    if (!nombre || !apellido || !email || !password) {
      return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('admin_users').insert({ nombre, apellido, email, password_hash, activo: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // PATCH — editar admin
  if (req.method === 'PATCH') {
    const { id, nombre, apellido, email, password, activo } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (apellido !== undefined) update.apellido = apellido;
    if (email !== undefined) update.email = email;
    if (activo !== undefined) update.activo = activo;
    if (password) update.password_hash = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('admin_users').update(update).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
