// Shared wiring: gives every nav item, dead link and unwired button feedback,
// and lets single-page sidebars switch their active state. Load after proto.js.
(function () {
  function gfToast(msg) {
    let t = document.getElementById('gfToast');
    if (!t) { t = document.createElement('div'); t.id = 'gfToast'; t.className = 'toast'; t.innerHTML = '<i data-lucide="check-circle-2"></i><span></span>'; document.body.appendChild(t); }
    t.querySelector('span').textContent = msg;
    if (window.lucide) lucide.createIcons();
    t.classList.add('show'); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2000);
  }
  window.gfToast = gfToast;

  // Inject a "Mobile view" / "Desktop view" toggle when the page declares a counterpart.
  function injectViewToggle() {
    if (!document.body || document.querySelector('.viewtoggle')) return;
    const mobile = document.body.getAttribute('data-gf-mobile');
    const desktop = document.body.getAttribute('data-gf-desktop');
    const target = mobile || desktop;
    if (!target) return;
    const a = document.createElement('a');
    a.href = target;
    a.className = 'viewtoggle';
    a.innerHTML = '<i data-lucide="' + (mobile ? 'smartphone' : 'monitor') + '"></i><span>' + (mobile ? 'Mobile view' : 'Desktop view') + '</span>';
    document.body.appendChild(a);
    if (window.lucide) lucide.createIcons();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectViewToggle);
  else injectViewToggle();

  // Load the shared popup system + intent router (once per page).
  function injectUi() {
    if (document.getElementById('gfUiJs')) return;
    const s = document.createElement('script'); s.id = 'gfUiJs'; s.src = 'ui.js';
    document.body.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectUi);
  else injectUi();

  function lbl(el) {
    const s = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ');
    return s ? s.slice(0, 40) + ' — prototype' : 'Prototype action';
  }

  document.addEventListener('click', function (e) {
    // single-page sidebar nav items (no real href) → set active + toast
    const nav = e.target.closest('.gf-nav-item');
    if (nav) {
      const href = nav.getAttribute('href');
      if (!href || href === '#') {
        e.preventDefault();
        const par = nav.closest('.gf-sidebar-nav') || nav.parentElement;
        if (par) par.querySelectorAll('.gf-nav-item').forEach(x => x.classList.remove('active'));
        nav.classList.add('active');
        gfToast(lbl(nav));
        return;
      }
      return; // real link: let it navigate
    }
    // dead anchor links
    const a = e.target.closest('a[href="#"]');
    if (a) { e.preventDefault(); gfToast(lbl(a)); return; }
    // unwired buttons (skip ones with their own handler / real nav / submit)
    const b = e.target.closest('.gf-btn, .icon-btn');
    if (b && !b.onclick) {
      if (b.tagName === 'A') { const h = b.getAttribute('href'); if (h && h !== '#') return; }
      if (b.type === 'submit') return;
      gfToast(lbl(b));
    }
  });
})();
