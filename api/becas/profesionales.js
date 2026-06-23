import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PUNTAJE_MINIMO = 65;

async function evaluarConIA(postulacionId, datos) {
  const { promedio_notas, situacion_economica, motivacion, carrera_interes, modalidad,
    beca_nombre, beca_institucion, condicion_requisitos, nombre_usuario } = datos;

  const prompt = `Eres un evaluador de becas académicas de AJUCON, plataforma peruana de orientación vocacional.

Evalúa la siguiente postulación y devuelve SOLO un JSON válido con este formato exacto:
{"puntaje": <número 0-100>, "aprobada": <true/false>, "evaluacion": "<texto breve en español>"}

Criterios de evaluación:
- Promedio de notas (escala 0-20): peso 40%. Promedio >= 14 es bueno, >= 16 excelente. Promedio < 12 es deficiente.
- Situación económica: peso 30%. "Muy vulnerable" = máximo puntaje, "Vulnerable" = bueno, "Media-baja" = regular.
- Carta de motivación: peso 30%. Evalúa claridad, coherencia, metas concretas y genuinidad.
- Puntaje mínimo para aprobar: ${PUNTAJE_MINIMO}/100.

Datos de la postulación:
- Beca: ${beca_nombre || 'No especificada'}
- Institución: ${beca_institucion || 'No especificada'}
- Requisitos de la beca: ${condicion_requisitos || 'No especificados'}
- Carrera de interés: ${carrera_interes}
- Modalidad: ${modalidad}
- Promedio de notas: ${promedio_notas}/20
- Situación económica: ${situacion_economica}
- Carta de motivación: "${motivacion}"

Responde SOLO con el JSON, sin texto adicional.`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const texto = msg.content[0].text.trim();
  const resultado = JSON.parse(texto);

  const estado = resultado.aprobada ? 'aprobada' : 'rechazada';
  await supabase.from('becas_profesionales').update({
    puntaje_ia: resultado.puntaje,
    evaluacion_ia: resultado.evaluacion,
    estado,
  }).eq('id', postulacionId);
}

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

  const { rut, fecha_nacimiento, direccion, telefono, carrera_interes, modalidad, region,
    promedio_notas, situacion_economica, motivacion, beca_id, beca_nombre, beca_institucion, documentos } = req.body;

  if (!rut || !fecha_nacimiento || !direccion || !telefono || !carrera_interes || !modalidad || !promedio_notas || !situacion_economica || !motivacion) {
    return res.status(400).json({ error: 'Todos los campos son requeridos.' });
  }
  if (!region) return res.status(400).json({ error: 'Debes seleccionar tu ciudad / región.' });
  if (promedio_notas < 0 || promedio_notas > 20) return res.status(400).json({ error: 'El promedio debe estar entre 0 y 20.' });

  const { data: postulacion, error } = await supabase.from('becas_profesionales').insert({
    user_id: payload.id,
    rut, fecha_nacimiento, direccion, telefono,
    carrera_interes, modalidad, region: region || null,
    promedio_notas, situacion_economica, motivacion,
    beca_id: beca_id || null,
    beca_nombre: beca_nombre || null,
    beca_institucion: beca_institucion || null,
    documentos: documentos || null,
    estado: 'pendiente',
  }).select('id').single();

  if (error) return res.status(500).json({ error: 'Error al guardar la postulación.' });

  const { data: usuario } = await supabase.from('users').select('nombre, email').eq('id', payload.id).single();

  // Obtener requisitos de la beca para el contexto de la IA
  let condicion_requisitos = null;
  if (beca_id) {
    const { data: beca } = await supabase.from('becas_disponibles').select('condicion_requisitos').eq('id', beca_id).single();
    condicion_requisitos = beca?.condicion_requisitos || null;
  }

  // Evaluación IA en segundo plano (no bloquea la respuesta)
  evaluarConIA(postulacion.id, {
    promedio_notas, situacion_economica, motivacion, carrera_interes, modalidad,
    beca_nombre, beca_institucion, condicion_requisitos, nombre_usuario: usuario?.nombre,
  }).catch(err => console.error('[IA EVAL ERROR]', err.message));

  // Email confirmación al usuario
  resend.emails.send({
    from: 'AJUCON <noreply@ajucon.org.pe>',
    to: usuario?.email,
    subject: `Tu postulación fue recibida — ${beca_nombre || 'Beca Profesional'}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#d97706,#f59e0b);border-radius:12px;padding:24px;color:white;margin-bottom:24px">
          <h1 style="margin:0 0 4px;font-size:20px">¡Postulación recibida! 🎓</h1>
          <p style="margin:0;opacity:.85;font-size:14px">AJUCON — Becas de Estudios Profesionales</p>
        </div>
        <p style="color:#1e293b;font-size:15px">Hola <strong>${usuario?.nombre || ''}</strong>,</p>
        <p style="color:#475569;font-size:14px;line-height:1.6">Hemos recibido tu postulación con éxito. Aquí el resumen:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          ${beca_nombre ? `<tr><td style="padding:8px 0;color:#64748b;width:40%">Beca</td><td style="padding:8px 0;color:#d97706;font-weight:700">${beca_nombre}</td></tr>` : ''}
          ${beca_institucion ? `<tr><td style="padding:8px 0;color:#64748b">Institución</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${beca_institucion}</td></tr>` : ''}
          <tr><td style="padding:8px 0;color:#64748b">Carrera</td><td style="padding:8px 0;color:#1e293b">${carrera_interes}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Modalidad</td><td style="padding:8px 0;color:#1e293b">${modalidad}</td></tr>
        </table>
        <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin:20px 0">
          <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6">⏳ Evaluaremos tu postulación y recibirás una respuesta en un plazo de <strong>24 horas</strong>.</p>
        </div>
        <p style="color:#94a3b8;font-size:13px">Si tienes alguna consulta puedes responder a este correo.<br>— Equipo AJUCON</p>
      </div>`,
  }).catch(() => {});

  // Email notificación al administrador
  resend.emails.send({
    from: 'AJUCON <noreply@ajucon.org.pe>',
    to: 'admin@balticec.com',
    subject: `Nueva postulación — ${beca_nombre || 'Beca Profesional'}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#d97706,#f59e0b);border-radius:12px;padding:24px;color:white;margin-bottom:24px">
          <h1 style="margin:0 0 4px;font-size:20px">Nueva postulación recibida</h1>
          <p style="margin:0;opacity:.85;font-size:14px">Beca de Estudios Profesionales — AJUCON</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:8px 0;color:#64748b;width:40%">Nombre</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${usuario?.nombre || '—'}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Email</td><td style="padding:8px 0;color:#1e293b">${usuario?.email || '—'}</td></tr>
          ${beca_nombre ? `<tr><td style="padding:8px 0;color:#64748b;font-weight:700">Beca</td><td style="padding:8px 0;color:#d97706;font-weight:700">${beca_nombre}</td></tr>` : ''}
          ${beca_institucion ? `<tr><td style="padding:8px 0;color:#64748b">Institución</td><td style="padding:8px 0;color:#1e293b">${beca_institucion}</td></tr>` : ''}
          <tr><td style="padding:8px 0;color:#64748b">DNI</td><td style="padding:8px 0;color:#1e293b">${rut}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Carrera</td><td style="padding:8px 0;color:#1e293b">${carrera_interes}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b">Promedio</td><td style="padding:8px 0;color:#1e293b">${promedio_notas}/20</td></tr>
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
