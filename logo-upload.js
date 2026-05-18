// netlify/functions/logo-upload.js
// GymFlow Logo Upload — stores in Supabase Storage, updates gyms table

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kdbbrxqxqewbjoozmfhq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { gym_id, image_base64, mime_type, file_name } = JSON.parse(event.body);

    if (!gym_id || !image_base64 || !mime_type) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'gym_id, image_base64, mime_type required' }) };
    }

    // Verify auth
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing auth' }) };
    }
    const token = authHeader.replace('Bearer ', '');

    const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
    });
    if (!verifyRes.ok) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
    }
    const user = await verifyRes.json();

    // Verify staff at this gym
    const staffCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/gym_staff_links?select=role&user_id=eq.${user.id}&gym_id=eq.${gym_id}&is_active=eq.true`,
      { headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY } }
    );
    const staffData = await staffCheck.json();
    if (!staffData || staffData.length === 0) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Staff access required' }) };
    }

    // Upload to Supabase Storage bucket 'gym-logos'
    const bucketName = 'gym-logos';
    const filePath = `${gym_id}/${file_name || 'logo.png'}`;
    const fileBuffer = Buffer.from(image_base64, 'base64');

    // Check/create bucket
    const bucketCheck = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${bucketName}`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }
    });
    if (!bucketCheck.ok) {
      // Create bucket
      await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: bucketName, name: bucketName, public: true })
      });
    }

    // Upload file
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucketName}/${filePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': mime_type,
        'x-upsert': 'true'
      },
      body: fileBuffer
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Upload failed: ' + err }) };
    }

    // Get public URL
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucketName}/${filePath}`;

    // Update gyms table with logo_url
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/gyms?id=eq.${gym_id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ logo_url: publicUrl })
      }
    );

    if (!updateRes.ok) {
      const err = await updateRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Update failed: ' + err }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, logo_url: publicUrl })
    };

  } catch (err) {
    console.error('Logo upload error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
