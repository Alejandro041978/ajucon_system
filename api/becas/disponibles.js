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
  // GET es público (usuarios lo consumen sin token)
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('becas_disponibles')
      .select('*')
      .eq('activo', true)
      .order('orden', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // El resto requiere admin
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  if (req.method === 'POST') {
    const { nombre, institucion, cantidad_disponible, condicion_requisitos, monto_total, vigencia, beneficio, carreras_disponibles, modalidad_estudios, orden, email_institucion } = req.body;
    if (!nombre || !institucion) return res.status(400).json({ error: 'Nombre e institución son requeridos.' });
    const { data, error } = await supabase
      .from('becas_disponibles')
      .insert({ nombre, institucion, cantidad_disponible, condicion_requisitos, monto_total, vigencia: vigencia || null, beneficio, carreras_disponibles: carreras_disponibles || null, modalidad_estudios: modalidad_estudios || null, orden: orden || 99, activo: true, email_institucion: email_institucion || null })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const { id, nombre, institucion, cantidad_disponible, condicion_requisitos, monto_total, vigencia, beneficio, carreras_disponibles, modalidad_estudios, orden, activo, email_institucion } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const { data, error } = await supabase
      .from('becas_disponibles')
      .update({ nombre, institucion, cantidad_disponible, condicion_requisitos, monto_total, vigencia: vigencia || null, beneficio, carreras_disponibles: carreras_disponibles || null, modalidad_estudios: modalidad_estudios || null, orden, activo, email_institucion: email_institucion || null })
      .eq('id', id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    await supabase.from('becas_disponibles').delete().eq('id', id);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
