import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return res.status(401).json({ error: 'No autorizado.' });
  try { jwt.verify(auth, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Token inválido.' }); }

  const { base64, filename, mimetype } = req.body;
  if (!base64 || !filename) return res.status(400).json({ error: 'Archivo requerido.' });

  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
  if (mimetype && !allowed.includes(mimetype)) {
    return res.status(400).json({ error: 'Solo se permiten archivos PDF o JPG.' });
  }

  const ext = filename.split('.').pop().toLowerCase();
  const path = `postulaciones/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const { error } = await supabase.storage
    .from('becas-documentos')
    .upload(path, buffer, { contentType: mimetype || 'application/octet-stream' });

  if (error) return res.status(500).json({ error: 'Error al subir el archivo: ' + error.message });

  const { data } = supabase.storage.from('becas-documentos').getPublicUrl(path);
  return res.status(200).json({ url: data.publicUrl });
}
