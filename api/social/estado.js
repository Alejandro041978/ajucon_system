import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HF_BASE = 'https://platform.higgsfield.ai';

function hfHeaders() {
  return {
    'hf-api-key': process.env.HIGGSFIELD_API_KEY,
    'hf-secret': process.env.HIGGSFIELD_SECRET,
    'Content-Type': 'application/json',
  };
}

function extractUrl(data) {
  if (data.result?.url) return data.result.url;
  if (data.result?.urls?.[0]) return data.result.urls[0];
  if (Array.isArray(data.result) && data.result[0]) return data.result[0];
  if (data.output?.[0]) return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  if (data.url) return data.url;
  return null;
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

  // Agente 5 (media-assembler): esperar imagen y luego arrancar video
  if (post.estado === 'generando_imagen' && post.imagen_request_id) {
    let hfData;
    try {
      const hfRes = await fetch(`${HF_BASE}/requests/${post.imagen_request_id}/status`, {
        headers: hfHeaders(),
      });
      hfData = await hfRes.json();
    } catch (e) {
      console.error('Poll imagen error:', e.message);
      return res.status(200).json(post);
    }

    if (hfData.status === 'completed') {
      const imagenUrl = extractUrl(hfData);
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
    } else if (hfData.status === 'failed' || hfData.status === 'nsfw') {
      await supabase.from('social_posts').update({
        estado: 'error',
        notas_calidad: `Imagen rechazada: ${hfData.status}`,
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

    if (hfData.status === 'completed') {
      const videoUrl = extractUrl(hfData);
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
    } else if (hfData.status === 'failed' || hfData.status === 'nsfw') {
      // Video falló: marcar listo con solo imagen
      await supabase.from('social_posts').update({
        estado: 'listo',
        aprobado: true,
        notas_calidad: `Video ${hfData.status} — se publicará con imagen estática`,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
    }
  }

  const { data: final } = await supabase.from('social_posts').select('*').eq('id', id).single();
  return res.status(200).json(final);
}
