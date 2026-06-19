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

  const { rut, fecha_nacimiento, direccion, telefono, tipo_institucion, carrera_interes, modalidad, region, promedio_notas, situacion_economica, motivacion } = req.body;

  if (!rut || !fecha_nacimiento || !direccion || !telefono || !tipo_institucion || !carrera_interes || !modalidad || !promedio_notas || !situacion_economica || !motivacion) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }

  if (modalidad === 'Presencial' && !region) {
    return res.status(400).json({ error: 'Debes seleccionar la región donde estudiarías.' });
  }

  if (promedio_notas < 0 || promedio_notas > 20) {
    return res.status(400).json({ error: 'El promedio debe estar entre 0 y 20.' });
  }

  const { error } = await supabase.from('becas_profesionales').insert({
    user_id: payload.id,
    rut, fecha_nacimiento, direccion, telefono,
    tipo_institucion, carrera_interes, modalidad, region: region || null,
    promedio_notas, situacion_economica, motivacion,
  });

  if (error) return res.status(500).json({ error: 'Error al guardar la postulación.' });

  return res.status(200).json({ ok: true });
}
