import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HF_BASE = 'https://platform.higgsfield.ai';

async function uploadToSupabase(externalUrl, folder, ext) {
  try {
    const resp = await fetch(externalUrl);
    if (!resp.ok) return externalUrl; // fallback a URL original
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

function hfHeaders() {
  return {
    'Authorization': `Key ${process.env.HIGGSFIELD_API_KEY}:${process.env.HIGGSFIELD_SECRET}`,
    'Content-Type': 'application/json',
  };
}

function extractStatus(hfData) {
  if (typeof hfData.status === 'string') return hfData.status;
  const job = hfData.data?.jobs?.[0];
  if (job?.status) return job.status;
  return null;
}

function extractImageUrl(hfData) {
  // Documented response: { images: [{url}] }
  if (hfData.images?.[0]?.url) return hfData.images[0].url;
  if (Array.isArray(hfData.images) && typeof hfData.images[0] === 'string') return hfData.images[0];
  // fallbacks
  const job = hfData.data?.jobs?.[0];
  if (job?.results?.[0]?.url) return job.results[0].url;
  if (hfData.result?.url) return hfData.result.url;
  if (hfData.output?.[0]) return hfData.output[0];
  if (hfData.url) return hfData.url;
  return null;
}

function extractVideoUrl(hfData) {
  // Documented response: { video: {url} }
  if (hfData.video?.url) return hfData.video.url;
  return extractImageUrl(hfData);
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
  if (req.method !== 'GET') return res.status(405).end();
  if (!verifyAdmin(req)) return res.status(401).json({ error: 'No autorizado.' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID requerido.' });

  const { data: post } = await supabase.from('social_posts').select('*').eq('id', id).single();
  if (!post) return res.status(404).json({ error: 'Post no encontrado.' });

  let _hfPollDebug = null;

  // Agente 5 (media-assembler): esperar imagen y luego arrancar video
  if (post.estado === 'generando_imagen' && post.imagen_request_id) {
    let hfData;
    try {
      const hfRes = await fetch(`${HF_BASE}/requests/${post.imagen_request_id}/status`, {
        headers: hfHeaders(),
      });
      hfData = await hfRes.json();
      _hfPollDebug = { http: hfRes.status, data: hfData };
      console.log('Poll imagen:', hfRes.status, JSON.stringify(hfData).slice(0, 400));
    } catch (e) {
      console.error('Poll imagen error:', e.message);
      _hfPollDebug = { error: e.message };
      return res.status(200).json({ ...post, _hf_debug: _hfPollDebug });
    }

    const imgStatus = extractStatus(hfData);
    console.log('imgStatus extraído:', imgStatus);
    if (imgStatus === 'completed') {
      const rawImagenUrl = extractImageUrl(hfData);
      const imagenUrl = rawImagenUrl ? await uploadToSupabase(rawImagenUrl, 'imagenes', 'png') : null;
      if (imagenUrl) {
        // Arrancar DoP Turbo (image → video)
        let videoRequestId = null;
        try {
          const videoRes = await fetch(`${HF_BASE}/higgsfield-ai/dop/turbo`, {
            method: 'POST',
            headers: hfHeaders(),
            body: JSON.stringify({
              image_url: imagenUrl,
              prompt: post.brief?.hook || post.tema || '',
              enhance_prompt: true,
            }),
          });
          const videoData = await videoRes.json();
          videoRequestId = videoData.request_id || null;
          if (!videoRequestId) {
            console.error('DoP Turbo sin request_id:', JSON.stringify(videoData).slice(0, 300));
          }
        } catch (e) {
          console.error('DoP Turbo error:', e.message);
        }

        await supabase.from('social_posts').update({
          imagen_url: imagenUrl,
          video_request_id: videoRequestId,
          estado: videoRequestId ? 'generando_video' : 'listo',
          updated_at: new Date().toISOString(),
        }).eq('id', id);
      }
    } else if (imgStatus === 'failed' || imgStatus === 'nsfw') {
      await supabase.from('social_posts').update({
        estado: 'error',
        notas_calidad: `Imagen rechazada: ${imgStatus}`,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    }
  }

  // Agente 5 continuación: esperar video
  else if (post.estado === 'generando_video' && post.video_request_id) {
    let hfData;
    try {
      const hfRes = await fetch(`${HF_BASE}/requests/${post.video_request_id}/status`, {
        headers: hfHeaders(),
      });
      hfData = await hfRes.json();
    } catch (e) {
      console.error('Poll video error:', e.message);
      return res.status(200).json(post);
    }

    const vidStatus = extractStatus(hfData);
    if (vidStatus === 'completed') {
      const rawVideoUrl = extractVideoUrl(hfData);
      const videoUrl = rawVideoUrl ? await uploadToSupabase(rawVideoUrl, 'videos', 'mp4') : null;
      if (videoUrl) {
        // Agente 6: quality-guardian
        let aprobado = true;
        let notas = 'Aprobado automáticamente.';
        try {
          const qgRes = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 256,
            messages: [{
              role: 'user',
              content: `Eres quality guardian de AJUCON, institución educativa peruana. Revisa este contenido de redes sociales:

TEMA: ${post.tema}
FACEBOOK: ${post.captions?.facebook || ''}
INSTAGRAM: ${post.captions?.instagram || ''}
TIKTOK: ${post.captions?.tiktok || ''}

Verifica: ¿Es apropiado para una institución educativa? ¿El tono es correcto? ¿Algo ofensivo o inapropiado?
Responde SOLO en JSON: {"aprobado":true,"notas":"breve observación"}`,
            }],
          });
          const txt = qgRes.content[0].text.trim();
          const i = txt.indexOf('{');
          const f = txt.lastIndexOf('}');
          if (i !== -1) {
            const qg = JSON.parse(txt.slice(i, f + 1));
            aprobado = qg.aprobado !== false;
            notas = qg.notas || notas;
          }
        } catch (e) {
          console.error('Quality guardian error:', e.message);
        }

        await supabase.from('social_posts').update({
          video_url: videoUrl,
          estado: aprobado ? 'listo' : 'revision_requerida',
          aprobado,
          notas_calidad: notas,
          updated_at: new Date().toISOString(),
        }).eq('id', id);
      }
    } else if (vidStatus === 'failed' || vidStatus === 'nsfw') {
      // Video falló: marcar listo con solo imagen
      await supabase.from('social_posts').update({
        estado: 'listo',
        aprobado: true,
        notas_calidad: `Video ${vidStatus} — se publicará con imagen estática`,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    }
  }

  const { data: final } = await supabase.from('social_posts').select('*').eq('id', id).single();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ...final, _hf_debug: _hfPollDebug });
}
