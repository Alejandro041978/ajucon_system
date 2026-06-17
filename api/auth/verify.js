import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, code } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email y código son requeridos.' });
  }

  // Buscar código válido y no usado
  const { data: rows, error } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('email', email)
    .eq('code', code)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !rows || rows.length === 0) {
    return res.status(401).json({ error: 'Código inválido o expirado.' });
  }

  // Marcar código como usado
  await supabase
    .from('verification_codes')
    .update({ used: true })
    .eq('id', rows[0].id);

  // Obtener datos del usuario
  const { data: user } = await supabase
    .from('users')
    .select('id, nombre, email, grado')
    .eq('email', email)
    .single();

  const token = jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  return res.status(200).json({ token, user });
}
