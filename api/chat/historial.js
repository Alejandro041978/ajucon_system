import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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

  const agente = req.query.agente || 'psicologa';

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_id', payload.id)
    .eq('agente', agente)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!conv) return res.status(200).json({ conversation_id: null, messages: [], perfil: null });

  const [{ data: messages }, { data: perfil }] = await Promise.all([
    supabase.from('messages').select('role, content').eq('conversation_id', conv.id).order('created_at', { ascending: true }),
    supabase.from('riasec_profiles').select('R,I,A,S,E,C,completitud').eq('user_id', payload.id).single(),
  ]);

  return res.status(200).json({
    conversation_id: conv.id,
    messages: messages || [],
    perfil: perfil || null,
  });
}
