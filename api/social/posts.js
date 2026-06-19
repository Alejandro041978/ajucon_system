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

  if (req.method === 'GET') {
    const { data } = await supabase
      .from('social_posts')
      .select('id, tema, redes, estado, imagen_url, video_url, aprobado, notas_calidad, publicado_en, creado_por, created_at, captions, brief')
      .order('created_at', { ascending: false })
      .limit(50);
    return res.status(200).json(data || []);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    await supabase.from('social_posts').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
