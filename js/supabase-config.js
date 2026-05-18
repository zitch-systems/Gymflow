/**
 * GymFlow Supabase Bootstrap
 * - Embeds credentials (for Cloudflare Pages where env vars don't reach the browser)
 * - Exports window.GF_SUPABASE_READY as a PROMISE that resolves to the Supabase client
 * - HTML pages use: const client = await window.GF_SUPABASE_READY;
 */
(function () {
  var SUPABASE_URL = 'https://kdbbrxqxqewbjoozmfhq.supabase.co';
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYmJyeHF4cWV3Ympvb3ptZmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Mzk3MDcsImV4cCI6MjA5MzMxNTcwN30.yzeKmGPubg5g9vdg9X4gLKWLoWmgpAqpIMQklxaTkkA';

  window.GF_SUPABASE_URL = SUPABASE_URL;
  window.GF_SUPABASE_KEY = SUPABASE_KEY;

  // GF_SUPABASE_READY is a Promise that resolves to the Supabase client.
  // It waits for the CDN UMD bundle (window.supabase.createClient) to load,
  // then creates and caches the client.
  window.GF_SUPABASE_READY = new Promise(function (resolve, reject) {
    var attempts = 0;
    var maxAttempts = 80; // 80 * 50ms = 4 seconds

    function tryInit() {
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        try {
          var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              storage: window.localStorage,
              storageKey: 'gf-supabase-auth'
            }
          });
          window.gfSupabase = client;
          console.log('[GF] Supabase client ready');
          resolve(client);
        } catch (e) {
          console.error('[GF] Supabase init failed:', e);
          reject(e);
        }
        return;
      }
      attempts++;
      if (attempts >= maxAttempts) {
        var err = new Error('Supabase CDN library did not load within 4 seconds');
        console.error('[GF]', err.message);
        reject(err);
        return;
      }
      setTimeout(tryInit, 50);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryInit);
    } else {
      tryInit();
    }
  });

  // Also catch unhandled rejection so the promise doesn't pollute the console
  window.GF_SUPABASE_READY.catch(function (e) {
    console.warn('[GF] GF_SUPABASE_READY rejected:', e && e.message);
  });
})();
