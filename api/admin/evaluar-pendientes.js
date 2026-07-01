import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { sendEmail } from '../utils/sendEmail.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PUNTAJE_MINIMO = 65;

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `BEC-${new Date().getFullYear()}-${code}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-cron-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const { data: pendientes, error } = await supabase
    .from('becas_profesionales')
    .select('id, carrera_interes, modalidad, promedio_notas, situacion_economica, motivacion, beca_id, beca_nombre, beca_institucion, user_id')
    .eq('estado', 'pendiente')
    .is('puntaje_ia', null)
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  if (!pendientes?.length) return res.status(200).json({ evaluadas: 0 });

  let evaluadas = 0;

  for (const p of pendientes) {
    try {
      // Obtener datos complementarios de la beca
      let condicion_requisitos = null;
      let email_institucion = null;
      let cantidad_disponible = null;
      let monto_total = null;
      if (p.beca_id) {
        const { data: beca } = await supabase
          .from('becas_disponibles')
          .select('condicion_requisitos, email_institucion, cantidad_disponible, monto_total')
          .eq('id', p.beca_id).single();
        condicion_requisitos = beca?.condicion_requisitos || null;
        email_institucion = beca?.email_institucion || null;
        cantidad_disponible = beca?.cantidad_disponible || null;
        monto_total = beca?.monto_total || null;
      }

      // Evaluar con IA
      const prompt = `Eres un evaluador de becas académicas de AJUCON, plataforma peruana de orientación vocacional.

Evalúa la siguiente postulación y devuelve SOLO un JSON válido con este formato exacto:
{"puntaje": <número 0-100>, "aprobada": <true/false>, "evaluacion": "<texto breve en español>"}

Criterios de evaluación:
- Promedio de notas (escala 0-20): peso 40%. Promedio >= 14 es bueno, >= 16 excelente. Promedio < 12 es deficiente.
- Situación económica: peso 30%. "Muy vulnerable" = máximo puntaje, "Vulnerable" = bueno, "Media-baja" = regular.
- Carta de motivación: peso 30%. Evalúa claridad, coherencia, metas concretas y genuinidad.
- Puntaje mínimo para aprobar: ${PUNTAJE_MINIMO}/100.

Datos de la postulación:
- Beca: ${p.beca_nombre || 'No especificada'}
- Institución: ${p.beca_institucion || 'No especificada'}
- Requisitos de la beca: ${condicion_requisitos || 'No especificados'}
- Carrera de interés: ${p.carrera_interes}
- Modalidad: ${p.modalidad}
- Promedio de notas: ${p.promedio_notas}/20
- Situación económica: ${p.situacion_economica}
- Carta de motivación: "${p.motivacion}"

