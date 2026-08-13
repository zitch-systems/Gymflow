import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  FLOW_DATA_API_VERSION,
  FlowKeyError,
  decryptFlowRequest,
  encryptFlowResponse,
  flowCryptoConfigured,
  type FlowCryptoContext,
  type FlowRequestBody,
} from '@/lib/whatsapp/flow-crypto';
import { SCREEN } from '@/lib/whatsapp/flow-json';
import { consumeFlowSession, loadFlowSession, patchFlowSession, type FlowSession } from '@/lib/whatsapp/flow-session';
import { beginSignup, issueEmailOtp, signinWithPassword, verifyEmailOtp } from '@/lib/whatsapp/auth';
import { contactByWaId, linkContact } from '@/lib/whatsapp/contacts';
import { gymById } from '@/lib/whatsapp/settings';
import { captureServerEvent } from '@/lib/server-error';

// Meta Flows data-exchange endpoint.
//
// Every screen the member submits arrives here as ciphertext relayed by Meta,
// and every reply goes back the same way (see lib/whatsapp/flow-crypto.ts for
// the scheme). The response body is a bare base64 string with content-type
// text/plain — NOT JSON. Returning JSON here fails silently on the client with
// a generic "something went wrong", which is a miserable thing to debug, so it
// is worth stating twice.
//
// IDENTITY. The Flow payload is attacker-controlled: it is whatever the client
// submitted. The only trustworthy thing in the request is `flow_token`, because
// we minted it and stored who it was issued to. Every handler below resolves
// the WhatsApp number from the session row and never from the payload.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

type Payload = Record<string, unknown>;

