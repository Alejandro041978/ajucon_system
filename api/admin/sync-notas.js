import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const MOODLE_URL = 'https://campus.ajucon.org.pe';

function autenticado(req) {
  const key = req.headers['x-admin-key'] || req.query.key;
  return key === process.env.ADMIN_SECRET_KEY;
}

async function moodlePost(wsfunction, params) {
  const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${process.env.MOODLE_TOKEN}&wsfunction=${wsfunction}&moodlewsrestformat=json`;
  const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params) });
  return r.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!autenticado(req)) return res.status(401).json({ error: 'No autorizado.' });

  const { data: inscripciones } = await supabase
    .from('inscripciones_cursos')
    .select('id, moodle_user_id, moodle_curso_id')
    .eq('estado', 'aprobado')
    .not('moodle_user_id', 'is', null)
    .not('moodle_curso_id', 'is', null);

  if (!inscripciones || inscripciones.length === 0) {
    return res.status(200).json({ ok: true, actualizados: 0 });
  }

  let actualizados = 0;
  for (const insc of inscripciones) {
    try {
      const result = await moodlePost('gradereport_user_get_grade_items', {
        courseid: String(insc.moodle_curso_id),
        userid: String(insc.moodle_user_id),
      });

      const items = result?.usergrades?.[0]?.gradeitems || [];
      const courseGrade = items.find(g => g.itemtype === 'course');
      if (!courseGrade) continue;

      const raw = courseGrade.percentageformatted || courseGrade.gradeformatted || '';
      const nota = parseFloat(raw.replace('%', '').replace(',', '.').trim());
      if (isNaN(nota)) continue;

      await supabase
        .from('inscripciones_cursos')
        .update({ nota, updated_at: new Date().toISOString() })
        .eq('id', insc.id);

      actualizados++;
    } catch (e) {
      console.error('Error sync nota inscripcion', insc.id, e);
    }
  }

  return res.status(200).json({ ok: true, actualizados });
}
