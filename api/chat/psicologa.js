import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres una psicóloga vocacional empática y profesional que ayuda a estudiantes escolares chilenos a descubrir su vocación y orientarse sobre su futuro académico y laboral.

Tu rol:
- Escuchar activamente los intereses, habilidades y dudas del estudiante
- Hacer preguntas reflexivas para ayudarle a autoconocerse mejor
- Orientar sobre carreras, áreas de estudio y opciones universitarias en Chile
- Entregar información sobre el sistema de educación superior chileno (CRUCH, PDT, CFT, IP, universidades)
- Ser cercana, motivadora y libre de juicios

Nunca diagnostiques condiciones de salud mental. Si detectas una crisis emocional, deriva amablemente a un profesional de salud.
Responde siempre en español, de forma cálida y en un tono adecuado para adolescentes.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verificar JWT
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'No autorizado.' });

  let payload;
  try {
    payload = jwt.verify(auth, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const { mensaje, conversation_id } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'Mensaje requerido.' });

  // Obtener o crear conversación
  let convId = conversation_id;
  if (!convId) {
    const { data: conv } = await supabase
      .from('conversations')
      .insert({ user_id: payload.id, agente: 'psicologa' })
      .select('id')
      .single();
    convId = conv.id;
  }

  // Guardar mensaje del usuario
  await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: mensaje });

  // Obtener historial (últimos 20 mensajes)
  const { data: historial } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(20);

  // Llamar a Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: historial.map(m => ({ role: m.role, content: m.content })),
  });

  const respuesta = response.content[0].text;

  // Guardar respuesta del asistente
  await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content: respuesta });

  return res.status(200).json({ respuesta, conversation_id: convId });
}
