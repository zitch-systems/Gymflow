// Shared helpers for the native mobile app's public API (/api/app/*). These
// endpoints are called by the app over plain HTTP (no browser cookie jar), so
// they take credentials in the body and return JSON with permissive CORS.

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// Shape returned to the app after auth: enough to render the gym and keep the
// Supabase session alive on the device.
export function sessionPayload(session: { access_token: string; refresh_token: string; expires_at?: number; expires_in?: number } | null) {
  if (!session) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    expires_in: session.expires_in ?? null,
    token_type: 'bearer',
  };
}
