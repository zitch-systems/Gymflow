// Shared, persisted light/dark theme. Load on every page (before other scripts).
(function () {
  const KEY = 'gf-theme';
  const stored = localStorage.getItem(KEY);
  if (stored) document.documentElement.setAttribute('data-theme', stored);

  function syncIcons() {
    const t = document.documentElement.getAttribute('data-theme') || 'dark';
    document.querySelectorAll('[data-theme-icon]').forEach(b => { b.innerHTML = '<i data-lucide="' + (t === 'dark' ? 'sun' : 'moon') + '"></i>'; });
    if (window.lucide) lucide.createIcons();
  }
  window.gfSetTheme = function (t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem(KEY, t);
    syncIcons();
  };
  window.gfToggleTheme = function () {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    window.gfSetTheme(cur === 'dark' ? 'light' : 'dark');
  };
  // delegate clicks from any [data-theme-toggle] control
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-theme-toggle]');
    if (b) { e.preventDefault(); window.gfToggleTheme(); }
  });
  document.addEventListener('DOMContentLoaded', syncIcons);
  window.gfSyncThemeIcons = syncIcons;

  // Auto-inject a floating theme toggle on pages that don't already have one.
  function injectFab() {
    if (!document.body) return;
    if (document.querySelector('[data-theme-toggle], #admTheme, #themeBtn, .theme-fab')) return;
    const b = document.createElement('button');
    b.className = 'theme-fab';
    b.setAttribute('data-theme-toggle', '');
    b.setAttribute('data-theme-icon', '');
    b.title = 'Toggle theme';
    b.innerHTML = '<i data-lucide="moon"></i>';
    b.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:510;width:42px;height:42px;border-radius:50%;border:1px solid var(--gf-border);background:var(--gf-surface);color:var(--gf-text);display:grid;place-items:center;cursor:pointer;box-shadow:var(--gf-shadow-md);';
    document.body.appendChild(b);
    syncIcons();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectFab);
  else injectFab();
})();
