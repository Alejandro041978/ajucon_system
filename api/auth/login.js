import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendWhatsApp(to, body) {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = (process.env.TWILIO_WHATSAPP_FROM || '').trim();
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const params = new URLSearchParams({
    From: `whatsapp:${from}`,
    To: `whatsapp:${to}`,
    Body: body,
  });
  const creds = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  console.log('[TWILIO] accountSid:', accountSid?.slice(0, 8), 'authToken len:', authToken?.length, 'from:', from, 'to:', to);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await r.json();
  console.log('[TWILIO RESPONSE]', r.status, JSON.stringify(data));
  if (!r.ok) throw new Error(`${data.message || 'Error'} (${data.code})`);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, canal = 'email' } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido.' });

  const { data: user } = await supabase
    .from('users')
    .select('nombre, telefono')
    .eq('email', email)
    .single();

  if (!user) return res.status(404).json({ error: 'Email no registrado.' });

  // Solo verificar si tiene teléfono, sin enviar código
  if (canal === 'check') {
    return res.status(200).json({ tiene_telefono: !!user.telefono });
  }

  // Validar que si pide WhatsApp tenga teléfono registrado
  if (canal === 'whatsapp' && !user.telefono) {
    return res.status(400).json({ error: 'No tienes un número de WhatsApp registrado. Usa el acceso por email.' });
  }

  const code = generateCode();
  const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await supabase.from('verification_codes').insert({ email, code, expires_at, canal });

  if (canal === 'whatsapp') {
    try {
      await sendWhatsApp(user.telefono, `🎓 AJUCON\n\nHola ${user.nombre}, tu código de acceso es:\n\n*${code}*\n\nVálido por 15 minutos. No lo compartas con nadie.`);
    } catch (e) {
      console.error('[TWILIO ERROR]', e.message);
      return res.status(500).json({
        error: `Error WhatsApp: ${e.message}`,
      });
    }
    return res.status(200).json({ message: 'Código enviado por WhatsApp.', canal: 'whatsapp', tiene_telefono: true });
  }

  // Canal email
  await resend.emails.send({
    from: 'AJUCON <noreply@ajucon.org.pe>',
    to: email,
    subject: 'Tu código de acceso AJUCON',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#6366f1">Hola ${user.nombre} 👋</h2>
        <p style="color:#475569">Tu código de acceso a AJUCON es:</p>
        <div style="font-size:48px;font-weight:800;letter-spacing:12px;color:#1e293b;margin:24px 0">${code}</div>
        <p style="color:#94a3b8;font-size:14px">Válido por 15 minutos. No lo compartas con nadie.</p>
      </div>`,
  });

  return res.status(200).json({
    message: 'Código enviado al email.',
    canal: 'email',
    tiene_telefono: !!user.telefono,
  });
}
