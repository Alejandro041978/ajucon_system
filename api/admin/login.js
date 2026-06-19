import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos.' });

  // Verificar contra tabla admin_users
  const { data: admin } = await supabase
    .from('admin_users')
    .select('id, nombre, apellido, email, password_hash, activo')
    .eq('email', email)
    .single();

  // Fallback: credenciales de env vars (para el admin inicial)
  if (!admin) {
    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }
    const token = jwt.sign({ role: 'admin', email }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return res.status(200).json({ token, nombre: 'Administrador' });
  }

  if (!admin.activo) return res.status(401).json({ error: 'Cuenta desactivada.' });

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas.' });

  const token = jwt.sign({ role: 'admin', email: admin.email, id: admin.id }, process.env.JWT_SECRET, { expiresIn: '8h' });
  return res.status(200).json({ token, nombre: admin.nombre });
}
