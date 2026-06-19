import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const METRICOOL_BASE = 'https://app.metricool.com/api/v2';

function verifyAdmin(req) {
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (!auth) return null;
  try {
    const p = jwt.verify(auth, process.env.JWT_SECRET);
    return p.role === 'admin' ? p : null;
  } catch { return null; }
}

async function metricoolFetch(path, options = {}) {
  const url = `${METRICOOL_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Mc-Auth': process.env.METRICOOL_TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error(`Metricool ${options.method || 'GET'} ${path} → ${res.status}:`, text.slice(0, 500));
  }
  return { ok: res.ok, status: res.status, data };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  const { post_id, fecha } = req.body;
  if (!post_id) return res.status(400).json({ error: 'post_id requerido.' });

  const { data: post } = await supabase.from('social_posts').select('*').eq('id', post_id).single();
  if (!post) return res.status(404).json({ error: 'Post no encontrado.' });
  if (!['listo', 'revision_requerida'].includes(post.estado)) {
    return res.status(400).json({ error: 'El post aún no está listo para publicar.' });
  }

  // Verificar conexión con Metricool
  const pingRes = await metricoolFetch('/scheduler/posts');
  if (!pingRes.ok) {
    return res.status(502).json({ error: 'Error conectando con Metricool.', detalle: pingRes.data });
  }

  // Determinar la URL de media a usar (video preferido sobre imagen)
  const mediaUrl = post.video_url || post.imagen_url || null;

  // Construir el body del post para Metricool
  // Metricool API v2: POST /posts con scheduled_at y redes configuradas
  const dt = fecha ? new Date(fecha) : new Date(Date.now() + 5 * 60 * 1000);
  // Metricool espera dateTime como string ISO sin timezone (UTC asumido)
  const scheduledAt = dt.toISOString().slice(0, 19);

  const providers = [];
  const redes = post.redes || [];

  if (redes.includes('facebook')) {
    providers.push({
      network: 'FACEBOOK',
      text: post.captions?.facebook || '',
      ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}),
    });
  }
  if (redes.includes('instagram')) {
    providers.push({
      network: 'INSTAGRAM',
      text: post.captions?.instagram || '',
      ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}),
    });
  }
  if (redes.includes('tiktok')) {
    providers.push({
      network: 'TIKTOK',
      text: post.captions?.tiktok || '',
      ...(post.video_url ? { mediaUrls: [post.video_url] } : {}),
    });
  }
  if (redes.includes('youtube')) {
    providers.push({
      network: 'YOUTUBE',
      title: post.captions?.youtube_titulo || post.tema,
      text: post.captions?.youtube_descripcion || '',
      ...(post.video_url ? { mediaUrls: [post.video_url] } : {}),
    });
  }

  const publishBody = {
    blogId: 6025050,
    text: post.captions?.facebook || post.captions?.instagram || post.tema || '',
    publicationDate: { dateTime: scheduledAt },
    providers,
  };

  const pubRes = await metricoolFetch('/scheduler/posts?blogId=6025050', {
    method: 'POST',
    body: JSON.stringify(publishBody),
  });

  if (!pubRes.ok) {
    return res.status(502).json({
      error: 'Metricool rechazó el post.',
      detalle: pubRes.data,
      body_enviado: publishBody,
    });
  }

  // Actualizar estado en BD
  await supabase.from('social_posts').update({
    estado: 'publicado',
    publicado_en: new Date().toISOString(),
    metricool_resultado: pubRes.data,
    updated_at: new Date().toISOString(),
  }).eq('id', post_id);

  return res.status(200).json({ ok: true, metricool: pubRes.data });
}
