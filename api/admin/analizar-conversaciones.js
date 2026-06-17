import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Protegido por clave secreta para uso desde GitHub Actions o admin
function autenticado(req) {
  const key = req.headers['x-admin-key'] || req.query.key;
  return key === process.env.ADMIN_SECRET_KEY;
}

const PROMPT_ACTUAL = `Eres Valeria, psicóloga vocacional de AJUCON. Tu metodología es RIASEC. Hablas con escolares de secundaria en Tacna, Perú. Respuestas muy cortas (2-3 líneas). Una pregunta por turno. Acumulas perfil vocacional mediante conversación natural.`;

const PROMPT_REVISOR = `Eres un experto en diseño de prompts para agentes conversacionales de orientación vocacional.

Tu tarea es analizar conversaciones reales entre Valeria (psicóloga vocacional IA) y estudiantes peruanos de secundaria, y proponer mejoras concretas al prompt de Valeria.

== PROMPT ACTUAL DE VALERIA (resumen) ==
${PROMPT_ACTUAL}

== LO QUE DEBES ANALIZAR ==
Para cada conversación, observa:
- ¿Valeria hizo preguntas que los estudiantes no entendieron?
- ¿Los estudiantes respondieron con monosílabos (sí/no) sin dar información útil para el perfil?
- ¿Valeria dio respuestas largas o complejas para el nivel escolar?
- ¿El perfil RIASEC avanzó o se quedó estancado?
- ¿Valeria repitió preguntas o perdió el hilo?
- ¿Hubo frustraciones, abandonos o respuestas fuera de tema?

== FORMATO DE SALIDA ==
Responde en este JSON exacto:
{
  "analisis": "párrafo de 3-5 líneas con los patrones observados",
  "sugerencias": [
    {
      "problema": "descripción breve del problema detectado",
      "mejora": "cambio concreto al prompt o estrategia para solucionarlo",
      "ejemplo": "ejemplo de pregunta o respuesta mejorada (opcional)"
    }
  ]
}

Da entre 3 y 6 sugerencias concretas y accionables. Prioriza las que más impacto tendrían en la calidad del perfil RIASEC.`;

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).end();

  if (!autenticado(req)) return res.status(401).json({ error: 'No autorizado.' });

  // Obtener conversaciones de las últimas 48h con sus mensajes
  const desde = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: convs } = await supabase
    .from('conversations')
    .select('id, user_id, created_at')
    .eq('agente', 'psicologa')
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!convs || convs.length === 0) {
    return res.status(200).json({ mensaje: 'No hay conversaciones recientes para analizar.' });
  }

  // Cargar mensajes de cada conversación
  const conversacionesTexto = [];
  for (const conv of convs) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });

    if (!msgs || msgs.length < 3) continue; // Ignorar conversaciones muy cortas

    const texto = msgs.map(m => `${m.role === 'user' ? 'Estudiante' : 'Valeria'}: ${m.content}`).join('\n');
    conversacionesTexto.push(`--- Conversación ${conversacionesTexto.length + 1} ---\n${texto}`);
  }

  if (conversacionesTexto.length === 0) {
    return res.status(200).json({ mensaje: 'No hay conversaciones con suficientes mensajes para analizar.' });
  }

  const contenidoAnalisis = conversacionesTexto.join('\n\n');

  // Llamar a Claude para análisis
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `${PROMPT_REVISOR}\n\n== CONVERSACIONES A ANALIZAR ==\n\n${contenidoAnalisis}`,
    }],
  });

  let resultado;
  try {
    const texto = response.content[0].text;
    const jsonMatch = texto.match(/\{[\s\S]+\}/);
    resultado = JSON.parse(jsonMatch[0]);
  } catch {
    return res.status(500).json({ error: 'Error al parsear respuesta del revisor.', raw: response.content[0].text });
  }

  // Guardar en Supabase
  await supabase.from('prompt_suggestions').insert({
    analisis: resultado.analisis,
    sugerencias: resultado.sugerencias,
    convs_analizadas: conversacionesTexto.length,
  });

  return res.status(200).json({
    ok: true,
    convs_analizadas: conversacionesTexto.length,
    ...resultado,
  });
}
