import 'server-only';
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
        // When set, settle this charge to the gym's Paystack subaccount (its own
        // bank); the platform keeps its commission and the subaccount bears fees.
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

// Initialize a transaction tied to a Paystack Plan. Passing `plan` makes
// Paystack auto-create a Subscription after the first successful charge and
// bill it monthly thereafter (firing charge.success each cycle). The amount is
// taken from the plan, so we don't pass one. Used for platform (gym → GymFlow)
// SaaS billing.
export async function initSubscription(params: {
  email: string;
  planCode: string;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
}): Promise<InitResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        plan: params.planCode,
        metadata: params.metadata,
        callback_url: params.callbackUrl,
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

export type SubscriptionInfo = { subscriptionCode: string; emailToken: string; status: string };

// Fetch a subscription — needed to get the email_token required to disable it.
export async function getSubscription(code: string): Promise<{ ok: true; data: SubscriptionInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subscription/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Subscription fetch failed' };
    return { ok: true, data: { subscriptionCode: json.data.subscription_code, emailToken: json.data.email_token, status: json.data.status } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Cancel a subscription. Paystack requires the code + the subscription's
// email_token (fetched via getSubscription). After this Paystack stops billing
// and fires subscription.disable / subscription.not_renew.
export async function disableSubscription(code: string, emailToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subscription/disable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token: emailToken }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Disable failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Platform's default cut of member dues routed through a gym's subaccount, as a
// percentage. Used when a gym has no explicit platform_commission_pct set, so we
// never silently create a 0% subaccount (which would settle 100% to the gym).
export const DEFAULT_PLATFORM_COMMISSION_PCT = 1;

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

export type Bank = { name: string; code: string };

// List Nigerian banks/fintechs for the payout dropdown. Paginates via Paystack's
// cursor, de-dupes by code, sorts by name. Cached a day (the list rarely
// changes). Returns [] if Paystack isn't configured or the call fails — the
// payout form then falls back to manual bank-code entry.
export async function listBanks(): Promise<Bank[]> {
  try {
    const out: Bank[] = [];
    const seen = new Set<string>();
    let url: string | null = `${PAYSTACK_BASE}/bank?currency=NGN&use_cursor=true&perPage=100`;
    for (let page = 0; url && page < 6; page++) {
      const res: Response = await fetch(url, {
        headers: { Authorization: `Bearer ${secret()}` },
        next: { revalidate: 86400 },
      });
      const json = await res.json();
      if (!res.ok || !json.status || !Array.isArray(json.data)) break;
      for (const b of json.data) {
        if (b?.code && b?.name && !seen.has(b.code)) { seen.add(String(b.code)); out.push({ name: b.name, code: String(b.code) }); }
      }
      const next = json.meta?.next;
      url = next ? `${PAYSTACK_BASE}/bank?currency=NGN&use_cursor=true&perPage=100&next=${encodeURIComponent(next)}` : null;
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  } catch {
    return [];
  }
}

export type ResolveResult = { ok: true; accountName: string } | { ok: false; error: string };

// Verify a bank account ("resolve") — returns the real account-holder name for a
// given account number + bank code, so payouts can't be saved to a typo'd account.
export async function resolveAccount(accountNumber: string, bankCode: string): Promise<ResolveResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Could not verify this account' };
    return { ok: true, accountName: json.data.account_name };
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
