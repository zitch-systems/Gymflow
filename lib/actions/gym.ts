'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff, MANAGER_ROLES } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { createSubaccount, resolveAccount, DEFAULT_PLATFORM_COMMISSION_PCT } from '@/lib/paystack';
import { rateLimit } from '@/lib/rate-limit';
import { normalizeBusinessName } from '@/lib/format';

export type GymSaveState = { ok: boolean; error: string | null };

// Client to use for gym-asset STORAGE writes. Prefer the service-role client
// (bypasses storage RLS — correct for these already-authorized server actions,
// where the object path is server-controlled). Fall back to the user client if
// the service-role key isn't configured, so uploads still work where RLS holds.
function storageWriter(userClient: Awaited<ReturnType<typeof createClient>>) {
  try { return createAdminClient(); } catch { return userClient; }
}

export type VerifyAccountResult = { ok: true; accountName: string } | { ok: false; error: string };

// Interactive account-name lookup for the payout form (client → server, since it
// needs the Paystack secret key). Owners/managers only.
export async function verifyBankAccount(accountNumber: string, bankCode: string): Promise<VerifyAccountResult> {
  if (!/^\d{10}$/.test(accountNumber) || !/^\d{3,6}$/.test(bankCode)) {
    return { ok: false, error: 'Enter a 10-digit account number and pick a bank.' };
  }
  if (!process.env.PAYSTACK_SECRET_KEY) return { ok: false, error: 'Payments are not configured yet.' };
  const { user } = await requireStaff(MANAGER_ROLES);
  // Each call resolves a real account name at Paystack — throttle per user so
  // the endpoint can't be scripted into an account-name enumeration oracle.
  if (!(await rateLimit(`verify-bank:user:${user.id}`, 10, 600))) {
    return { ok: false, error: 'Too many lookups — wait a few minutes and try again.' };
  }
  return resolveAccount(accountNumber, bankCode);
}

