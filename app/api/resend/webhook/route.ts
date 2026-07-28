import { NextResponse, type NextRequest } from 'next/server';
import { verifyStandardWebhook, standardWebhookHeaders } from '@/lib/webhook-verify';
import { adminOrNull } from '@/lib/email/recipients';
import { captureServerEvent } from '@/lib/server-error';

// Resend delivery webhook — the feedback loop for everything lib/email sends.
//
// WHY THIS EXISTS AT ALL: mail is fire-and-forget from the app's side (sendEmail
// fails open by design), so without this endpoint a bad address is invisible. We
// keep mailing it. Mailbox providers score a sender on exactly that — the rate
// of hard bounces and spam complaints against a domain — and the score attaches
// to the DOMAIN, which every gym on GymFlow shares with our password-reset and
// receipt mail. One gym's stale CSV import, mailed forever, is what puts another
// gym's "reset your password" link in a spam folder. So bounces and complaints
// are recorded as suppressions the moment Resend tells us, and every other event
// goes to the ledger so "the member says the receipt never arrived" is a lookup
// rather than an argument.
//
// Configure it in Resend → Webhooks: point the endpoint at
// https://<site>/api/resend/webhook and paste the signing secret into
// RESEND_WEBHOOK_SECRET.
//
// Discipline copied from app/api/paystack/webhook: read the RAW body (parsing
// and re-serialising changes bytes and breaks the MAC), verify before touching
// anything, then ack. Verified events always get a 200 — including types we
// don't handle — because Resend retries non-2xx and disables endpoints that keep
// failing, and losing the whole feed to protect one unwritten row is a bad
// trade. Only a bad signature (401) or a body that will never parse (400) is
// refused.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type Json = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Non-empty trimmed string, or null. Every field below comes off an external
 *  payload, so nothing is assumed to be the type it usually is. */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

/**
 * Read one of the tags we attached at send time.
 *
 * We post tags as `[{ name, value }]`; Resend has echoed them back both in that
 * shape and as a flat object map. Both are read rather than picking one — the
 * template tag is how we find out WHICH template is generating the bounces, and
 * losing it silently is a diagnostic we'd only miss once reputation is sliding.
 */
function tag(data: Json, name: string): string | null {
  const tags = data.tags;
  if (Array.isArray(tags)) {
    for (const entry of tags) {
      const t = entry as Json;
      if (str(t?.name) === name) return str(t?.value);
    }
    return null;
  }
  if (tags && typeof tags === 'object') return str((tags as Json)[name]);
  return null;
}

/** sendGymEmail sets `X-Entity-Ref-ID: <template>:<gym id>` for threading; it
 *  doubles as the only gym attribution most events carry. */
function refHeaderGymId(data: Json): string | null {
  const headers = data.headers;
  if (!Array.isArray(headers)) return null;
  for (const entry of headers) {
    const h = entry as Json;
    if (str(h?.name)?.toLowerCase() !== 'x-entity-ref-id') continue;
    return str(h?.value)?.split(':').pop() ?? null;
  }
  return null;
}

/** Which gym this message belonged to, when the event says enough to tell.
 *  Best-effort: gym_id is nullable, and an unattributed ledger row is worth far
 *  more than an insert rejected because a non-uuid hit the FK column (22P02). */
function gymId(data: Json): string | null {
  const candidate = tag(data, 'gym_id') ?? tag(data, 'gym') ?? refHeaderGymId(data);
  return candidate && UUID_RE.test(candidate) ? candidate : null;
}

/**
 * Is this bounce permanent?
 *
 * 'Transient' is a full mailbox or greylisting — the address is alive, and
 * suppressing it would quietly cut a paying member off from their own receipts.
 * When Resend sends no bounce detail we DO suppress: undoing that is one row to
 * delete, while months of mail to a dead address is a domain reputation we
 * can't get back on request.
 */
function isHardBounce(data: Json): boolean {
  const type = str((data.bounce as Json | undefined)?.type);
  return type === null || type.toLowerCase() === 'permanent';
}

