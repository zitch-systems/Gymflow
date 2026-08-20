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

/** What the platform's cut was computed from on this charge. */
export type CommissionBasis = 'percentage' | 'flat';

export type SplitRecord = {
  settlement: Settlement;
  /**
   * How the cut was arrived at, or null when nothing was split. A flat charge
   * has no rate at all — see `pct`.
   */
  basis: CommissionBasis | null;
  /**
   * Rate applied, or null when nothing was split OR the charge carried a flat
   * transaction_charge. A ₦500 flat fee on a ₦5,000 payment is not "10%":
   * deriving one would invent a rate nobody agreed and would reprice itself on
   * the next payment of a different size.
   */
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
  if (!sub || !code) return { settlement: 'platform_only', basis: null, pct: null, amountNaira: null };

  const fees = d ? obj(d.fees_split) : null;
  const params = fees ? obj(fees.params) : null;

  // A flat transaction_charge overrides the subaccount's percentage for this
  // one charge (lib/paystack.ts initTransaction sends it for a fixed-mode gym),
  // so its presence — not our gyms row, which can have been re-moded since —
  // is what says this charge was flat. Read from the same two places the rate
  // is read from, and only a positive figure counts: Paystack echoes a 0 on
  // ordinary percentage splits.
  //
  // Third and last, the metadata we sent with the charge. Whether Paystack
  // repeats transaction_charge on a charge event is Paystack's choice, and the
  // webhook payload is not the /transaction/verify payload; without this the
  // absence of an echo silently demotes a flat charge to "percentage at the
  // subaccount's fallback rate", which is an arrangement the gym was never on
  // and a figure nobody can tell apart from a real one afterwards. Our own
  // metadata says what we asked Paystack for, so it is read last — an echo
  // from Paystack, where present, still describes what Paystack did.
  const meta = d ? obj(d.metadata) : null;
  const flatKobo = num(params?.transaction_charge)
    ?? num(d?.transaction_charge)
    ?? num(meta?.platform_commission_flat_kobo);
  const flat = flatKobo !== null && flatKobo > 0 ? flatKobo : null;

  // params.percentage_charge is the rate this transaction was actually split
  // on; subaccount.percentage_charge is the subaccount's rate as of the API
  // response, which can already have moved. Prefer the former. Ignored outright
  // on a flat charge: the subaccount still carries its fallback percentage (see
  // initTransaction), and recording that as the applied rate would describe an
  // arrangement this charge did not use.
  const pctRaw = flat !== null ? null : num(params?.percentage_charge) ?? num(sub.percentage_charge);
  const pct = pctRaw !== null && pctRaw >= 0 && pctRaw <= 100 ? round2(pctRaw) : null;

  // fees_split.integration is the main account's share in kobo — literally
  // what GymFlow kept, already net of how the Paystack fee was borne. Falling
  // back to pct x amount is an approximation, so it is only used when Paystack
  // reported no breakdown.
  const integrationKobo = num(fees?.integration);
  const amountKobo = num(d?.amount);
  // The flat charge is the fallback on a flat split, for the same reason pct ×
  // amount is on a percentage one: it is what we asked Paystack for, used only
  // when Paystack reported no breakdown of what it actually did.
  const keptKobo = integrationKobo !== null
    ? integrationKobo
    : flat !== null ? flat
      : pct !== null && amountKobo !== null ? (amountKobo * pct) / 100 : null;

  return {
    settlement: 'split',
    basis: flat !== null ? 'flat' : 'percentage',
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
    // The basis is what lets the console say "₦500 flat" rather than guessing a
    // rate back out of the amount. NULL on anything that wasn't a split, where
    // there is no cut to describe.
    platform_commission_basis: split.settlement === 'split' ? split.basis : null,
    platform_commission_pct: split.settlement === 'split' ? split.pct : null,
    platform_commission_amount: split.settlement === 'split' ? split.amountNaira : null,
  };
}
