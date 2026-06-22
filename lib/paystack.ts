// Paystack server helpers. Uses PAYSTACK_SECRET_KEY (server-only). All calls
// are no-throw on missing key at module load — callers check + surface errors.

const PAYSTACK_BASE = 'https://api.paystack.co';

function secret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error('PAYSTACK_SECRET_KEY is not set');
  return k;
}

export type InitResult =
  | { ok: true; authorization_url: string; reference: string }
  | { ok: false; error: string };

// Initialize a transaction. amountKobo = naira × 100. metadata carries the
// member/gym/plan so the webhook can record the payment + extend the sub.
// When `subaccount` is given the charge settles to that gym's Paystack
// subaccount (the gym's own bank), with the platform keeping its commission;
// the subaccount also bears the Paystack processing fee.
export async function initTransaction(params: {
  email: string;
  amountKobo: number;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
  subaccount?: string | null;
}): Promise<InitResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        amount: params.amountKobo,
        currency: 'NGN',
        metadata: params.metadata,
        callback_url: params.callbackUrl,
        ...(params.subaccount ? { subaccount: params.subaccount, bearer: 'subaccount' } : {}),
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Paystack init failed' };
    return { ok: true, authorization_url: json.data.authorization_url, reference: json.data.reference };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type SubaccountResult = { ok: true; subaccountCode: string } | { ok: false; error: string };

// Create a Paystack subaccount for a gym so member dues settle to the gym's own
// bank. `percentageCharge` is the platform's commission (kept by the main
// account); the rest settles to the subaccount. Returns the subaccount_code to
// store on the gym and pass as `subaccount` on future charges.
export async function createSubaccount(params: {
  businessName: string;
  bankCode: string;
  accountNumber: string;
  percentageCharge: number;
}): Promise<SubaccountResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subaccount`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_name: params.businessName,
        settlement_bank: params.bankCode,
        account_number: params.accountNumber,
        percentage_charge: params.percentageCharge,
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Subaccount creation failed' };
    return { ok: true, subaccountCode: json.data.subaccount_code };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type VerifyResult =
  | { ok: true; status: string; amountKobo: number; reference: string; metadata: Record<string, unknown>; channel: string | null }
  | { ok: false; error: string };

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Verify failed' };
    const d = json.data;
    return { ok: true, status: d.status, amountKobo: d.amount, reference: d.reference, metadata: d.metadata ?? {}, channel: d.channel ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
