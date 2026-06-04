/* ============================================================================
   GymFlow — shared notifications panel (desktop portals).
   Self-initializing. Injected by admin/instructor/superadmin shells.
   Replaces the topbar bell's static dot with a live count + a slide-over
   panel of role-appropriate notifications.
   ============================================================================ */
(function () {
  if (window.__gfNotifReady) return;
  window.__gfNotifReady = true;

  /* role-specific feeds */
  const FEEDS = {
    admin: [
      { g:'Today', items: [
        { t:'reminder', ic:'alert-triangle', cls:'warn', title:'3 memberships expired today', body:'Chidi O., Maryam S. and 1 more need follow-up. Send a renewal nudge?', time:'9:12 AM', unread:true },
        { t:'class',    ic:'calendar-clock',  cls:'brand', title:'Spin Class is 92% filling up', body:'22 of 24 booked for 17:30 with Coach Tobi. Open a waitlist?', time:'8:40 AM', unread:true },
        { t:'pay',      ic:'wallet',          cls:'info', title:'Paystack payout settled', body:'₦248,500 landed in your GTBank account ending 4471.', time:'7:05 AM', unread:true },
      ]},
      { g:'Earlier', items: [
        { t:'member', ic:'user-plus', cls:'brand', title:'New member: Chidi O.', body:'Joined the Growth plan via powerhouse.gymflow.ng.', time:'Yesterday' },
        { t:'system', ic:'scan-line', cls:'muted', title:'5 check-ins flagged', body:'Members tried to check in with an expired plan.', time:'Yesterday' },
      ]},
    ],
    instructor: [
      { g:'Today', items: [
        { t:'class',  ic:'bike',         cls:'brand', title:'Spin Class in 2 hours', body:'22 members booked for 17:30. Studio 2 is reserved for you.', time:'3:30 PM', unread:true },
        { t:'member', ic:'dumbbell',     cls:'accent', title:'New PT client: Ada B.', body:'Booked a 6-session strength block starting Monday.', time:'11:20 AM', unread:true },
        { t:'pay',    ic:'wallet',       cls:'info', title:'Payout on the way', body:'₦86,400 for this week\u2019s classes — arriving Fri.', time:'9:00 AM', unread:true },
      ]},
      { g:'Earlier', items: [
        { t:'class', ic:'calendar-clock', cls:'muted', title:'Class moved', body:'Yoga Flow shifted to 19:30 on Fri at the studio\u2019s request.', time:'Yesterday' },
      ]},
    ],
    superadmin: [
      { g:'Today', items: [
        { t:'gym',  ic:'building-2',  cls:'brand', title:'New gym onboarded', body:'Lekki Fitness Collective went live on lekkifitness.gymflow.ng.', time:'10:48 AM', unread:true },
        { t:'rev',  ic:'trending-up', cls:'accent', title:'Platform MRR crossed ₦12M', body:'Up 8.4% month-on-month across 47 active gyms.', time:'8:15 AM', unread:true },
        { t:'risk', ic:'alert-triangle', cls:'warn', title:'2 gyms past due', body:'Platform fee overdue for Apex Arena and FitHub Abuja.', time:'7:30 AM', unread:true },
      ]},
      { g:'Earlier', items: [
        { t:'support', ic:'life-buoy', cls:'info', title:'Support ticket escalated', body:'Paystack reconciliation issue raised by Powerhouse Fitness.', time:'Yesterday' },
      ]},
    ],
  };

  function detectRole() {
    if (document.body && document.body.dataset.gfRole) return document.body.dataset.gfRole;
    if (window.GF_NOTIF_ROLE) return window.GF_NOTIF_ROLE;
    if (document.getElementById('admSidebar')) return 'admin';
    if (document.getElementById('coachSidebar')) return 'instructor';
    if (document.getElementById('saSidebar')) return 'superadmin';
    return 'admin';
  }

  function injectCss() {
    if (document.getElementById('gfNotifCss')) return;
    const s = document.createElement('style');
    s.id = 'gfNotifCss';
    s.textContent = `
      .bell { position: relative; }
      .bell::after { display: none !important; }
      .gfnp-nub { position:absolute; top:5px; right:5px; min-width:16px; height:16px; padding:0 4px; border-radius:99px;
        background:var(--gf-danger); color:#fff; font-family:var(--gf-font-display); font-weight:800; font-size:0.6rem;
        display:grid; place-items:center; border:2px solid var(--gf-surface); line-height:1; pointer-events:none; }
      .gfnp-nub.hide { display:none; }
      .gfnp-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.5); -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px);
        opacity:0; pointer-events:none; transition:opacity .25s var(--gf-ease-std); z-index:1200; }
      .gfnp-backdrop.open { opacity:1; pointer-events:auto; }
      .gfnp { position:fixed; top:0; right:0; height:100%; width:384px; max-width:92vw; background:var(--gf-surface);
        border-left:1px solid var(--gf-border); box-shadow:var(--gf-shadow-lg); transform:translateX(102%);
        transition:transform .32s var(--gf-ease-out); z-index:1201; display:flex; flex-direction:column; }
      .gfnp.open { transform:none; }
      .gfnp-head { display:flex; align-items:center; gap:12px; padding:18px 20px 16px; border-bottom:1px solid var(--gf-border); flex-shrink:0; }
      .gfnp-head h3 { font-family:var(--gf-font-display); font-weight:800; font-size:1.1rem; letter-spacing:-0.01em; margin:0; flex:1; }
      .gfnp-head .gfnp-mark { background:none; border:none; color:var(--gf-brand); font-family:var(--gf-font-display); font-weight:600; font-size:0.8rem; cursor:pointer; padding:6px 8px; border-radius:var(--gf-radius-xs); white-space:nowrap; }
      .gfnp-head .gfnp-mark:hover { background:var(--gf-brand-soft); }
      .gfnp-head .gfnp-x { width:34px; height:34px; border-radius:var(--gf-radius-xs); border:1px solid var(--gf-border); background:var(--gf-elevated); color:var(--gf-text-secondary); display:grid; place-items:center; cursor:pointer; flex-shrink:0; }
      .gfnp-head .gfnp-x:hover { color:var(--gf-text); }
      .gfnp-head .gfnp-x i { width:16px; height:16px; }
      .gfnp-body { flex:1; overflow-y:auto; padding:6px 16px 28px; }
      .gfnp-g { font-family:var(--gf-font-display); font-weight:800; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--gf-text-muted); margin:18px 0 9px; }
      .gfnp-i { display:flex; gap:12px; padding:13px; border:1px solid var(--gf-border); border-radius:var(--gf-radius); background:var(--gf-surface); margin-bottom:8px; cursor:pointer; transition:border-color var(--gf-t-fast); position:relative; }
      .gfnp-i:hover { border-color:var(--gf-border-light); }
      .gfnp-i.unread { background:var(--gf-brand-soft); border-color:var(--gf-border-glow); }
      .gfnp-i .nic { width:40px; height:40px; border-radius:12px; display:grid; place-items:center; flex-shrink:0; }
      .gfnp-i .nic i { width:18px; height:18px; }
      .gfnp-i .nic.brand { background:var(--gf-brand-soft); color:var(--gf-brand); }
      .gfnp-i .nic.accent { background:var(--gf-accent-soft); color:var(--gf-accent-dark); }
      .gfnp-i .nic.info { background:var(--gf-info-soft); color:var(--gf-info); }
      .gfnp-i .nic.warn { background:var(--gf-warning-soft); color:var(--gf-warning); }
      .gfnp-i .nic.muted { background:var(--gf-elevated); color:var(--gf-text-secondary); }
      .gfnp-i .m { flex:1; min-width:0; }
      .gfnp-i .m strong { font-family:var(--gf-font-display); font-size:0.86rem; font-weight:700; display:block; line-height:1.3; }
      .gfnp-i .m p { color:var(--gf-text-secondary); font-size:0.79rem; margin:3px 0 0; line-height:1.45; }
      .gfnp-i .m .nt { color:var(--gf-text-muted); font-size:0.69rem; margin-top:6px; display:block; }
      .gfnp-i .ud { position:absolute; top:14px; right:13px; width:8px; height:8px; border-radius:50%; background:var(--gf-brand); }
      .gfnp-i:not(.unread) .ud { display:none; }
      .gfnp-foot { padding:14px 20px; border-top:1px solid var(--gf-border); flex-shrink:0; }
      .gfnp-foot a { color:var(--gf-text-secondary); font-family:var(--gf-font-display); font-weight:600; font-size:0.8rem; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:7px; }
      .gfnp-foot a:hover { color:var(--gf-text); }
      .gfnp-foot a i { width:15px; height:15px; }
    `;
    document.head.appendChild(s);
  }

  let feed, panel, backdrop;

  function render() {
    const body = panel.querySelector('.gfnp-body');
    body.innerHTML = feed.map((grp, gi) => `
      <div class="gfnp-g">${grp.g}</div>
      ${grp.items.map((it, ii) => `
        <div class="gfnp-i ${it.unread ? 'unread' : ''}" data-g="${gi}" data-i="${ii}">
          <span class="nic ${it.cls}"><i data-lucide="${it.ic}"></i></span>
          <div class="m"><strong>${it.title}</strong><p>${it.body}</p><span class="nt">${it.time}</span></div>
          <span class="ud"></span>
        </div>`).join('')}
    `).join('');
    if (window.lucide) lucide.createIcons();
  }

  function unreadCount() {
    return feed.reduce((n, g) => n + g.items.filter(i => i.unread).length, 0);
  }
  function syncNub() {
    const n = unreadCount();
    document.querySelectorAll('.bell').forEach(b => {
      let nub = b.querySelector('.gfnp-nub');
      if (!nub) { nub = document.createElement('span'); nub.className = 'gfnp-nub'; b.appendChild(nub); }
      nub.textContent = n;
      nub.classList.toggle('hide', n === 0);
    });
  }

  function open()  { backdrop.classList.add('open'); panel.classList.add('open'); }
  function close() { backdrop.classList.remove('open'); panel.classList.remove('open'); }

  function build() {
    injectCss();
    feed = FEEDS[detectRole()] || FEEDS.admin;

    backdrop = document.createElement('div');
    backdrop.className = 'gfnp-backdrop';
    backdrop.onclick = close;

    panel = document.createElement('aside');
    panel.className = 'gfnp';
    panel.innerHTML = `
      <div class="gfnp-head">
        <h3>Notifications</h3>
        <button class="gfnp-mark">Mark all read</button>
        <button class="gfnp-x" aria-label="Close"><i data-lucide="x"></i></button>
      </div>
      <div class="gfnp-body"></div>
      <div class="gfnp-foot"><a href="#"><i data-lucide="settings"></i> Notification settings</a></div>`;

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);

    panel.querySelector('.gfnp-x').onclick = close;
    panel.querySelector('.gfnp-mark').onclick = (e) => {
      e.stopPropagation();
      feed.forEach(g => g.items.forEach(i => i.unread = false));
      render(); syncNub();
      if (window.gfToast) gfToast('All caught up');
    };
    panel.querySelector('.gfnp-body').addEventListener('click', (e) => {
      const row = e.target.closest('.gfnp-i');
      if (!row) return;
      const it = feed[+row.dataset.g].items[+row.dataset.i];
      if (it.unread) { it.unread = false; row.classList.remove('unread'); syncNub(); }
    });

    render();
    syncNub();

    // delegate bell clicks (bell is injected by the shell, possibly after us)
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.bell');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      panel.classList.contains('open') ? close() : open();
    }, true);

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
