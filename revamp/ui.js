/* ============================================================================
   GymFlow — shared popup system + intent router.
   • gfUI.modal / drawer / confirm / form  — on-brand popups
   • a single capture-phase click router turns every previously-dead
     "— prototype" button / link / list-row into a believable popup.
   Loaded on every page (via wire.js and admin-shell.js).
   ============================================================================ */
(function () {
  if (window.gfUI) return;

  // ── stylesheet ──
  if (!document.getElementById('gfUiCss')) {
    const l = document.createElement('link'); l.id = 'gfUiCss'; l.rel = 'stylesheet'; l.href = 'ui.css';
    document.head.appendChild(l);
  }

  const ic = () => { if (window.lucide) lucide.createIcons(); };

  // ── toast (reuse the shared one if present) ──
  function toast(msg) {
    if (window.gfToast && window.gfToast !== toast) return window.gfToast(msg);
    let t = document.getElementById('gfToast');
    if (!t) { t = document.createElement('div'); t.id = 'gfToast'; t.className = 'toast'; t.innerHTML = '<i data-lucide="check-circle-2"></i><span></span>'; document.body.appendChild(t); }
    t.querySelector('span').textContent = msg; ic();
    t.classList.add('show'); clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ── host ──
  let bg = null;
  function host() {
    if (bg) return bg;
    bg = document.createElement('div'); bg.className = 'gfui-bg';
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(bg);
    return bg;
  }
  function close() {
    if (bg) bg.classList.remove('open');
    document.querySelectorAll('.gfui-drawer.open').forEach(d => d.classList.remove('open'));
  }

  function headHTML(o) {
    const icon = o.icon ? `<span class="gfui-ic ${o.tone || ''}"><i data-lucide="${o.icon}"></i></span>` : '';
    const sub = o.subtitle ? `<p>${o.subtitle}</p>` : '';
    return `<div class="gfui-h">${icon}<div class="gfui-tt"><h3>${o.title || ''}</h3>${sub}</div><button class="gfui-x" data-gfui-close aria-label="Close"><i data-lucide="x"></i></button></div>`;
  }
  function footHTML(actions) {
    if (!actions || !actions.length) return '';
    return `<div class="gfui-f">${actions.map((a, i) =>
      `<button class="gf-btn ${a.kind || 'gf-btn-secondary'}" data-gfui-act="${i}">${a.icon ? `<i data-lucide="${a.icon}" style="width:16px;height:16px"></i> ` : ''}${a.label}</button>`).join('')}</div>`;
  }
  function bindActions(root, actions) {
    root.querySelectorAll('[data-gfui-close]').forEach(b => b.onclick = close);
    (actions || []).forEach((a, i) => {
      const btn = root.querySelector(`[data-gfui-act="${i}"]`);
      if (btn) btn.onclick = () => { const keep = a.onClick && a.onClick(); if (!keep && a.close !== false) close(); };
    });
  }

  // ── modal ──
  function modal(o) {
    host(); bg.innerHTML = '';
    const m = document.createElement('div'); m.className = 'gfui-modal';
    m.innerHTML = headHTML(o) + `<div class="gfui-b">${o.bodyHTML || ''}</div>` + footHTML(o.actions);
    bg.appendChild(m);
    bindActions(m, o.actions);
    if (o.onMount) o.onMount(m);
    requestAnimationFrame(() => bg.classList.add('open'));
    ic();
    return m;
  }

  // ── drawer ──
  function drawer(o) {
    host(); bg.innerHTML = '';
    // backdrop stays for click-out; drawer is a sibling fixed element
    document.querySelectorAll('.gfui-drawer').forEach(d => d.remove());
    const d = document.createElement('aside'); d.className = 'gfui-drawer';
    d.innerHTML = headHTML(o) + `<div class="gfui-b">${o.bodyHTML || ''}</div>` + footHTML(o.actions);
    document.body.appendChild(d);
    bindActions(d, o.actions);
    requestAnimationFrame(() => { bg.classList.add('open'); d.classList.add('open'); });
    ic();
    return d;
  }

  // ── confirm ──
  function confirm(o) {
    return modal({
      title: o.title, subtitle: o.subtitle, icon: o.icon || (o.danger ? 'alert-triangle' : 'help-circle'), tone: o.danger ? 'danger' : '',
      bodyHTML: `<p class="gfui-text">${o.body || ''}</p>`,
      actions: [
        { label: o.cancelLabel || 'Cancel', kind: 'gf-btn-ghost' },
        { label: o.confirmLabel || 'Confirm', kind: o.danger ? 'gf-btn-danger' : 'gf-btn-primary', icon: o.confirmIcon, onClick: () => { if (o.onConfirm) o.onConfirm(); else toast((o.toast || 'Done')); } },
      ],
    });
  }

  // ── form ──
  function fieldHTML(f) {
    const lab = f.label ? `<label class="gf-form-label">${f.label}</label>` : '';
    let ctrl;
    if (f.type === 'select') ctrl = `<select class="gf-select" data-f="${f.name || ''}">${(f.options || []).map(o => `<option>${o}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') ctrl = `<textarea class="gf-textarea" data-f="${f.name || ''}" placeholder="${f.placeholder || ''}" style="min-height:84px"></textarea>`;
    else if (f.type === 'naira') ctrl = `<div class="gf-naira-input"><input class="gf-input" data-f="${f.name || ''}" placeholder="${f.placeholder || '0'}" inputmode="numeric" /></div>`;
    else ctrl = `<input class="gf-input" type="${f.type || 'text'}" data-f="${f.name || ''}" placeholder="${f.placeholder || ''}" ${f.value ? `value="${f.value}"` : ''} />`;
    return `<div class="gf-form-group" style="${f.half ? '' : 'grid-column:1/-1'}">${lab}${ctrl}</div>`;
  }
  function form(o) {
    const fields = o.fields || [];
    const body = `<div class="gfui-grid2">${fields.map(fieldHTML).join('')}</div>` + (o.note ? `<div class="gfui-note"><i data-lucide="${o.noteIcon || 'shield-check'}"></i> ${o.note}</div>` : '');
    return modal({
      title: o.title, subtitle: o.subtitle, icon: o.icon || 'plus', tone: o.tone,
      bodyHTML: body,
      actions: [
        { label: 'Cancel', kind: 'gf-btn-ghost' },
        { label: o.submitLabel || 'Save', kind: 'gf-btn-primary', icon: o.submitIcon || 'check', onClick: () => { if (o.onSubmit) o.onSubmit(); else toast(o.success || 'Saved'); } },
      ],
    });
  }

  window.gfUI = { modal, drawer, confirm, form, close, toast };
  window.gfToast = window.gfToast || toast;

  /* ════════════════════════ intent router ════════════════════════ */
  const RX = {
    danger: /\b(delete|remove|suspend|deactivate|revoke|disable|terminate|block|end\b|refund)\b/i,
    create: /\b(add|new|create|invite|onboard|register|enrol|log\b|raise|generate)\b/i,
    exp:    /\b(export|download|statement|\.pdf|\.csv|report)\b/i,
    send:   /\b(remind|nudge|send|notify|message|whatsapp|broadcast|resend|email\b|call\b)\b/i,
    edit:   /\b(edit|manage|configure|update|change|customi|set up|setup|adjust)\b/i,
    view:   /\b(view|details|see all|open|profile|inspect)\b/i,
  };

  function clean(el) {
    const s = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ');
    return s ? s.slice(0, 60) : 'Action';
  }

  // field presets keyed by the noun found in the label
  function formSpec(label) {
    const l = label.toLowerCase();
    const base = (title, icon, fields, submitLabel, success) => ({ title, icon, fields, submitLabel, success });
    if (/\bmember\b/.test(l)) return base('Add member', 'user-plus',
      [{ label: 'Full name', name: 'n', placeholder: 'e.g. Chidi Okeke' }, { label: 'Phone', name: 'p', placeholder: '0801 234 5678', half: true }, { label: 'Email', name: 'e', placeholder: 'name@mail.com', half: true }, { label: 'Plan', name: 'plan', type: 'select', options: ['Monthly — ₦13,999', 'Quarterly — ₦37,999', 'Annual — ₦119,999'] }, { label: 'Start date', name: 'd', type: 'date', half: true }, { label: 'Referred by', name: 'r', placeholder: 'Optional', half: true }],
      'Create member', 'Member added');
    if (/\bclass|session\b/.test(l)) return base(/session/.test(l) ? 'New PT session' : 'New class', 'calendar-plus',
      [{ label: 'Name', name: 'n', placeholder: 'e.g. Sunrise HIIT' }, { label: 'Coach', name: 'c', type: 'select', options: ['Coach Bisi', 'Coach Femi', 'Coach Tobi', 'Coach Ada'], half: true }, { label: 'Capacity', name: 'cap', placeholder: '20', half: true }, { label: 'Day', name: 'day', type: 'select', options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], half: true }, { label: 'Time', name: 't', type: 'time', half: true }],
      'Schedule it', 'Class scheduled');
    if (/\bplan|pricing|price\b/.test(l)) return base('New plan', 'tag',
      [{ label: 'Plan name', name: 'n', placeholder: 'e.g. Student' }, { label: 'Price', name: 'price', type: 'naira', placeholder: '13,999', half: true }, { label: 'Interval', name: 'iv', type: 'select', options: ['Monthly', 'Quarterly', 'Annual', 'Day pass'], half: true }, { label: 'Perks', name: 'perks', type: 'textarea', placeholder: 'What members get…' }],
      'Create plan', 'Plan created');
    if (/\bstaff|team|instructor|coach\b/.test(l)) return base('Invite staff', 'user-cog',
      [{ label: 'Full name', name: 'n', placeholder: 'e.g. Deborah A.' }, { label: 'Role', name: 'role', type: 'select', options: ['Front desk', 'Instructor', 'Manager', 'Accountant'], half: true }, { label: 'Phone', name: 'p', placeholder: '0801 234 5678', half: true }, { label: 'Email', name: 'e', placeholder: 'name@mail.com' }],
      'Send invite', 'Invite sent');
    if (/\bgym\b/.test(l)) return base('Onboard a gym', 'building-2',
      [{ label: 'Gym name', name: 'n', placeholder: 'e.g. Lekki Fitness' }, { label: 'Owner', name: 'o', placeholder: 'Full name', half: true }, { label: 'City', name: 'city', type: 'select', options: ['Lagos', 'Abuja', 'Port Harcourt', 'Ibadan', 'Kano'], half: true }, { label: 'Subdomain', name: 'sub', placeholder: 'lekkifitness', half: true }, { label: 'Plan', name: 'plan', type: 'select', options: ['Starter', 'Growth', 'Scale'], half: true }],
      'Onboard gym', 'Gym onboarded');
    if (/\bticket|support\b/.test(l)) return base('New ticket', 'life-buoy',
      [{ label: 'Subject', name: 's', placeholder: 'Short summary' }, { label: 'Gym', name: 'g', type: 'select', options: ['Powerhouse Fitness', 'Apex Arena', 'FitHub Abuja'], half: true }, { label: 'Priority', name: 'pr', type: 'select', options: ['Low', 'Normal', 'High', 'Urgent'], half: true }, { label: 'Details', name: 'd', type: 'textarea', placeholder: 'Describe the issue…' }],
      'Open ticket', 'Ticket opened');
    if (/\bissue|equipment|machine|maintenance|fault\b/.test(l)) return base('Log an issue', 'wrench',
      [{ label: 'Item', name: 'i', placeholder: 'e.g. Treadmill #4' }, { label: 'Zone', name: 'z', type: 'select', options: ['Weights floor', 'Cardio zone', 'Studio A', 'Locker room'], half: true }, { label: 'Severity', name: 'sev', type: 'select', options: ['Low', 'Medium', 'High'], half: true }, { label: 'Problem', name: 'p', type: 'textarea', placeholder: 'What\u2019s wrong?' }],
      'Log issue', 'Issue logged');
    if (/\bclient\b/.test(l)) return base('Add PT client', 'dumbbell',
      [{ label: 'Full name', name: 'n', placeholder: 'e.g. Ada B.' }, { label: 'Sessions', name: 's', placeholder: '6', half: true }, { label: 'Focus', name: 'f', type: 'select', options: ['Strength', 'Weight loss', 'Mobility', 'General'], half: true }, { label: 'First session', name: 'd', type: 'date' }],
      'Add client', 'Client added');
    if (/\bcard|payment method\b/.test(l)) return base('Add payment method', 'credit-card',
      [{ label: 'Card number', name: 'c', placeholder: '0000 0000 0000 0000' }, { label: 'Expiry', name: 'ex', placeholder: 'MM/YY', half: true }, { label: 'CVV', name: 'cv', placeholder: '123', half: true }],
      'Add card', 'Card added');
    if (/\breminder|campaign|broadcast\b/.test(l)) return base('New reminder', 'bell',
      [{ label: 'Audience', name: 'a', type: 'select', options: ['Expiring members', 'Expired members', 'All active', 'Class bookings'] }, { label: 'Channel', name: 'ch', type: 'select', options: ['WhatsApp', 'SMS', 'Email'], half: true }, { label: 'Send', name: 'w', type: 'select', options: ['Now', 'Schedule'], half: true }, { label: 'Message', name: 'm', type: 'textarea', placeholder: 'Your message…' }],
      'Save reminder', 'Reminder saved');
    return base(label, 'plus', [{ label: 'Name', name: 'n', placeholder: 'Enter a name' }, { label: 'Notes', name: 'notes', type: 'textarea', placeholder: 'Optional' }], 'Save', 'Saved');
  }

  function openForm(label) {
    const s = formSpec(label);
    form({ title: s.title, icon: s.icon, fields: s.fields, submitLabel: s.submitLabel, submitIcon: 'check', success: s.success, note: 'Prototype — nothing is saved.' });
  }
  function openExport(label) {
    const m = modal({ title: label.replace(/\.$/, ''), subtitle: 'Generating your file…', icon: 'download',
      bodyHTML: `<div style="display:flex;align-items:center;gap:13px;padding:6px 0"><div class="gfui-spin"></div><span class="gfui-text" id="gfuiExpMsg">Preparing export…</span></div>`,
      actions: [{ label: 'Close', kind: 'gf-btn-ghost' }] });
    setTimeout(() => {
      m.querySelector('.gfui-b').innerHTML = `<div class="gfui-done"><div class="ring"><i data-lucide="check"></i></div><p class="gfui-text">Your file is ready.</p></div>`;
      m.querySelector('.gfui-f').innerHTML = `<button class="gf-btn gf-btn-ghost" data-gfui-close>Close</button><button class="gf-btn gf-btn-primary" id="gfuiDl"><i data-lucide="download" style="width:16px;height:16px"></i> Download</button>`;
      m.querySelector('[data-gfui-close]').onclick = close;
      m.querySelector('#gfuiDl').onclick = () => { close(); toast('Download started'); };
      ic();
    }, 1100);
  }
  function openSupport(label) {
    modal({ title: 'Help & support', subtitle: 'We usually reply within an hour', icon: 'life-buoy',
      bodyHTML: `<div class="group" style="margin:0"><a class="row" data-gfui-sup="WhatsApp"><span class="ic"><i data-lucide="message-circle"></i></span><div class="m"><strong>Chat on WhatsApp</strong><small>Fastest — +234 800 GYMFLOW</small></div><i data-lucide="chevron-right" class="chev"></i></a><a class="row" data-gfui-sup="Email"><span class="ic"><i data-lucide="mail"></i></span><div class="m"><strong>Email us</strong><small>help@gymflow.ng</small></div><i data-lucide="chevron-right" class="chev"></i></a><a class="row" data-gfui-sup="Call"><span class="ic"><i data-lucide="phone"></i></span><div class="m"><strong>Call support</strong><small>Mon–Sat, 8am–8pm</small></div><i data-lucide="chevron-right" class="chev"></i></a></div>`,
      onMount: (m) => m.querySelectorAll('[data-gfui-sup]').forEach(a => a.onclick = () => { close(); toast(a.dataset.gfuiSup + ' — prototype'); }),
    });
  }
  function openDocs(label) {
    modal({ title: 'Documents', subtitle: 'Waivers, receipts & policies', icon: 'file-text',
      bodyHTML: `<div class="group" style="margin:0">${['Membership waiver.pdf', 'Health declaration.pdf', 'Latest receipt.pdf'].map(d => `<a class="row" data-gfui-doc="${d}"><span class="ic"><i data-lucide="file-text"></i></span><div class="m"><strong>${d}</strong><small>Tap to download</small></div><i data-lucide="download" class="chev"></i></a>`).join('')}</div>`,
      onMount: (m) => m.querySelectorAll('[data-gfui-doc]').forEach(a => a.onclick = () => { close(); toast('Downloading ' + a.dataset.gfuiDoc); }),
    });
  }
  function detailDrawer(el, label) {
    const strong = el.querySelector('strong, b'); const small = el.querySelector('small');
    const title = strong ? strong.textContent.trim() : label;
    const sub = small ? small.textContent.trim() : '';
    const badge = el.querySelector('.gf-badge'); const av = el.querySelector('.gf-avatar');
    const letter = av ? (av.textContent.trim().charAt(0) || title.charAt(0)) : title.charAt(0).toUpperCase();
    drawer({
      title: title, subtitle: sub, 
      bodyHTML: `<div class="gfui-id" style="margin-bottom:18px"><span class="gf-avatar gf-avatar-lg">${letter}</span><div><strong>${title}</strong><small>${sub || 'Detail'}</small></div></div>`
        + (badge ? `<div style="margin-bottom:16px">${badge.outerHTML}</div>` : '')
        + `<div class="gfui-rows"><div class="r"><span>Status</span><b>Active</b></div><div class="r"><span>Reference</span><b>GF-${Math.floor(1000 + Math.random() * 9000)}</b></div><div class="r"><span>Last update</span><b>Today</b></div></div>`,
      actions: [{ label: 'Close', kind: 'gf-btn-ghost' }, { label: 'Message', kind: 'gf-btn-primary', icon: 'send', onClick: () => toast('Message sent — prototype') }],
    });
  }

  function route(el) {
    const label = clean(el);
    const l = label.toLowerCase();
    if (RX.danger.test(l)) return confirm({ title: label, body: 'This can\u2019t be undone in a real account. Continue?', danger: true, confirmLabel: label.split(' ')[0], confirmIcon: 'trash-2', toast: label + ' — done' });
    if (/\bhelp|support|contact us\b/.test(l)) return openSupport(label);
    if (/\bwaiver|document|policy|invoice\b/.test(l)) return openDocs(label);
    if (RX.create.test(l)) return openForm(label);
    if (RX.exp.test(l)) return openExport(label);
    if (RX.send.test(l)) return confirm({ title: label + '?', body: 'Send this now to the selected recipients?', confirmLabel: 'Send', confirmIcon: 'send', icon: 'send', toast: 'Sent — prototype' });
    if (RX.edit.test(l)) { const s = formSpec(label); return form({ title: label, icon: 'pencil', fields: s.fields, submitLabel: 'Save changes', success: 'Saved' }); }
    if (el.matches('.row, .lc') || RX.view.test(l)) return detailDrawer(el, label);
    return toast(label + ' — prototype');
  }

  // skip these — page-managed stateful controls / handled elsewhere
  const SKIP = '.bell, .theme-btn, [data-theme-toggle], #themeBtn, #admTheme, .viewtoggle, .gf-nav-item, .gf-chip, [data-tab], [data-dev], [data-f], [data-st], [data-d], [data-day], [data-i], [data-plan], [data-go], .cday, .day, .switch, .seg-ctrl button, .segtabs button';

  document.addEventListener('click', function (e) {
    const el = e.target.closest('a, .gf-btn, .icon-btn, .row, .lc, .gf-quick-action, .gf-dropdown-item');
    if (!el) return;
    if (el.closest('.gfui-bg, .gfui-drawer, .gfnp, .proto, .controls, .gf-sidebar, .rail, .tabbar')) return;
    if (el.matches(SKIP) || el.closest('.gf-table tbody tr')) return;
    // real navigation → let it through
    if (el.tagName === 'A') { const h = el.getAttribute('href'); if (h && h !== '#' && h.slice(0, 11) !== 'javascript:') return; }
    if (el.onclick) return;            // page already wired it
    if (el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit' && el.closest('form')) return; // genuine form submit only
    e.preventDefault();
    e.stopPropagation();
    route(el);
  }, true);
})();
