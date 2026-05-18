const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = 'https://kdbbrxqxqewbjoozmfhq.supabase.co';

async function supabaseQuery(table, method, body, query) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (query) url += '?' + query;
  const reqHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  // FIX: Only add Prefer header on POST, not empty string on GET
  if (method === 'POST') {
    reqHeaders['Prefer'] = 'return=representation';
  }
  const res = await fetch(url, {
    method: method || 'GET',
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { action } = event.queryStringParameters || {};
    const body = JSON.parse(event.body);

    if (action === 'initiate') {
      const { email, amount, metadata } = body;
      // FIX: Multiply amount by 100 for Paystack kobo
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount: amount * 100, metadata }),
      });
      const data = await res.json();
      if (!data.status) throw new Error(data.message);
      return { statusCode: 200, headers, body: JSON.stringify({ reference: data.data.reference, authorization_url: data.data.authorization_url }) };
    }

    if (action === 'verify') {
      const { reference, member_id, gym_id, subscription, amount, payment_method = 'card' } = body;
      const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      });
      const data = await res.json();
      if (!data.status || data.data.status !== 'success') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment failed' }) };
      }

      // FIX: Complete the subscription insert with error handling
      const subResult = await supabaseQuery('member_subscriptions', 'POST', {
        member_id,
        gym_id,
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
        end_date: subscription.end_date,
        auto_debit_enabled: false,
      });

      // FIX: Insert into payments table with ALL required fields
      // Save authorization code for future auto-debit
      const auth = data.data.authorization;
      if (auth && auth.reusable && auth.authorization_code) {
        await supabaseQuery('saved_cards', 'POST', {
          gym_id,
          member_id,
          authorization_code: auth.authorization_code,
          card_type: auth.card_type || null,
          last4: auth.last4 || null,
          exp_month: auth.exp_month || null,
          exp_year: auth.exp_year || null,
          bank: auth.bank || null,
          brand: auth.brand || null,
          reusable: auth.reusable || true,
          email: data.data.customer?.email || member_id,
          is_default: true,
        });
      }

      await supabaseQuery('payments', 'POST', {
        gym_id,
        member_id,
        amount: amount || 0,
        payment_method,
        payment_status: 'successful',
        paystack_reference: reference,
        paystack_authorization_code: auth?.authorization_code || null,
        payment_date: new Date().toISOString(),
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, subscription: subResult, authorization_saved: !!(auth && auth.reusable) }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
  } catch (err) {
    console.error('Paystack function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};