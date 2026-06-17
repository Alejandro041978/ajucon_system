import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'No autorizado.' });

  let payload;
  try {
    payload = jwt.verify(auth, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const { data } = await supabase
    .from('test_results')
    .select('resultado, carreras, respuestas, created_at')
    .eq('user_id', payload.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data) return res.status(200).json({ resultado: null });

  return res.status(200).json(data);
}
