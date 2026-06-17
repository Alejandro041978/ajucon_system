import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'No autorizado.' });

  let payload;
  try {
    payload = jwt.verify(auth, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const { plataforma, curso_nombre, curso_url, justificacion } = req.body;

  if (!plataforma || !curso_nombre || !justificacion) {
    return res.status(400).json({ error: 'Plataforma, nombre del curso y justificación son requeridos.' });
  }

  const { error } = await supabase.from('becas_cursos').insert({
    user_id: payload.id,
    plataforma, curso_nombre,
    curso_url: curso_url || null,
    justificacion,
  });

  if (error) return res.status(500).json({ error: 'Error al guardar la solicitud.' });

  return res.status(200).json({ ok: true });
}
