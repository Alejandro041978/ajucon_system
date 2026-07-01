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
    const { data, error } = await supabase
      .from('convenios')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  if (req.method === 'POST') {
    const { institucion, tipo, ciudad, region, nombre_contacto, correo_contacto, telefono_contacto, activo } = req.body;
    if (!institucion || !tipo) return res.status(400).json({ error: 'Institución y tipo son requeridos.' });
    const { data, error } = await supabase.from('convenios').insert({
      institucion, tipo, ciudad: ciudad || null, region: region || null,
      nombre_contacto: nombre_contacto || null, correo_contacto: correo_contacto || null,
      telefono_contacto: telefono_contacto || null, activo: activo !== false,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { id, ...campos } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const { error } = await supabase.from('convenios').update(campos).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const { error } = await supabase.from('convenios').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
