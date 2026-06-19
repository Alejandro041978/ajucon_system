import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

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

  // GET — listar todos los cursos
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('cursos')
      .select('id, nombre, moodle_curso_id, activo, orden')
      .order('orden', { ascending: true });
    return res.status(200).json(data || []);
  }

  // PATCH — actualizar un curso
  if (req.method === 'PATCH') {
    const { id, nombre, moodle_curso_id, activo } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });

    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (moodle_curso_id !== undefined) update.moodle_curso_id = moodle_curso_id || null;
    if (activo !== undefined) update.activo = activo;

    const { error } = await supabase.from('cursos').update(update).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
