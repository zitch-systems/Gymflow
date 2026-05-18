export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'}
    });
  }
  const PAYSTACK_SK = 'sk_test_86001513e7e205dad5abf6400057634f5d107422';
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (request.method === 'POST' && action === 'initiate') {
    try {
      const body = await request.json();
      if (!body.email || !body.amount) {
        return new Response(JSON.stringify({error:'email and amount required'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method:'POST',
        headers:{'Authorization':'Bearer '+PAYSTACK_SK,'Content-Type':'application/json'},
        body:JSON.stringify({email:body.email, amount:Math.round(body.amount*100), currency:'NGN', callback_url:body.callback_url||''})
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {status:res.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    } catch(e) {
      return new Response(JSON.stringify({error:e.message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }
  }
  if (request.method === 'POST' && action === 'verify') {
    try {
      const body = await request.json();
      if (!body.reference) {
        return new Response(JSON.stringify({error:'reference required'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
      }
      const res = await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(body.reference), {
        headers:{'Authorization':'Bearer '+PAYSTACK_SK}
      });
      const data = await res.json();
      return new Response(JSON.stringify(data), {status:res.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    } catch(e) {
      return new Response(JSON.stringify({error:e.message}), {status:500, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }
  }
  return new Response(JSON.stringify({error:'Unknown action. Use ?action=initiate or ?action=verify'}), {status:400, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
}
