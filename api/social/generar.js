import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HF_BASE = 'https://platform.higgsfield.ai';

function hfHeaders() {
  return {
    'Authorization': `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_SECRET}`,
    'Content-Type': 'application/json',
  };
}

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' ? p : null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const admin = verifyAdmin(req);
  if (!admin) return res.status(401).json({ error: 'No autorizado.' });

  const { tema, redes = ['facebook', 'instagram', 'tiktok', 'youtube'], fecha_publicacion, modelo = 'soul' } = req.body;
  if (!tema) return res.status(400).json({ error: 'Tema requerido.' });

  // Agentes 1-4: social-director + content-strategist + copywriter + creative-director
  let plan;
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Eres un equipo de marketing digital para AJUCON, plataforma de orientación vocacional en Tacna, Perú. Ayudamos a jóvenes de secundaria a encontrar su camino profesional, con especial foco en el Instituto Neumann (convenio con Blackwell Global University: 2 años presencial en Tacna + 2 años online, título universitario reconocido por SUNEDU).

TEMA DEL CONTENIDO: "${tema}"
REDES OBJETIVO: ${redes.join(', ')}
AUDIENCIA: Jóvenes 14-20 años y sus padres en Tacna, Perú.

Actúa como 4 agentes secuenciales:

AGENTE 1 - Social Director: Define el ángulo estratégico (objetivo: awareness, engagement o conversión) y por qué este tema conecta con la audiencia.

AGENTE 2 - Content Strategist: Brief ejecutivo: hook principal, mensaje clave, llamada a la acción y tono adecuado.

AGENTE 3 - Copywriter: Copy adaptado por red social (SOLO para las redes en REDES OBJETIVO, deja vacío el resto):
${redes.includes('facebook') ? '- facebook: hasta 500 caracteres. Tono profesional y cálido. Orientado a padres y jóvenes.' : ''}
${redes.includes('instagram') ? '- instagram: hasta 300 caracteres + exactamente 6 hashtags relevantes en español peruano.' : ''}
${redes.includes('tiktok') ? '- tiktok: máximo 150 caracteres. Gancho viral. Tono joven y directo. Hasta 2 emojis estratégicos.' : ''}
${redes.includes('youtube') ? '- youtube_titulo: máximo 60 caracteres. Llamativo para Shorts educativos.\n- youtube_descripcion: máximo 200 caracteres con llamada a la acción.' : ''}

AGENTE 4 - Creative Director: Prompt en inglés para generar una imagen fotorrealista con IA. La imagen debe mostrar jóvenes estudiantes peruanos en un ambiente educativo moderno, optimista y profesional. Evitar texto, logos o números en la imagen. Photorealistic, natural lighting, bright colors, authentic Peruvian youth in modern educational setting.

Responde SOLO en JSON válido, sin texto adicional antes ni después:
{
  "estrategia": { "angulo": "", "objetivo": "", "audiencia": "" },
  "brief": { "hook": "", "mensaje_clave": "", "cta": "", "tono": "" },
  "captions": {
    "facebook": "",
    "instagram": "",
    "tiktok": "",
    "youtube_titulo": "",
    "youtube_descripcion": ""
  },
  "imagen_prompt": ""
}`,
      }],
    });

    const txt = r.content[0].text.trim();
    const i = txt.indexOf('{');
    const f = txt.lastIndexOf('}');
    if (i === -1) throw new Error('Claude no devolvió JSON válido');
    plan = JSON.parse(txt.slice(i, f + 1));
  } catch (e) {
    console.error('Error agentes texto:', e.message);
    return res.status(500).json({ error: 'Error en agentes de texto: ' + e.message });
  }

  // Agente 5: higgsfield-creative-director → genera imagen con Soul
  let imagenRequestId = null;
  let hfDebug = null;
  try {
    const hfEndpoint = modelo === 'soul-cinema' ? '/higgsfield-ai/soul/cinema' : '/v1/text2image/soul';
    const hfRes = await fetch(`${HF_BASE}${hfEndpoint}`, {
      method: 'POST',
      headers: hfHeaders(),
      body: JSON.stringify({
        params: {
          prompt: plan.imagen_prompt,
          quality: '720p',
          width_and_height: '1536x1536',
          batch_size: 1,
          enhance_prompt: true,
        },
        webhook: null,
      }),
    });
    const hfData = await hfRes.json();
    hfDebug = { status: hfRes.status, data: hfData };
    imagenRequestId = hfData.request_id || hfData.data?.id || hfData.id || null;
    if (!imagenRequestId) {
      console.error('Higgsfield Soul sin request_id:', JSON.stringify(hfData).slice(0, 500));
    }
  } catch (e) {
    hfDebug = { error: e.message };
    console.error('Higgsfield Soul error:', e.message);
  }

  const { data: post, error } = await supabase
    .from('social_posts')
    .insert({
      tema,
      redes,
      fecha_publicacion: fecha_publicacion || null,
      estado: imagenRequestId ? 'generando_imagen' : 'listo',
      estrategia: plan.estrategia,
      brief: plan.brief,
      captions: plan.captions,
      imagen_prompt: plan.imagen_prompt,
      imagen_request_id: imagenRequestId,
      notas_calidad: imagenRequestId ? null : `HF_DEBUG: ${JSON.stringify(hfDebug)}`,
      creado_por: admin.email,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ post_id: post.id, estado: post.estado, hf_debug: hfDebug });
}
