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

  if (req.method === 'PATCH') {
    const { id, nombre, apellido, email, grado, ciudad, colegio } = req.body;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (apellido !== undefined) update.apellido = apellido;
    if (email !== undefined) update.email = email;
    if (grado !== undefined) update.grado = grado;
    if (ciudad !== undefined) update.ciudad = ciudad;
    if (colegio !== undefined) update.colegio = colegio;
    const { error } = await supabase.from('users').update(update).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID requerido.' });

  const [
    { data: user },
    { data: riasec },
    { data: tests },
    { data: becas_prof },
    { data: becas_cur },
    { data: convs },
  ] = await Promise.all([
    supabase.from('users').select('*').eq('id', id).single(),
    supabase.from('riasec_profiles').select('*').eq('user_id', id).single(),
    supabase.from('test_results').select('resultado, carreras, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(1),
    supabase.from('becas_profesionales').select('carrera_interes, institucion, estado, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    supabase.from('becas_cursos').select('plataforma, curso_nombre, estado, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    supabase.from('conversations').select('agente, created_at').eq('user_id', id),
  ]);

  return res.status(200).json({
    user,
    riasec: riasec || null,
    test: tests?.[0] || null,
    becas_profesionales: becas_prof || [],
    becas_cursos: becas_cur || [],
    conversaciones: {
      psicologa: convs?.filter(c => c.agente === 'psicologa').length || 0,
      profesor: convs?.filter(c => c.agente === 'profesor').length || 0,
    },
  });
}
