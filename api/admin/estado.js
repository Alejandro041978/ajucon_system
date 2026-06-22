import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' ? p : null;
  } catch { return null; }
}

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `BEC-${new Date().getFullYear()}-${code}`;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  const { tabla, id, estado } = req.body;
  const tablas = ['becas_profesionales', 'becas_cursos'];
  const estadosBP = ['en_revision', 'aprobada', 'rechazada'];
  const estadosBC = ['pendiente', 'en_revision', 'aprobada', 'rechazada'];
  const estadosValidos = tabla === 'becas_profesionales' ? estadosBP : estadosBC;

  if (!tablas.includes(tabla) || !estadosValidos.includes(estado)) {
    return res.status(400).json({ error: 'Datos inválidos.' });
  }

  // Para aprobadas: generar código si no tiene uno
  let updateData = { estado };
  let codigo_beca = null;

  if (tabla === 'becas_profesionales' && estado === 'aprobada') {
    const { data: actual } = await supabase
      .from('becas_profesionales').select('codigo_beca').eq('id', id).single();
    codigo_beca = actual?.codigo_beca || generarCodigo();
    updateData.codigo_beca = codigo_beca;
    updateData.notificada_at = new Date().toISOString();
  }

  const { error } = await supabase.from(tabla).update(updateData).eq('id', id);
  if (error) return res.status(500).json({ error: 'Error al actualizar.' });

  // Enviar email al postulante si es beca profesional y estado final
  if (tabla === 'becas_profesionales' && (estado === 'aprobada' || estado === 'rechazada')) {
    const { data: p } = await supabase
      .from('becas_profesionales')
      .select('beca_nombre, beca_institucion, carrera_interes, modalidad, user_id')
      .eq('id', id).single();

    const { data: usuario } = await supabase
      .from('users').select('nombre, email').eq('id', p?.user_id).single();

    if (usuario?.email && p) {
      if (estado === 'aprobada') {
        resend.emails.send({
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
              <p style="color:#94a3b8;font-size:13px">— Equipo AJUCON</p>
            </div>`,
        }).catch(() => {});
      } else {
        resend.emails.send({
          from: 'AJUCON <noreply@ajucon.org.pe>',
          to: usuario.email,
          subject: `Resultado de tu postulación — ${p.beca_nombre || 'Beca Profesional'}`,
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
              <p style="color:#475569;font-size:14px;line-height:1.6">
                Te invitamos a seguir preparándote y a estar atento a nuevas becas disponibles en la plataforma AJUCON.
              </p>
              <p style="color:#94a3b8;font-size:13px;margin-top:24px">— Equipo AJUCON</p>
            </div>`,
        }).catch(() => {});
      }
    }
  }

  return res.status(200).json({ ok: true });
}
