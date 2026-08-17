import { requireApiMember, json, corsPreflight, readJson } from '@/lib/api-app';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export function OPTIONS() {
  return corsPreflight();
}

// GET /api/app/notifications — the member's inbox (reminders, receipts, class
// alerts). Not gym-scoped: notifications belong to the user, and RLS already
// restricts the table to user_id = auth.uid().
export async function GET(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user } = auth.ctx;

  try {
    const { data } = await supabase
      .from('notifications')
      .select('id, title, body, type, sent_at, is_read, metadata')
      .eq('user_id', user.id)
      .order('sent_at', { ascending: false })
      .limit(50);

    const rows = data ?? [];
    return json({
      unread: rows.filter((n) => !n.is_read).length,
      notifications: rows.map((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        return {
          id: n.id,
          title: n.title,
          body: n.body,
          type: n.type,
          sent_at: n.sent_at,
          is_read: n.is_read,
          // The one piece of metadata the app acts on: a receipt row deep-links
          // to the payment it announced.
          payment_id: meta?.payment_id ? String(meta.payment_id) : null,
        };
      }),
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

// POST /api/app/notifications — { action: 'read_all' } | { action: 'read', id }.
export async function POST(req: Request) {
  const auth = await requireApiMember(req);
  if (!auth.ok) return auth.res;
  const { supabase, user } = auth.ctx;

  const body = await readJson(req);
  const action = String(body.action ?? 'read_all');

  try {
    let q = supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('is_read', false);
    if (action === 'read') {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'Missing notification id.' }, 400);
      q = q.eq('id', id);
    } else if (action !== 'read_all') {
      return json({ error: 'Unknown action.' }, 400);
    }

    const { error } = await q;
    if (error) return json({ ok: false, error: error.message }, 422);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}
