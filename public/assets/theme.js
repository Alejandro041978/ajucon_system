// Aplicar tema antes de renderizar (evita parpadeo)
(function () {
  var t = localStorage.getItem('ajucon_theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
})();

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ajucon_theme', next);
  var btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

document.addEventListener('DOMContentLoaded', function () {
  var btn = document.getElementById('theme-toggle');
  var t = localStorage.getItem('ajucon_theme') || 'light';
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
});
