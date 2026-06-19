import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const MOODLE_URL = 'https://campus.ajucon.org.pe';
const MOODLE_COURSE_ID = 8;

async function moodlePost(wsfunction, params) {
  const url = `${MOODLE_URL}/webservice/rest/server.php?wstoken=${process.env.MOODLE_TOKEN}&wsfunction=${wsfunction}&moodlewsrestformat=json`;
  const r = await fetch(url, { method: 'POST', body: new URLSearchParams(params) });
  return r.json();
}

function generarPassword() {
  return 'Ajucon' + Math.floor(1000 + Math.random() * 9000) + '#';
}

function usernameDeEmail(email) {
  return 'ajucon_' + email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '_');
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

  const { curso_nombre } = req.body;
  if (!curso_nombre) return res.status(400).json({ error: 'Debes seleccionar un curso.' });

  // Verificar si tiene inscripción activa
  const { data: activa } = await supabase
    .from('inscripciones_cursos')
    .select('id, curso_nombre')
    .eq('user_id', payload.id)
    .eq('estado', 'inscrito')
    .single();

  if (activa) {
    return res.status(400).json({
      error: `Ya estás inscrito en "${activa.curso_nombre}". Debes completarlo y ser aprobado antes de inscribirte en otro curso.`,
    });
  }

  // Obtener datos del usuario
  const { data: usuario } = await supabase
    .from('users')
    .select('nombre, email')
    .eq('id', payload.id)
    .single();

  const partes = usuario.nombre.trim().split(' ');
  const firstname = partes[0];
  const lastname = partes.slice(1).join(' ') || partes[0];
  const username = usernameDeEmail(usuario.email);
  const password = generarPassword();

  // Verificar si el usuario ya existe en Moodle
  let moodleUserId;
  const busqueda = await moodlePost('core_user_get_users', {
    'criteria[0][key]': 'email',
    'criteria[0][value]': usuario.email,
  });

  if (busqueda?.users?.length > 0) {
    moodleUserId = busqueda.users[0].id;
  } else {
    // Crear usuario en Moodle
    const creado = await moodlePost('core_user_create_users', {
      'users[0][username]': username,
      'users[0][password]': password,
      'users[0][firstname]': firstname,
      'users[0][lastname]': lastname,
      'users[0][email]': usuario.email,
      'users[0][lang]': 'es',
    });

    if (creado?.exception) {
      console.error('Moodle create_users error:', creado);
      return res.status(500).json({ error: 'Error al crear acceso al campus virtual.' });
    }

    moodleUserId = creado[0]?.id;
  }

  // Enrolar en el curso
  const enrol = await moodlePost('enrol_manual_enrol_users', {
    'enrolments[0][roleid]': '5',
    'enrolments[0][userid]': String(moodleUserId),
    'enrolments[0][courseid]': String(MOODLE_COURSE_ID),
  });

  if (enrol?.exception) {
    console.error('Moodle enrol error:', enrol);
    return res.status(500).json({ error: 'Error al inscribir en el campus virtual.' });
  }

  // Guardar en Supabase
  const { error: dbError } = await supabase.from('inscripciones_cursos').insert({
    user_id: payload.id,
    curso_nombre,
    moodle_curso_id: MOODLE_COURSE_ID,
    moodle_user_id: moodleUserId,
    estado: 'inscrito',
  });

  if (dbError) {
    console.error('DB insert error:', dbError);
    return res.status(500).json({ error: 'Error al registrar inscripción.' });
  }

  // Enviar credenciales por email
  await resend.emails.send({
    from: 'AJUCON <noreply@ajucon.org.pe>',
    to: usuario.email,
    subject: `¡Inscripción exitosa! — ${curso_nombre}`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <div style="background:linear-gradient(135deg,#db2777,#ec4899);border-radius:12px;padding:24px;color:white;margin-bottom:24px">
          <h1 style="margin:0 0 6px;font-size:20px">¡Inscripción exitosa!</h1>
          <p style="margin:0;opacity:.85;font-size:14px">${curso_nombre}</p>
        </div>
        <p style="font-size:15px;color:#1e293b">Hola <strong>${firstname}</strong>, tu inscripción al curso <strong>${curso_nombre}</strong> en el Campus Virtual AJUCON fue registrada.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin:20px 0">
          <p style="margin:0 0 12px;font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase">Tus datos de acceso al campus</p>
          <p style="margin:0 0 8px;font-size:14px;color:#1e293b">🌐 <a href="https://campus.ajucon.org.pe" style="color:#db2777;font-weight:600">campus.ajucon.org.pe</a></p>
          <p style="margin:0 0 8px;font-size:14px;color:#1e293b">👤 Usuario: <strong>${username}</strong></p>
          <p style="margin:0;font-size:14px;color:#1e293b">🔑 Contraseña: <strong>${password}</strong></p>
        </div>
        <p style="font-size:13px;color:#94a3b8;text-align:center">Guarda bien estos datos. Te recomendamos cambiar tu contraseña al ingresar por primera vez.</p>
      </div>`,
  }).catch(() => {});

  return res.status(200).json({
    ok: true,
    mensaje: `¡Inscripción exitosa! Revisa tu email para los datos de acceso al campus virtual.`,
  });
}
