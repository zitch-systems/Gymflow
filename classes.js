// netlify/functions/classes.js
// GymFlow Class Booking API — handles class CRUD, bookings, attendance

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kdbbrxqxqewbjoozmfhq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  const path = event.path.replace('/.netlify/functions/classes', '').replace(/^\//, '');
  const method = event.httpMethod;

  try {
    // Auth check — verify JWT from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing auth token' }) };
    }

    const token = authHeader.replace('Bearer ', '');

    // Verify token with Supabase
    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
    });
    if (!verifyRes.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
    }
    const user = await verifyRes.json();

    // Route handling
    if (path === 'report' && method === 'GET') {
      return await classReport(event, user);
    }
    if (path === 'bulk-cancel' && method === 'POST') {
      return await bulkCancel(event, user);
    }
    if (path === 'attendance' && method === 'POST') {
      return await markAttendance(event, user);
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

  } catch (err) {
    console.error('Classes function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// GET /report?gym_id=xxx&start=YYYY-MM-DD&end=YYYY-MM-DD
async function classReport(event, user) {
  const params = new URLSearchParams(event.queryStringParameters);
  const gymId = params.get('gym_id');
  const start = params.get('start');
  const end = params.get('end');

  if (!gymId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'gym_id required' }) };
  }

  // Verify user is staff at this gym
  const staffCheck = await fetch(`${SUPABASE_URL}/rest/v1/gym_staff_links?select=role&user_id=eq.${user.id}&gym_id=eq.${gymId}&is_active=eq.true`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
  });
  const staffData = await staffCheck.json();
  if (!staffData || staffData.length === 0) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Staff access required' }) };
  }

  // Get class attendance summary
  const query = `${SUPABASE_URL}/rest/v1/class_bookings?select=class_id,status,booking_date,classes(name)&gym_id=eq.${gymId}${start ? `&booking_date=gte.${start}` : ''}${end ? `&booking_date=lte.${end}` : ''}`;

  const res = await fetch(query, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
  });
  const bookings = await res.json();

  // Aggregate by class
  const summary = {};
  bookings.forEach(b => {
    const key = b.class_id;
    if (!summary[key]) {
      summary[key] = { name: b.classes?.name || 'Unknown', total: 0, attended: 0, cancelled: 0, no_show: 0 };
    }
    summary[key].total++;
    if (b.status === 'attended') summary[key].attended++;
    if (b.status === 'cancelled') summary[key].cancelled++;
    if (b.status === 'booked') summary[key].no_show++;
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ summary, total_bookings: bookings.length })
  };
}

// POST /bulk-cancel
async function bulkCancel(event, user) {
  const body = JSON.parse(event.body);
  const { gym_id, class_id, date, reason } = body;

  if (!gym_id || !class_id || !date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'gym_id, class_id, date required' }) };
  }

  // Verify staff
  const staffCheck = await fetch(`${SUPABASE_URL}/rest/v1/gym_staff_links?select=role&user_id=eq.${user.id}&gym_id=eq.${gym_id}&is_active=eq.true`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
  });
  const staffData = await staffCheck.json();
  if (!staffData || staffData.length === 0 || staffData[0].role === 'rep') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Manager/Owner access required' }) };
  }

  // Cancel all bookings for this class on this date
  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/class_bookings?gym_id=eq.${gym_id}&class_id=eq.${class_id}&booking_date=eq.${date}&status=eq.booked`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ status: 'cancelled' })
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: err }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ message: 'All bookings cancelled', reason }) };
}

// POST /attendance
async function markAttendance(event, user) {
  const body = JSON.parse(event.body);
  const { gym_id, booking_id, status } = body;

  if (!gym_id || !booking_id || !status) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'gym_id, booking_id, status required' }) };
  }

  // Verify staff
  const staffCheck = await fetch(`${SUPABASE_URL}/rest/v1/gym_staff_links?select=role&user_id=eq.${user.id}&gym_id=eq.${gym_id}&is_active=eq.true`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
  });
  const staffData = await staffCheck.json();
  if (!staffData || staffData.length === 0) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Staff access required' }) };
  }

  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/class_bookings?id=eq.${booking_id}&gym_id=eq.${gym_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ status })
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    return { statusCode: 500, headers, body: JSON.stringify({ error: err }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ message: `Attendance marked: ${status}` }) };
}
