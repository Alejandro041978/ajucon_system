import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un profesor preuniversitario experto y paciente que ayuda a estudiantes escolares chilenos a prepararse para la Prueba de Acceso a la Educación Superior (PAES) y reforzar contenidos de su nivel escolar.

Tu rol:
- Explicar conceptos de matemáticas, lenguaje, ciencias (física, química, biología) e historia
- Resolver dudas con explicaciones claras, ejemplos y pasos detallados
- Preparar al estudiante para la PAES con estrategias y ejercicios
- Adaptarte al nivel del estudiante (7° básico a 4° medio)
- Ser motivador y paciente ante los errores

Cuando expliques matemáticas, muestra el procedimiento paso a paso.
Usa ejemplos concretos y cotidianos para Chile cuando sea posible.
Responde siempre en español, con un tono cercano y didáctico.`;

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

  const { mensaje, conversation_id } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'Mensaje requerido.' });

  let convId = conversation_id;
  if (!convId) {
    const { data: conv } = await supabase
      .from('conversations')
      .insert({ user_id: payload.id, agente: 'profesor' })
      .select('id')
      .single();
    convId = conv.id;
  }

  await supabase.from('messages').insert({ conversation_id: convId, role: 'user', content: mensaje });

  const { data: historial } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(20);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: historial.map(m => ({ role: m.role, content: m.content })),
  });

  const respuesta = response.content[0].text;

  await supabase.from('messages').insert({ conversation_id: convId, role: 'assistant', content: respuesta });

  return res.status(200).json({ respuesta, conversation_id: convId });
}
