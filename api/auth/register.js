import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { nombre, email, grado } = req.body;

  if (!nombre || !email || !grado) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }

  // Crear o actualizar usuario
  const { error: upsertError } = await supabase
    .from('users')
    .upsert({ nombre, email, grado }, { onConflict: 'email' });

  if (upsertError) {
    return res.status(500).json({ error: 'Error al registrar usuario.' });
  }

  // Generar código con expiración de 15 minutos
  const code = generateCode();
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await supabase.from('verification_codes').insert({ email, code, expires_at });

  // Enviar email
  const { error: emailError } = await resend.emails.send({
    from: 'AJUCON <onboarding@resend.dev>',
    to: email,
    subject: 'Tu código de acceso AJUCON',
    html: `
      <h2>Hola ${nombre}</h2>
      <p>Tu código de acceso es:</p>
      <h1 style="letter-spacing:8px;font-size:48px">${code}</h1>
      <p>Válido por 15 minutos.</p>
    `,
  });

  if (emailError) {
    return res.status(500).json({ error: 'Error al enviar el email.' });
  }

  return res.status(200).json({ message: 'Código enviado al email.' });
}
