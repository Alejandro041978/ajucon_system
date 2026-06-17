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

  const { rut, fecha_nacimiento, direccion, telefono, carrera_interes, institucion, promedio_notas, situacion_economica, motivacion } = req.body;

  if (!rut || !fecha_nacimiento || !direccion || !telefono || !carrera_interes || !institucion || !promedio_notas || !situacion_economica || !motivacion) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  if (promedio_notas < 1 || promedio_notas > 7) {
    return res.status(400).json({ error: 'El promedio debe estar entre 1 y 7.' });
  }

  const { error } = await supabase.from('becas_profesionales').insert({
    user_id: payload.id,
    rut, fecha_nacimiento, direccion, telefono,
    carrera_interes, institucion,
    promedio_notas, situacion_economica, motivacion,
  });

  if (error) return res.status(500).json({ error: 'Error al guardar la postulación.' });

  return res.status(200).json({ ok: true });
}
