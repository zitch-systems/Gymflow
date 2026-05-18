export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      }
    });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({error:'Method not allowed'}), {status:405, headers:{'Content-Type':'application/json'}});
  }
  try {
    const body = await request.json();
    const SB_URL = 'https://kdbbrxqxqewbjoozmfhq.supabase.co';
    const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkYmJyeHF4cWV3Ympvb3ptZmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Mzk3MDcsImV4cCI6MjA5MzMxNTcwN30.yzeKmGPubg5g9vdg9X4gLKWLoWmgpAqpIMQklxaTkkA';
    const auth = request.headers.get('Authorization') || ('Bearer ' + SB_KEY);
    const res = await fetch(SB_URL + '/rest/v1/check_ins', {
      method:'POST',
      headers:{'apikey':SB_KEY,'Authorization':auth,'Content-Type':'application/json','Prefer':'return=representation'},
      body: JSON.stringify({
        member_id: body.member_id,
        gym_id: body.gym_id,
        check_in_time: new Date().toISOString(),
        check_in_method: body.method || 'manual',
        device_info: body.device_info || null,
      })
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {status:res.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
  }
}
