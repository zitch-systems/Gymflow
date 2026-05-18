// GymFlow Supabase Bootstrap — credentials embedded for Cloudflare Pages drag-and-drop
(function(){
  var url = 'https://kdbbrxqxqewbjoozmfhq.supabase.co';
  var key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYmJyeHF4cWV3Ympvb3ptZmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Mzk3MDcsImV4cCI6MjA5MzMxNTcwN30.yzeKmGPubg5g9vdg9X4gLKWLoWmgpAqpIMQklxaTkkA';
  window.GF_SUPABASE_URL = url;
  window.GF_SUPABASE_KEY = key;
  window.GF_SUPABASE_READY = true;
  if(window.supabase && window.supabase.createClient){
    window.gfSupabase = window.supabase.createClient(url, key);
  }
})();
