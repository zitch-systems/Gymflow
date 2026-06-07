// ── GymFlow superadmin shell: sidebar + topbar for platform pages ──
// Usage: <aside id="saSidebar"></aside> ... <header id="saTop"></header>
//   saShell('gyms', { search:'Search…', action:{label,icon,href} });
(function () {
  try { const t = localStorage.getItem('gf-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}

  const NAV = [
    { s: 'Platform', items: [
      { k:'overview', label:'Overview',    icon:'layout-dashboard', href:'superadmin.html' },
      { k:'gyms',     label:'Gyms',        icon:'building-2',       href:'superadmin-gyms.html' },
      { k:'members',  label:'All members', icon:'users',            href:'superadmin-members.html' },
      { k:'revenue',  label:'Revenue',     icon:'line-chart',       href:'superadmin-revenue.html' },
    ]},
    { s: 'Operations', items: [
      { k:'onboard',  label:'Onboard gym', icon:'user-plus',        href:'superadmin-onboard.html' },
      { k:'audit',    label:'Audit log',   icon:'shield-check',     href:'superadmin-audit.html' },
      { k:'support',  label:'Support',     icon:'life-buoy',        href:'superadmin-support.html' },
      { k:'settings', label:'Settings',    icon:'settings',         href:'superadmin-settings.html' },
    ]},
  ];

  if (!document.getElementById('saShellCss')) {
    const css = document.createElement('style');
    css.id = 'saShellCss';
    css.textContent = `
      .sb-role { display:flex; align-items:center; gap:10px; margin-top:14px; padding:8px; border-radius:var(--gf-radius-sm); background:var(--gf-elevated); border:1px solid var(--gf-border); }
      .sb-role .gf-avatar { background:var(--gf-info-soft); color:var(--gf-info); border-color:rgba(64,128,255,0.25); }
      .sb-role small { color:var(--gf-text-muted); font-size:0.66rem; display:block; }
      .sb-role strong { font-family:var(--gf-font-display); font-size:0.85rem; }
      .pill-plat { display:inline-flex; align-items:center; gap:6px; font-family:var(--gf-font-display); font-weight:700; font-size:0.66rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--gf-info); background:var(--gf-info-soft); border:1px solid rgba(64,128,255,0.25); padding:3px 9px; border-radius:var(--gf-radius-pill); }
      .bell { position:relative; }
      .bell::after { content:''; position:absolute; top:9px; right:10px; width:7px; height:7px; border-radius:50%; background:var(--gf-danger); border:2px solid var(--gf-elevated); }
      .page-h2 { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:22px; }
      .page-h2 h1 { font-family:var(--gf-font-display); font-size:clamp(1.5rem,2.4vw,2rem); font-weight:800; letter-spacing:-0.03em; line-height:1.15; margin:6px 0 0; }
      .page-h2 p { margin:6px 0 0; color:var(--gf-text-secondary); font-size:0.9rem; }
      .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:18px; }
      .kpi { background:var(--gf-surface); border:1px solid var(--gf-border); border-radius:var(--gf-radius); padding:18px; transition:all var(--gf-t); }
      .kpi:hover { transform:translateY(-3px); border-color:var(--gf-border-light); box-shadow:var(--gf-shadow); }
      .kpi-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
      .kpi-ic { width:38px; height:38px; border-radius:11px; display:grid; place-items:center; }
      .kpi-ic i { width:19px; height:19px; }
      .kpi-val { font-family:var(--gf-font-display); font-size:2rem; font-weight:800; letter-spacing:-0.03em; line-height:1; }
      .kpi-lbl { color:var(--gf-text-muted); font-size:0.8125rem; margin-top:6px; }
      .gname { display:flex; align-items:center; gap:11px; }
      .gname .sq { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; font-family:var(--gf-font-display); font-weight:800; font-size:0.85rem; color:#fff; flex-shrink:0; }
      .gname strong { font-family:var(--gf-font-display); font-weight:600; display:block; font-size:0.875rem; }
      .gname small { color:var(--gf-text-muted); font-size:0.72rem; }
      .naira { font-variant-numeric:tabular-nums; font-weight:600; font-family:var(--gf-font-display); }
    `;
    document.head.appendChild(css);
  }

  window.saShell = function (active, topOpts) {
    topOpts = topOpts || {};
    const sb = document.getElementById('saSidebar');
    const top = document.getElementById('saTop');
    if (sb) {
      sb.innerHTML = `
        <div class="gf-sidebar-header">
          <a class="brand" href="marketing.html" style="text-decoration:none"><img class="mark-sm" src="../assets/logomark-v2.svg" alt="" /><span class="brand-tx">Gym<em>Flow</em></span></a>
          <div class="sb-role"><span class="gf-avatar gf-avatar-sm">S</span><div><strong>Samuel A.</strong><small>Platform admin</small></div></div>
        </div>
        <nav class="gf-sidebar-nav">
          ${NAV.map(g => `<span class="gf-sidebar-section">${g.s}</span>${g.items.map(i => `<a class="gf-nav-item${i.k===active?' active':''}" href="${i.href}"><i data-lucide="${i.icon}"></i><span>${i.label}</span></a>`).join('')}`).join('')}
        </nav>
        <div class="gf-sidebar-footer"><a class="gf-nav-item" href="login.html"><i data-lucide="log-out"></i><span>Sign out</span></a></div>`;
    }
    if (top) {
      const act = topOpts.action;
      top.innerHTML = `
        <div class="search" style="flex:1;max-width:440px"><i data-lucide="search"></i><input placeholder="${topOpts.search || 'Search…'}" /></div>
        <div style="flex:1"></div>
        <span class="pill-plat"><i data-lucide="shield" style="width:13px;height:13px"></i> Superadmin</span>
        <button class="icon-btn" data-theme-toggle data-theme-icon title="Toggle theme"><i data-lucide="moon"></i></button>
        <button class="icon-btn bell"><i data-lucide="bell"></i></button>
        ${act ? `<a class="gf-btn gf-btn-primary" href="${act.href||'#'}"><i data-lucide="${act.icon}" style="width:16px;height:16px"></i> ${act.label}</a>` : ''}`;
    }
    if (window.lucide) lucide.createIcons();
    if (window.gfSyncThemeIcons) window.gfSyncThemeIcons();
    if (!document.getElementById('gfNotifJs')) { const ns = document.createElement('script'); ns.id = 'gfNotifJs'; ns.src = 'notifications-panel.js'; document.body.appendChild(ns); }
  };
})();
