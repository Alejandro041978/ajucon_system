import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' || p.role === 'super_admin' ? p : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (!verifyAdmin(req)) return res.status(403).json({ error: 'No autorizado.' });

  // GET — listar mejoras
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('valeria_mejoras')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  // POST — procesar reporte con IA y crear mejoras
  if (req.method === 'POST') {
    const { reporte, fecha } = req.body;
    if (!reporte?.trim()) return res.status(400).json({ error: 'Reporte vacío.' });

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Analiza este reporte de revisión del asistente Valeria y extrae cada sugerencia de mejora.

Para cada problema/sugerencia, clasifícala en:
- "prompt": la mejora se implementa añadiendo o modificando instrucciones en el prompt del sistema
- "conocimiento": la mejora requiere que un humano provea información específica (datos reales, contenido de dominio) que Valeria no puede tener por sí sola

Responde SOLO con un array JSON válido, sin markdown, con este formato:
[
  {
    "tipo": "prompt",
    "problema": "descripción breve del problema",
    "mejora_propuesta": "descripción de la mejora",
    "cambio_prompt": "texto exacto a agregar al prompt de Valeria (solo para tipo prompt)"
  }
]

REPORTE:
${reporte}`,
      }],
    });

    let mejoras;
    try {
      const raw = msg.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      mejoras = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: 'No se pudo parsear la respuesta de IA.' });
    }

    const reporte_fecha = fecha || new Date().toISOString().slice(0, 10);
    const rows = mejoras.map(m => ({
      tipo: m.tipo,
      problema: m.problema,
      mejora_propuesta: m.mejora_propuesta,
      cambio_prompt: m.cambio_prompt || null,
      estado: 'pendiente',
      reporte_fecha,
    }));

    const { data, error } = await supabase.from('valeria_mejoras').insert(rows).select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ creadas: data.length, mejoras: data });
  }

  // PATCH — aprobar o rechazar una mejora
  if (req.method === 'PATCH') {
    const { id, estado } = req.body;
    if (!id || !['aprobada', 'rechazada'].includes(estado)) {
      return res.status(400).json({ error: 'Parámetros inválidos.' });
    }

    const { data: mejora } = await supabase.from('valeria_mejoras').select('*').eq('id', id).single();
    if (!mejora) return res.status(404).json({ error: 'Mejora no encontrada.' });

    // Si se aprueba y es de tipo prompt, aplicar al prompt de Valeria
    if (estado === 'aprobada' && mejora.tipo === 'prompt' && mejora.cambio_prompt) {
      const { data: config } = await supabase
        .from('valeria_config')
        .select('*')
        .order('version', { ascending: false })
        .limit(1)
        .single();

      if (config) {
        const nuevoPrompt = config.prompt + '\n\n== MEJORA APLICADA ==\n' + mejora.cambio_prompt;
        const { error: insertErr } = await supabase.from('valeria_config').insert({
          prompt: nuevoPrompt,
          version: config.version + 1,
        });
        if (insertErr) return res.status(500).json({ error: insertErr.message });
      }
    }

    const { error } = await supabase.from('valeria_mejoras').update({ estado }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
