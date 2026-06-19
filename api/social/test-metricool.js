export default async function handler(req, res) {
  const TOKEN = process.env.METRICOOL_TOKEN;
  const BASE = 'https://app.metricool.com/api/v2';

  const b64 = Buffer.from(`:${TOKEN}`).toString('base64');
  const b64v2 = Buffer.from(`${TOKEN}:`).toString('base64');

  const intentos = [
    { nombre: 'token query param', url: `${BASE}/user?token=${TOKEN}` },
    { nombre: 'smToken query param', url: `${BASE}/user?smToken=${TOKEN}` },
    { nombre: 'access_token query param', url: `${BASE}/user?access_token=${TOKEN}` },
    { nombre: 'Bearer header', url: `${BASE}/user`, headers: { 'Authorization': `Bearer ${TOKEN}` } },
    { nombre: 'Token header', url: `${BASE}/user`, headers: { 'Authorization': `Token ${TOKEN}` } },
    { nombre: 'X-Mc-Auth header', url: `${BASE}/user`, headers: { 'X-Mc-Auth': TOKEN } },
    { nombre: 'Basic :token', url: `${BASE}/user`, headers: { 'Authorization': `Basic ${b64}` } },
    { nombre: 'Basic token:', url: `${BASE}/user`, headers: { 'Authorization': `Basic ${b64v2}` } },
    { nombre: 'token header lowercase', url: `${BASE}/user`, headers: { 'token': TOKEN } },
    { nombre: '/brands endpoint token param', url: `${BASE}/brands?token=${TOKEN}` },
  ];

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
