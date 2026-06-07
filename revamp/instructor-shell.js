// ── GymFlow instructor shell: sidebar + topbar for coach pages ──
// Usage: <aside id="coachSidebar"></aside> ... <header id="coachTop"></header>
//   coachShell('classes', { search:'Search…', action:{label,icon,href} });
(function () {
  try { const t = localStorage.getItem('gf-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}

  const NAV = [
    { s: 'Coaching', items: [
      { k:'schedule',   label:'My schedule', icon:'calendar-clock',  href:'instructor.html' },
      { k:'classes',    label:'Classes',     icon:'calendar-days',   href:'instructor-classes.html' },
      { k:'clients',    label:'PT clients',  icon:'dumbbell',        href:'instructor-clients.html' },
      { k:'attendance', label:'Attendance',  icon:'clipboard-check', href:'instructor-attendance.html' },
    ]},
    { s: 'Money', items: [
      { k:'earnings',   label:'Earnings',    icon:'wallet',          href:'instructor-earnings.html' },
      { k:'payouts',    label:'Payouts',     icon:'banknote',        href:'instructor-payouts.html' },
      { k:'settings',   label:'Settings',    icon:'settings',        href:'instructor-settings.html' },
    ]},
  ];

  if (!document.getElementById('coachShellCss')) {
    const css = document.createElement('style');
    css.id = 'coachShellCss';
    css.textContent = `
      .sb-role { display:flex; align-items:center; gap:10px; margin-top:14px; padding:8px; border-radius:var(--gf-radius-sm); background:var(--gf-elevated); border:1px solid var(--gf-border); }
      .sb-role .gf-avatar { background:var(--gf-brand-soft); color:var(--gf-brand); border-color:var(--gf-brand-glow); }
      .sb-role small { color:var(--gf-text-muted); font-size:0.66rem; display:block; }
      .sb-role strong { font-family:var(--gf-font-display); font-size:0.85rem; }
      .bell { position:relative; }
      .bell::after { content:''; position:absolute; top:9px; right:10px; width:7px; height:7px; border-radius:50%; background:var(--gf-danger); border:2px solid var(--gf-elevated); }
    `;
    document.head.appendChild(css);
  }

  window.coachShell = function (active, topOpts) {
    topOpts = topOpts || {};
    const sb = document.getElementById('coachSidebar');
    const top = document.getElementById('coachTop');
    if (sb) {
      sb.innerHTML = `
        <div class="gf-sidebar-header">
          <a class="brand" href="marketing.html" style="text-decoration:none"><img class="mark-sm" src="../assets/logomark-v2.svg" alt="" /><span class="brand-tx">Gym<em>Flow</em></span></a>
          <div class="sb-role"><span class="gf-avatar gf-avatar-sm">F</span><div><strong>Coach Femi</strong><small>Instructor · Powerhouse</small></div></div>
        </div>
        <nav class="gf-sidebar-nav">
          ${NAV.map(g => `<span class="gf-sidebar-section">${g.s}</span>${g.items.map(i => `<a class="gf-nav-item${i.k===active?' active':''}" href="${i.href}"><i data-lucide="${i.icon}"></i><span>${i.label}</span></a>`).join('')}`).join('')}
        </nav>
        <div class="gf-sidebar-footer"><a class="gf-nav-item" href="login.html"><i data-lucide="log-out"></i><span>Sign out</span></a></div>`;
    }
    if (top) {
      const act = topOpts.action;
      top.innerHTML = `
        <div class="search" style="flex:1;max-width:420px"><i data-lucide="search"></i><input placeholder="${topOpts.search || 'Search…'}" /></div>
        <div style="flex:1"></div>
        <button class="icon-btn" data-theme-toggle data-theme-icon title="Toggle theme"><i data-lucide="moon"></i></button>
        <button class="icon-btn bell"><i data-lucide="bell"></i></button>
        ${act ? `<a class="gf-btn gf-btn-primary" href="${act.href||'#'}"><i data-lucide="${act.icon}" style="width:16px;height:16px"></i> ${act.label}</a>` : ''}`;
    }
    if (window.lucide) lucide.createIcons();
    if (window.gfSyncThemeIcons) window.gfSyncThemeIcons();
    if (!document.getElementById('gfNotifJs')) { const ns = document.createElement('script'); ns.id = 'gfNotifJs'; ns.src = 'notifications-panel.js'; document.body.appendChild(ns); }
  };
})();
