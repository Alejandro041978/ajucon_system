import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AREAS_CHASIDE = {
  C: 'Ciencias',
  H: 'Humanidades',
  A: 'Arte',
  S: 'Ciencias de la Salud',
  I: 'Ingeniería y Tecnología',
  D: 'Derecho y Ciencias Sociales',
  E: 'Educación',
};

const RIASEC_NOMBRES = {
  R: 'Realista',
  I: 'Investigador',
  A: 'Artístico',
  S: 'Social',
  E: 'Emprendedor',
  C: 'Convencional',
};

const RIASEC_DESC = {
  R: 'actividades prácticas, manuales y técnicas',
  I: 'análisis, investigación y resolución de problemas complejos',
  A: 'creatividad, expresión artística y pensamiento libre',
  S: 'ayudar a otros, trabajo comunitario y relaciones humanas',
  E: 'liderazgo, negocios y toma de decisiones',
  C: 'organización, datos, procesos y detalle',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'No autorizado.' });

  let payload;
  try {
    payload = jwt.verify(auth, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  // Obtener todos los datos del estudiante en paralelo
  const [
    { data: usuario },
    { data: riasec },
    { data: tests },
    { data: inscripciones },
  ] = await Promise.all([
    supabase.from('users').select('nombre, apellido, email, grado, ciudad, created_at').eq('id', payload.id).single(),
    supabase.from('riasec_profiles').select('*').eq('user_id', payload.id).single(),
    supabase.from('test_results').select('resultado, carreras, created_at').eq('user_id', payload.id).order('created_at', { ascending: false }).limit(1),
    supabase.from('inscripciones_cursos').select('curso_nombre, estado').eq('user_id', payload.id),
  ]);

  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const chaside = tests?.[0] || null;
  const tieneRiasec = riasec && riasec.completitud >= 30;
  const tieneChaside = !!chaside?.resultado;

  if (!tieneRiasec && !tieneChaside) {
    return res.status(400).json({ error: 'El estudiante aún no tiene suficiente información para generar un reporte. Debe completar al menos el cuestionario CHASIDE o tener sesiones con Valeria.' });
  }

  // Construir scores RIASEC ordenados
  let riasecScores = null;
  let riasecTop = [];
  if (tieneRiasec) {
    const dims = ['R','I','A','S','E','C'];
    riasecScores = {};
    dims.forEach(d => { riasecScores[d] = riasec[d] || riasec[`dim_${d.toLowerCase()}`] || 0; });
    riasecTop = dims.sort((a, b) => riasecScores[b] - riasecScores[a]).slice(0, 3);
  }

  // Prompt para Claude
  const contexto = [];
  contexto.push(`Estudiante: ${usuario.nombre} ${usuario.apellido || ''}, ${usuario.grado || 'secundaria'}, ciudad: ${usuario.ciudad || 'Tacna'}, Perú.`);

  if (tieneRiasec) {
    const dims = ['R','I','A','S','E','C'];
    const puntajes = dims.map(d => `${RIASEC_NOMBRES[d]} (${d}): ${riasecScores[d]} pts`).join(', ');
    contexto.push(`Perfil RIASEC (obtenido mediante conversación con psicóloga virtual): ${puntajes}.`);
    contexto.push(`Dimensiones dominantes: ${riasecTop.map(d => `${RIASEC_NOMBRES[d]} (${d})`).join(', ')}.`);
    contexto.push(`Completitud del perfil: ${riasec.completitud || 0}%.`);
  }

  if (tieneChaside) {
    const areaLabel = AREAS_CHASIDE[chaside.resultado] || chaside.resultado;
    const carreras = Array.isArray(chaside.carreras) ? chaside.carreras.join(', ') : '—';
    contexto.push(`Resultado CHASIDE: área dominante "${areaLabel}" (código ${chaside.resultado}).`);
    contexto.push(`Carreras sugeridas por CHASIDE: ${carreras}.`);
  }

  if (inscripciones?.length > 0) {
    contexto.push(`Cursos en los que está inscrito: ${inscripciones.map(i => i.curso_nombre).join(', ')}.`);
  }

  const prompt = `Eres un psicólogo vocacional experto redactando un informe profesional para un joven estudiante peruano y su familia.

Datos del estudiante:
${contexto.join('\n')}

Redacta un informe vocacional completo con exactamente estas secciones, en JSON válido:

{
  "resumen_perfil": "2-3 párrafos cálidos y profesionales describiendo quién es este estudiante según su perfil. Habla en tercera persona. Menciona sus características personales inferidas de sus dimensiones dominantes. Tono: cercano, positivo, propio de un psicólogo que inspira confianza a los padres.",
  "fortalezas": "2 párrafos describiendo sus principales fortalezas vocacionales. Conecta las dimensiones RIASEC y/o el área CHASIDE con habilidades concretas que este joven probablemente tiene.",
  "areas_desarrollo": "1-2 párrafos sobre aspectos a desarrollar o explorar. Tono constructivo, nunca negativo. Enfócate en oportunidades de crecimiento.",
  "orientacion_carreras": "2-3 párrafos con orientación específica sobre carreras. Menciona carreras concretas alineadas a su perfil. Para Tacna menciona UNJBG, UPT, UTP o Instituto Neumann/Blackwell según corresponda. Justifica por qué esas carreras le sientan bien.",
  "mensaje_motivador": "1 párrafo final dirigido directamente al estudiante (en segunda persona, tuteo). Cálido, esperanzador, que genere confianza en su futuro."
}

Reglas:
- Escribe en español peruano formal pero accesible
- No uses lenguaje técnico que asuste a los padres
- Cada sección debe ser sustanciosa (no genérica)
- El tono debe transmitir que este informe fue elaborado por un profesional que conoce al estudiante
- Responde SOLO el JSON, sin texto antes ni después`;

  let narrativa;
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const texto = response.content[0].text.trim();
    const jsonStr = texto.startsWith('{') ? texto : texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1);
    narrativa = JSON.parse(jsonStr);
  } catch (e) {
    console.error('Error Claude:', e);
    return res.status(500).json({ error: 'Error al generar el reporte con IA. Intenta nuevamente.' });
  }

  return res.status(200).json({
    usuario: {
      nombre: `${usuario.nombre} ${usuario.apellido || ''}`.trim(),
      email: usuario.email,
      grado: usuario.grado || '',
      ciudad: usuario.ciudad || 'Tacna',
      fecha_registro: usuario.created_at,
    },
    riasec: tieneRiasec ? { scores: riasecScores, top: riasecTop, completitud: riasec.completitud } : null,
    chaside: tieneChaside ? { resultado: chaside.resultado, area: AREAS_CHASIDE[chaside.resultado] || chaside.resultado, carreras: chaside.carreras } : null,
    narrativa,
    generado_en: new Date().toISOString(),
  });
}
