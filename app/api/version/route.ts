// Returns the build id of the currently-running deployment. Baked at build via
// next.config `env`, so each release echoes a different value. The client's
// VersionWatcher compares this against its own baked id to detect that it's
// running stale code after a deploy. The proxy and service worker both skip
// `/api`, so this always reaches the live server uncached.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? '' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
