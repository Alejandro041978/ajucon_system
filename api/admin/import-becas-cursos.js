import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const MOODLE_URL = 'https://campus.ajucon.org.pe';

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' ? p : null;
  } catch { return null; }
}

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
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'No autorizado.' });

  const { filas } = req.body;
  // filas: [{nombre, apellido, email, curso, convenio, dni, celular, grado, ciudad, fecha_registro}]
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ error: 'No hay filas para importar.' });
  }
  const hoy = new Date().toISOString().slice(0, 10);

  function normalizarFecha(f) {
    if (!f) return hoy;
    // DD/MM/YYYY → YYYY-MM-DD
    const m = f.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return f; // ya está en YYYY-MM-DD u otro formato
  }

  // Cargar todos los cursos y convenios para match por nombre
  const { data: cursosDB } = await supabase.from('cursos').select('id, nombre, moodle_curso_id');
  const cursoMap = {};
  (cursosDB || []).forEach(c => { cursoMap[c.nombre.toLowerCase().trim()] = c; });

  const { data: conveniosDB } = await supabase.from('convenios').select('id, institucion').eq('activo', true);
  const convenioMap = {};
  (conveniosDB || []).forEach(c => { convenioMap[c.institucion.toLowerCase().trim()] = c.id; });

  const resultados = [];

  for (const fila of filas) {
    const { nombre, apellido, email, curso: cursoNombre, convenio: convenioNombre, dni, celular, grado, ciudad, fecha_registro } = fila;
    const result = { email, nombre: `${nombre} ${apellido}`, curso: cursoNombre, ok: false, mensaje: '' };

    if (!nombre || !apellido || !email || !cursoNombre) {
      result.mensaje = 'Faltan campos requeridos (nombre, apellido, email, curso).';
      resultados.push(result); continue;
    }

    // Buscar curso
    const cursoKey = cursoNombre.toLowerCase().trim();
    const curso = cursoMap[cursoKey] || Object.values(cursoMap).find(c => c.nombre.toLowerCase().includes(cursoKey));
    if (!curso) {
      result.mensaje = `Curso "${cursoNombre}" no encontrado.`;
      resultados.push(result); continue;
    }

    try {
      // Upsert usuario en BD
      let userId;
      const { data: userExist } = await supabase.from('users').select('id').eq('email', email).single();

      if (userExist) {
        userId = userExist.id;
        await supabase.from('users').update({
          nombre, apellido,
          ...(grado && { grado }),
          ...(ciudad && { ciudad }),
          ...(dni && { dni }),
          ...(celular && { telefono: celular }),
        }).eq('id', userId);
      } else {
        const { data: newUser, error: userErr } = await supabase.from('users').insert({
          nombre, apellido, email,
          grado: grado || 'No especificado',
          ciudad: ciudad || 'Tacna',
          ...(dni && { dni }),
          ...(celular && { telefono: celular }),
        }).select('id').single();
        if (userErr) { result.mensaje = `Error al crear usuario: ${userErr.message}`; resultados.push(result); continue; }
        userId = newUser.id;
      }

      // Verificar inscripción previa en este curso
      const { data: inscExist } = await supabase
        .from('inscripciones_cursos')
        .select('id')
        .eq('user_id', userId)
        .eq('curso_nombre', curso.nombre)
        .single();

      if (inscExist) {
        result.ok = true; result.mensaje = 'Ya estaba inscrito — datos actualizados.';
        resultados.push(result); continue;
      }

      // Moodle: buscar o crear usuario
      const username = usernameDeEmail(email);
      const password = generarPassword();
      let moodleUserId;
      const busqueda = await moodlePost('core_user_get_users', {
        'criteria[0][key]': 'email', 'criteria[0][value]': email,
      });

      let credencialesNuevas = false;
      if (busqueda?.users?.length > 0) {
        moodleUserId = busqueda.users[0].id;
      } else {
        const creado = await moodlePost('core_user_create_users', {
          'users[0][username]': username,
          'users[0][password]': password,
          'users[0][firstname]': nombre,
          'users[0][lastname]': apellido,
          'users[0][email]': email,
          'users[0][lang]': 'es',
        });
        if (creado?.exception) { result.mensaje = `Error Moodle: ${creado.message}`; resultados.push(result); continue; }
        moodleUserId = creado[0]?.id;
        credencialesNuevas = true;
      }

      // Enrolar en curso Moodle
      if (curso.moodle_curso_id) {
        const enrol = await moodlePost('enrol_manual_enrol_users', {
          'enrolments[0][roleid]': '5',
          'enrolments[0][userid]': String(moodleUserId),
          'enrolments[0][courseid]': String(curso.moodle_curso_id),
        });
        if (enrol?.exception) { result.mensaje = `Error al enrolar en Moodle: ${enrol.message}`; resultados.push(result); continue; }
      }

      // Insertar inscripción en BD
      const convenio_id = convenioNombre ? (convenioMap[convenioNombre.toLowerCase().trim()] || null) : null;

      const { error: inscErr } = await supabase.from('inscripciones_cursos').insert({
        user_id: userId,
        curso_nombre: curso.nombre,
        moodle_curso_id: curso.moodle_curso_id,
        moodle_user_id: moodleUserId,
        estado: 'inscrito',
        convenio_id,
        fecha_registro: normalizarFecha(fecha_registro),
      });
      if (inscErr) { result.mensaje = `Error al registrar inscripción: ${inscErr.message}`; resultados.push(result); continue; }

      // Email con credenciales (solo si son nuevas)
      if (credencialesNuevas) {
        await resend.emails.send({
          from: 'AJUCON <noreply@ajucon.org.pe>',
          to: email,
          subject: `¡Inscripción exitosa! — ${curso.nombre}`,
          html: `
            <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
              <div style="background:linear-gradient(135deg,#db2777,#ec4899);border-radius:12px;padding:24px;color:white;margin-bottom:24px">
                <h1 style="margin:0 0 6px;font-size:20px">¡Inscripción exitosa!</h1>
                <p style="margin:0;opacity:.85;font-size:14px">${curso.nombre}</p>
              </div>
              <p style="font-size:15px;color:#1e293b">Hola <strong>${nombre}</strong>, tu inscripción al curso <strong>${curso.nombre}</strong> fue registrada.</p>
              <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin:20px 0">
                <p style="margin:0 0 12px;font-size:13px;color:#64748b;font-weight:700;text-transform:uppercase">Datos de acceso al campus</p>
                <p style="margin:0 0 8px;font-size:14px;color:#1e293b">🌐 <a href="https://campus.ajucon.org.pe" style="color:#db2777;font-weight:600">campus.ajucon.org.pe</a></p>
                <p style="margin:0 0 8px;font-size:14px;color:#1e293b">👤 Usuario: <strong>${username}</strong></p>
                <p style="margin:0;font-size:14px;color:#1e293b">🔑 Contraseña: <strong>${password}</strong></p>
              </div>
              <p style="font-size:13px;color:#94a3b8;text-align:center">Te recomendamos cambiar tu contraseña al ingresar por primera vez.</p>
            </div>`,
        }).catch(() => {});
      }

      result.ok = true;
      result.mensaje = credencialesNuevas ? 'Inscrito y credenciales enviadas por email.' : 'Inscrito (ya tenía cuenta Moodle).';
      resultados.push(result);

    } catch (e) {
      result.mensaje = `Error inesperado: ${e.message}`;
      resultados.push(result);
    }
  }

  return res.status(200).json({ resultados });
}