// Payout account write:
//   First-time setup (no bank on file) — verifies against Paystack, creates the
//     subaccount, sets payouts_locked=true so future edits require review.
//   Change (locked) — creates a payout_change_request row for a platform admin
//     to approve. If the resolved holder name doesn't match the gym's business
//     name, the request is still created but flagged as name_matches=false;
//     approval requires the admin to tick "allow name mismatch".
//   Change (name mismatch override on gyms) — behaves like first-time setup,
//     so a gym whose registered account holder legitimately differs (e.g. a
//     personal bank account for a sole trader) isn't stuck submitting requests
//     forever. The override itself is set by a platform admin.
// Owners/managers only.
export async function savePayout(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const bank_name = String(formData.get('bank_name') ?? '').trim();
  const bank_code = String(formData.get('bank_code') ?? '').trim();
  const account_number = String(formData.get('account_number') ?? '').trim();
  const account_name = String(formData.get('account_name') ?? '').trim();
  if (!bank_name || !/^\d{3,6}$/.test(bank_code) || !/^\d{10}$/.test(account_number) || !account_name) {
    return { ok: false, error: 'Enter bank name, bank code, a 10-digit account number and the account name.' };
  }
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();

    // Verification is best-effort: try to resolve the holder name at Paystack,
    // but a failure (unresolvable account, Paystack hiccup) does NOT block the
    // save — the gym can set any account, keeping the name they entered.
    let resolvedName = account_name;
    let paystackVerified = false;
    if (process.env.PAYSTACK_SECRET_KEY) {
      const resolved = await resolveAccount(account_number, bank_code);
      if (resolved.ok) { resolvedName = resolved.accountName || account_name; paystackVerified = true; }
    }

    const nameMatches = normalizeBusinessName(resolvedName) === normalizeBusinessName(gym.name);
    const locked = (gym as { payouts_locked?: boolean }).payouts_locked === true;

    // Locked: any change goes through the approval queue instead of applying.
    if (locked) {
      // Generated types don't include payout_change_requests yet — assert the
      // table name so both the query builder and the untyped row payload compile.
      const { error: reqErr } = await supabase.from('payout_change_requests' as never).insert({
        gym_id: gym.id,
        requested_by: user.id,
        bank_name, bank_code, account_number,
        account_name: resolvedName,
        name_matches: nameMatches,
        status: 'pending',
      } as never);
      if (reqErr) return { ok: false, error: reqErr.message };
      logAudit({ action: 'payout_change_requested', table: 'payout_change_requests', actorId: user.id, gymId: gym.id, recordId: gym.id, values: { bank_name, last4: account_number.slice(-4) } });
      try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
      return { ok: true, error: null };
    }

    // Not locked yet — first-time setup. Save whatever account the gym entered
    // (any account is allowed). The name-match is still recorded on locked
    // change requests for the platform's audit trail, but it no longer blocks
    // the initial save; ongoing CHANGES route through the approval queue (above).
    const { error: upErr } = await supabase.from('gyms')
      .update({ bank_name, bank_code, account_number, account_name: resolvedName, payouts_locked: true } as never)
      .eq('id', gym.id);
    if (upErr) return { ok: false, error: upErr.message };

    // Only wire up the Paystack subaccount when the account actually resolved —
    // creating a subaccount with an unverifiable account would fail anyway. An
    // unverified bank is still saved so the gym has its details on file.
    if (process.env.PAYSTACK_SECRET_KEY && paystackVerified) {
      const sub = await createSubaccount({
        businessName: gym.name,
        bankCode: bank_code,
        accountNumber: account_number,
        percentageCharge: gym.platform_commission_pct == null ? DEFAULT_PLATFORM_COMMISSION_PCT : Number(gym.platform_commission_pct),
      });
      if (!sub.ok) return { ok: false, error: `Bank saved, but connecting payouts failed: ${sub.error}` };
      const { error: scErr } = await supabase.from('gyms').update({ paystack_subaccount_code: sub.subaccountCode }).eq('id', gym.id);
      if (scErr) return { ok: false, error: scErr.message };
    }
    logAudit({ action: 'payout_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: { bank_name, last4: account_number.slice(-4) } });
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Platform-admin review of a pending payout change request. Approve writes the
// new bank into the gym row and (with Paystack keys) rebuilds the subaccount.
// Reject just marks the request rejected with an optional reason.
export type ReviewPayoutState = { ok: boolean; error: string | null };
export async function reviewPayoutRequest(_prev: ReviewPayoutState, formData: FormData): Promise<ReviewPayoutState> {
  const requestId = String(formData.get('request_id') ?? '');
  const decision = String(formData.get('decision') ?? ''); // 'approve' | 'reject'
  const allowNameMismatch = formData.get('allow_name_mismatch') === 'on';
  const rejectReason = String(formData.get('reject_reason') ?? '').trim() || null;
  if (!requestId || !['approve', 'reject'].includes(decision)) {
    return { ok: false, error: 'Missing or invalid decision.' };
  }
  try {
    const { requirePlatformAdmin } = await import('@/lib/auth/dal');
    const adminUser = await requirePlatformAdmin();
    const db = createAdminClient();

    const { data: req, error: rErr } = await db.from('payout_change_requests' as never).select('*').eq('id', requestId).maybeSingle();
    if (rErr || !req) return { ok: false, error: rErr?.message ?? 'Request not found.' };
    const r = req as unknown as {
      id: string; gym_id: string; bank_name: string; bank_code: string;
      account_number: string; account_name: string; name_matches: boolean; status: string;
    };
    if (r.status !== 'pending') return { ok: false, error: `This request is already ${r.status}.` };

    if (decision === 'reject') {
      const { error } = await db.from('payout_change_requests' as never).update({
        status: 'rejected', reject_reason: rejectReason, reviewed_by: adminUser.id, reviewed_at: new Date().toISOString(),
      } as never).eq('id', r.id);
      if (error) return { ok: false, error: error.message };
      logAudit({ action: 'payout_request_rejected', table: 'payout_change_requests', actorId: adminUser.id, gymId: r.gym_id, recordId: r.id, values: { reject_reason: rejectReason } });
      revalidatePath('/superadmin/payout-approvals');
      return { ok: true, error: null };
    }

    // Approve
    if (!r.name_matches && !allowNameMismatch) {
      return { ok: false, error: 'Account name doesn’t match the business name. Tick "allow name mismatch" to approve anyway.' };
    }
    const { data: gymRow, error: gErr } = await db.from('gyms').select('name, platform_commission_pct').eq('id', r.gym_id).maybeSingle();
    if (gErr || !gymRow) return { ok: false, error: gErr?.message ?? 'Gym not found.' };
    const commission = (gymRow as { platform_commission_pct: number | null }).platform_commission_pct;
    const gymName = (gymRow as { name: string }).name;

    const gymPatch: Record<string, unknown> = {
      bank_name: r.bank_name, bank_code: r.bank_code, account_number: r.account_number, account_name: r.account_name, payouts_locked: true,
    };
    if (allowNameMismatch) gymPatch.payout_name_match_override = true;
    const { error: uErr } = await db.from('gyms').update(gymPatch as never).eq('id', r.gym_id);
    if (uErr) return { ok: false, error: uErr.message };

    if (process.env.PAYSTACK_SECRET_KEY) {
      const sub = await createSubaccount({
        businessName: gymName,
        bankCode: r.bank_code,
        accountNumber: r.account_number,
        percentageCharge: commission == null ? DEFAULT_PLATFORM_COMMISSION_PCT : Number(commission),
      });
      if (!sub.ok) return { ok: false, error: `Bank saved, but connecting payouts failed: ${sub.error}` };
      const { error: scErr } = await db.from('gyms').update({ paystack_subaccount_code: sub.subaccountCode }).eq('id', r.gym_id);
      if (scErr) return { ok: false, error: scErr.message };
    }

    const { error: doneErr } = await db.from('payout_change_requests' as never).update({
      status: 'approved', allow_name_mismatch: allowNameMismatch, reviewed_by: adminUser.id, reviewed_at: new Date().toISOString(),
    } as never).eq('id', r.id);
    if (doneErr) return { ok: false, error: doneErr.message };

    logAudit({ action: 'payout_request_approved', table: 'payout_change_requests', actorId: adminUser.id, gymId: r.gym_id, recordId: r.id, values: { allow_name_mismatch: allowNameMismatch } });
    revalidatePath('/superadmin/payout-approvals');
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Update the gym's public profile. RLS gyms_update_owner_only restricts this to
// owners/managers of the gym.
export async function updateGym(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Gym name is required.' };
  // Amenities post as a comma-separated string; store as a trimmed, de-duped array.
  const amenities = Array.from(new Set(
    String(formData.get('amenities') ?? '').split(',').map((a) => a.trim()).filter(Boolean),
  )).slice(0, 30);
  // Social handles/URLs — keep only the platforms actually filled in. Stored as
  // entered (handle or full URL); the landing page normalizes each to a link.
  const SOCIAL_KEYS = ['instagram', 'facebook', 'x', 'tiktok', 'youtube', 'whatsapp'] as const;
  const social_links: Record<string, string> = {};
  for (const k of SOCIAL_KEYS) {
    const v = String(formData.get(`social_${k}`) ?? '').trim().slice(0, 200);
    if (v) social_links[k] = v;
  }
  // Curated Instagram posts — one permalink per line. Keep only well-formed
  // instagram.com post/reel/tv links (de-duped, capped) so the landing page's
  // official embed always has valid URLs to render.
  const instagram_posts = Array.from(new Set(
    String(formData.get('instagram_posts') ?? '')
      .split(/[\n,]+/).map((s) => s.trim())
      .filter((u) => /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/i.test(u)),
  )).slice(0, 6);
  const patch = {
    name,
    tagline: String(formData.get('tagline') ?? '').trim() || null,
    description: String(formData.get('description') ?? '').trim() || null,
    city: String(formData.get('city') ?? '').trim() || null,
    state: String(formData.get('state') ?? '').trim() || null,
    phone: String(formData.get('phone') ?? '').trim() || null,
    email: String(formData.get('email') ?? '').trim() || null,
    address: String(formData.get('address') ?? '').trim() || null,
    website: String(formData.get('website') ?? '').trim() || null,
    amenities,
    social_links,
    instagram_posts: instagram_posts.length ? instagram_posts : null,
  };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from('gyms').update(patch as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'gym_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: patch });
    try { revalidatePath('/admin/settings'); revalidatePath(`/g/${gym.slug}`); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Marketing/tracking + live-chat IDs for the public landing page. These are all
// public client-side identifiers (no secrets), validated to fixed shapes so the
// landing page can only ever interpolate a clean ID into a known script
// template — never raw markup. Empty fields clear that integration.
export async function updateMarketing(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const raw = {
    ga4: String(formData.get('ga4') ?? '').trim(),
    meta_pixel: String(formData.get('meta_pixel') ?? '').trim(),
    chat_provider: String(formData.get('chat_provider') ?? '').trim(),
    chat_id: String(formData.get('chat_id') ?? '').trim(),
  };
  // Validate each public ID's shape; reject rather than store something the
  // landing script can't use. All are optional.
  const integrations: Record<string, string> = {};
  if (raw.ga4) {
    if (!/^G-[A-Z0-9]{4,20}$/i.test(raw.ga4)) return { ok: false, error: 'Google Analytics ID should look like G-XXXXXXX.' };
    integrations.ga4 = raw.ga4.toUpperCase();
  }
  if (raw.meta_pixel) {
    if (!/^\d{6,20}$/.test(raw.meta_pixel)) return { ok: false, error: 'Meta Pixel ID should be the numeric ID (6–20 digits).' };
    integrations.meta_pixel = raw.meta_pixel;
  }
  if (raw.chat_provider && raw.chat_id) {
    if (raw.chat_provider !== 'crisp' && raw.chat_provider !== 'tawk') return { ok: false, error: 'Pick a supported live-chat provider.' };
    // Crisp: a UUID website ID. Tawk.to: "propertyId/widgetId" (hex segments).
    const ok = raw.chat_provider === 'crisp'
      ? /^[0-9a-f-]{20,40}$/i.test(raw.chat_id)
      : /^[0-9a-f]{16,30}\/[0-9a-z]{5,20}$/i.test(raw.chat_id);
    if (!ok) return { ok: false, error: raw.chat_provider === 'crisp' ? 'Crisp Website ID looks off — copy it from Crisp → Settings → Setup.' : 'Tawk.to ID should look like propertyId/widgetId.' };
    integrations.chat_provider = raw.chat_provider;
    integrations.chat_id = raw.chat_id;
  }
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const value = Object.keys(integrations).length ? integrations : null;
    const { error } = await supabase.from('gyms').update({ integrations: value } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'gym_integrations_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: integrations });
    try { revalidatePath('/admin/settings'); revalidatePath(`/g/${gym.slug}`); } catch { /* stale-cache tolerable */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Upload one or more photos to the gym's public gallery. Appends their public
// URLs to gyms.gallery_urls (capped). Owner/manager; mirrors uploadLogo's
// storage handling (gym-assets bucket, first path segment = gym id for RLS).
export async function uploadGymPhotos(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const files = formData.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: 'Choose at least one image to upload.' };
  for (const f of files) {
    if (!f.type.startsWith('image/')) return { ok: false, error: 'Every file must be an image.' };
    if (f.size > 3_000_000) return { ok: false, error: 'Each image must be under 3 MB.' };
  }
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const storage = storageWriter(supabase);
    const existing = ((gym as { gallery_urls?: string[] }).gallery_urls ?? []);
    if (existing.length + files.length > 12) {
      return { ok: false, error: `Gallery holds up to 12 photos — you have ${existing.length}.` };
    }
    const added: string[] = [];
    for (const file of files) {
      const ext = ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
      const path = `${gym.id}/gallery/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await storage.storage.from('gym-assets').upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) return { ok: false, error: upErr.message };
      added.push(storage.storage.from('gym-assets').getPublicUrl(path).data.publicUrl);
    }
    const { error } = await supabase.from('gyms').update({ gallery_urls: [...existing, ...added] } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'gym_photos_added', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: { count: added.length } });
    try { revalidatePath('/admin/settings'); revalidatePath(`/g/${gym.slug}`); } catch { /* tolerable */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Remove one photo from the gallery (by URL) and best-effort delete the object.
export async function removeGymPhoto(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const url = String(formData.get('url') ?? '').trim();
  if (!url) return { ok: false, error: 'Missing photo.' };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const existing = ((gym as { gallery_urls?: string[] }).gallery_urls ?? []);
    const next = existing.filter((u) => u !== url);
    const { error } = await supabase.from('gyms').update({ gallery_urls: next } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    // Best-effort storage cleanup — the path is everything after the bucket name.
    const marker = '/gym-assets/';
    const idx = url.indexOf(marker);
    if (idx !== -1) { try { await supabase.storage.from('gym-assets').remove([url.slice(idx + marker.length)]); } catch { /* leave the object */ } }
    logAudit({ action: 'gym_photo_removed', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id });
    try { revalidatePath('/admin/settings'); revalidatePath(`/g/${gym.slug}`); } catch { /* tolerable */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Save the gym's weekly business hours. Each day can have either a single
// "all day" row or up to 3 split rows (morning/afternoon/evening); the editor
// posts a "mode_<d>" for the day plus session-scoped open/close pairs. Delete
// + insert replaces the whole gym's rows so a session that was toggled off
// simply disappears.
export async function saveBusinessHours(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  type Session = 'all' | 'morning' | 'afternoon' | 'evening';
  type Row = { gym_id: string; day_of_week: number; open_time: string | null; close_time: string | null; is_closed: boolean; session: Session };
  const SPLIT_SESSIONS: Session[] = ['morning', 'afternoon', 'evening'];
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const rows: Row[] = [];
    for (let d = 0; d <= 6; d++) {
      const mode = String(formData.get(`mode_${d}`) ?? 'single'); // 'single' | 'split' | 'closed'
      if (mode === 'closed') {
        rows.push({ gym_id: gym.id, day_of_week: d, open_time: null, close_time: null, is_closed: true, session: 'all' });
        continue;
      }
      if (mode === 'split') {
        const dayRows: Row[] = [];
        for (const s of SPLIT_SESSIONS) {
          if (formData.get(`enabled_${d}_${s}`) !== 'on') continue;
          const open = String(formData.get(`open_${d}_${s}`) ?? '').trim();
          const close = String(formData.get(`close_${d}_${s}`) ?? '').trim();
          if (!/^\d{2}:\d{2}$/.test(open) || !/^\d{2}:\d{2}$/.test(close)) {
            return { ok: false, error: `Enter open and close times for every enabled session.` };
          }
          if (open >= close) {
            return { ok: false, error: `A session's close time must be after its open time.` };
          }
          dayRows.push({ gym_id: gym.id, day_of_week: d, open_time: open, close_time: close, is_closed: false, session: s });
        }
        if (!dayRows.length) {
          return { ok: false, error: `Enable at least one session for a split day, or mark it closed.` };
        }
        rows.push(...dayRows);
        continue;
      }
      // single (default) — one row for the whole day
      const open = String(formData.get(`open_${d}`) ?? '').trim();
      const close = String(formData.get(`close_${d}`) ?? '').trim();
      if (!open || !close) return { ok: false, error: `Set open and close times for every open day, or mark it closed.` };
      if (open >= close) return { ok: false, error: `Close time must be after open time.` };
      rows.push({ gym_id: gym.id, day_of_week: d, open_time: open, close_time: close, is_closed: false, session: 'all' });
    }
    const { error: delErr } = await supabase.from('business_hours').delete().eq('gym_id', gym.id);
    if (delErr) return { ok: false, error: delErr.message };
    const { error: insErr } = await supabase.from('business_hours').insert(rows as never);
    if (insErr) return { ok: false, error: insErr.message };
    logAudit({ action: 'business_hours_updated', table: 'business_hours', actorId: user.id, gymId: gym.id, recordId: gym.id });
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    revalidatePath(`/g/${gym.slug}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Toggle the three reminder channels the Settings → Notifications section
// renders. Cron / reminder writers check these flags before enqueueing.
// Owners/managers only.
export async function updateNotifications(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const patch = {
    notif_class_reminders:  formData.get('notif_class_reminders')  === 'on',
    notif_renewal_nudges:   formData.get('notif_renewal_nudges')   === 'on',
    notif_payment_receipts: formData.get('notif_payment_receipts') === 'on',
  };
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from('gyms').update(patch as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'notifications_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: patch });
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Upload a gym logo to the gym-assets bucket and save its public URL. The
// storage RLS requires the path's first segment to be the gym id.
export async function uploadLogo(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const file = formData.get('logo');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Choose an image to upload.' };
  if (!file.type.startsWith('image/')) return { ok: false, error: 'File must be an image.' };
  if (file.size > 2_000_000) return { ok: false, error: 'Image must be under 2 MB.' };
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    // Do the storage write with the service-role client. requireStaff has
    // already authorized the caller and the path is server-controlled
    // (`${gym.id}/…`), so this is safe — and it avoids the storage-RLS
    // "new row violates row-level security policy" that hits the user-scoped
    // client when its token doesn't reach the storage service.
    const storage = storageWriter(supabase);
    const ext = ((file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'png';
    const path = `${gym.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await storage.storage.from('gym-assets').upload(path, file, { contentType: file.type, upsert: true });
    if (upErr) return { ok: false, error: upErr.message };
    const { data: pub } = storage.storage.from('gym-assets').getPublicUrl(path);
    const { error } = await supabase.from('gyms').update({ logo_url: pub.publicUrl } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    try { revalidatePath('/dashboard', 'layout'); } catch { /* member-app cache is idempotent */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Toggle whether members can request a freeze themselves. Owners/managers only.
// Staff can always freeze manually from the member page regardless of this flag.
export async function updateFreezePolicy(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const enabled = formData.get('member_freeze_enabled') === 'on';
  try {
    const { user, gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    const { error } = await supabase.from('gyms').update({ member_freeze_enabled: enabled }).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    logAudit({ action: 'gym_updated', table: 'gyms', actorId: user.id, gymId: gym.id, recordId: gym.id, values: { member_freeze_enabled: enabled } });
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    revalidatePath('/dashboard/profile');
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

// Save the gym's accent colour (applied across the member app).
export async function updateBranding(_prev: GymSaveState, formData: FormData): Promise<GymSaveState> {
  const color = String(formData.get('brand_color') ?? '').trim();
  if (!HEX.test(color)) return { ok: false, error: 'Pick a valid colour.' };
  try {
    const { gym } = await requireStaff(MANAGER_ROLES);
    const supabase = await createClient();
    // brand_color isn't in the generated types yet — cast to keep tsc happy.
    const { error } = await supabase.from('gyms').update({ brand_color: color } as never).eq('id', gym.id);
    if (error) return { ok: false, error: error.message };
    try { revalidatePath('/admin/settings'); } catch { /* stale-cache tolerable — don't fail the action */ }
    try { revalidatePath('/dashboard', 'layout'); } catch { /* member-app cache is idempotent */ }
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
