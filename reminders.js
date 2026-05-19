const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = 'https://kdbbrxqxqewbjoozmfhq.supabase.co';
const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'GymFlow';

async function supabaseQuery(table, method, body, query) {
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (query) url += '?' + query;
  const reqHeaders = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method === 'POST') reqHeaders['Prefer'] = 'return=representation';
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
    'Content-Type': 'application/json' 
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const body = JSON.parse(event.body);
    const { action, gym_id, days = 3, message, member_id } = body;

    // FIX: Require gym_id for all actions
    if (!gym_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'gym_id required' }) };
    }

    let targetDate;
    let queryFilter;

    if (action === 'auto' || !action) {
      // FIX: Use date RANGE (today to target date), not exact date
      const today = new Date().toISOString().split('T')[0];
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);
      const targetStr = targetDate.toISOString().split('T')[0];

      // FIX: Filter by gym_id AND date range
      queryFilter = `select=*,profiles!inner(phone,full_name)&gym_id=eq.${gym_id}&status=eq.active&end_date=gte.${today}&end_date=lte.${targetStr}`;
    } else if (action === 'single' && member_id) {
      // Send to specific member
      queryFilter = `select=*,profiles!inner(phone,full_name)&gym_id=eq.${gym_id}&member_id=eq.${member_id}&status=eq.active`;
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
    }

    const expiring = await supabaseQuery('memberships', 'GET', null, queryFilter);

    if (!expiring || !expiring.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ message: 'No expiring subscriptions', sent: 0 }) };
    }

    const results = [];
    for (const sub of expiring) {
      const phone = sub.profiles?.phone;
      const name = sub.profiles?.full_name || 'Member';
      if (!phone) {
        results.push({ member_id: sub.member_id, phone: null, sent: false, reason: 'No phone number' });
        continue;
      }

      // Use custom message if provided, otherwise default
      const msg = message || 
        `Hi ${name}, your gym subscription expires in ${days} days (${sub.end_date}). Renew now to keep your access active. - GymFlow`;

      let sent = false;
      try {
        if (TERMII_API_KEY) {
          const res = await fetch('https://api.ng.termii.com/api/sms/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: phone.startsWith('0') ? '234' + phone.slice(1) : phone,
              from: TERMII_SENDER_ID,
              sms: msg,
              type: 'plain',
              channel: 'generic',
              api_key: TERMII_API_KEY,
            }),
          });
          const data = await res.json();
          sent = data.message === 'Successfully Sent';
        } else {
          results.push({ member_id: sub.member_id, phone, sent: false, reason: 'TERMII_API_KEY not configured' });
          continue;
        }
      } catch (e) { 
        console.error('SMS failed:', e.message); 
        results.push({ member_id: sub.member_id, phone, sent: false, reason: e.message });
        continue;
      }

      results.push({ member_id: sub.member_id, phone, sent, message: msg });
    }

    return { statusCode: 200, headers, body: JSON.stringify({
      sent: results.filter(r => r.sent).length,
      total: results.length,
      details: results
    }) };
  } catch (err) {
    console.error('Reminders error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};