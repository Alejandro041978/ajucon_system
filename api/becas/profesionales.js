import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

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

  // Obtener nombre del usuario
  const { data: usuario } = await supabase.from('users').select('nombre, email').eq('id', payload.id).single();

  resend.emails.send({
    from: 'AJUCON <noreply@ajucon.org.pe>',
    to: 'admin@balticec.com',
    subject: `Nueva postulación — Beca Profesional`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#d97706,#f59e0b);border-radius:12px;padding:24px;color:white;margin-bottom:24px">
          <h1 style="margin:0 0 4px;font-size:20px">Nueva postulación recibida</h1>
          <p style="margin:0;opacity:.85;font-size:14px">Beca de Estudios Profesionales — AJUCON</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#64748b;width:40%">Nombre</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${usuario?.nombre || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Email</td><td style="padding:8px 0;color:#1e293b">${usuario?.email || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">DNI</td><td style="padding:8px 0;color:#1e293b">${rut}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Fecha de nacimiento</td><td style="padding:8px 0;color:#1e293b">${fecha_nacimiento}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Dirección</td><td style="padding:8px 0;color:#1e293b">${direccion}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Teléfono</td><td style="padding:8px 0;color:#1e293b">${telefono}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Modalidad</td><td style="padding:8px 0;color:#1e293b">${modalidad}${region ? ' — ' + region : ''}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Tipo de institución</td><td style="padding:8px 0;color:#1e293b">${tipo_institucion}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Carrera</td><td style="padding:8px 0;color:#1e293b">${carrera_interes}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Promedio</td><td style="padding:8px 0;color:#1e293b">${promedio_notas}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Situación económica</td><td style="padding:8px 0;color:#1e293b">${situacion_economica}</td></tr>
        </table>
        <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase">Carta de motivación</p>
          <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.6">${motivacion}</p>
        </div>
      </div>`,
  }).catch(() => {});

  return res.status(200).json({ ok: true });
}
