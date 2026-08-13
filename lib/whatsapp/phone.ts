import { normalizeNgPhone } from '@/lib/format';

// WhatsApp identifies people by `wa_id` — an E.164 number with no punctuation
// and no leading plus, e.g. "2348031234567". The rest of GymFlow stores Nigerian
// numbers in local form ("08031234567"), because that is what members type and
// what the profiles table already holds.
//
// Everything crossing the WhatsApp boundary goes through here so the two
// spellings never leak into each other. Getting this wrong is not cosmetic: a
// lookup on the wrong spelling silently fails to find the member, and the
// member is told their number isn't registered while it plainly is.

/** Meta's wa_id → local Nigerian form, or null if it isn't a valid NG mobile. */
export function waIdToLocal(waId: string | null | undefined): string | null {
  if (!waId) return null;
  const digits = waId.replace(/\D/g, '');
  if (!digits) return null;
  return normalizeNgPhone(digits.startsWith('234') ? `+${digits}` : digits);
}

/** Local ("0803…") or any accepted spelling → wa_id ("234803…"), or null. */
export function localToWaId(phone: string | null | undefined): string | null {
  const local = normalizeNgPhone(phone);
  return local ? `234${local.slice(1)}` : null;
}

/** Normalise whatever Meta sent into the canonical wa_id we store. */
export function canonicalWaId(waId: string | null | undefined): string | null {
  return localToWaId(waIdToLocal(waId));
}

// The spellings a phone number might already be stored under in `profiles`.
// Historical rows were written by several different paths (web join, mobile
// signup, staff-created members, CSV import) and were never normalised, so a
// member lookup has to try all of them rather than assume the local form.
export function phoneVariants(local: string): string[] {
  const intl = `234${local.slice(1)}`;
  return [local, `+${intl}`, intl, local.replace(/^0/, '')];
}

/** Pretty form for display back to a member: "+234 803 123 4567". */
export function formatWaId(waId: string | null | undefined): string {
  const local = waIdToLocal(waId);
  if (!local) return waId ?? '';
  return `+234 ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

// A tel: link a member can tap to phone their gym. Falls back to returning the
// raw string when it isn't a Nigerian mobile — gyms legitimately publish
// landlines and short codes, and refusing to show one because it doesn't match
// an NG mobile pattern would be worse than showing it unformatted.
export function dialLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const local = normalizeNgPhone(trimmed);
  if (local) return `+234${local.slice(1)}`;
  return /^[+\d][\d\s()-]{4,}$/.test(trimmed) ? trimmed.replace(/[\s()-]/g, '') : null;
}
