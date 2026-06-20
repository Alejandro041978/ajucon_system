import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HF_BASE = 'https://platform.higgsfield.ai';
const METRICOOL_BASE = 'https://app.metricool.com/api/v2';
const BLOG_ID = 6025050;

function hfHeaders() {
  return {
    'Authorization': `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_SECRET}`,
    'Content-Type': 'application/json',
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function uploadToSupabase(externalUrl, folder, ext) {
  try {
    const resp = await fetch(externalUrl);
    if (!resp.ok) return externalUrl;
    const buffer = await resp.arrayBuffer();
    const fileName = `${folder}/${Date.now()}.${ext}`;
    const contentType = ext === 'mp4' ? 'video/mp4' : 'image/png';
    const { error } = await supabase.storage
      .from('social-media')
      .upload(fileName, Buffer.from(buffer), { contentType, upsert: false });
    if (error) return externalUrl;
    const { data } = supabase.storage.from('social-media').getPublicUrl(fileName);
    return data.publicUrl;
  } catch {
    return externalUrl;
  }
}

function extractImageUrl(hfData) {
  if (hfData.images?.[0]?.url) return hfData.images[0].url;
  if (Array.isArray(hfData.images) && typeof hfData.images[0] === 'string') return hfData.images[0];
  const job = hfData.data?.jobs?.[0];
  if (job?.results?.[0]?.url) return job.results[0].url;
  if (hfData.result?.url) return hfData.result.url;
  if (hfData.output?.[0]) return hfData.output[0];
  if (hfData.url) return hfData.url;
  return null;
}

export default async function handler(req, res) {
  // Verificar CRON_SECRET para seguridad
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const log = [];
  const L = (msg) => { log.push(msg); console.log('[AUTO]', msg); };

  try {
    // 1. Obtener siguiente tema de la rotación
    const { data: configRow } = await supabase
      .from('social_config')
      .select('valor')
      .eq('clave', 'social_tema_index')
      .single();

    const { data: temas } = await supabase
      .from('social_temas')
      .select('*')
      .eq('activo', true)
      .order('orden');

    if (!temas || temas.length === 0) {
      return res.status(200).json({ ok: false, error: 'No hay temas activos configurados.', log });
    }

    const currentIndex = parseInt(configRow?.valor || '0') % temas.length;
    const tema = temas[currentIndex];
    const nextIndex = (currentIndex + 1) % temas.length;

    L(`Tema #${currentIndex + 1}: "${tema.tema}"`);

    // Avanzar índice en BD inmediatamente
    await supabase.from('social_config')
      .update({ valor: String(nextIndex) })
      .eq('clave', 'social_tema_index');

    // 2. Claude: generar copies (FB+IG unificado + imagen_prompt)
    L('Llamando a Claude para generar copies...');
    const claudeRes = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Eres un equipo de marketing digital para AJUCON, plataforma de orientación vocacional en Tacna, Perú. Ayudamos a jóvenes de secundaria a encontrar su camino profesional, con especial foco en el Instituto Neumann (convenio con Blackwell Global University: 2 años presencial en Tacna + 2 años online, título universitario reconocido por SUNEDU).

TEMA DEL CONTENIDO: "${tema.tema}"
REDES OBJETIVO: Facebook e Instagram
AUDIENCIA: Jóvenes 14-20 años y sus padres en Tacna, Perú.

Actúa como 4 agentes secuenciales:

AGENTE 1 - Social Director: Define el ángulo estratégico (objetivo: awareness, engagement o conversión).

AGENTE 2 - Content Strategist: Brief ejecutivo: hook principal, mensaje clave, llamada a la acción y tono.

AGENTE 3 - Copywriter: Un solo texto para Facebook e Instagram: máximo 300 caracteres, tono empático y cercano, orientado a padres y jóvenes, termina con exactamente 5 hashtags relevantes en español peruano.

AGENTE 4 - Creative Director: Prompt en inglés para generar imagen fotorrealista con IA. Jóvenes estudiantes peruanos en ambiente educativo moderno. Sin texto, logos ni números. Photorealistic, natural lighting, bright colors, authentic Peruvian youth.

Responde SOLO en JSON válido:
{
  "estrategia": { "angulo": "", "objetivo": "", "audiencia": "" },
  "brief": { "hook": "", "mensaje_clave": "", "cta": "", "tono": "" },
  "caption": "",
  "imagen_prompt": ""
}`,
      }],
    });

    const txt = claudeRes.content[0].text.trim();
    const i = txt.indexOf('{');
    const f = txt.lastIndexOf('}');
    if (i === -1) throw new Error('Claude no devolvió JSON válido');
    const plan = JSON.parse(txt.slice(i, f + 1));
    L('Copies generados correctamente.');

    // 3. Higgsfield Soul Cinema: generar imagen
    L('Iniciando generación de imagen con Higgsfield Soul Cinema...');
    const hfRes = await fetch(`${HF_BASE}/higgsfield-ai/soul/cinema`, {
      method: 'POST',
      headers: hfHeaders(),
      body: JSON.stringify({
        prompt: plan.imagen_prompt,
        quality: '720p',
        width_and_height: '1536x1536',
        batch_size: 1,
        enhance_prompt: true,
      }),
    });
    const hfData = await hfRes.json();
    const requestId = hfData.request_id || hfData.data?.id || hfData.id || null;
    if (!requestId) throw new Error(`Higgsfield no devolvió request_id: ${JSON.stringify(hfData).slice(0, 200)}`);
    L(`Imagen en cola. request_id: ${requestId}`);

    // 4. Polling hasta que la imagen esté lista (máx 240s)
    L('Esperando que la imagen se complete...');
    let imagenUrl = null;
    const maxWait = 240000;
    const pollInterval = 8000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await sleep(pollInterval);
      const pollRes = await fetch(`${HF_BASE}/requests/${requestId}/status`, { headers: hfHeaders() });
      const pollData = await pollRes.json();
      const status = pollData.status || pollData.data?.jobs?.[0]?.status;
      L(`Poll imagen: ${status}`);

      if (status === 'completed') {
        const rawUrl = extractImageUrl(pollData);
        if (rawUrl) {
          imagenUrl = await uploadToSupabase(rawUrl, 'imagenes', 'png');
          L(`Imagen lista: ${imagenUrl}`);
        }
        break;
      }
      if (status === 'failed' || status === 'nsfw') {
        throw new Error(`Imagen rechazada por Higgsfield: ${status}`);
      }
    }

    if (!imagenUrl) throw new Error('Timeout esperando imagen de Higgsfield.');

    // 5. Guardar post en BD
    const { data: post, error: postError } = await supabase
      .from('social_posts')
      .insert({
        tema: tema.tema,
        redes: ['facebook', 'instagram'],
        estado: 'listo',
        estrategia: plan.estrategia,
        brief: plan.brief,
        captions: { facebook_instagram: plan.caption, facebook: plan.caption, instagram: plan.caption },
        imagen_prompt: plan.imagen_prompt,
        imagen_url: imagenUrl,
        aprobado: true,
        notas_calidad: 'Publicación automática.',
        creado_por: 'auto',
      })
      .select()
      .single();

    if (postError) throw new Error('Error guardando post: ' + postError.message);
    L(`Post guardado: ${post.id}`);

    // 6. Publicar en Metricool
    L('Publicando en Metricool...');
    const scheduledAt = new Date().toISOString().slice(0, 19);
    const publishBody = {
      blogId: BLOG_ID,
      text: plan.caption,
      publicationDate: { dateTime: scheduledAt },
      media: [imagenUrl],
      providers: [
        { network: 'FACEBOOK', text: plan.caption, media: [imagenUrl] },
        { network: 'INSTAGRAM', text: plan.caption, media: [imagenUrl] },
      ],
    };

    const mcRes = await fetch(`${METRICOOL_BASE}/scheduler/posts?blogId=${BLOG_ID}`, {
      method: 'POST',
      headers: { 'X-Mc-Auth': process.env.METRICOOL_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(publishBody),
    });
    const mcData = await mcRes.json();

    if (!mcRes.ok) {
      L(`Metricool rechazó: ${JSON.stringify(mcData).slice(0, 200)}`);
      await supabase.from('social_posts').update({ estado: 'error', notas_calidad: 'Metricool rechazó el post.' }).eq('id', post.id);
      return res.status(200).json({ ok: false, error: 'Metricool rechazó el post.', detalle: mcData, log });
    }

    await supabase.from('social_posts').update({
      estado: 'publicado',
      publicado_en: new Date().toISOString(),
      metricool_resultado: mcData,
    }).eq('id', post.id);

    L('¡Publicación automática completada!');
    return res.status(200).json({ ok: true, post_id: post.id, tema: tema.tema, imagen_url: imagenUrl, log });

  } catch (e) {
    L(`ERROR: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message, log });
  }
}
