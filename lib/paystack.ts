import 'server-only';
import { isChargeableKobo, subscriptionInitBody, transactionChargeKobo, type GymCommission } from '@/lib/paystack-payloads';
import { readSplit, type SplitRecord } from '@/lib/paystack-split';
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
//
// `commission` is the gym's arrangement. In percentage mode nothing extra is
// sent and Paystack splits on the subaccount's own percentage_charge, exactly
// as before. In fixed mode a flat `transaction_charge` (kobo) rides along and
// overrides that percentage for this one charge.
//
// The subaccount's percentage_charge is deliberately LEFT AS THE GYM'S
// PERCENTAGE even for a fixed-mode gym (setGymCommission keeps pushing it).
// It is the fallback: any charge that somehow reaches Paystack without a
// transaction_charge — a call site added later that doesn't thread this
// through, a fixed amount that resolved to null — still splits at the stored
// rate. The alternative, zeroing it, makes that same slip settle 100% to the
// gym with the platform earning nothing, and a 0% main-account share also
// flips who bears the Paystack fee onto the platform. Both failure directions
// are wrong in favour of the platform's own error; this one is wrong in favour
// of "the old arrangement still applied", which is recoverable and visible in
// what gets recorded on the payment.
export async function initTransaction(params: {
  email: string;
  amountKobo: number;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
  subaccount?: string | null;
  commission?: GymCommission | null;
}): Promise<InitResult> {
  try {
    // Only meaningful alongside a subaccount: with no split there is nothing
    // to route a flat charge away from — the whole amount already lands in the
    // platform account.
    const flatKobo = params.subaccount
      ? transactionChargeKobo({ commission: params.commission, amountKobo: params.amountKobo })
      : null;
    // Our own record of what we ASKED for, carried on the charge's metadata.
    // Paystack echoes metadata back on charge.success verbatim, and it is the
    // only field in the payload we control — whether the charge event also
    // repeats `transaction_charge` is Paystack's choice, and lib/paystack-split
    // must not have to guess a basis when it doesn't. Kobo, matching the field
    // it mirrors.
    const metadata = flatKobo !== null
      ? { ...params.metadata, platform_commission_flat_kobo: flatKobo }
      : params.metadata;
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        amount: params.amountKobo,
        currency: 'NGN',
        metadata,
        callback_url: params.callbackUrl,
        // When set, settle this charge to the gym's Paystack subaccount (its own
        // bank); the platform keeps its commission and the subaccount bears fees.
        ...(params.subaccount ? { subaccount: params.subaccount, bearer: 'subaccount' } : {}),
        // Flat commission for this charge, in kobo. Paystack sends exactly this
        // much to the main account and the remainder to the subaccount,
        // overriding the subaccount's percentage_charge for this transaction.
        ...(flatKobo !== null ? { transaction_charge: flatKobo } : {}),
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Paystack init failed' };
    return { ok: true, authorization_url: json.data.authorization_url, reference: json.data.reference };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Initialize a transaction tied to a Paystack Plan. Passing `plan` makes
// Paystack auto-create a Subscription after the first successful charge and
// bill it monthly thereafter (firing charge.success each cycle). Used for
// platform (gym → GymFlow) SaaS billing and member auto-renew.
//
// The amount is sent even though the plan defines the price: /transaction/
// initialize requires it, and omitting it failed every plan checkout with
// "Invalid Amount Sent". Paystack charges the plan's amount regardless.
export async function initSubscription(params: {
  email: string;
  planCode: string;
  /** The plan's price in kobo. Required by /transaction/initialize even when a
   *  plan code is present — see subscriptionInitBody. Paystack still charges
   *  the plan's own amount. */
  amountKobo: number;
  metadata: Record<string, unknown>;
  callbackUrl?: string;
}): Promise<InitResult> {
  if (!isChargeableKobo(params.amountKobo)) {
    return { ok: false, error: 'This plan has no price set, so it can’t be billed.' };
  }
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(subscriptionInitBody({
        email: params.email,
        planCode: params.planCode,
        amountKobo: params.amountKobo,
        metadata: params.metadata,
        callbackUrl: params.callbackUrl,
      })),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Paystack init failed' };
    return { ok: true, authorization_url: json.data.authorization_url, reference: json.data.reference };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Create a Paystack Plan. Member auto-billing lazy-creates one per
// membership_plans row on first opt-in and caches the code. Paystack Plan
// intervals are fixed to a small vocabulary — we pick the closest match to
// the membership plan's duration.
export type PlanInterval = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'biannually' | 'annually';
export type CreatePlanResult = { ok: true; planCode: string } | { ok: false; error: string };

export async function createPlan(params: {
  name: string;
  amountKobo: number;
  interval: PlanInterval;
}): Promise<CreatePlanResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/plan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: params.name,
        amount: params.amountKobo,
        interval: params.interval,
        currency: 'NGN',
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Paystack plan creation failed' };
    return { ok: true, planCode: json.data.plan_code };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Map a membership plan's duration to a Paystack interval. Paystack only bills
// on its own fixed schedule (daily/weekly/monthly/quarterly/biannually/annually)
// — we snap to the closest match. Returns null when no reasonable match exists,
// so the caller can refuse to enable auto-renew for that plan.
export function planIntervalFor(durationDays: number | null, durationMonths: number | null): PlanInterval | null {
  if (durationDays && durationDays > 0) {
    if (durationDays <= 1) return 'daily';
    if (durationDays <= 10) return 'weekly';
    if (durationDays <= 45) return 'monthly';
    if (durationDays <= 100) return 'quarterly';
    if (durationDays <= 200) return 'biannually';
    return 'annually';
  }
  if (durationMonths && durationMonths > 0) {
    if (durationMonths === 1) return 'monthly';
    if (durationMonths <= 3) return 'quarterly';
    if (durationMonths <= 6) return 'biannually';
    return 'annually';
  }
  return null;
}

export type SubscriptionInfo = { subscriptionCode: string; emailToken: string; status: string };

// Fetch a subscription — needed to get the email_token required to disable it.
export async function getSubscription(code: string): Promise<{ ok: true; data: SubscriptionInfo } | { ok: false; error: string; status?: number }> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subscription/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    // The HTTP status rides along on failures: a 4xx here means Paystack has
    // nothing (usable) under this code, which callers treat differently from a
    // 5xx or a dropped connection. See mandateGoneAtPaystack().
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Subscription fetch failed', status: res.status };
    return { ok: true, data: { subscriptionCode: json.data.subscription_code, emailToken: json.data.email_token, status: json.data.status } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Cancel a subscription. Paystack requires the code + the subscription's
// email_token (fetched via getSubscription). After this Paystack stops billing
// and fires subscription.disable / subscription.not_renew.
export async function disableSubscription(code: string, emailToken: string): Promise<{ ok: boolean; error?: string; status?: number }> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subscription/disable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, token: emailToken }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Disable failed', status: res.status };
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
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Subaccount creation failed' };
    return { ok: true, subaccountCode: json.data.subaccount_code };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Update an existing subaccount's commission. Paystack locks percentage_charge
// at creation, so changing a gym's commission after the fact needs this PUT —
// without it, edits would only ever touch our DB and not the live split.
export async function updateSubaccountCommission(subaccountCode: string, percentageCharge: number): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subaccount/${encodeURIComponent(subaccountCode)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ percentage_charge: percentageCharge }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Subaccount update failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type SubaccountInfo = { subaccountCode: string; percentageCharge: number; active: boolean };

// Fetch a subaccount by code. Used by the reconciliation sweep to check
// whether a gym's stored code still resolves at Paystack — it can stop
// resolving if the subaccount was created under a different key/mode, or
// deleted there — and, when it does, to compare its live percentage_charge
// against ours before deciding whether a push is even needed.
//
// `status` on failure carries the HTTP status we actually got back (404 for a
// genuine "no such subaccount"), or null when we never got one at all — a
// thrown fetch (timeout/dropped connection) or a JSON-parse failure land in
// the same catch as network errors. Callers that need to tell "truly gone"
// apart from "this one GET hiccuped" key off that distinction — see
// lib/reconcile-core.ts planGymSplitFix.
export async function getSubaccount(code: string): Promise<{ ok: true; data: SubaccountInfo } | { ok: false; error: string; status: number | null }> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/subaccount/${encodeURIComponent(code)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Subaccount fetch failed', status: res.status };
    return {
      ok: true,
      data: {
        subaccountCode: json.data.subaccount_code,
        percentageCharge: Number(json.data.percentage_charge),
        active: Boolean(json.data.active),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: null };
  }
}

export type RecipientResult = { ok: true; recipientCode: string } | { ok: false; error: string };

// Create a transfer recipient (NUBAN) for instructor payouts. Paystack
// de-duplicates identical recipients server-side, so calling this twice with
// the same account is harmless — but we still cache the code on the payout row.
export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<RecipientResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'nuban',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: 'NGN',
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Recipient creation failed' };
    return { ok: true, recipientCode: json.data.recipient_code };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type TransferResult =
  | { ok: true; transferCode: string; status: string }
  | { ok: false; error: string };

// Move money from the Paystack balance to a recipient. `reference` is OUR
// idempotency key — Paystack rejects a duplicate reference, so retrying a
// payout can never double-pay. Status comes back 'success' (instant),
// 'pending'/'queued' (webhook will confirm), or 'otp' (the account has
// OTP-gated transfers enabled, which no server can complete — surface it).
export async function initiateTransfer(params: {
  amountKobo: number;
  recipientCode: string;
  reference: string;
  reason?: string;
}): Promise<TransferResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'balance',
        amount: params.amountKobo,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
        currency: 'NGN',
      }),
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Transfer failed' };
    if (json.data.status === 'otp') {
      return { ok: false, error: 'This Paystack account requires an OTP for transfers. Disable "Confirm transfers with OTP" in Paystack settings to pay from the app.' };
    }
    return { ok: true, transferCode: json.data.transfer_code, status: json.data.status };
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
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Could not verify this account' };
    return { ok: true, accountName: json.data.account_name };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type PaystackTxn = {
  reference: string;
  status: string;
  amountKobo: number;
  paidAt: string | null;
  channel: string | null;
};

export type ListTransactionsResult =
  | { ok: true; transactions: PaystackTxn[] }
  | { ok: false; error: string };

// List transactions from Paystack — the authoritative charge record. Used by
// the daily reconciliation pass to catch charges whose charge.success webhook
// was dropped (they exist at Paystack but not in payments/platform_payments).
// Pages through up to `maxPages` × 200 rows; date bounds keep the sweep small.
export async function listTransactions(params: {
  from: Date;
  to?: Date;
  status?: 'success' | 'failed' | 'abandoned';
  maxPages?: number;
}): Promise<ListTransactionsResult> {
  try {
    const out: PaystackTxn[] = [];
    const maxPages = params.maxPages ?? 5;
    for (let page = 1; page <= maxPages; page++) {
      const qs = new URLSearchParams({
        perPage: '200',
        page: String(page),
        from: params.from.toISOString(),
        ...(params.to ? { to: params.to.toISOString() } : {}),
        ...(params.status ? { status: params.status } : {}),
      });
      const res = await fetch(`${PAYSTACK_BASE}/transaction?${qs}`, {
        headers: { Authorization: `Bearer ${secret()}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json.status || !Array.isArray(json.data)) {
        return { ok: false, error: json.message ?? 'Transaction list failed' };
      }
      for (const t of json.data) {
        if (!t?.reference) continue;
        out.push({
          reference: String(t.reference),
          status: String(t.status ?? ''),
          amountKobo: Number(t.amount ?? 0),
          paidAt: t.paid_at ? String(t.paid_at) : null,
          channel: t.channel ? String(t.channel) : null,
        });
      }
      if (json.data.length < 200) break; // last page
    }
    return { ok: true, transactions: out };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type TransferVerifyResult =
  | { ok: true; status: string; transferCode: string | null; reason: string | null }
  | { ok: false; error: string };

// Fetch a transfer's current status by its transfer_code (stored on the payout
// row at initiation). Payout completion normally arrives via the
// transfer.success webhook; when that delivery is dropped the payout sits in
// 'approved' forever (and blocks the instructor's next request via the
// one-open-payout guard). Reconciliation polls this to resolve stuck rows.
export async function getTransfer(codeOrId: string): Promise<TransferVerifyResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transfer/${encodeURIComponent(codeOrId)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status) return { ok: false, error: json.message ?? 'Transfer fetch failed' };
    const d = json.data ?? {};
    return {
      ok: true,
      status: String(d.status ?? ''),
      transferCode: d.transfer_code ? String(d.transfer_code) : null,
      reason: d.reason ? String(d.reason) : null,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type BalanceResult = { ok: true; balanceKobo: number } | { ok: false; error: string };

// Available NGN balance on the Paystack account. Lets staff see "top up your
// Paystack balance" instead of a generic transfer failure when paying payouts.
export async function getBalance(): Promise<BalanceResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/balance`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !Array.isArray(json.data)) {
      return { ok: false, error: json.message ?? 'Balance fetch failed' };
    }
    const ngn = json.data.find((b: { currency?: string }) => b?.currency === 'NGN');
    return { ok: true, balanceKobo: Number(ngn?.balance ?? 0) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type VerifyResult =
  | { ok: true; status: string; amountKobo: number; reference: string; metadata: Record<string, unknown>; channel: string | null; split: SplitRecord }
  | { ok: false; error: string };

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  try {
    const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret()}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok || !json.status || !json.data) return { ok: false, error: json.message ?? 'Verify failed' };
    const d = json.data;
    // The post-checkout callbacks fulfil from this response rather than the
    // webhook body, so the split has to survive the round trip too — otherwise
    // whichever of the two races in first decides whether commission is
    // recorded at all.
    return { ok: true, status: d.status, amountKobo: d.amount, reference: d.reference, metadata: d.metadata ?? {}, channel: d.channel ?? null, split: readSplit(d) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
