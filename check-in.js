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
  // FIX: Only add Prefer header on POST
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
    const { member_id, gym_id, device_info } = JSON.parse(event.body);
    if (!member_id || !gym_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'member_id and gym_id required' }) };

    // Verify membership
    const links = await supabaseQuery('gym_member_links', 'GET', null, `select=id&user_id=eq.${member_id}&gym_id=eq.${gym_id}`);
    if (!links || !links.length) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Not a member' }) };

    // Check active subscription
    const today = new Date().toISOString().split('T')[0];
    const subs = await supabaseQuery('memberships', 'GET', null, `select=*&member_id=eq.${member_id}&gym_id=eq.${gym_id}&status=eq.active&end_date=gte.${today}&order=end_date.desc&limit=1`);
    const sub = subs && subs.length ? subs[0] : null;

    // FIX: Allow check-in even without subscription (staff override scenario)
    // But flag it in response
    let subscriptionId = null;
    if (sub) subscriptionId = sub.id;

    // Prevent duplicate within 2 hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recent = await supabaseQuery('check_ins', 'GET', null, `select=id&member_id=eq.${member_id}&gym_id=eq.${gym_id}&checked_in_at=gte.${twoHoursAgo}&limit=1`);
    if (recent && recent.length) return { statusCode: 429, headers, body: JSON.stringify({ error: 'Already checked in within 2 hours' }) };

    // FIX: Record check-in with subscription_id and device_info
    const checkin = await supabaseQuery('check_ins', 'POST', { 
      member_id, 
      gym_id, 
      subscription_id: subscriptionId,
      checked_in_at: new Date().toISOString(),
      device_info: device_info || null
    });

    return { statusCode: 200, headers, body: JSON.stringify({
      success: true,
      check_in: checkin,
      subscription: sub ? {
        type: 'active',
        end_date: sub.end_date,
        days_left: Math.ceil((new Date(sub.end_date) - new Date(today)) / (1000*60*60*24))
      } : null
    }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};