import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function sendEmail({ to, subject, html, tipo }) {
  const destinatario = Array.isArray(to) ? to.join(', ') : to;
  try {
    await resend.emails.send({
      from: 'AJUCON <noreply@ajucon.org.pe>',
      to,
      subject,
      html,
    });
    await supabase.from('email_logs').insert({
      tipo, destinatario, asunto: subject, estado: 'enviado',
    });
  } catch (err) {
    await supabase.from('email_logs').insert({
      tipo, destinatario, asunto: subject, estado: 'error', error: err.message,
    });
    console.error(`[EMAIL ERROR] tipo=${tipo} to=${destinatario}`, err.message);
  }
}
