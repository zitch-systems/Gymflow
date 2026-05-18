/**
 * GymFlow Shared Utilities v3.0
 * - Theme toggle + persistence
 * - Service Worker registration (skipped on previews)
 * - Page loader
 * - Toast system (mobile-aware positioning)
 * - Modal helpers + bottom-sheet on mobile
 * - Confirm dialog (Promise-based)
 * - Mobile sidebar drawer with backdrop + swipe-close
 * - Universal mobile bottom navigation (auto-injected on admin pages)
 * - Online/offline status indicator
 * - Keyboard shortcuts (Esc to close, / to focus search, ? for help)
 * - Search debouncer + clear button
 * - Pull-to-refresh visual indicator (mobile only)
 * - Skeleton helper
 * - XSS escape utilities
 * - Event delegation for data-action attributes
 * - CSV/JSON export utilities
 * - Notification permission request (lazy)
 * - Auto-save form drafts to localStorage
 * - Click-outside helper
 */
(function(w) {
  'use strict';

  /* ── Theme: respect saved choice, then system preference, then default dark ── */
  var saved = localStorage.getItem('gf-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
  } else if (w.matchMedia && w.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  // Listen for system theme changes (only if user hasn't manually chosen)
  if (w.matchMedia) {
    var mql = w.matchMedia('(prefers-color-scheme: light)');
    var mqlHandler = function(e) {
      if (!localStorage.getItem('gf-theme')) {
        document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark');
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', e.matches ? '#f4f7fb' : '#080e1c');
      }
    };
    if (mql.addEventListener) mql.addEventListener('change', mqlHandler);
    else if (mql.addListener) mql.addListener(mqlHandler);
  }

  w.toggleTheme = function() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('gf-theme', next);
    // Update theme-color meta for browser UI
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#f4f7fb' : '#080e1c');
  };

  /* ── Service Worker (silent in preview environments) ── */
  if ('serviceWorker' in navigator) {
    var host = w.location.hostname;
    var isPreview = host.includes('claudeusercontent') || host === 'localhost' || host === '127.0.0.1';
    if (!isPreview) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function(r) { console.log('[GF] SW:', r.scope); })
        .catch(function(e) { console.warn('[GF] SW skipped:', e.message); });
    }
  }

  /* ── Page Loader hide ── */
  w.addEventListener('load', function() {
    setTimeout(function() {
      var l = document.getElementById('pageLoader');
      if (l) l.classList.add('hidden');
    }, 500);
  });
  // Fallback: hide loader after 3s no matter what
  setTimeout(function() {
    var l = document.getElementById('pageLoader');
    if (l) l.classList.add('hidden');
  }, 3000);

  /* ── Toast ── */
  function toast(msg, type, duration) {
    type = type || 'success';
    duration = duration || 3500;
    var wrap = document.getElementById('gf-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'gf-toasts';
      wrap.className = 'gf-toast-container';
      document.body.appendChild(wrap);
    }
    var icons = { success: '\u2713', error: '\u2715', warning: '\u26A0', info: '\u2139' };
    var el = document.createElement('div');
    el.className = 'gf-toast gf-toast-' + type;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = '<span aria-hidden="true">' + (icons[type] || icons.info) + '</span><span>' + msg + '</span>';
    wrap.appendChild(el);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() { el.classList.add('show'); });
    });
    setTimeout(function() {
      el.classList.add('hide');
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    }, duration);
  }
  w.toast = toast;

  /* ── Modal Helpers ── */
  w.openModal = function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.classList.add('open', 'active');
      document.body.style.overflow = 'hidden';
      // Focus first focusable
      setTimeout(function() {
        var f = el.querySelector('input,select,textarea,button,[tabindex="0"]');
        if (f) try { f.focus(); } catch(e) {}
      }, 100);
    }
  };
  w.closeModal = function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.classList.remove('open', 'active');
      document.body.style.overflow = '';
    }
  };

  // Click outside modal to close
  document.addEventListener('click', function(e) {
    var modal = e.target.closest('.modal, .modal-bg, .gf-modal-bg');
    if (modal && e.target === modal) {
      modal.classList.remove('open', 'active');
      document.body.style.overflow = '';
    }
  });

  /* ── Sidebar drawer (admin layouts) ── */
  function initSidebar() {
    var sidebar = document.querySelector('.sidebar, .gf-sidebar');
    var hamburger = document.getElementById('hamburger') || document.getElementById('menuBtn');
    if (!sidebar) return;
    // Idempotent: only init once
    if (sidebar.dataset.gfSidebarInit) return;
    sidebar.dataset.gfSidebarInit = '1';

    // Inject overlay if not present
    var overlay = document.getElementById('sidebarOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebarOverlay';
      overlay.className = 'gf-sidebar-overlay';
      document.body.appendChild(overlay);
    }

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    // Replace hamburger with a clone to drop any existing click handlers
    // (inline scripts that toggle .open on the wrong element cause double-toggle).
    if (hamburger) {
      var clean = hamburger.cloneNode(true);
      hamburger.parentNode.replaceChild(clean, hamburger);
      hamburger = clean;
      hamburger.addEventListener('click', function(e) {
        e.stopPropagation();
        sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
      });
    }
    // Same for the overlay
    var cleanOverlay = overlay.cloneNode(false);
    overlay.parentNode.replaceChild(cleanOverlay, overlay);
    overlay = cleanOverlay;
    overlay.addEventListener('click', closeSidebar);

    // Sidebar close button (the ::before pseudo, made interactive)
    sidebar.addEventListener('click', function(e) {
      // Click in top-right corner = close
      var rect = sidebar.getBoundingClientRect();
      if (w.innerWidth < 1024 && sidebar.classList.contains('open')) {
        if (e.clientX > rect.right - 50 && e.clientY < rect.top + 50) {
          closeSidebar();
        }
      }
    });

    // Auto-close on nav click
    sidebar.querySelectorAll('a, .gf-nav-item, .nav-item').forEach(function(a) {
      a.addEventListener('click', function() {
        if (w.innerWidth < 1024) closeSidebar();
      });
    });

    // Swipe-right-from-edge to open, swipe-left to close
    var touchStart = null;
    document.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    document.addEventListener('touchend', function(e) {
      if (!touchStart || w.innerWidth >= 1024) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - touchStart.x;
      var dy = Math.abs(t.clientY - touchStart.y);
      var dt = Date.now() - touchStart.t;
      if (dt > 350 || Math.abs(dx) < 80 || dy > 60) { touchStart = null; return; }
      // Swipe right from far-left edge
      if (touchStart.x < 30 && dx > 80 && !sidebar.classList.contains('open')) openSidebar();
      // Swipe left while sidebar is open
      else if (dx < -80 && sidebar.classList.contains('open')) closeSidebar();
      touchStart = null;
    }, { passive: true });
  }

  /* ── Auto-inject mobile bottom nav on admin/dashboard pages ── */
  function injectMobileAdminNav() {
    // Only inject on pages with a sidebar OR pages explicitly marked as admin
    var isAdminPage = !!document.querySelector('.sidebar, .gf-sidebar')
      || document.body.classList.contains('gf-page')
      || document.body.classList.contains('gf-scanner-page');
    // But not on member-facing pages (they have their own bottom nav)
    var isMemberPage = !!document.querySelector('.glass-nav');
    if (!isAdminPage || isMemberPage) return;
    if (document.querySelector('.gf-admin-mobile-nav')) return;

    var path = w.location.pathname.replace(/\.html$/, '').replace(/^\//, '');
    var items = [
      { href: '/admin-dashboard.html', label: 'Members', match: /(admin-dashboard|dashboard|^$|^index)/,
        svg: '<path d="M17 20h5v-2a3 3 0 00-5.36-1.86M17 20H7m10 0v-2c0-.66-.13-1.28-.36-1.86M7 20H2v-2a3 3 0 015.36-1.86M7 20v-2c0-.66.13-1.28.36-1.86m0 0a5 5 0 019.28 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>' },
      { href: '/analytics.html', label: 'Analytics', match: /analytics/,
        svg: '<path d="M9 19v-6m3 6V9m3 10v-3M3 21h18M5 5v14h14V5H5z"/>' },
      { href: '/classes-admin.html', label: 'Classes', match: /classes-admin/,
        svg: '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
      { href: '/staff-checkin.html', label: 'Check-In', match: /staff-checkin|checkin/,
        svg: '<path d="M12 4v16m8-8H4"/>' },
      { href: '/operations.html', label: 'More', match: /operations|pricing|reminders|business-hours|waiver|instructor/,
        svg: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>' }
    ];
    var nav = document.createElement('nav');
    nav.className = 'gf-admin-mobile-nav';
    nav.setAttribute('aria-label', 'Admin navigation');
    items.forEach(function(it) {
      var a = document.createElement('a');
      a.href = it.href;
      var active = it.match.test(path);
      if (active) a.className = 'active';
      a.innerHTML = '<svg viewBox="0 0 24 24" fill="none">' + it.svg + '</svg><span>' + it.label + '</span>';
      nav.appendChild(a);
    });
    document.body.appendChild(nav);
  }

  /* ── Online/Offline indicator ── */
  function initNetStatus() {
    var banner = document.createElement('div');
    banner.className = 'gf-net-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    document.body.appendChild(banner);

    function update() {
      if (navigator.onLine) {
        banner.classList.add('online');
        banner.textContent = 'Back online';
        banner.classList.add('show');
        setTimeout(function() { banner.classList.remove('show'); }, 2500);
      } else {
        banner.classList.remove('online');
        banner.textContent = 'You are offline';
        banner.classList.add('show');
      }
    }

    var wasOnline = navigator.onLine;
    w.addEventListener('online', function() { wasOnline = true; update(); });
    w.addEventListener('offline', function() { wasOnline = false; update(); });
    // Show on initial load only if offline
    if (!navigator.onLine) update();
  }

  /* ── Keyboard Shortcuts ── */
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
      // Don't trigger when typing in inputs
      var t = e.target;
      var isInput = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;

      // Escape closes any open modal/sidebar
      if (e.key === 'Escape') {
        var openModal = document.querySelector('.modal.active, .modal.open, .modal-bg.active, .gf-modal-bg.active, .gf-confirm-overlay.active');
        if (openModal) {
          openModal.classList.remove('open', 'active');
          document.body.style.overflow = '';
          e.preventDefault();
          return;
        }
        var sb = document.querySelector('.sidebar.open');
        if (sb) {
          sb.classList.remove('open');
          var ov = document.getElementById('sidebarOverlay');
          if (ov) ov.classList.remove('open');
          document.body.style.overflow = '';
          e.preventDefault();
        }
      }

      if (isInput) return;

      // "/" focuses the search input
      if (e.key === '/') {
        var search = document.querySelector('input[type="search"], .gf-search-input, #searchInput, #search-input');
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }

      // "?" shows help (basic toast for now)
      if (e.key === '?' && e.shiftKey) {
        toast('Shortcuts: / to search · Esc to close · ? for help', 'info', 4000);
      }

      // "t" toggles theme
      if (e.key === 't' && !e.ctrlKey && !e.metaKey) {
        if (typeof w.toggleTheme === 'function') w.toggleTheme();
      }
    });
  }

  /* ── Search Input Enhancement (auto-clear + debounce) ── */
  function enhanceSearchInputs() {
    document.querySelectorAll('input[type="search"], .gf-search-input').forEach(function(input) {
      if (input.dataset.gfEnhanced) return;
      input.dataset.gfEnhanced = '1';

      // Wrap if not already wrapped
      var wrap = input.closest('.gf-search-wrap');
      if (!wrap) return; // page didn't use the wrapper, skip

      // Add clear button if missing
      var clearBtn = wrap.querySelector('.gf-search-clear');
      if (!clearBtn) {
        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'gf-search-clear';
        clearBtn.setAttribute('aria-label', 'Clear search');
        clearBtn.innerHTML = '\u00d7';
        wrap.appendChild(clearBtn);
      }

      function updateHasValue() {
        if (input.value) wrap.classList.add('has-value');
        else wrap.classList.remove('has-value');
      }
      input.addEventListener('input', updateHasValue);
      clearBtn.addEventListener('click', function() {
        input.value = '';
        updateHasValue();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
      updateHasValue();
    });
  }

  /* ── Debounce helper ── */
  w.GF_DEBOUNCE = function(fn, ms) {
    var timer;
    return function() {
      var args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function() { fn.apply(null, args); }, ms || 250);
    };
  };

  /* ── Skeleton helpers ── */
  w.GF_SKELETON = {
    cards: function(n) {
      var html = '';
      for (var i = 0; i < (n || 3); i++) {
        html += '<div class="gf-skeleton gf-skeleton-card"></div>';
      }
      return html;
    },
    rows: function(n) {
      var html = '';
      for (var i = 0; i < (n || 5); i++) {
        html += '<div class="gf-skeleton gf-skeleton-text" style="width:' + (60 + (i*7)%30) + '%"></div>';
      }
      return html;
    }
  };

  /* ── XSS / Escape Utilities ── */
  function escHtml(text) {
    if (!text) return '';
    var map = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#x27;', '/':'&#x2F;' };
    return String(text).replace(/[&<>"'\/]/g, function(c) { return map[c]; });
  }
  w.esc = escHtml;
  w.GF_UTILS = {
    escapeHtml: escHtml,
    setText: function(sel, text) {
      var el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (el) el.textContent = text != null ? text : '';
    },
    // Format relative time ("2 mins ago")
    relativeTime: function(date) {
      if (!date) return '';
      var d = (typeof date === 'string') ? new Date(date) : date;
      var diff = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return Math.floor(diff/60) + 'm ago';
      if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
      if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
      return d.toLocaleDateString();
    },
    // Format Naira amount
    fmtNaira: function(amount) {
      if (amount == null) return '\u2014';
      return '\u20a6' + Number(amount).toLocaleString('en-NG');
    },
    // Debounce shortcut
    debounce: function(fn, ms) { return w.GF_DEBOUNCE(fn, ms); },
    // Empty state HTML helper
    emptyState: function(opts) {
      opts = opts || {};
      return '<div class="gf-empty">' +
        '<div class="gf-empty-icon">' + (opts.icon || '\ud83d\udcc2') + '</div>' +
        '<div class="gf-empty-title">' + escHtml(opts.title || 'Nothing here yet') + '</div>' +
        '<div class="gf-empty-text">' + escHtml(opts.text || '') + '</div>' +
        (opts.action ? '<div style="margin-top:16px;">' + opts.action + '</div>' : '') +
        '</div>';
    }
  };

  /* ── Confirm Dialog ── */
  w.GF_CONFIRM = function(opts) {
    opts = opts || {};
    return new Promise(function(resolve) {
      var dlg = document.getElementById('gfConfirmDialog');
      if (!dlg) {
        dlg = document.createElement('div');
        dlg.id = 'gfConfirmDialog';
        dlg.className = 'gf-confirm-overlay';
        dlg.innerHTML =
          '<div class="gf-confirm-box" role="dialog" aria-modal="true" aria-labelledby="gfConfirmTitle">' +
          '  <div class="gf-confirm-title" id="gfConfirmTitle">Confirm</div>' +
          '  <div class="gf-confirm-msg" id="gfConfirmMsg">Are you sure?</div>' +
          '  <div class="gf-confirm-actions">' +
          '    <button class="gf-confirm-btn cancel" id="gfConfirmCancel" type="button">Cancel</button>' +
          '    <button class="gf-confirm-btn primary" id="gfConfirmOk" type="button">Confirm</button>' +
          '  </div>' +
          '</div>';
        document.body.appendChild(dlg);
      }
      document.getElementById('gfConfirmTitle').textContent = opts.title || 'Confirm';
      document.getElementById('gfConfirmMsg').textContent   = opts.message || 'Are you sure?';
      var ok = document.getElementById('gfConfirmOk');
      ok.textContent = opts.okText || 'Confirm';
      ok.className   = 'gf-confirm-btn ' + (opts.type === 'danger' ? 'danger' : 'primary');
      document.getElementById('gfConfirmCancel').textContent = opts.cancelText || 'Cancel';
      dlg.classList.add('active');
      function done(v) {
        dlg.classList.remove('active');
        document.body.style.overflow = '';
        resolve(v);
      }
      ok.onclick     = function() { done(true); };
      document.getElementById('gfConfirmCancel').onclick = function() { done(false); };
      // Backdrop click
      dlg.onclick = function(e) { if (e.target === dlg) done(false); };
      // Focus the OK button
      setTimeout(function() { try { ok.focus(); } catch(e) {} }, 50);
    });
  };
  w.GF_CONFIRM_DANGER = function(title, msg, okText) {
    return w.GF_CONFIRM({ title: title, message: msg, okText: okText || 'Delete', type: 'danger' });
  };

  /* ── Event Delegation for data-action attributes ── */
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var args = btn.dataset.args
      ? btn.dataset.args.split(',').map(function(a) { return a.trim().replace(/^['"]|['"]$/g, ''); })
      : [];
    if (typeof w[action] === 'function') {
      try { w[action].apply(null, args); }
      catch(err) { console.error('[GF] Action error:', action, err); }
    }
  });

  /* ── Form auto-save drafts ── */
  function initFormAutoSave() {
    document.querySelectorAll('form[data-autosave]').forEach(function(form) {
      var key = 'gf-draft-' + (form.dataset.autosave || form.id || 'form');
      // Restore
      try {
        var saved = JSON.parse(localStorage.getItem(key) || '{}');
        Object.keys(saved).forEach(function(name) {
          var f = form.querySelector('[name="' + name + '"]');
          if (f && !f.value) f.value = saved[name];
        });
      } catch (e) {}
      // Save on input (debounced)
      var save = w.GF_DEBOUNCE(function() {
        var data = {};
        new FormData(form).forEach(function(v, k) { if (typeof v === 'string') data[k] = v; });
        try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {}
      }, 500);
      form.addEventListener('input', save);
      form.addEventListener('submit', function() { localStorage.removeItem(key); });
    });
  }

  /* ── Auto-loading state for any form submit ──
     On submit, the submit button gets a spinner and disabled state for 8s
     (or until the page navigates / form is re-enabled). */
  function initFormSubmitLoading() {
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (form.dataset.gfNoLoading) return;
      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (!btn || btn.disabled) return;
      var originalHtml = btn.innerHTML;
      var originalText = btn.value;
      btn.dataset.gfOriginal = originalHtml;
      btn.disabled = true;
      if (btn.tagName === 'BUTTON') {
        btn.innerHTML = '<span class="gf-spinner-inline" aria-hidden="true"></span><span>Working…</span>';
      } else {
        btn.value = 'Working…';
      }
      // Restore after 8s as a safety net (in case form is async and doesn't navigate)
      setTimeout(function() {
        if (btn.disabled && btn.dataset.gfOriginal !== undefined) {
          btn.disabled = false;
          if (btn.tagName === 'BUTTON') btn.innerHTML = btn.dataset.gfOriginal;
          else btn.value = originalText;
          delete btn.dataset.gfOriginal;
        }
      }, 8000);
    }, true);
  }

  /* ── Export Utilities ── */
  w.GF_EXPORT = {
    tableToCSV: function(selector, filename) {
      var tbl = document.querySelector(selector);
      if (!tbl) return;
      var rows = Array.from(tbl.querySelectorAll('tr'));
      var csv = rows.map(function(r) {
        return Array.from(r.querySelectorAll('td,th')).map(function(c) {
          return '"' + c.textContent.replace(/"/g, '""').trim() + '"';
        }).join(',');
      }).join('\n');
      var blob = new Blob([csv], {type: 'text/csv'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (filename || 'export') + '.csv';
      a.click();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    },
    toJSON: function(data, filename) {
      var blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (filename || 'export') + '.json';
      a.click();
      setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
    }
  };

  /* ── Global Error Handler (suppress noise) ── */
  w.addEventListener('unhandledrejection', function(e) {
    var msg = (e.reason && e.reason.message) || String(e.reason) || '';
    if (msg.includes('ServiceWorker') || msg.includes('sw.js') || msg.includes('fetch')) {
      e.preventDefault();
      return;
    }
    console.error('[GF] Unhandled rejection:', msg);
  });

  /* ── Init on DOM ready ── */
  function init() {
    initSidebar();
    injectMobileAdminNav();
    initNetStatus();
    initKeyboardShortcuts();
    enhanceSearchInputs();
    initFormAutoSave();
    initFormSubmitLoading();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run enhancers after dynamic content loads
  var enhanceTimeout;
  var observer = new MutationObserver(function() {
    clearTimeout(enhanceTimeout);
    enhanceTimeout = setTimeout(function() {
      enhanceSearchInputs();
      initFormAutoSave();
    }, 100);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  else document.addEventListener('DOMContentLoaded', function() { observer.observe(document.body, { childList: true, subtree: true }); });

})(window);

