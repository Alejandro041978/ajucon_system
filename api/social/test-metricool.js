export default async function handler(req, res) {
  const TOKEN = process.env.METRICOOL_TOKEN;
  const BASE = 'https://app.metricool.com/api/v2';

  const H = { 'X-Mc-Auth': TOKEN };

  const intentos = [
    { nombre: '/scheduler/posts (GET)', url: `${BASE}/scheduler/posts`, headers: H },
    { nombre: '/blogs/list', url: `${BASE}/blogs/list`, headers: H },
    { nombre: '/blogs/all', url: `${BASE}/blogs/all`, headers: H },
    { nombre: '/blog', url: `${BASE}/blog`, headers: H },
    { nombre: '/blog/list', url: `${BASE}/blog/list`, headers: H },
    { nombre: '/analytics/blogs', url: `${BASE}/analytics/blogs`, headers: H },
    { nombre: '/analytics/accounts', url: `${BASE}/analytics/accounts`, headers: H },
    { nombre: '/accounts/list', url: `${BASE}/accounts/list`, headers: H },
    { nombre: '/user/blogs', url: `${BASE}/user/blogs`, headers: H },
    { nombre: '/scheduler/posts con blogId=1', url: `${BASE}/scheduler/posts?blogId=1`, headers: H },
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
