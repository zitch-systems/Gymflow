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
  if (method === 'POST') reqHeaders['Prefer'] = 'return=representation';

  const res = await fetch(url, {
    method: method || 'GET',
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : await res.json();
}

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(rows, headers) {
  const lines = [headers.map(h => escapeCSV(h.label)).join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => escapeCSV(h.get(row))).join(','));
  }
  return lines.join('\n');
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
    const body = JSON.parse(event.body);
    const { gym_id, filter = 'all' } = body;

    if (!gym_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'gym_id required' }) };
    }

    // Fetch all members with profiles
    const members = await supabaseQuery(
      'gym_member_links',
      'GET',
      null,
      `select=*,profiles!inner(*)&gym_id=eq.${gym_id}&order=created_at.desc`
    );

    if (!members || !members.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ csv: '', count: 0 }) };
    }

    // Fetch subscriptions for all members
    const memberIds = members.map(m => m.user_id).join(',');
    const subs = await supabaseQuery(
      'member_subscriptions',
      'GET',
      null,
      `select=*&member_id=in.(${memberIds})&gym_id=eq.${gym_id}&order=created_at.desc`
    );

    // Build enriched rows
    const today = new Date(); today.setHours(0,0,0,0);
    const rows = [];
    for (const m of members) {
      const profile = m.profiles || {};
      const memberSubs = (subs || []).filter(s => s.member_id === m.user_id);
      const activeSub = memberSubs.find(s => s.status === 'active');
      const latestSub = memberSubs[0];

      const endDate = activeSub?.end_date || latestSub?.end_date;
      const days = endDate ? Math.max(0, Math.ceil((new Date(endDate) - today) / (1000*60*60*24))) : 0;

      let status = 'No Subscription';
      if (activeSub) {
        status = days <= 0 ? 'Expired' : days <= 7 ? 'Expiring Soon' : 'Active';
      } else if (latestSub) {
        status = 'Expired';
      }

      rows.push({
        name: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        gender: profile.gender || '',
        dob: profile.date_of_birth || '',
        address: profile.address || '',
        nok_name: profile.nok_name || '',
        nok_phone: profile.nok_phone || '',
        nok_relationship: profile.nok_relationship || '',
        health_notes: profile.health_notes || '',
        status: status,
        subscription_end: endDate || '',
        days_left: days,
        joined: m.created_at ? new Date(m.created_at).toISOString().split('T')[0] : '',
      });
    }

    // Apply filter
    let filtered = rows;
    if (filter === 'active') filtered = rows.filter(r => r.status === 'Active');
    else if (filter === 'expiring') filtered = rows.filter(r => r.status === 'Expiring Soon');
    else if (filter === 'expired') filtered = rows.filter(r => r.status === 'Expired' || r.status === 'No Subscription');

    const csvHeaders = [
      { label: 'Full Name', get: r => r.name },
      { label: 'Email', get: r => r.email },
      { label: 'Phone', get: r => r.phone },
      { label: 'Gender', get: r => r.gender },
      { label: 'Date of Birth', get: r => r.dob },
      { label: 'Address', get: r => r.address },
      { label: 'NOK Name', get: r => r.nok_name },
      { label: 'NOK Phone', get: r => r.nok_phone },
      { label: 'NOK Relationship', get: r => r.nok_relationship },
      { label: 'Health Notes', get: r => r.health_notes },
      { label: 'Status', get: r => r.status },
      { label: 'Subscription End', get: r => r.subscription_end },
      { label: 'Days Left', get: r => r.days_left },
      { label: 'Joined Date', get: r => r.joined },
    ];

    const csv = toCSV(filtered, csvHeaders);
    const gymData = await supabaseQuery('gyms', 'GET', null, `select=name&id=eq.${gym_id}`);
    const gymName = gymData?.[0]?.name || 'gym';
    const safeName = gymName.replace(/\s+/g, '_').toLowerCase();
    const filename = `${safeName}_members_${filter}_${new Date().toISOString().split('T')[0]}.csv`;

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` },
      body: csv,
    };

  } catch (err) {
    console.error('CSV export error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};