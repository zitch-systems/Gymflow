const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = 'https://kdbbrxqxqewbjoozmfhq.supabase.co';

async function supabaseQuery(table, method, body, query) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (query) url += '?' + query;
  const res = await fetch(url, {
    method: method || 'GET',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
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
    const { email, password, gymId, profile, subscription } = JSON.parse(event.body);

    // 1. Create auth user via Supabase Auth Admin API
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!authRes.ok) {
      const err = await authRes.json();
      return { statusCode: 400, headers, body: JSON.stringify({ error: err.msg || err.message || 'Auth failed' }) };
    }
    const authData = await authRes.json();
    const userId = authData.id;

    // 2. Create profile
    await supabaseQuery('profiles', 'POST', { id: userId, ...profile, email });

    // 3. Link to gym
    await supabaseQuery('gym_member_links', 'POST', { gym_id: gymId, user_id: userId, onboarding_method: 'admin_manual' });

    // 4. Create subscription
    if (subscription) {
      await supabaseQuery('memberships', 'POST', { member_id: userId, gym_id: gymId, ...subscription });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, userId }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};