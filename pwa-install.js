

// ═══════════════════════════════════════════════════════════════════════════════
// GymFlow PWA Install System — Cross-Platform (Android, iOS, Desktop)
// Auto-detects device and shows appropriate install UI
// ═══════════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ── Platform Detection ──
  const PLATFORM = {
    isAndroid: /Android/i.test(navigator.userAgent),
    isIOS: /iPhone|iPad|iPod/i.test(navigator.userAgent),
    isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
    isChrome: /Chrome/i.test(navigator.userAgent) && !/Edge|Edg/i.test(navigator.userAgent),
    isEdge: /Edge|Edg/i.test(navigator.userAgent),
    isFirefox: /Firefox/i.test(navigator.userAgent),
    isSamsung: /SamsungBrowser/i.test(navigator.userAgent),
    isDesktop: !(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)),
    isStandalone: window.matchMedia('(display-mode: standalone)').matches || 
                  window.navigator.standalone === true ||
                  document.referrer.startsWith('android-app://')
  };

  // ── State ──
  let deferredPrompt = null;
  let installButton = null;
  let installCard = null;

  // ── beforeinstallprompt handler (Chrome/Edge/Android) ──
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallUI('chrome');
  });

  // ── App installed handler ──
  window.addEventListener('appinstalled', function() {
    deferredPrompt = null;
    hideInstallUI();
    if (window.toast) toast('GymFlow installed successfully!', 'success');
  });

  // ── Display mode change ──
  window.matchMedia('(display-mode: standalone)').addEventListener('change', function(e) {
    if (e.matches) hideInstallUI();
  });

  // ── Show Install UI based on platform ──
  function showInstallUI(browser) {
    if (PLATFORM.isStandalone) return;

    // Create install card if not exists
    if (!installCard) {
      createInstallCard();
    }

    // Update content based on platform
    const title = installCard.querySelector('.pwa-install-title');
    const subtitle = installCard.querySelector('.pwa-install-subtitle');
    const btn = installCard.querySelector('.pwa-install-btn');
    const steps = installCard.querySelector('.pwa-install-steps');

    if (PLATFORM.isIOS) {
      title.textContent = 'Add GymFlow to Home Screen';
      subtitle.textContent = 'Install GymFlow like a native app on your iPhone/iPad';
      btn.style.display = 'none';
      steps.innerHTML = '<div class="pwa-step"><span class="pwa-step-num">1</span> Tap the <strong>Share</strong> button <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> in Safari</div>' +
        '<div class="pwa-step"><span class="pwa-step-num">2</span> Scroll down and tap <strong>Add to Home Screen</strong></div>' +
        '<div class="pwa-step"><span class="pwa-step-num">3</span> Tap <strong>Add</strong> in the top right</div>';
      steps.style.display = 'block';
    } else if (PLATFORM.isAndroid) {
      title.textContent = 'Install GymFlow App';
      subtitle.textContent = 'Add GymFlow to your home screen for quick access';
      btn.textContent = 'Install Now';
      btn.style.display = 'flex';
      steps.style.display = 'none';
    } else if (PLATFORM.isDesktop) {
      title.textContent = 'Install GymFlow Desktop App';
      subtitle.textContent = 'Get the full app experience on your computer';
      btn.textContent = 'Install App';
      btn.style.display = 'flex';
      steps.style.display = 'none';
    }

    installCard.classList.add('active');
  }

  // ── Create Install Card DOM ──
  function createInstallCard() {
    installCard = document.createElement('div');
    installCard.id = 'pwaInstallCard';
    installCard.className = 'pwa-install-card';
    installCard.innerHTML = '<div class="pwa-install-content">' +
      '<div class="pwa-install-icon">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00d9a5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>' +
      '<line x1="12" y1="8" x2="12" y2="16"/>' +
      '<line x1="8" y1="12" x2="16" y2="12"/>' +
      '</svg></div>' +
      '<div class="pwa-install-text">' +
      '<div class="pwa-install-title">Install GymFlow</div>' +
      '<div class="pwa-install-subtitle">Get the app experience</div>' +
      '</div>' +
      '<button class="pwa-install-btn" id="pwaInstallBtn">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      'Install</button>' +
      '<button class="pwa-install-close" id="pwaInstallClose">&times;</button>' +
      '</div>' +
      '<div class="pwa-install-steps"></div>';
    document.body.appendChild(installCard);

    // Event listeners
    installCard.querySelector('#pwaInstallBtn').addEventListener('click', triggerInstall);
    installCard.querySelector('#pwaInstallClose').addEventListener('click', hideInstallUI);

    // Auto-show after 3 seconds on first visit
    setTimeout(function() {
      if (!localStorage.getItem('pwa-install-dismissed') && !PLATFORM.isStandalone) {
        showInstallUI();
      }
    }, 3000);
  }

  // ── Trigger Install ──
  function triggerInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(choice) {
        if (choice.outcome === 'accepted') {
          if (window.toast) toast('Installing GymFlow...', 'success');
        }
        deferredPrompt = null;
      });
    } else if (PLATFORM.isIOS) {
      // iOS already shows instructions
    } else {
      // Fallback for unsupported browsers
      alert('To install GymFlow:\n1. Open your browser menu (⋮ or ⋯)\n2. Look for "Add to Home Screen" or "Install App"\n3. Follow the prompts');
    }
  }

  // ── Hide Install UI ──
  function hideInstallUI() {
    if (installCard) {
      installCard.classList.remove('active');
      localStorage.setItem('pwa-install-dismissed', 'true');
    }
  }

  // ── Create floating install button (for landing page) ──
  function createFloatingInstallButton() {
    if (PLATFORM.isStandalone) return;

    var btn = document.createElement('button');
    btn.id = 'floatingInstallBtn';
    btn.className = 'pwa-floating-install';
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
      '<span>Install App</span>';
    btn.addEventListener('click', function() {
      if (installCard) {
        installCard.classList.add('active');
      } else {
        showInstallUI();
      }
    });
    document.body.appendChild(btn);
  }

  // ── Add Sign In / Sign Up buttons to landing page ──
  function addAuthButtons() {
    var hero = document.querySelector('.hero') || document.querySelector('#hero') || document.querySelector('header');
    if (!hero) return;

    // Check if auth buttons already exist
    if (hero.querySelector('.auth-buttons')) return;

    var authDiv = document.createElement('div');
    authDiv.className = 'auth-buttons';
    authDiv.innerHTML = '<a href="login.html" class="gf-btn gf-btn-outline auth-signin">Sign In</a>' +
      '<a href="join.html" class="gf-btn auth-signup">Get Started Free</a>';

    // Insert after hero content or in nav area
    var nav = hero.querySelector('nav') || hero.querySelector('.nav');
    if (nav) {
      nav.appendChild(authDiv);
    } else {
      hero.appendChild(authDiv);
    }
  }

  // ── Auto-detect and apply mobile/desktop classes ──
  function detectViewport() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    var isMobile = w < 768;
    var isTablet = w >= 768 && w < 1024;
    var isDesktop = w >= 1024;
    var isPortrait = h > w;

    document.documentElement.classList.remove('mobile-view', 'tablet-view', 'desktop-view', 'portrait', 'landscape');

    if (isMobile) document.documentElement.classList.add('mobile-view');
    if (isTablet) document.documentElement.classList.add('tablet-view');
    if (isDesktop) document.documentElement.classList.add('desktop-view');
    if (isPortrait) document.documentElement.classList.add('portrait');
    else document.documentElement.classList.add('landscape');

    // Touch detection
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      document.documentElement.classList.add('touch-device');
    } else {
      document.documentElement.classList.add('no-touch');
    }

    // Standalone detection
    if (PLATFORM.isStandalone) {
      document.documentElement.classList.add('standalone-app');
    }
  }

  // ── Initialize ──
  function init() {
    detectViewport();
    createFloatingInstallButton();
    addAuthButtons();

    // Re-detect on resize
    window.addEventListener('resize', function() {
      clearTimeout(window._resizeTimer);
      window._resizeTimer = setTimeout(detectViewport, 150);
    });

    // Re-detect on orientation change
    window.addEventListener('orientationchange', detectViewport);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.GF_PWA = {
    platform: PLATFORM,
    deferredPrompt: function() { return deferredPrompt; },
    showInstall: showInstallUI,
    hideInstall: hideInstallUI
  };
})();

