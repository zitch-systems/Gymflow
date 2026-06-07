import 'server-only';
import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { isDeadSubscriptionStatus } from '@/lib/push-keys';

type DB = SupabaseClient<Database>;

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;       // deep link opened on notification click
  tag?: string;       // collapse key — a newer push with the same tag replaces
};

type StoredSubscription = { id: string; endpoint: string; p256dh: string; auth: string };

let configured: boolean | null = null;

/**
 * Whether VAPID keys are present. The whole push feature degrades to a no-op
 * when they aren't, so the code can ship before keys are provisioned. Cached
 * after first call (env doesn't change within a process).
 */
export function vapidConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:support@gymflow.ng',
      pub,
      priv,
    );
    configured = true;
  } else {
    configured = false;
  }
  return configured;
}

/**
 * Send a push to every device a user has subscribed. Best-effort:
 *   - no-op (returns 0) when VAPID isn't configured
 *   - prunes subscriptions the push service reports as gone (404/410)
 *   - swallows transient failures (the next notification retries)
 *
 * Returns the number of successful deliveries. Uses the service-role client
 * (the caller already has one for the server-to-server context).
 */
export async function sendPushToUser(
  supabase: DB,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  if (!vapidConfigured()) return 0;

  const { data } = await supabase
    .from('push_subscriptions' as never)
    .select('id, endpoint, p256dh, auth')
    .eq('user_id' as never, userId);

  const subs = (data ?? []) as unknown as StoredSubscription[];
  if (subs.length === 0) return 0;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? '',
    url: payload.url ?? '/',
    tag: payload.tag,
  });

  let delivered = 0;
  const deadIds: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        delivered += 1;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        if (isDeadSubscriptionStatus(status)) deadIds.push(s.id);
        // transient errors: leave the subscription, let the next push retry
      }
    }),
  );

  if (deadIds.length > 0) {
    await supabase.from('push_subscriptions' as never).delete().in('id' as never, deadIds);
  }

  return delivered;
}