export async function POST(req: NextRequest) {
  if (!flowCryptoConfigured()) {
    // 501 rather than 500: nothing is broken, the channel simply has no key
    // installed yet, and Meta's endpoint health check should say so honestly.
    return new NextResponse('WhatsApp Flow encryption is not configured.', { status: 501 });
  }

  let body: FlowRequestBody;
  try {
    body = (await req.json()) as FlowRequestBody;
  } catch {
    return new NextResponse('Malformed request.', { status: 400 });
  }
  if (!body?.encrypted_flow_data || !body?.encrypted_aes_key || !body?.initial_vector) {
    return new NextResponse('Missing encryption envelope.', { status: 400 });
  }

  let request: Awaited<ReturnType<typeof decryptFlowRequest>>['request'];
  let context: FlowCryptoContext;
  try {
    ({ request, context } = decryptFlowRequest(body));
  } catch (e) {
    if (e instanceof FlowKeyError) {
      // Meta's contract: 421 tells the client its cached public key is stale and
      // to refetch before retrying. Anything else here would strand every
      // session after a key rotation.
      void captureServerEvent('whatsapp flow key mismatch', { error: (e as Error).message });
      return new NextResponse('Key mismatch.', { status: 421 });
    }
    return new NextResponse('Decryption failed.', { status: 400 });
  }

  const reply = (payload: unknown) =>
    new NextResponse(encryptFlowResponse(payload, context), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });

  // Meta's endpoint availability probe. Must answer before a Flow can publish.
  if (request.action === 'ping') {
    return reply({ version: FLOW_DATA_API_VERSION, data: { status: 'active' } });
  }

  // Client-side error report. Acknowledge and move on — retrying or erroring
  // back just loops.
  if (request.data?.error || request.action === 'error') {
    console.error('[whatsapp/flow] client error:', JSON.stringify(request.data).slice(0, 500));
    return reply({ version: FLOW_DATA_API_VERSION, data: { acknowledged: true } });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return reply(errorScreen(request.screen, 'We’re having trouble right now. Please try again shortly.'));
  }

  const token = request.flow_token ?? '';
  const session = await loadFlowSession(admin, token);
  if (!session) {
    // Expired or forged. Say it plainly on whichever screen they are on rather
    // than silently doing nothing.
    return reply(errorScreen(request.screen, 'This form has expired. Close it and send “hi” to start again.'));
  }

  try {
    const payload = (request.data ?? {}) as Payload;
    const intent = str(payload.intent) ?? inferIntent(request.screen);

    switch (intent) {
      case 'signup':
        return reply(await handleSignup(admin, session, payload));
      case 'verify_email':
        return reply(await handleVerify(admin, session, payload));
      case 'resend_code':
        return reply(await handleResend(admin, session));
      case 'signin':
        return reply(await handleSignin(admin, session, payload));
      default:
        // INIT and BACK land here: hand back the screen they asked for with
        // empty error state.
        return reply(initialScreen(request.screen, session));
    }
  } catch (e) {
    const error = (e as Error).message;
    console.error('[whatsapp/flow] handler failed:', error);
    void captureServerEvent('whatsapp flow handler failed', { error, screen: request.screen ?? 'unknown' });
    return reply(errorScreen(request.screen, 'Something went wrong on our side. Please try again.'));
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleSignup(
  admin: ReturnType<typeof createAdminClient>,
  session: FlowSession,
  payload: Payload,
) {
  const res = await beginSignup({
    gymCode: str(payload.gym_code) ?? '',
    fullName: str(payload.full_name) ?? '',
    email: str(payload.email) ?? '',
    password: str(payload.password) ?? '',
    confirmPassword: str(payload.confirm_password) ?? '',
    waId: session.wa_id,
  });

  if (!res.ok) {
    return screen(SCREEN.signUp, { gym_code: str(payload.gym_code) ?? '', error: res.error });
  }

  const email = (str(payload.email) ?? '').trim().toLowerCase();
  await patchFlowSession(admin, session, {
    gymId: res.gym.id,
    data: { email, pending_user_id: res.userId, full_name: res.fullName },
  });

  return screen(SCREEN.verifyEmail, { email, error: '', notice: '' });
}

async function handleVerify(
  admin: ReturnType<typeof createAdminClient>,
  session: FlowSession,
  payload: Payload,
) {
  const email = str(session.data?.email) ?? '';
  if (!email) {
    return screen(SCREEN.signUp, { gym_code: '', error: 'Please start again — we lost track of your email.' });
  }

  const res = await verifyEmailOtp({ email, code: str(payload.code) ?? '', waId: session.wa_id });
  if (!res.ok) return screen(SCREEN.verifyEmail, { email, error: res.error, notice: '' });

  await attachContact(admin, session, res.userId, res.gym.id);
  await consumeFlowSession(admin, session.flow_token);

  const first = (res.fullName ?? '').trim().split(/\s+/)[0];
  return screen(SCREEN.done, {
    headline: first ? `You're in, ${first}` : "You're in",
    detail:
      `Your ${res.gym.name} account is ready. The same email and password sign you in on the GymFlow app and on the web. ` +
      'Close this and send “menu” to check in, see your days, or renew.',
  });
}

async function handleResend(admin: ReturnType<typeof createAdminClient>, session: FlowSession) {
  const email = str(session.data?.email) ?? '';
  const gymId = session.gym_id;
  if (!email || !gymId) {
    return screen(SCREEN.signUp, { gym_code: '', error: 'Please start again — we lost track of your sign-up.' });
  }
  const gym = await gymById(admin, gymId);
  if (!gym) return screen(SCREEN.verifyEmail, { email, error: 'That gym is no longer available.', notice: '' });

  const res = await issueEmailOtp(admin, {
    email,
    userId: str(session.data?.pending_user_id),
    gym,
    waId: session.wa_id,
    fullName: str(session.data?.full_name),
  });
  return screen(SCREEN.verifyEmail, {
    email,
    error: res.ok ? '' : res.error,
    notice: res.ok ? 'A new code is on its way.' : '',
  });
}

async function handleSignin(
  admin: ReturnType<typeof createAdminClient>,
  session: FlowSession,
  payload: Payload,
) {
  const gymCode = str(session.data?.gym_code);
  const res = await signinWithPassword({
    email: str(payload.email) ?? '',
    password: str(payload.password) ?? '',
    waId: session.wa_id,
    gymCode,
  });

  if (!res.ok) {
    const gymName = str(session.data?.gym_name) ?? 'your gym';
    return screen(SCREEN.signIn, { gym_name: gymName, error: res.error });
  }

  await attachContact(admin, session, res.userId, res.gym.id);
  await consumeFlowSession(admin, session.flow_token);

  const first = (res.fullName ?? '').trim().split(/\s+/)[0];
  return screen(SCREEN.done, {
    headline: first ? `Welcome back, ${first}` : 'Welcome back',
    detail:
      `You're signed in to ${res.gym.name}. Close this and send “menu” to check in, see your remaining days, or renew.`,
  });
}

/** Bind the WhatsApp identity to the account that just proved itself. */
async function attachContact(
  admin: ReturnType<typeof createAdminClient>,
  session: FlowSession,
  profileId: string,
  gymId: string,
) {
  const contact = await contactByWaId(admin, session.wa_id);
  if (contact) await linkContact(admin, contact.id, { profileId, gymId });
}

// ── Screen helpers ─────────────────────────────────────────────────────────

function screen(name: string, data: Record<string, unknown>) {
  return { version: FLOW_DATA_API_VERSION, screen: name, data };
}

function initialScreen(name: string | undefined, session: FlowSession) {
  const target = name ?? (session.kind === 'signup' ? SCREEN.signUp : SCREEN.signIn);
  return screen(target, blankData(target, session));
}

function errorScreen(name: string | undefined, message: string) {
  const target = name ?? SCREEN.signIn;
  return screen(target, { ...blankData(target, null), error: message });
}

/** Each screen declares its own data contract; a missing key renders as the
 *  literal "${data.x}", so every field is always supplied. */
function blankData(name: string, session: FlowSession | null): Record<string, unknown> {
  switch (name) {
    case SCREEN.signUp:
      return { gym_code: str(session?.data?.gym_code) ?? '', error: '' };
    case SCREEN.verifyEmail:
      return { email: str(session?.data?.email) ?? '', error: '', notice: '' };
    case SCREEN.done:
      return { headline: 'All set', detail: '' };
    case SCREEN.signIn:
    default:
      return { gym_name: str(session?.data?.gym_name) ?? 'your gym', error: '' };
  }
}

function inferIntent(screenName: string | undefined): string | null {
  switch (screenName) {
    case SCREEN.signUp: return 'signup';
    case SCREEN.signIn: return 'signin';
    case SCREEN.verifyEmail: return 'verify_email';
    default: return null;
  }
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}
