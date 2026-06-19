import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, code } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido.' });

  // Buscar en admin_users
  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, nombre, apellido, email, activo, rol, permisos')
    .eq('email', email)
    .single();

  // Fallback: admin de env vars
  const esAdminEnv = email === process.env.ADMIN_EMAIL;

  if (!admin && !esAdminEnv) {
    return res.status(404).json({ error: 'Email no registrado como administrador.' });
  }

  if (admin && !admin.activo) {
    return res.status(401).json({ error: 'Cuenta desactivada.' });
  }

  // Paso 1: solicitar código
  if (!code) {
    const nuevoCode = generateCode();
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await supabase.from('verification_codes').insert({ email, code: nuevoCode, expires_at });

    const nombre = admin ? admin.nombre : 'Administrador';
    await resend.emails.send({
      from: 'AJUCON <noreply@ajucon.org.pe>',
      to: email,
      subject: 'Código de acceso — Panel Admin AJUCON',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px 24px">
          <h2 style="color:#1e293b">Hola ${nombre}</h2>
          <p style="color:#475569">Tu código de acceso al panel de administración es:</p>
          <div style="font-size:48px;font-weight:800;letter-spacing:12px;color:#6366f1;margin:24px 0">${nuevoCode}</div>
          <p style="color:#94a3b8;font-size:14px">Válido por 15 minutos.</p>
        </div>`,
    });
    return res.status(200).json({ mensaje: 'Código enviado al email.' });
  }

  // Paso 2: verificar código
  const { data: rows } = await supabase
    .from('verification_codes')
    .select('id')
    .eq('email', email)
    .eq('code', code)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (!rows || rows.length === 0) {
    return res.status(401).json({ error: 'Código inválido o expirado.' });
  }

  await supabase.from('verification_codes').update({ used: true }).eq('id', rows[0].id);

  const todasSecciones = ['stats','users','becas_profesionales','becas_cursos','gestion_cursos','test_results','riasec','valeria_review'];
  const payload = admin
    ? { role: 'admin', id: admin.id, email: admin.email, rol: admin.rol || 'admin', permisos: admin.permisos || todasSecciones }
    : { role: 'admin', email, rol: 'super_admin', permisos: todasSecciones };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
  const nombre = admin ? `${admin.nombre} ${admin.apellido}` : 'Administrador';

  return res.status(200).json({ token, nombre });
}