Responde SOLO con el JSON, sin texto adicional.`;

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const raw = msg.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const resultado = JSON.parse(raw);
      const estado = resultado.aprobada ? 'aprobada' : 'rechazada';
      const codigo_beca = estado === 'aprobada' ? generarCodigo() : null;

      await supabase.from('becas_profesionales').update({
        puntaje_ia: resultado.puntaje,
        evaluacion_ia: resultado.evaluacion,
        estado,
        ...(codigo_beca ? { codigo_beca, notificada_at: new Date().toISOString() } : {}),
      }).eq('id', p.id);

      // Obtener datos del usuario para el email
      const { data: usuario } = await supabase
        .from('users').select('nombre, email').eq('id', p.user_id).single();

      if (usuario?.email) {
        if (estado === 'aprobada') {
          // Email al estudiante
          await sendEmail({
            to: usuario.email,
            subject: `🎉 ¡Tu beca fue aprobada! — ${p.beca_nombre || 'Beca Profesional'}`,
            tipo: 'beca_aprobada_estudiante',
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
                <div style="background:linear-gradient(135deg,#059669,#10b981);border-radius:12px;padding:28px;color:white;margin-bottom:24px;text-align:center">
                  <div style="font-size:40px;margin-bottom:8px">🎓</div>
                  <h1 style="margin:0 0 6px;font-size:22px">¡Felicitaciones, ${usuario.nombre}!</h1>
                  <p style="margin:0;opacity:.9;font-size:14px">Tu postulación ha sido aprobada</p>
                </div>
                <p style="color:#1e293b;font-size:15px;line-height:1.6">
                  Nos complace informarte que tu postulación a la beca <strong>${p.beca_nombre || 'Beca Profesional'}</strong>
                  ${p.beca_institucion ? `en <strong>${p.beca_institucion}</strong>` : ''} ha sido <strong style="color:#059669">aprobada</strong>.
                </p>
                ${(cantidad_disponible || monto_total) ? `
                <div style="background:#ecfdf5;border-left:4px solid #059669;border-radius:0 10px 10px 0;padding:14px 18px;margin:16px 0">
                  <p style="margin:0;font-size:14px;color:#065f46;line-height:1.7">
                    🏆 Lo felicitamos por recibir${cantidad_disponible ? ` una de las <strong>${cantidad_disponible} becas disponibles</strong>` : ' esta beca'}${monto_total ? ` valorizada en <strong>S/ ${Number(monto_total).toLocaleString('es-PE')}</strong>` : ''}.
                    Esta distinción reconoce su esfuerzo y potencial académico.
                  </p>
                </div>` : ''}
                <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
                  ${p.beca_nombre ? `<tr><td style="padding:8px 0;color:#64748b;width:40%">Beca</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${p.beca_nombre}</td></tr>` : ''}
                  ${p.beca_institucion ? `<tr><td style="padding:8px 0;color:#64748b">Institución</td><td style="padding:8px 0;color:#1e293b">${p.beca_institucion}</td></tr>` : ''}
                  <tr><td style="padding:8px 0;color:#64748b">Carrera</td><td style="padding:8px 0;color:#1e293b">${p.carrera_interes}</td></tr>
                  <tr><td style="padding:8px 0;color:#64748b">Modalidad</td><td style="padding:8px 0;color:#1e293b">${p.modalidad}</td></tr>
                </table>
                <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:20px;margin:24px 0;text-align:center">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.05em">Tu código de beca</p>
                  <div style="font-size:28px;font-weight:800;letter-spacing:6px;color:#15803d;font-family:monospace">${codigo_beca}</div>
                  <p style="margin:10px 0 0;font-size:12px;color:#15803d">Guarda este código — lo necesitarás al presentarte en la institución</p>
                </div>
                <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin:20px 0">
                  <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6">
                    📋 <strong>¿Cómo usar tu código?</strong><br/>
                    Preséntate en ${p.beca_institucion || 'la institución'} con tu DNI y este código.
                    El equipo de admisiones verificará tu beca y te indicará los siguientes pasos.
                  </p>
                </div>
                <p style="color:#94a3b8;font-size:13px">
                  Si tienes dudas, comunícate con la asesora de ${p.beca_institucion || 'la institución'}.<br/>
                  — Equipo AJUCON
                </p>
              </div>`,
          });

          // Notificar admin e institución
          const destinatarios = ['admin@balticec.com'];
          if (email_institucion) destinatarios.push(email_institucion);
          await sendEmail({
            to: destinatarios,
            subject: `Beca otorgada — ${usuario.nombre} — ${p.beca_nombre || ''}`,
            tipo: 'beca_aprobada_admin',
            html: `<div style="font-family:system-ui,sans-serif;padding:24px">
              <h2 style="color:#059669">Beca otorgada automáticamente</h2>
              <p><strong>Estudiante:</strong> ${usuario.nombre} (${usuario.email})</p>
              <p><strong>Beca:</strong> ${p.beca_nombre || '—'}</p>
              <p><strong>Institución:</strong> ${p.beca_institucion || '—'}</p>
              <p><strong>Puntaje IA:</strong> ${resultado.puntaje}/100</p>
              <p><strong>Código asignado:</strong> <code style="font-size:18px;font-weight:800;color:#059669">${codigo_beca}</code></p>
              <p><strong>Evaluación IA:</strong> ${resultado.evaluacion || '—'}</p>
            </div>`,
          });
        } else {
          // Email rechazo al estudiante
          await sendEmail({
            to: usuario.email,
            subject: `Resultado de tu postulación — ${p.beca_nombre || 'Beca Profesional'}`,
            tipo: 'beca_rechazada_estudiante',
            html: `
              <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
                <div style="background:linear-gradient(135deg,#475569,#64748b);border-radius:12px;padding:28px;color:white;margin-bottom:24px">
                  <h1 style="margin:0 0 6px;font-size:20px">Resultado de tu postulación</h1>
                  <p style="margin:0;opacity:.85;font-size:14px">AJUCON — Becas de Estudios Profesionales</p>
                </div>
                <p style="color:#1e293b;font-size:15px">Hola <strong>${usuario.nombre}</strong>,</p>
                <p style="color:#475569;font-size:14px;line-height:1.6">
                  Luego de revisar tu postulación a la beca <strong>${p.beca_nombre || 'Beca Profesional'}</strong>,
                  lamentamos informarte que en esta oportunidad no cumple con todos los criterios requeridos.
                </p>
                <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin:20px 0">
                  <p style="margin:0;font-size:14px;color:#92400e;line-height:1.7">
                    💡 <strong>¿Puedo volver a postular?</strong><br/>
                    Sí, puedes volver a postular cuando lo desees. Te recomendamos revisar los requisitos de la beca y mejorar los siguientes aspectos antes de tu próxima postulación:
                    <br/>• <strong>Promedio de notas:</strong> un promedio más alto mejora significativamente tus posibilidades.
                    <br/>• <strong>Carta de motivación:</strong> explica con detalle tus metas, tu situación y por qué mereces esta beca.
                    <br/>• <strong>Documentos de respaldo:</strong> adjunta evidencia que sustente tu situación económica y académica.
                  </p>
                </div>
                <p style="color:#475569;font-size:14px;line-height:1.6">
                  Ingresa a <strong>system.ajucon.org.pe</strong>, revisa las becas disponibles y vuelve a postular con la información actualizada. ¡Estamos para apoyarte!
                </p>
                <p style="color:#94a3b8;font-size:13px;margin-top:24px">— Equipo AJUCON</p>
              </div>`,
          });
        }
      }

      evaluadas++;
    } catch (err) {
      console.error('[EVAL ERROR]', p.id, err.message);
    }
  }

  return res.status(200).json({ evaluadas, total: pendientes.length });
}
