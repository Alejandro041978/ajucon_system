import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { nombre, apellido, email, grado, ciudad, colegio, telefono } = req.body;

  if (!nombre || !apellido || !email || !grado || !ciudad) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }

  const { error: upsertError } = await supabase
    .from('users')
    .upsert(
      { nombre, apellido, email, grado, ciudad, colegio: colegio || null, telefono: telefono || null },
      { onConflict: 'email' }
    );

  if (upsertError) return res.status(500).json({ error: 'Error al registrar usuario.' });

  const code = generateCode();
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await supabase.from('verification_codes').insert({ email, code, expires_at, canal: 'email' });

  const { error: emailError } = await resend.emails.send({
    from: 'AJUCON <noreply@ajucon.org.pe>',
    to: email,
    subject: 'Tu código de acceso AJUCON',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#6366f1">Hola ${nombre} 👋</h2>
        <p style="color:#475569">Tu código de acceso a AJUCON es:</p>
        <div style="font-size:48px;font-weight:800;letter-spacing:12px;color:#1e293b;margin:24px 0">${code}</div>
        <p style="color:#94a3b8;font-size:14px">Válido por 15 minutos. No lo compartas con nadie.</p>
      </div>`,
  });

  if (emailError) return res.status(500).json({ error: 'Error al enviar el email.' });

  return res.status(200).json({ message: 'Código enviado al email.' });
}
