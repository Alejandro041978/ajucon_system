import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { data, error } = await supabase
    .from('convenios')
    .select('id, institucion, nombre_contacto, telefono_contacto')
    .eq('activo', true)
    .order('institucion', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json(data || []);
}
