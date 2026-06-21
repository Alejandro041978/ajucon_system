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
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  if (req.method === 'DELETE') {
    const { tabla, id } = req.query;
    const tablas = ['becas_profesionales', 'inscripciones_cursos', 'users'];
    if (!tablas.includes(tabla) || !id) return res.status(400).json({ error: 'Parámetros inválidos.' });
    const { error } = await supabase.from(tabla).delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).end();

  const { seccion } = req.query;

  if (seccion === 'users') {
    const { data } = await supabase
      .from('users')
      .select('id, nombre, apellido, email, grado, ciudad, colegio, created_at')
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
    const { periodo } = req.query; // 'semana' | 'mes' | 'acumulado'

    // Calcular fecha de inicio según periodo (zona horaria Lima UTC-5)
    let desde = null;
    if (periodo === 'semana' || periodo === 'mes') {
      const now = new Date();
      // Ajustar a Lima (UTC-5)
      const lima = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      if (periodo === 'semana') {
        // Lunes de la semana vigente
        const day = lima.getUTCDay(); // 0=dom,1=lun...6=sab
        const diffToMonday = (day === 0 ? -6 : 1 - day);
        const monday = new Date(lima);
        monday.setUTCDate(lima.getUTCDate() + diffToMonday);
        monday.setUTCHours(0, 0, 0, 0);
        desde = monday.toISOString();
      } else {
        // Primer día del mes actual
        desde = new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), 1)).toISOString();
      }
    }

    function applyDesde(query, col = 'created_at') {
      return desde ? query.gte(col, desde) : query;
    }

    const [u, bp, bc, tr, rv, spManual, spAuto] = await Promise.all([
      applyDesde(supabase.from('users').select('id', { count: 'exact', head: true })),
      applyDesde(supabase.from('becas_profesionales').select('id', { count: 'exact', head: true })),
      applyDesde(supabase.from('inscripciones_cursos').select('id', { count: 'exact', head: true })),
      applyDesde(supabase.from('test_results').select('id', { count: 'exact', head: true })),
      applyDesde(supabase.from('reportes_vocacionales').select('id', { count: 'exact', head: true })),
      applyDesde(supabase.from('social_posts').select('id', { count: 'exact', head: true }).eq('estado', 'publicado').neq('creado_por', 'auto'), 'publicado_en'),
      applyDesde(supabase.from('social_posts').select('id', { count: 'exact', head: true }).eq('estado', 'publicado').eq('creado_por', 'auto'), 'publicado_en'),
    ]);
    return res.status(200).json({
      usuarios: u.count,
      becas_profesionales: bp.count,
      becas_cursos: bc.count,
      test_results: tr.count,
      reportes_ia: rv.count,
      social_manual: spManual.count,
      social_auto: spAuto.count,
      periodo: periodo || 'acumulado',
    });
  }

  return res.status(400).json({ error: 'Sección no válida.' });
}
