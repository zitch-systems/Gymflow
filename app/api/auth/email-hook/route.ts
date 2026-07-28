import { NextResponse, type NextRequest } from 'next/server';
import { verifyStandardWebhook, standardWebhookHeaders } from '@/lib/webhook-verify';
import { sendEmail, gymFromAddress } from '@/lib/email';
import { renderEmail } from '@/lib/email/layout';
import { adminOrNull } from '@/lib/email/recipients';
import {
  linkBase, parseActionType, renderAuthEmail,
  resolveAuthBrand, type AuthHookPayload,
} from '@/lib/email/auth-hook';

// Supabase "Send Email" auth hook.
//
// Configure it in Supabase → Authentication → Emails → Hooks → "Send email":
// set the URL to https://<site>/api/auth/email-hook and paste the generated
// secret into SUPABASE_AUTH_HOOK_SECRET. From then on Supabase stops sending
// its own default auth mail and POSTs the payload here instead, letting us send
// branded confirmation / recovery / invite / magic-link / email-change /
// reauthentication mail through Resend — a member's in their gym's colours, an
// owner's from GymFlow.
//
// Unlike the rest of lib/email (which fails open — a missing key just means no
// mail), THIS route is the flow: if it can't send, the user gets no link at
// all. So it fails LOUD — a non-2xx tells Supabase the hook failed, and
// Supabase surfaces the error to the user instead of silently stranding them.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  // No secret → the hook isn't configured. Refuse rather than process an
  // unverified body (which would be a way to send arbitrary branded mail).
  if (!secret) {
    return NextResponse.json({ error: 'Auth email hook is not configured.' }, { status: 501 });
  }
  // No Resend key → we can't deliver. Say so loudly so Supabase doesn't record
  // a success and drop the mail on the floor.
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email transport is not configured.' }, { status: 503 });
  }

  const raw = await request.text();
  const headers = standardWebhookHeaders(request.headers);
  if (!verifyStandardWebhook(raw, headers, secret)) {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });
  }

  let payload: AuthHookPayload;
  try {
    payload = JSON.parse(raw) as AuthHookPayload;
  } catch {
    return NextResponse.json({ error: 'Malformed payload.' }, { status: 400 });
  }

  const actionType = parseActionType(payload.email_data?.email_action_type);
  if (!actionType) {
    // An action type we don't recognise. Rather than 500 (which makes Supabase
    // retry forever), let Supabase send its own default mail for it.
    return NextResponse.json({ error: 'Unsupported action type; falling back to default.' }, { status: 422 });
  }

  const base = linkBase(payload);
  if (!base) {
    // Every link would be relative and therefore dead. This is a config error
    // (Site URL unset in Supabase and NEXT_PUBLIC_SITE_URL unset here), not a
    // per-request problem — 500 so it's noticed.
    return NextResponse.json({ error: 'No absolute site URL available to build the link.' }, { status: 500 });
  }

  const email = (payload.user?.email ?? '').trim();
  if (!email) return NextResponse.json({ error: 'No recipient.' }, { status: 400 });

  const admin = adminOrNull();
  const { brand, senderName, isGymMember, gym } = await resolveAuthBrand(admin, payload.user);

  const content = renderAuthEmail(actionType, payload, { base, senderName, isGymMember });
  if (!content) {
    return NextResponse.json({ error: 'Payload missing the token for this action.' }, { status: 400 });
  }

  const { html, text } = renderEmail({
    brand,
    title: content.subject,
    preheader: content.preheader,
    blocks: content.blocks,
    // Auth mail is never opt-out-able — there is no "turn off password resets".
    preferencesUrl: null,
  });

  // Email-change to the new address is sent to new_email, not the account
  // address; every other type goes to the account address.
  const recipient = actionType === 'email_change_new'
    ? ((payload.user?.new_email ?? '').trim() || email)
    : email;

  const result = await sendEmail({
    to: recipient,
    subject: content.subject,
    html,
    text,
    // Members get their gym in the From line; owners/staff get GymFlow (the
    // default sender). Replies to a member's auth mail reach their gym.
    from: isGymMember && gym ? gymFromAddress(gym) : undefined,
    replyTo: isGymMember ? (gym?.email ?? undefined) : undefined,
    tags: [
      { name: 'template', value: `auth_${actionType}` },
      { name: 'category', value: 'auth' },
      { name: 'sender', value: isGymMember ? 'gym' : 'platform' },
    ],
    // The token hash is single-use, so it's a natural idempotency key: a hook
    // retry for the same action re-sends the same mail at most once on Resend.
    idempotencyKey: payload.email_data?.token_hash?.slice(0, 256),
  });

  if (!result.ok && !result.skipped) {
    // Real delivery failure — 500 so Supabase retries with backoff.
    return NextResponse.json({ error: result.error ?? 'Send failed.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
