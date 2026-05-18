// GymFlow lightweight error tracker
// Logs errors to /client_errors table in Supabase
(function() {
  var queue = [];
  var pageLoadTime = Date.now();
  
  function logErr(payload) {
    queue.push(payload);
    if (window.GF_SUPABASE_READY && typeof window.GF_SUPABASE_READY.then === 'function') {
      window.GF_SUPABASE_READY.then(function(client) {
        if (!client || !client.from) return;
        while(queue.length) {
          var p = queue.shift();
          client.from('client_errors').insert({
            page_url: location.pathname,
            user_agent: navigator.userAgent.slice(0,500),
            message: (p.message||'').slice(0,500),
            stack: (p.stack||'').slice(0,2000),
            severity: p.severity || 'error',
            session_seconds: Math.round((Date.now()-pageLoadTime)/1000)
          }).then(null, function(){}); // swallow errors silently
        }
      }).catch(function(){});
    }
  }
  
  window.addEventListener('error', function(e) {
    logErr({
      message: e.message || 'Uncaught error',
      stack: e.error && e.error.stack || '',
      severity: 'error'
    });
  });
  
  window.addEventListener('unhandledrejection', function(e) {
    logErr({
      message: 'Unhandled rejection: ' + (e.reason && e.reason.message || e.reason || ''),
      stack: e.reason && e.reason.stack || '',
      severity: 'warning'
    });
  });
  
  window.GF_ERROR_TRACKER = { log: logErr };
})();
