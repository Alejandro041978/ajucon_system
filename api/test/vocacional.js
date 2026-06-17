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

  const { respuestas, resultado, carreras, scores } = req.body;

  if (!respuestas || !resultado || !carreras) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }

  const { error } = await supabase.from('test_results').insert({
    user_id: payload.id,
    respuestas,
    resultado,
    carreras,
    scores: scores || null,
  });

  if (error) {
    console.error('test_results insert error:', error);
    return res.status(500).json({ error: 'Error al guardar resultado.', detail: error.message });
  }

  return res.status(200).json({ ok: true });
}
