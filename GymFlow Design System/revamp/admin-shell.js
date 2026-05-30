// ── GymFlow admin shell: renders sidebar + topbar across all admin pages ──
// Usage: <aside id="admSidebar"></aside> ... <header id="admTop"></header>
//   adminShell('members', { search:'Search…', action:{label,icon,href} });

(function () {
  const NAV = [
    { s: 'Main', items: [
      { k:'overview',  label:'Overview',  icon:'layout-dashboard', href:'admin.html' },
      { k:'members',   label:'Members',   icon:'users',            href:'admin-members.html' },
      { k:'checkin',   label:'Check-In',  icon:'scan-line',        href:'admin-checkin.html' },
      { k:'analytics', label:'Analytics', icon:'bar-chart-3',      href:'admin-analytics.html' },
      { k:'classes',   label:'Classes',   icon:'calendar-days',    href:'admin-classes.html' },
    ]},
    { s: 'Admin', items: [
      { k:'pricing',   label:'Pricing',   icon:'tag',              href:'admin-pricing.html' },
      { k:'reminders', label:'Reminders', icon:'bell',             href:'admin-reminders.html' },
      { k:'wallet',    label:'Wallet',    icon:'wallet',           href:'admin-wallet.html' },
      { k:'settings',  label:'Settings',  icon:'settings',         href:'admin-settings.html' },
    ]},
  ];

  // self-contained shell styles
  if (!document.getElementById('admShellCss')) {
    const css = document.createElement('style');
    css.id = 'admShellCss';
    css.textContent = `
      .sb-gym { display:flex; align-items:center; gap:10px; margin-top:14px; padding:8px; border-radius:var(--gf-radius-sm); background:var(--gf-elevated); border:1px solid var(--gf-border); }
      .sb-gym .gf-avatar { background:var(--gf-brand-soft); color:var(--gf-brand); border-color:var(--gf-brand-glow); }
      .sb-gym small { color:var(--gf-text-muted); font-size:0.66rem; display:block; }
      .sb-gym strong { font-family:var(--gf-font-display); font-size:0.85rem; }
      .bell { position:relative; }
      .bell::after { content:''; position:absolute; top:9px; right:10px; width:7px; height:7px; border-radius:50%; background:var(--gf-danger); border:2px solid var(--gf-elevated); }
      .sb-foot-user { display:flex; align-items:center; gap:10px; }
      .sb-foot-user .gf-avatar { background:var(--gf-brand-soft); color:var(--gf-brand); }
    `;
    document.head.appendChild(css);
  }

  // global toast + dead-link / unwired-button feedback (attached once)
  function gfToast(msg) {
    let t = document.getElementById('gfToast');
    if (!t) { t = document.createElement('div'); t.id = 'gfToast'; t.className = 'toast'; t.innerHTML = '<i data-lucide="check-circle-2"></i><span></span>'; document.body.appendChild(t); }
    t.querySelector('span').textContent = msg;
    if (window.lucide) lucide.createIcons();
    t.classList.add('show'); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2000);
  }
  window.gfToast = gfToast;
  function gfLabel(el) { const s = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, 40) + ' — prototype' : 'Prototype action'; }
  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href="#"]');
    if (a) { e.preventDefault(); gfToast(gfLabel(a)); return; }
    const b = e.target.closest('.gf-btn, .icon-btn');
    if (b && !b.onclick) {
      if (b.tagName === 'A') { const h = b.getAttribute('href'); if (h && h !== '#') return; }
      if (b.type === 'submit') return;
      gfToast(gfLabel(b));
    }
  });

  window.adminShell = function (active, topOpts) {
    topOpts = topOpts || {};
    const sb = document.getElementById('admSidebar');
    const top = document.getElementById('admTop');

    if (sb) {
      sb.innerHTML = `
        <div class="gf-sidebar-header">
          <a class="brand" href="marketing.html" style="text-decoration:none">
            <img class="mark-sm" src="../assets/logomark-v2.svg" alt="" />
            <span class="brand-tx">Gym<em>Flow</em></span>
          </a>
          <div class="sb-gym">
            <span class="gf-avatar gf-avatar-sm">P</span>
            <div style="min-width:0"><strong>Powerhouse Fitness</strong><small>Lekki · powerhouse.gymflow.ng</small></div>
          </div>
        </div>
        <nav class="gf-sidebar-nav">
          ${NAV.map(group => `
            <span class="gf-sidebar-section">${group.s}</span>
            ${group.items.map(i => `
              <a class="gf-nav-item${i.k===active?' active':''}" href="${i.href}">
                <i data-lucide="${i.icon}"></i><span>${i.label}</span>
              </a>`).join('')}
          `).join('')}
        </nav>
        <div class="gf-sidebar-footer">
          <div class="sb-foot-user">
            <span class="gf-avatar gf-avatar-sm">A</span>
            <div style="min-width:0;flex:1">
              <div style="font-family:var(--gf-font-display);font-size:0.8125rem;font-weight:600">Adunni O.</div>
              <div style="font-size:0.68rem;color:var(--gf-text-muted)">Owner</div>
            </div>
            <a class="icon-btn" href="login.html" style="width:32px;height:32px" title="Sign out"><i data-lucide="log-out"></i></a>
          </div>
        </div>`;
    }

    if (top) {
      const act = topOpts.action;
      top.innerHTML = `
        <div class="search" style="flex:1;max-width:460px">
          <i data-lucide="search"></i>
          <input placeholder="${topOpts.search || 'Search…'}" />
        </div>
        <div style="flex:1"></div>
        <button class="icon-btn" id="admTheme" title="Toggle theme"><i data-lucide="moon"></i></button>
        <button class="icon-btn bell" title="Notifications"><i data-lucide="bell"></i></button>
        ${act ? `<a class="gf-btn gf-btn-primary" href="${act.href||'#'}"><i data-lucide="${act.icon}" style="width:16px;height:16px"></i> ${act.label}</a>` : ''}`;
    }

    if (window.lucide) lucide.createIcons();
    const tbtn = document.getElementById('admTheme');
    if (tbtn) tbtn.onclick = () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
      tbtn.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
      if (window.lucide) lucide.createIcons();
    };
  };
})();
