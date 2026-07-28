import { createHash, timingSafeEqual } from 'crypto';
import { createClient as createSb } from '@supabase/supabase-js';
import { runReconciliation, type ReconcileSummary } from '@/lib/reconcile';
import { deliverRenewalReminder, inSlices, type NotifyGym } from '@/lib/notify';
import { firstName, fmt12Hr, fmtDate, watDateISO, watDayStartUtc } from '@/lib/format';
import { gymBillingState } from '@/lib/platform-plans';
import { memberAppUrl, platformAppUrl, sendGymEmail, sendPlatformEmail } from '@/lib/email/send';
import { adminOrNull, getContacts, getGymOwnerEmails, GYM_EMAIL_COLUMNS, type EmailGym } from '@/lib/email/recipients';
import { classesToday, freezeResumed, MEMBER_TEMPLATES, type ClassFacts } from '@/lib/email/templates/member';
import { trialEnded, trialEnding } from '@/lib/email/templates/platform';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Admin = NonNullable<ReturnType<typeof adminOrNull>>;

// Constant-time compare that doesn't leak length (hash both to a fixed width
// first) — guards the secret comparison against timing side-channels.
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Authorized via CRON_SECRET — Vercel Cron sends it as a Bearer token. The
// query-string form (?secret=) remains as a fallback for external schedulers
// that can't set headers; prefer the header in production since query strings
// land in access/proxy logs.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth && safeEqual(auth, `Bearer ${secret}`)) return true;
  const qs = new URL(req.url).searchParams.get('secret');
  return qs != null && safeEqual(qs, secret);
}

/** The WAT calendar date `offset` days from now. Day boundaries are Lagos ones
 *  everywhere in this route — the server clock is UTC, an hour behind. */
const watDay = (offset: number): string => watDateISO(new Date(Date.now() + offset * 86_400_000));

/**
 * Gym branding + member contact details for a fan-out, in two round trips.
 *
 * Both member fan-outs below need exactly this pair, and doing it per row is
 * the N+1 the renewal branch above had to be rewritten out of. GYM_EMAIL_COLUMNS
 * rather than the notif_* toggles alone: these messages carry the gym's logo,
 * colour and subdomain, and a narrow select quietly posts them dressed as
 * GymFlow with links pointing at the wrong host.
 */
async function emailTargets(admin: Admin, gymIds: string[], memberIds: string[]) {
  const [{ data: gyms }, contacts] = await Promise.all([
    admin.from('gyms').select(GYM_EMAIL_COLUMNS).in('id', [...new Set(gymIds)]),
    getContacts(admin, memberIds),
  ]);
  return {
    gymById: new Map(((gyms ?? []) as unknown as EmailGym[]).map((g) => [g.id, g])),
    contactById: new Map(contacts.map((c) => [c.id, c])),
  };
}

/** gyms.name is nullable and holds blanks from early imports; "your membership
 *  at  ends today" is worse than a generic noun. */
const gymNameOf = (gym: { name?: string | null }): string => (gym.name ?? '').trim() || 'Your gym';

