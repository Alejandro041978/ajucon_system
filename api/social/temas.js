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
      .from('social_temas')
      .select('*')
      .order('orden');
    const { data: cfg } = await supabase
      .from('social_config')
      .select('valor')
      .eq('clave', 'social_tema_index')
      .single();
    return res.status(200).json({ temas: data || [], index: parseInt(cfg?.valor || '0') });
  }

  if (req.method === 'POST') {
    const { tema, orden } = req.body;
    if (!tema) return res.status(400).json({ error: 'Tema requerido.' });
    const { data, error } = await supabase
      .from('social_temas')
      .insert({ tema, orden: orden || 99, activo: true })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const { id, tema, orden, activo } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const { data, error } = await supabase
      .from('social_temas')
      .update({ tema, orden, activo })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    await supabase.from('social_temas').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
