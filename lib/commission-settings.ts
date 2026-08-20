// The two pure pieces of setting a gym's commission: what an operator's input
// means, and which arrangement the editor is showing.
//
// Both live outside lib/actions/platform-gym.ts and outside the editor
// component so the suite can exercise them for real. They are the parts that
// have been wrong: the rules below decide whether a money setting is accepted,
// and the toggle below decides which setting is submitted at all — neither is
// something a regex over the source can check, and a source-text test on the
// toggle is exactly what let it ship frozen.

/** Which arrangement a gym is on. */
export type CommissionMode = 'percentage' | 'fixed';

// A flat fee above this is far likelier to be a typo (or naira/kobo confusion)
// than a real per-payment deal, and the mistake is invisible until members'
// payments start settling ₦0 to the gym. The column itself only refuses a
// negative.
export const MAX_FIXED_COMMISSION_NAIRA = 1_000_000;

export type CommissionInput = { mode: CommissionMode; pct: number; fixed: number };

export type ParsedCommission =
  | { error: string; value: null }
  | { error: null; value: CommissionInput };

/**
 * Read and check the numbers off a commission form post.
 *
 * BOTH numbers are validated on every save whichever mode is live: both are
 * written to the row, because in fixed mode the percentage stays behind as
 * Paystack's fallback for any charge that reaches it without a flat one. A
 * nonsense value must never get in on the grounds that it is "not the one in
 * use" — it is one bad charge away from being exactly the one in use.
 *
 * An absent mode means percentage, so an older form post (or anything that only
 * knows about a rate) keeps its existing meaning rather than failing.
 */
export function parseCommission(raw: {
  mode?: FormDataEntryValue | string | null;
  pct?: FormDataEntryValue | string | null;
  fixed?: FormDataEntryValue | string | null;
}): ParsedCommission {
  const bad = (error: string): ParsedCommission => ({ error, value: null });

  const modeRaw = String(raw.mode ?? 'percentage');
  if (modeRaw !== 'percentage' && modeRaw !== 'fixed') return bad('Pick either a percentage or a fixed amount.');
  const mode: CommissionMode = modeRaw;

  const pct = Number(raw.pct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return bad('Enter a percentage between 0 and 100.');

  // An empty box is ₦0, not NaN: the flat input is absent from the form
  // entirely while the editor is in percentage mode.
  const fixed = raw.fixed == null || String(raw.fixed).trim() === '' ? 0 : Number(raw.fixed);
  if (!Number.isFinite(fixed) || fixed < 0) return bad('Enter a fixed amount of ₦0 or more.');
  if (fixed > MAX_FIXED_COMMISSION_NAIRA) {
    return bad(`That fixed amount looks wrong — enter ₦${MAX_FIXED_COMMISSION_NAIRA.toLocaleString('en-NG')} or less.`);
  }
  // ₦0 flat is not an arrangement — it is a gym being charged nothing while the
  // console reports a deal. Percentage mode is how "nothing" is expressed.
  if (mode === 'fixed' && fixed === 0) {
    return bad('A fixed commission of ₦0 earns nothing — enter an amount, or switch back to a percentage.');
  }

  return { error: null, value: { mode, pct, fixed } };
}

export type ModeSelection = {
  /** The mode to show and submit. */
  mode: CommissionMode;
  /** The saved mode already adopted, to carry into the next render. */
  adopted: CommissionMode | null;
};

/**
 * Resolve the mode the editor displays.
 *
 * `saved` is the mode the last save stored (undefined before any save has
 * returned); `adopted` is the last saved mode this editor has already taken on
 * board. Comparing the two is the whole point: the save is adopted ONCE, and
 * after the operator has been shown it their own next selection is the newer
 * intent and wins again.
 *
 * The obvious-looking `saved ?? draft` is not this rule. useActionState state
 * survives the revalidate — the editor is never remounted — so once any save
 * has returned a mode, `saved ?? draft` pins the toggle to it permanently: the
 * select snaps back on every change and the hidden input keeps submitting the
 * old arrangement, with a full page reload the only way out.
 */
export function editorMode(
  current: { draft: CommissionMode; adopted: CommissionMode | null },
  saved: CommissionMode | undefined,
): ModeSelection {
  if (saved !== undefined && saved !== current.adopted) return { mode: saved, adopted: saved };
  return { mode: current.draft, adopted: current.adopted };
}