/** Gyms whose trial_ends_at falls inside a WAT calendar-day window. */
function trialsEndingBetween(admin: Admin, fromDay: string, toDay: string) {
  return admin.from('gyms')
    .select('id, name, trial_ends_at, subscription_status, subscription_current_period_end')
    .gte('trial_ends_at', watDayStartUtc(fromDay))
    .lt('trial_ends_at', watDayStartUtc(toDay));
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  // adminOrNull rather than createAdminClient: the service-role key is absent in
  // preview environments and this route must degrade to the keep-warm ping
  // rather than 500.
  const admin = adminOrNull();

  // Keep-warm: a cheap query so the (free-tier) Supabase project doesn't pause.
  const warm = admin ?? createSb(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await warm.from('gyms').select('id', { head: true, count: 'exact' });

  // Renewal reminders — needs service role (writes notifications across users).
  let remindersCreated = 0;
  if (admin) {
    const today = new Date().toISOString().slice(0, 10);
    const in3 = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();

    const { data: subs } = await admin.from('member_subscriptions')
      .select('id, member_id, gym_id, end_date')
      .eq('status', 'active').gte('end_date', today).lte('end_date', in3);

    const due = (subs ?? []).filter((s) => s.member_id && s.end_date);
    if (due.length) {
      // Batch the dedup into ONE query (was a SELECT per subscription → N+1 that
      // could exceed the 60s budget on large platforms), then bulk-insert.
      const { data: dupes } = await admin.from('notifications')
        .select('user_id, metadata->>subscription_id')
        .eq('type', 'warning').gte('created_at', cutoff)
        .in('user_id', due.map((s) => s.member_id as string));
      const seen = new Set(
        (dupes ?? []).map((d: { user_id: string | null; subscription_id?: string | null }) => `${d.user_id}:${d.subscription_id}`),
      );
      const rows = due
        .filter((s) => !seen.has(`${s.member_id}:${s.id}`))
        .map((s) => {
          const days = Math.max(0, Math.ceil((new Date(s.end_date as string).getTime() - Date.now()) / 86_400_000));
          return {
            gym_id: s.gym_id, user_id: s.member_id, type: 'warning' as const, channel: 'in_app' as const,
            title: 'Membership expiring soon',
            body: `Your membership ends in ${days} day${days === 1 ? '' : 's'}. Renew to keep training.`,
            metadata: { kind: 'renewal_reminder', subscription_id: s.id },
          };
        });
      if (rows.length) {
        const { error } = await admin.from('notifications').insert(rows);
        if (!error) {
          remindersCreated = rows.length;
          // External fan-out (email all tiers, WhatsApp Growth+ — lib/notify
          // applies the per-gym toggles). Batched contact + gym lookups, then
          // bounded-parallel delivery capped so the run stays inside the 60s
          // budget even on a big platform day.
          const fresh = due.filter((s) => !seen.has(`${s.member_id}:${s.id}`)).slice(0, 200);
          const gymIds = [...new Set(fresh.map((s) => s.gym_id as string))];
          const [{ data: contacts }, { data: gyms }] = await Promise.all([
            admin.from('profiles').select('id, email, phone, full_name').in('id', fresh.map((s) => s.member_id as string)),
            admin.from('gyms').select('id, name, subscription_plan, notif_renewal_nudges').in('id', gymIds),
          ]);
          const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
          const gymById = new Map(((gyms ?? []) as unknown as NotifyGym[]).map((g) => [g.id, g]));
          await inSlices(fresh, 10, async (s) => {
            const c = contactById.get(s.member_id as string);
            const g = gymById.get(s.gym_id as string);
            if (!c || !g) return;
            const days = Math.max(0, Math.ceil((new Date(s.end_date as string).getTime() - Date.now()) / 86_400_000));
            await deliverRenewalReminder(g, { email: c.email, phone: c.phone, fullName: c.full_name }, { days, endDate: s.end_date });
          });
        }
      }
    }
  }

  // Trial expiry, GymFlow-branded, to the gym's owners. Two beats: a warning
  // three days out while a plan can still be picked without anything locking,
  // and the notice once the console already has. Each bucket is one WAT
  // calendar day wide and this job runs once a day, so a gym lands in each at
  // most once — no send-ledger needed.
  //
  // gymBillingState is what decides eligibility, not trial_ends_at alone: the
  // column keeps its signup value after a gym subscribes, so filtering on dates
  // by themselves nags paying customers about a trial they left months ago.
  let trialNoticesSent = 0;
  if (admin && process.env.RESEND_API_KEY) {
    try {
      const stamp = watDay(0);
      const billingUrl = platformAppUrl('/admin/billing');
      const [{ data: ending }, { data: ended }] = await Promise.all([
        trialsEndingBetween(admin, watDay(3), watDay(4)),
        // Yesterday's bucket, not "any time before now": a trial ending at 22:00
        // Lagos today has not passed at the 09:00 run, and would otherwise be
        // declared over fourteen hours early.
        trialsEndingBetween(admin, watDay(-1), watDay(0)),
      ]);

      type TrialGym = NonNullable<typeof ending>[number];
      const notices: Array<{ gym: TrialGym; kind: 'ending' | 'ended' }> = [
        ...(ending ?? []).filter((g) => gymBillingState(g) === 'trial').map((gym) => ({ gym, kind: 'ending' as const })),
        ...(ended ?? []).filter((g) => gymBillingState(g) === 'trial_expired').map((gym) => ({ gym, kind: 'ended' as const })),
      ];

      await inSlices(notices, 5, async ({ gym, kind }) => {
        const to = await getGymOwnerEmails(admin, gym.id);
        if (to.length === 0) return;
        const gymName = gymNameOf(gym);
        const trialEndDate = fmtDate(gym.trial_ends_at);
        const res = await sendPlatformEmail({
          to,
          ...(kind === 'ending'
            // Exactly 3: the bucket IS the calendar day three days out, so the
            // countdown in the subject line can't drift from the date below it.
            ? trialEnding({ gymName, daysLeft: 3, trialEndDate, billingUrl })
            : trialEnded({ gymName, trialEndDate, billingUrl })),
          template: kind === 'ending' ? 'trial_ending' : 'trial_ended',
          // A manual re-run of this route on the same day must not mail the same
          // owner twice; Resend drops the duplicate on the key.
          idempotencyKey: `trial_${kind}:${gym.id}:${stamp}`,
        });
        if (res.ok) trialNoticesSent++;
      });
    } catch { /* one branch failing must not abort the rest of the run */ }
  }

  // Today's classes, gym-branded, to the members holding a seat.
  //
  // This is the first reader gyms.notif_class_reminders has ever had — the
  // switch has been in Settings since launch with nothing behind it, so an
  // owner could toggle it and change nothing. The gate itself stays where it
  // belongs: sendGymEmail, via category 'classes'.
  //
  // vercel.json schedules this route once a day at 08:00 UTC (09:00
  // Africa/Lagos), so the "1 hour before class" the Settings copy promises is
  // not reachable from here without a second, hourly cron entry. This ships as
  // a morning digest deliberately: one mail listing everything you booked today
  // is what a daily job can honestly deliver, and it beats the nothing that
  // shipped before it.
  let classDigestsSent = 0;
  if (admin && process.env.RESEND_API_KEY) {
    try {
      const today = watDateISO();
      const { data: bookings } = await admin.from('class_bookings')
        .select('member_id, gym_id, class_schedule_id')
        .eq('booking_date', today).eq('status', 'booked')
        .limit(2000);
      const held = (bookings ?? []).filter((b) => b.member_id && b.gym_id && b.class_schedule_id);

      if (held.length) {
        // Name, instructor and room live two tables away from the booking, both
        // fetched in one batch each rather than per seat.
        const { data: scheds } = await admin.from('class_schedules')
          .select('id, class_id, start_time, room')
          .in('id', [...new Set(held.map((b) => b.class_schedule_id as string))]);
        const schedById = new Map((scheds ?? []).map((s) => [s.id, s]));
        const { data: classes } = await admin.from('classes')
          .select('id, name, instructor')
          .in('id', [...new Set((scheds ?? []).map((s) => s.class_id).filter(Boolean) as string[])]);
        const classById = new Map((classes ?? []).map((c) => [c.id, c]));

        // Sorted on the raw column, before display formatting: start_time is 24h
        // 'HH:MM:SS' so lexical order is chronological, whereas the "6:00 AM"
        // the member reads sorts the afternoon above the morning.
        const startOf = (scheduleId: string): string => schedById.get(scheduleId)?.start_time ?? '';
        const ordered = held
          .filter((b) => schedById.has(b.class_schedule_id as string))
          .sort((a, b) => startOf(a.class_schedule_id as string).localeCompare(startOf(b.class_schedule_id as string)));

        // One digest per member, not one per booking: someone with three classes
        // today gets their day, not three separate emails.
        const byMember = new Map<string, { gymId: string; classes: ClassFacts[] }>();
        for (const b of ordered) {
          const sched = schedById.get(b.class_schedule_id as string)!;
          const cls = sched.class_id ? classById.get(sched.class_id) : null;
          const entry = byMember.get(b.member_id as string) ?? { gymId: b.gym_id as string, classes: [] };
          entry.classes.push({
            className: cls?.name ?? 'Class',
            time: fmt12Hr(sched.start_time),
            instructor: cls?.instructor ?? null,
            location: sched.room ?? null,
          });
          byMember.set(b.member_id as string, entry);
        }

        // Capped for the same reason the renewal fan-out is: this branch shares
        // a 60s budget with everything below it.
        const digests = [...byMember.entries()].filter(([, d]) => d.classes.length > 0).slice(0, 500);
        const { gymById, contactById } = await emailTargets(admin, digests.map(([, d]) => d.gymId), digests.map(([id]) => id));
        const spec = MEMBER_TEMPLATES.classesToday;

        await inSlices(digests, 5, async ([memberId, d]) => {
          const gym = gymById.get(d.gymId);
          const contact = contactById.get(memberId);
          if (!gym || !contact?.email) return;
          const res = await sendGymEmail({
            gym,
            to: { email: contact.email, fullName: contact.fullName, wantsEmail: contact.wantsEmail },
            template: spec.template,
            category: spec.category,
            ...classesToday({
              gymName: gymNameOf(gym),
              firstName: firstName(contact.fullName),
              classes: d.classes,
              classesUrl: memberAppUrl(gym, '/classes'),
            }),
            idempotencyKey: `classes_today:${memberId}:${today}`,
          });
          if (res.ok) classDigestsSent++;
        });
      }
    } catch { /* the digest is a bonus channel; never abort the run for it */ }
  }

  // Auto-resume freezes whose scheduled window has ended: restore status and
  // credit the frozen days (pause_start → pause_end) to end_date so the member
  // gets back exactly the time they were paused.
  let freezesResumed = 0;
  const resumed: Array<{ gymId: string; memberId: string; daysCredited: number; newEndDate: string }> = [];
  if (admin) {
    const today = new Date().toISOString().slice(0, 10);
    // gym_id and member_id ride along so the member can be told. Without them
    // this was the one membership state change that reached nobody: the
    // turnstile started working again and the member found out by trying it.
    const { data: due } = await admin.from('member_subscriptions')
      .select('id, gym_id, member_id, end_date, pause_start, pause_end')
      .eq('status', 'paused').not('pause_end', 'is', null).lte('pause_end', today);
    for (const s of due ?? []) {
      const start = s.pause_start ?? s.pause_end!;
      const days = Math.max(0, Math.round((Date.parse(s.pause_end! + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86_400_000));
      const base = new Date((s.end_date ?? today) + 'T00:00:00Z');
      base.setUTCDate(base.getUTCDate() + days);
      const newEndDate = base.toISOString().slice(0, 10);
      const { error } = await admin.from('member_subscriptions')
        .update({ status: 'active', paused_at: null, pause_reason: null, pause_start: null, pause_end: null, end_date: newEndDate })
        .eq('id', s.id);
      if (!error) {
        freezesResumed++;
        if (s.gym_id && s.member_id) resumed.push({ gymId: s.gym_id, memberId: s.member_id, daysCredited: days, newEndDate });
      }
    }
  }

  // The freeze is over and the days are back on the end date — say so. Runs
  // after the writes above, never instead of them: the membership is already
  // active whether or not any of this delivers.
  let freezeNoticesSent = 0;
  if (admin && resumed.length && process.env.RESEND_API_KEY) {
    try {
      const { gymById, contactById } = await emailTargets(admin, resumed.map((r) => r.gymId), resumed.map((r) => r.memberId));
      const spec = MEMBER_TEMPLATES.freezeResumed;
      await inSlices(resumed, 5, async (r) => {
        const gym = gymById.get(r.gymId);
        const contact = contactById.get(r.memberId);
        if (!gym || !contact?.email) return;
        const res = await sendGymEmail({
          gym,
          to: { email: contact.email, fullName: contact.fullName, wantsEmail: contact.wantsEmail },
          template: spec.template,
          category: spec.category,
          ...freezeResumed({
            gymName: gymNameOf(gym),
            firstName: firstName(contact.fullName),
            daysCredited: r.daysCredited,
            newEndDate: fmtDate(r.newEndDate),
            classesUrl: memberAppUrl(gym, '/classes'),
          }),
          idempotencyKey: `freeze_resumed:${r.memberId}:${r.newEndDate}`,
        });
        if (res.ok) freezeNoticesSent++;
      });
    } catch { /* the resume already happened; the mail is best-effort */ }
  }

  // Auto-close stale visits: a member who forgot to check out shouldn't
  // stay "in gym" indefinitely (breaks the front desk's "in gym now" count
  // and stops them re-entering the next day). Cap the session at 6h from
  // check-in so session-length analytics aren't skewed by wall-clock delta.
  let staleVisitsClosed = 0;
  if (admin) {
    const sixHoursAgoIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await admin.from('check_ins')
      .select('id, checked_in_at')
      .eq('status', 'active').is('checked_out_at', null).lt('checked_in_at', sixHoursAgoIso)
      .limit(500);
    for (const v of stale ?? []) {
      if (!v.checked_in_at) continue;
      const closedAt = new Date(new Date(v.checked_in_at).getTime() + 6 * 60 * 60 * 1000).toISOString();
      const { error } = await admin.from('check_ins')
        .update({ checked_out_at: closedAt, status: 'completed' })
        .eq('id', v.id).is('checked_out_at', null);
      if (!error) staleVisitsClosed++;
    }
  }

  // Paystack ↔ DB reconciliation: flag charges whose webhook was dropped and
  // resolve payouts stuck in 'approved'. No-ops without PAYSTACK_SECRET_KEY.
  let reconciliation: ReconcileSummary | null = null;
  if (admin) reconciliation = await runReconciliation();

  // Housekeeping: rate-limit windows are minutes-to-hours; anything older
  // than 2 days is dead weight. Webhook replay-ledger rows matter only while
  // Paystack could still retry the same body — 30 days is far beyond that.
  // Best-effort.
  if (admin) {
    const stale = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await admin.from('rate_limits').delete().lt('window_start', stale);
    const ledgerStale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    await admin.from('webhook_events' as never).delete().lt('received_at', ledgerStale);
  }

  // Resend's delivery ledger: ops telemetry that answers "did the receipt
  // actually leave?" while someone is still asking, and dead weight after that.
  // It grows with send volume, so 90 days. Kept here rather than in Postgres
  // by the migration that created the table, next to the sweeps above.
  if (admin) {
    try {
      const eventsStale = new Date(Date.now() - 90 * 86_400_000).toISOString();
      await admin.from('email_events' as never).delete().lt('created_at', eventsStale);
    } catch { /* housekeeping never fails the run */ }
  }

  return Response.json({
    ok: true, warmed: true, serviceRole: Boolean(admin),
    remindersCreated, trialNoticesSent, classDigestsSent, freezesResumed, freezeNoticesSent, staleVisitsClosed,
    reconciliation,
  });
}
