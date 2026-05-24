import 'server-only';

const TERMII_BASE = 'https://api.ng.termii.com/api';

type SendResult = { ok: boolean; error?: string };

function normalisePhone(phone: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // 234XXXXXXXXXX → keep; 0XXXXXXXXXX → 234XXXXXXXXXX; +234XXXXXXXXXX → strip +
  if (digits.length === 13 && digits.startsWith('234')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.length === 10) return '234' + digits;
  return digits.length >= 10 ? digits : null;
}

export async function sendWhatsApp(to: string, message: string): Promise<SendResult> {
  const apiKey = process.env.TERMII_API_KEY;
  const sender = process.env.TERMII_SENDER_ID || 'GymFlow';
  if (!apiKey) {
    console.warn('[GF whatsapp] TERMII_API_KEY not set; skipping send to', to);
    return { ok: false, error: 'whatsapp_not_configured' };
  }
  const phone = normalisePhone(to);
  if (!phone) return { ok: false, error: 'invalid_phone' };

  try {
    const res = await fetch(`${TERMII_BASE}/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to: phone,
        from: sender,
        sms: message,
        type: 'plain',
        channel: 'whatsapp',
      }),
      cache: 'no-store',
    });
    const data = await res.json();
    if (!res.ok || data?.code !== 'ok') {
      return { ok: false, error: data?.message ?? `Termii ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── High-level senders ─────────────────────────────────────────────────

export async function waWelcome(phone: string, name: string, gymName: string, dashboardUrl: string) {
  return sendWhatsApp(
    phone,
    `Welcome to ${gymName}, ${name}! 💪\n\nYour membership is active. Open your portal: ${dashboardUrl}`,
  );
}

export async function waReceipt(phone: string, args: { name: string; amount: number; endDate: string }) {
  return sendWhatsApp(
    phone,
    `Hi ${args.name}, payment of ₦${args.amount.toLocaleString('en-NG')} received. Your membership is active until ${args.endDate}. — GymFlow`,
  );
}

export async function waExpiryReminder(phone: string, args: { name: string; daysLeft: number; endDate: string; renewUrl: string; autoDebit: boolean }) {
  const when = args.daysLeft === 1 ? 'TOMORROW' : `in ${args.daysLeft} days`;
  return sendWhatsApp(
    phone,
    args.autoDebit
      ? `Hi ${args.name}, your membership renews ${when} (${args.endDate}). Your saved card will be charged automatically. — GymFlow`
      : `Hi ${args.name}, your membership expires ${when} (${args.endDate}). Renew: ${args.renewUrl} — GymFlow`,
  );
}

export async function waAutoDebitSuccess(phone: string, args: { name: string; amount: number; endDate: string }) {
  return sendWhatsApp(
    phone,
    `Hi ${args.name}, auto-renewal successful (₦${args.amount.toLocaleString('en-NG')}). Active until ${args.endDate}. — GymFlow`,
  );
}

export async function waAutoDebitFailure(phone: string, args: { name: string; renewUrl: string; attempts: number }) {
  return sendWhatsApp(
    phone,
    `Hi ${args.name}, auto-renewal failed (attempt ${args.attempts}/3). Please update your card: ${args.renewUrl} — GymFlow`,
  );
}

export async function waTempPassword(phone: string, args: { name: string; gymName: string; tempPassword: string; loginUrl: string }) {
  return sendWhatsApp(
    phone,
    `Welcome to ${args.gymName}, ${args.name}! Sign in with temp password: ${args.tempPassword}\n\n${args.loginUrl}\n\nYou'll set a new password on first sign-in. — GymFlow`,
  );
}
