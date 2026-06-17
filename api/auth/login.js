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

  const { email } = req.body;

  if (!email) return res.status(400).json({ error: 'Email requerido.' });

  const { data: user } = await supabase
    .from('users')
    .select('nombre')
    .eq('email', email)
    .single();

  if (!user) {
    return res.status(404).json({ error: 'Email no registrado.' });
  }

  const code = generateCode();
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await supabase.from('verification_codes').insert({ email, code, expires_at });

  await resend.emails.send({
    from: 'AJUCON <noreply@ajucon.cl>',
    to: email,
    subject: 'Tu código de acceso AJUCON',
    html: `
      <h2>Hola ${user.nombre}</h2>
      <p>Tu código de acceso es:</p>
      <h1 style="letter-spacing:8px;font-size:48px">${code}</h1>
      <p>Válido por 15 minutos.</p>
    `,
  });

  return res.status(200).json({ message: 'Código enviado al email.' });
}
