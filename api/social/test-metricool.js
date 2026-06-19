export default async function handler(req, res) {
  const TOKEN = process.env.METRICOOL_TOKEN;
  const BASE = 'https://app.metricool.com/api/v2';

  const H = { 'X-Mc-Auth': TOKEN };

  const intentos = [
    { nombre: '/brands', url: `${BASE}/brands`, headers: H },
    { nombre: '/accounts', url: `${BASE}/accounts`, headers: H },
    { nombre: '/profile', url: `${BASE}/profile`, headers: H },
    { nombre: '/me', url: `${BASE}/me`, headers: H },
    { nombre: '/blogs', url: `${BASE}/blogs`, headers: H },
    { nombre: '/social/posts', url: `${BASE}/social/posts`, headers: H },
    { nombre: '/scheduler', url: `${BASE}/scheduler`, headers: H },
    { nombre: '/scheduler/posts', url: `${BASE}/scheduler/posts`, headers: H },
    { nombre: '/posts', url: `${BASE}/posts`, headers: H },
    { nombre: '/networks', url: `${BASE}/networks`, headers: H },
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
