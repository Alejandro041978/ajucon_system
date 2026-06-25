import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

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

  // Postulaciones aprobadas con más de 80 horas y aún no notificadas
  const hace80h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: pendientes, error } = await supabase
    .from('becas_profesionales')
    .select('id, beca_id, beca_nombre, beca_institucion, carrera_interes, modalidad, user_id, puntaje_ia, evaluacion_ia')
    .eq('estado', 'aprobada')
    .is('notificada_at', null)
    .lte('created_at', hace80h);

  if (error) return res.status(500).json({ error: error.message });
  if (!pendientes?.length) return res.status(200).json({ notificadas: 0 });

  let notificadas = 0;

  for (const p of pendientes) {
    const codigo = generarCodigo();

    // Obtener datos del usuario
    const { data: usuario } = await supabase
      .from('users')
      .select('nombre, email')
      .eq('id', p.user_id)
      .single();

    if (!usuario?.email) continue;

    // Obtener email de la institución
    let email_institucion = null;
    if (p.beca_id) {
      const { data: beca } = await supabase
        .from('becas_disponibles')
        .select('email_institucion')
        .eq('id', p.beca_id)
        .single();
      email_institucion = beca?.email_institucion || null;
    }

    // Guardar código y marcar como notificada
    await supabase.from('becas_profesionales').update({
      codigo_beca: codigo,
      notificada_at: new Date().toISOString(),
    }).eq('id', p.id);

    // Email al estudiante con el código
    await resend.emails.send({
      from: 'AJUCON <noreply@ajucon.org.pe>',
      to: usuario.email,
      subject: `🎉 ¡Tu beca fue aprobada! — ${p.beca_nombre || 'Beca Profesional'}`,
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

          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
            ${p.beca_nombre ? `<tr><td style="padding:8px 0;color:#64748b;width:40%">Beca</td><td style="padding:8px 0;color:#1e293b;font-weight:600">${p.beca_nombre}</td></tr>` : ''}
            ${p.beca_institucion ? `<tr><td style="padding:8px 0;color:#64748b">Institución</td><td style="padding:8px 0;color:#1e293b">${p.beca_institucion}</td></tr>` : ''}
            <tr><td style="padding:8px 0;color:#64748b">Carrera</td><td style="padding:8px 0;color:#1e293b">${p.carrera_interes}</td></tr>
            <tr><td style="padding:8px 0;color:#64748b">Modalidad</td><td style="padding:8px 0;color:#1e293b">${p.modalidad}</td></tr>
          </table>

          <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:20px;margin:24px 0;text-align:center">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.05em">Tu código de beca</p>
            <div style="font-size:28px;font-weight:800;letter-spacing:6px;color:#15803d;font-family:monospace">${codigo}</div>
            <p style="margin:10px 0 0;font-size:12px;color:#4ade80">Guarda este código — lo necesitarás al presentarte en la institución</p>
          </div>

          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin:20px 0">
            <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6">
              📋 <strong>¿Cómo usar tu código?</strong><br/>
              Preséntate en ${p.beca_institucion || 'la institución'} con tu DNI y este código.
              El equipo de admisiones verificará tu beca y te indicará los siguientes pasos para matricularte.
            </p>
          </div>

          <p style="color:#94a3b8;font-size:13px;margin-top:24px">
            Si tienes dudas, comunícate con la asesora de ${p.beca_institucion || 'la institución'}.<br/>
            — Equipo AJUCON
          </p>
        </div>`,
    });

    // Notificar al admin y a la institución
    const destinatarios = ['admin@balticec.com'];
    if (email_institucion) destinatarios.push(email_institucion);

    resend.emails.send({
      from: 'AJUCON <noreply@ajucon.org.pe>',
      to: destinatarios,
      subject: `Beca otorgada — ${usuario.nombre} — ${p.beca_nombre || ''}`,
      html: `<div style="font-family:system-ui,sans-serif;padding:24px">
        <h2 style="color:#059669">Beca otorgada automáticamente</h2>
        <p><strong>Estudiante:</strong> ${usuario.nombre} (${usuario.email})</p>
        <p><strong>Beca:</strong> ${p.beca_nombre || '—'}</p>
        <p><strong>Institución:</strong> ${p.beca_institucion || '—'}</p>
        <p><strong>Puntaje IA:</strong> ${p.puntaje_ia}/100</p>
        <p><strong>Código asignado:</strong> <code style="font-size:18px;font-weight:800;color:#059669">${codigo}</code></p>
        <p><strong>Evaluación IA:</strong> ${p.evaluacion_ia || '—'}</p>
      </div>`,
    }).catch(() => {});

    notificadas++;
  }

  return res.status(200).json({ notificadas, total: pendientes.length });
}
