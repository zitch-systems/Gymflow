// What the platform actually kept on a Paystack charge.
//
// The commission is not a number we choose at fulfilment — it is applied by
// Paystack at settlement, from the percentage_charge on the gym's subaccount.
// So the authority is the charge event itself, not our gyms row: a member can
// pay minutes after an operator edits the rate, and a checkout initialized
// before that edit settles on the OLD split. Reading the event is the only way
// to record what happened rather than what we think should have happened.
//
// Pure and shape-tolerant on purpose. This runs on money-path webhooks that
// must not throw, and Paystack's payload is wider and less stable than the
// three fields we want out of it.

/** How the money moved. See the column comments in the migration. */
export type Settlement = 'split' | 'platform_only' | 'offline';

export type SplitRecord = {
  settlement: Settlement;
  /** Rate applied, or null when nothing was split. */
  pct: number | null;
  /** Naira the platform kept, or null when Paystack didn't report a figure. */
  amountNaira: number | null;
};

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Read the split off a Paystack charge/verify `data` object.
 *
 * `platform_only` is not an error state — an unconnected gym still takes
 * payments, they just all land in GymFlow's own account with the gym owed the
 * remainder. It reports no commission because none was earned; the money is
 * held, not kept. Recording a figure there is what made the console's
 * "commission collected" wrong in the first place.
 */
export function readSplit(data: unknown): SplitRecord {
  const d = obj(data);
  const sub = d ? obj(d.subaccount) : null;
  // Paystack sends `subaccount` as null, as {}, or as the full object; only the
  // last means the charge was actually routed somewhere other than the platform
  // account, so the code is what decides, not the key's presence.
  const code = sub && typeof sub.subaccount_code === 'string' ? sub.subaccount_code.trim() : '';
  if (!sub || !code) return { settlement: 'platform_only', pct: null, amountNaira: null };

  const fees = d ? obj(d.fees_split) : null;
  const params = fees ? obj(fees.params) : null;

  // params.percentage_charge is the rate this transaction was actually split
  // on; subaccount.percentage_charge is the subaccount's rate as of the API
  // response, which can already have moved. Prefer the former.
  const pctRaw = num(params?.percentage_charge) ?? num(sub.percentage_charge);
  const pct = pctRaw !== null && pctRaw >= 0 && pctRaw <= 100 ? round2(pctRaw) : null;

  // fees_split.integration is the main account's share in kobo — literally
  // what GymFlow kept, already net of how the Paystack fee was borne. Falling
  // back to pct x amount is an approximation, so it is only used when Paystack
  // reported no breakdown.
  const integrationKobo = num(fees?.integration);
  const amountKobo = num(d?.amount);
  const keptKobo = integrationKobo !== null
    ? integrationKobo
    : pct !== null && amountKobo !== null ? (amountKobo * pct) / 100 : null;

  return {
    settlement: 'split',
    pct,
    amountNaira: keptKobo !== null && keptKobo >= 0 ? round2(keptKobo / 100) : null,
  };
}

// The columns are numeric(5,2) and numeric(12,2); rounding here rather than
// letting Postgres do it keeps the value we log identical to the value stored.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Columns to write on a payments row. Shared by every fulfilment path. */
export function commissionColumns(split: SplitRecord | null): Json {
  if (!split) return {};
  return {
    platform_settlement: split.settlement,
    platform_commission_pct: split.settlement === 'split' ? split.pct : null,
    platform_commission_amount: split.settlement === 'split' ? split.amountNaira : null,
  };
}
