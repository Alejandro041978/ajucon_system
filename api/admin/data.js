import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' ? p : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  const { seccion } = req.query;

  if (seccion === 'users') {
    const { data } = await supabase
      .from('users')
      .select('id, nombre, email, grado, ciudad, colegio, created_at')
      .order('created_at', { ascending: false });
    return res.status(200).json(data);
  }

  if (seccion === 'becas_profesionales') {
    const { data } = await supabase
      .from('becas_profesionales')
      .select('*, users(nombre, email)')
      .order('created_at', { ascending: false });
    return res.status(200).json(data);
  }

  if (seccion === 'becas_cursos') {
    const { data } = await supabase
      .from('inscripciones_cursos')
      .select('*, users(nombre, apellido, email)')
      .order('created_at', { ascending: false });
    return res.status(200).json(data);
  }

  if (seccion === 'test_results') {
    const { data } = await supabase
      .from('test_results')
      .select('id, resultado, carreras, created_at, users(nombre, email)')
      .order('created_at', { ascending: false });
    return res.status(200).json(data);
  }

  if (seccion === 'riasec') {
    const { data } = await supabase
      .from('riasec_profiles')
      .select('*, users(nombre, email, grado)')
      .order('completitud', { ascending: false });
    return res.status(200).json(data);
  }

  if (seccion === 'prompt_suggestions') {
    const { data } = await supabase
      .from('prompt_suggestions')
      .select('id, analisis, sugerencias, convs_analizadas, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    return res.status(200).json({ rows: data || [] });
  }

  if (seccion === 'stats') {
    const [u, bp, bc, tr] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('becas_profesionales').select('id', { count: 'exact', head: true }),
      supabase.from('inscripciones_cursos').select('id', { count: 'exact', head: true }),
      supabase.from('test_results').select('id', { count: 'exact', head: true }),
    ]);
    return res.status(200).json({
      usuarios: u.count,
      becas_profesionales: bp.count,
      becas_cursos: bc.count,
      test_results: tr.count,
    });
  }

  return res.status(400).json({ error: 'Sección no válida.' });
}
