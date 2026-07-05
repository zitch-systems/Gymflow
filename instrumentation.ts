// Next.js instrumentation — onRequestError fires for every uncaught error in
// server components, server actions, and route handlers. We persist them to
// the client_errors table so /superadmin has real error visibility instead of
// only Vercel's ephemeral function logs. See lib/server-error.ts (which is
// also the seam for adding Sentry later).

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: NodeJS.Dict<string | string[]> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  // The capture path needs the Node runtime (service-role Supabase client);
  // edge invocations just log.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    console.error(`[edge-error] ${request.method} ${request.path}:`, err);
    return;
  }
  const { captureServerError } = await import('./lib/server-error');
  await captureServerError(err, request, context);
}
