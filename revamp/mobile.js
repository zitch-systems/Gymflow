// Shared mobile-shell helpers: scale-to-fit, theme toggle, tab/view switching,
// and (new) phone / foldable / tablet device frames with an expanded side rail.
(function () {
  // apply persisted theme (shared 'gf-theme' key) before paint
  try { const t = localStorage.getItem('gf-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) {}

  function fit() {
    const d = document.getElementById('device'), box = document.getElementById('fitbox');
    if (!d || !box) return;
    d.style.transform = 'none';
    const natW = d.offsetWidth, natH = d.offsetHeight;
    const r = Math.min(1, (window.innerWidth - 40) / natW, (window.innerHeight - 150) / natH);
    d.style.transform = 'scale(' + r + ')';
    box.style.width = (natW * r) + 'px';
    box.style.height = (natH * r) + 'px';
  }
  window.addEventListener('resize', fit);
  window.gfFit = fit;

  window.gfTheme = function (t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('gf-theme', t); } catch (e) {}
    const b = document.getElementById('themeBtn');
    if (b) { b.innerHTML = '<i data-lucide="' + (t === 'light' ? 'moon' : 'sun') + '"></i>'; }
    if (window.lucide) lucide.createIcons();
  };

  window.gfGo = function (v) {
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.dataset.v === v));
    const tab = (window.gfTabMap && window.gfTabMap[v]) || v;
    document.querySelectorAll('.tabbar button, .rail button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const scr = document.querySelector('.scr'); if (scr) scr.scrollTop = 0;
    if (window.lucide) lucide.createIcons();
  };

  // ── device switching (phone / fold / tablet) ──
  window.gfDevice = function (d) {
    const dev = document.getElementById('device');
    if (!dev) return;
    dev.className = 'device ' + d;
    document.body.classList.toggle('expanded', d !== 'phone');
    document.body.classList.remove('dev-phone', 'dev-fold', 'dev-tablet');
    document.body.classList.add('dev-' + d);
    fit();
    if (window.lucide) lucide.createIcons();
  };

  // Build the expanded side rail from the existing bottom tab bar, and wrap
  // the scroll area so the rail can sit beside it on fold/tablet.
  function buildExpandedShell() {
    const dev = document.getElementById('device');
    if (!dev) return;
    const scr = dev.querySelector('.scr');
    const tabbar = dev.querySelector('.tabbar');
    if (!scr || dev.querySelector('.bodyrow')) return;

    // foldable crease (visible only on .device.fold)
    if (!dev.querySelector('.crease')) {
      const cr = document.createElement('div'); cr.className = 'crease';
      dev.insertBefore(cr, dev.firstChild);
    }

    // gather nav items from the tab bar
    const btns = tabbar ? [...tabbar.querySelectorAll('button')] : [];
    const navHtml = btns.map(b => {
      const tab = b.dataset.tab || '';
      const onclick = b.getAttribute('onclick') || '';
      const iconEl = b.querySelector('i');
      const icon = iconEl ? iconEl.getAttribute('data-lucide') : 'circle';
      const label = (b.textContent || '').trim();
      const on = b.classList.contains('on') ? ' on' : '';
      return `<button class="${on}" data-tab="${tab}" onclick="${onclick}"><i data-lucide="${icon}"></i> ${label}</button>`;
    }).join('');

    // foot identity — derive from the .controls label + first avatar letter
    const lblEl = document.querySelector('.controls .lbl');
    const role = lblEl ? lblEl.textContent.trim() : 'Account';
    const avEl = dev.querySelector('.mhead .gf-avatar');
    const letter = avEl ? (avEl.textContent.trim().charAt(0) || 'G') : 'G';

    const rail = document.createElement('aside');
    rail.className = 'rail';
    rail.innerHTML =
      `<div class="rail-brand"><img src="../assets/logomark-v2.svg" alt="" /><span>Gym<em>Flow</em></span></div>` +
      navHtml +
      `<div class="rail-spacer"></div>` +
      `<div class="rail-foot"><span class="gf-avatar gf-avatar-sm">${letter}</span><div style="min-width:0"><strong>${role}</strong><small>GymFlow</small></div></div>`;

    const bodyrow = document.createElement('div');
    bodyrow.className = 'bodyrow';
    dev.insertBefore(bodyrow, scr);
    bodyrow.appendChild(rail);
    bodyrow.appendChild(scr);
  }

  // Inject the device segmented control into the top .controls bar.
  function injectDeviceControl() {
    const controls = document.querySelector('.controls');
    if (!controls || controls.querySelector('.seg-ctrl')) return;
    const seg = document.createElement('div');
    seg.className = 'seg-ctrl';
    seg.id = 'devSeg';
    seg.innerHTML =
      `<button class="on" data-dev="phone"><i data-lucide="smartphone"></i> Phone</button>` +
      `<button data-dev="fold"><i data-lucide="tablet-smartphone"></i> Fold</button>` +
      `<button data-dev="tablet"><i data-lucide="tablet"></i> Tablet</button>`;
    const lbl = controls.querySelector('.lbl');
    if (lbl) lbl.after(seg); else controls.prepend(seg);
    seg.querySelectorAll('button').forEach(b => b.onclick = () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      gfDevice(b.dataset.dev);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const tb = document.getElementById('themeBtn');
    if (tb) {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      tb.innerHTML = '<i data-lucide="' + (cur === 'light' ? 'moon' : 'sun') + '"></i>';
      tb.onclick = () => gfTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light');
    }
    buildExpandedShell();
    injectDeviceControl();
    document.body.classList.add('dev-phone');
    const dev = document.getElementById('device');
    if (dev && !/\b(phone|fold|tablet)\b/.test(dev.className)) dev.className = 'device phone';
    fit();
    if (window.lucide) lucide.createIcons();
  });
})();
