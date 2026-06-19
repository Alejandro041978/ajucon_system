export default async function handler(req, res) {
  const TOKEN = process.env.METRICOOL_TOKEN;
  const BASE = 'https://app.metricool.com/api/v2';

  const H = { 'X-Mc-Auth': TOKEN, 'Content-Type': 'application/json' };
  const minBody = JSON.stringify({ text: 'test', publicationDate: { dateTime: '2026-06-25T10:00:00' }, providers: [{ name: 'FACEBOOK', text: 'test' }] });

  // Probar con blogId en el body
  const intentos = [];
  for (const id of [1, 2, 3, 100, 1000, 10000]) {
    intentos.push({
      nombre: `POST blogId=${id} en body`,
      url: `${BASE}/scheduler/posts`,
      method: 'POST',
      body: JSON.stringify({ blogId: id, text: 'test', publicationDate: { dateTime: '2026-06-25T10:00:00' }, providers: [{ name: 'FACEBOOK', text: 'test' }] }),
      headers: H,
    });
  }
  // Probar con blogId como query param
  intentos.push({ nombre: 'GET /scheduler/posts detalle', url: `${BASE}/scheduler/posts`, headers: { 'X-Mc-Auth': TOKEN } });
  intentos.push({ nombre: 'GET /analytics/stats', url: `${BASE}/analytics/stats`, headers: { 'X-Mc-Auth': TOKEN } });

  const resultados = [];
  for (const intento of intentos) {
    try {
      const r = await fetch(intento.url, { headers: intento.headers || {} });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }
      resultados.push({ nombre: intento.nombre, status: r.status, ok: r.ok, data });
    } catch (e) {
      resultados.push({ nombre: intento.nombre, error: e.message });
    }
  }

  return res.status(200).json(resultados);
}
