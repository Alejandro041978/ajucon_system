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
  if (req.method !== 'PATCH') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  const { tabla, id, estado } = req.body;
  const tablas = ['becas_profesionales', 'becas_cursos'];
  const estados = ['pendiente', 'en_revision', 'aprobada', 'rechazada'];

  if (!tablas.includes(tabla) || !estados.includes(estado)) {
    return res.status(400).json({ error: 'Datos inválidos.' });
  }

  const { error } = await supabase.from(tabla).update({ estado }).eq('id', id);
  if (error) return res.status(500).json({ error: 'Error al actualizar.' });

  return res.status(200).json({ ok: true });
}