/** Provider diagnostic kept alongside the suppression, so a member disputing it
 *  ("I never marked you as spam") can be answered from the row. */
function bounceDetail(data: Json): string | null {
  const bounce = data.bounce as Json | undefined;
  const parts = [str(bounce?.type), str(bounce?.subType), str(bounce?.message)]
    .filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ').slice(0, 500) : null;
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // No secret means nothing can be verified, and an unverified body here is a
  // way to suppress any address on the platform — i.e. to switch off a rival
  // gym's mail. Refuse outright rather than process it.
  if (!secret) {
    return NextResponse.json({ error: 'Resend webhook is not configured.' }, { status: 501 });
  }

  const raw = await req.text();
  const headers = standardWebhookHeaders(req.headers);
  if (!verifyStandardWebhook(raw, headers, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let event: Json;
  try {
    event = JSON.parse(raw) as Json;
  } catch {
    // Signed but not JSON. A retry re-sends the same bytes, so 4xx to stop them.
    return NextResponse.json({ error: 'Malformed payload.' }, { status: 400 });
  }

  const admin = adminOrNull();
  if (!admin) {
    // Preview/dev envs have no service-role key. Nowhere to write, but Resend
    // must not retry forever over a config gap on our side.
    console.warn('[resend/webhook] no service-role client; event not recorded');
    return NextResponse.json({ received: true, stored: false });
  }

  const type = str(event.type) ?? 'unknown';
  const data = (event.data as Json) ?? {};

  // Single-recipient by construction (sendEmail sends one message per person);
  // for the rare multi-recipient platform alert the rest stays in payload.
  // Lowercased so suppression lookups and "everything we sent this address"
  // agree regardless of how the address was typed.
  const first = Array.isArray(data.to) ? str(data.to[0]) : str(data.to);
  const recipient = first ? first.toLowerCase() : null;

  // Resend's own event id when the body carries one, otherwise the Standard
  // Webhooks message id — which is stable across redelivery attempts, so it is
  // the right identity either way. Keyed on it, a redelivery is a no-op instead
  // of a second ledger row (and a second suppression timestamp).
  const eventId = str(event.id) ?? str(event.event_id) ?? headers.id;

  // `as never`: email_events / email_suppressions postdate the generated
  // database.types.ts (same pattern as webhook_events in the Paystack route).
  const { error: ledgerError } = await admin.from('email_events' as never).upsert({
    event_id: eventId,
    email_id: str(data.email_id),
    type,
    recipient,
    subject: str(data.subject),
    template: tag(data, 'template'),
    gym_id: gymId(data),
    payload: event,
  } as never, { onConflict: 'event_id', ignoreDuplicates: true });

  // Telemetry only — Resend's dashboard still holds the authoritative feed, so a
  // failed ledger write is logged, not retried.
  if (ledgerError) console.error(`[resend/webhook] ledger write failed for ${type}: ${ledgerError.message}`);

  const suppress = recipient
    && (type === 'email.complained' || (type === 'email.bounced' && isHardBounce(data)));

  if (suppress) {
    // ignoreDuplicates: the FIRST record wins, so created_at stays "when we
    // stopped mailing this address" — the number that matters when explaining a
    // reputation dip — instead of being reset by every later event.
    const { error } = await admin.from('email_suppressions' as never).upsert({
      address: recipient,
      reason: type === 'email.complained' ? 'complained' : 'bounced',
      detail: type === 'email.complained' ? null : bounceDetail(data),
    } as never, { onConflict: 'address', ignoreDuplicates: true });

    if (error) {
      // The one write with lasting consequence: dropping it means we keep
      // mailing a dead address, which is the exact failure this route exists to
      // prevent. Page on it rather than letting it scroll past in the logs.
      console.error(`[resend/webhook] suppression write failed: ${error.message}`);
      void captureServerEvent('resend webhook suppression write failed', { type, error: error.message });
    }
  }

  // Unknown event types land here too: acking them keeps the endpoint healthy,
  // and the full body is already in the ledger if we need it later.
  return NextResponse.json({ received: true });
}
