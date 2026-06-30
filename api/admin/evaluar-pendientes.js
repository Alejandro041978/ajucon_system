import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PUNTAJE_MINIMO = 65;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-cron-secret'];
  if (!secret || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  const { data: pendientes, error } = await supabase
    .from('becas_profesionales')
    .select('id, carrera_interes, modalidad, promedio_notas, situacion_economica, motivacion, beca_id, beca_nombre, beca_institucion, user_id')
    .eq('estado', 'pendiente')
    .is('puntaje_ia', null)
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  if (!pendientes?.length) return res.status(200).json({ evaluadas: 0 });

  let evaluadas = 0;

  for (const p of pendientes) {
    try {
      let condicion_requisitos = null;
      if (p.beca_id) {
        const { data: beca } = await supabase
          .from('becas_disponibles').select('condicion_requisitos').eq('id', p.beca_id).single();
        condicion_requisitos = beca?.condicion_requisitos || null;
      }

      const prompt = `Eres un evaluador de becas académicas de AJUCON, plataforma peruana de orientación vocacional.

Evalúa la siguiente postulación y devuelve SOLO un JSON válido con este formato exacto:
{"puntaje": <número 0-100>, "aprobada": <true/false>, "evaluacion": "<texto breve en español>"}

Criterios de evaluación:
- Promedio de notas (escala 0-20): peso 40%. Promedio >= 14 es bueno, >= 16 excelente. Promedio < 12 es deficiente.
- Situación económica: peso 30%. "Muy vulnerable" = máximo puntaje, "Vulnerable" = bueno, "Media-baja" = regular.
- Carta de motivación: peso 30%. Evalúa claridad, coherencia, metas concretas y genuinidad.
- Puntaje mínimo para aprobar: ${PUNTAJE_MINIMO}/100.

Datos de la postulación:
- Beca: ${p.beca_nombre || 'No especificada'}
- Institución: ${p.beca_institucion || 'No especificada'}
- Requisitos de la beca: ${condicion_requisitos || 'No especificados'}
- Carrera de interés: ${p.carrera_interes}
- Modalidad: ${p.modalidad}
- Promedio de notas: ${p.promedio_notas}/20
- Situación económica: ${p.situacion_economica}
- Carta de motivación: "${p.motivacion}"

Responde SOLO con el JSON, sin texto adicional.`;

      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const resultado = JSON.parse(msg.content[0].text.trim());
      const estado = resultado.aprobada ? 'aprobada' : 'rechazada';

      await supabase.from('becas_profesionales').update({
        puntaje_ia: resultado.puntaje,
        evaluacion_ia: resultado.evaluacion,
        estado,
      }).eq('id', p.id);

      evaluadas++;
    } catch (err) {
      console.error(`[EVAL ERROR] id=${p.id}`, err.message);
      return res.status(200).json({ evaluadas, total: pendientes.length, error_debug: err.message, error_id: p.id });
    }
  }

  return res.status(200).json({ evaluadas, total: pendientes.length });
}
