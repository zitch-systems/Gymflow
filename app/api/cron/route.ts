import { createHash, timingSafeEqual } from 'crypto';
import { createClient as createSb } from '@supabase/supabase-js';
import { deliverRenewalReminder, inSlices, type NotifyGym } from '@/lib/notify';
import { expireStaleIntents } from '@/lib/whatsapp/payments';
import { firstName, fmt12Hr, fmtDate, watDateISO, watDayStartUtc } from '@/lib/format';
import { gymBillingState } from '@/lib/platform-plans';
import { memberAppUrl, platformAppUrl, sendGymEmail, sendPlatformEmail } from '@/lib/email/send';
import { adminOrNull, getContacts, getGymOwnerEmails, GYM_EMAIL_COLUMNS, type EmailGym } from '@/lib/email/recipients';
import { classesToday, freezeResumed, MEMBER_TEMPLATES, type ClassFacts } from '@/lib/email/templates/member';
import { trialEnded, trialEnding } from '@/lib/email/templates/platform';
import { OFFLINE_GYM_FILTER } from '@/lib/gym-status';
import { markJobFailed, markJobStarted, markJobSucceeded } from '@/lib/operational-jobs';

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

// Authorized via CRON_SECRET — Vercel Cron sends it as a Bearer token.
// Secrets in query strings leak into access/proxy logs and browser history, so
// this endpoint deliberately has no ?secret= fallback.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth != null && safeEqual(auth, `Bearer ${secret}`);
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
  const [{ data: gyms, error: gymsError }, contacts] = await Promise.all([
    // Offline gyms drop out of the map here, and every fan-out below already
    // skips a member whose gym is missing (`if (!gym ...) return`). That makes
    // this one filter the choke point for the whole route: a gym GymFlow has
    // switched off stops sending mail dressed in its own logo, colour and
    // subdomain — a subdomain whose landing page now 404s.
    admin.from('gyms').select(GYM_EMAIL_COLUMNS).in('id', [...new Set(gymIds)])
      .not('status', 'in', OFFLINE_GYM_FILTER),
    getContacts(admin, memberIds),
  ]);
  if (gymsError) throw new Error(`Email gym lookup failed: ${gymsError.message}`);
  return {
    gymById: new Map(((gyms ?? []) as unknown as EmailGym[]).map((g) => [g.id, g])),
    contactById: new Map(contacts.map((c) => [c.id, c])),
  };
}

/** gyms.name is nullable and holds blanks from early imports; "your membership
 *  at  ends today" is worse than a generic noun. */
const gymNameOf = (gym: { name?: string | null }): string => (gym.name ?? '').trim() || 'Your gym';

/** Gyms whose trial_ends_at falls inside a WAT calendar-day window.
 *
 *  Switched-off gyms are excluded: this drives the "your trial ends tomorrow,
 *  subscribe to keep going" notice, and a gym GymFlow has suspended cannot pay
 *  its way back in — that is the whole difference between SuspendedWall and
 *  BillingWall. Sending it the checkout nudge anyway is a false promise. */
function trialsEndingBetween(admin: Admin, fromDay: string, toDay: string) {
  return admin.from('gyms')
    .select('id, name, trial_ends_at, subscription_status, subscription_current_period_end')
    .not('status', 'in', OFFLINE_GYM_FILTER)
    .gte('trial_ends_at', watDayStartUtc(fromDay))
    .lt('trial_ends_at', watDayStartUtc(toDay));
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });

  // adminOrNull rather than createAdminClient: the service-role key is absent in
  // preview environments and this route must degrade to the keep-warm ping
  // rather than 500.
  const admin = adminOrNull();
  let bestEffortWarnings = 0;
  try {
    if (admin) await markJobStarted(admin, 'notifications');

  // Keep-warm: a cheap query so the (free-tier) Supabase project doesn't pause.
  const warm = admin ?? createSb(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  // gym-status: n/a — a head-only row count to stop the project auto-pausing.
  // It resolves no gym and reads no column, so filtering it would mean nothing.
  const { error: warmError } = await warm.from('gyms').select('id', { head: true, count: 'exact' });
  if (warmError) throw new Error(`Keep-warm query failed: ${warmError.message}`);

  // Renewal reminders — needs service role (writes notifications across users).
  let remindersCreated = 0;
  if (admin) {
    // watDay (defined above, and already used by the class-reminder block) —
    // end_date is a WAT date-only column, so a UTC "today" silently drops
    // memberships expiring today whenever this runs after 23:00 UTC.
    const today = watDay(0);
    const in3 = watDay(3);
    const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();

    const { data: subs, error: subsError } = await admin.from('member_subscriptions')
      .select('id, member_id, gym_id, end_date')
      .eq('status', 'active').gte('end_date', today).lte('end_date', in3);
    if (subsError) throw new Error(`Renewal scan failed: ${subsError.message}`);

    const due = (subs ?? []).filter((s) => s.member_id && s.end_date);
    if (due.length) {
      // Batch the dedup into ONE query (was a SELECT per subscription → N+1 that
      // could exceed the 60s budget on large platforms), then bulk-insert.
      const { data: dupes, error: dupesError } = await admin.from('notifications')
        .select('user_id, metadata->>subscription_id')
        .eq('type', 'warning').gte('created_at', cutoff)
        .in('user_id', due.map((s) => s.member_id as string));
      if (dupesError) throw new Error(`Renewal deduplication failed: ${dupesError.message}`);
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
        // Resolve delivery prerequisites before claiming the reminder in the
        // dedupe ledger. A failed lookup can then be retried on the next run.
        const fresh = due.filter((s) => !seen.has(`${s.member_id}:${s.id}`)).slice(0, 200);
        const gymIds = [...new Set(fresh.map((s) => s.gym_id as string))];
        const [{ data: contacts, error: contactsError }, { data: gyms, error: gymsError }] = await Promise.all([
          admin.from('profiles').select('id, email, phone, full_name, notification_email').in('id', fresh.map((s) => s.member_id as string)),
          admin.from('gyms').select(GYM_EMAIL_COLUMNS).in('id', gymIds).not('status', 'in', OFFLINE_GYM_FILTER),
        ]);
        if (contactsError) throw new Error(`Renewal contact lookup failed: ${contactsError.message}`);
        if (gymsError) throw new Error(`Renewal gym lookup failed: ${gymsError.message}`);

        const { error } = await admin.from('notifications').insert(rows);
        if (error) throw new Error(`Renewal notification write failed: ${error.message}`);
        {
          remindersCreated = rows.length;
          // External fan-out (email all tiers, WhatsApp Growth+ — lib/notify
          // applies the per-gym toggles). Batched contact + gym lookups, then
          // bounded-parallel delivery capped so the run stays inside the 60s
          // budget even on a big platform day.
          const contactById = new Map((contacts ?? []).map((c) => [c.id, c]));
          const gymById = new Map(((gyms ?? []) as unknown as NotifyGym[]).map((g) => [g.id, g]));
          await inSlices(fresh, 10, async (s) => {
            const c = contactById.get(s.member_id as string);
            const g = gymById.get(s.gym_id as string);
            if (!c || !g) return;
            const days = Math.max(0, Math.ceil((new Date(s.end_date as string).getTime() - Date.now()) / 86_400_000));
            await deliverRenewalReminder(
              g,
              // memberId is what lets the reminder go out over the WhatsApp
              // Cloud API into the member's existing thread rather than the
              // plain Termii fallback.
              { email: c.email, phone: c.phone, fullName: c.full_name, memberId: c.id, wantsEmail: c.notification_email },
              { days, endDate: s.end_date },
            );
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
      const [{ data: ending, error: endingError }, { data: ended, error: endedError }] = await Promise.all([
        trialsEndingBetween(admin, watDay(3), watDay(4)),
        // Yesterday's bucket, not "any time before now": a trial ending at 22:00
        // Lagos today has not passed at the 09:00 run, and would otherwise be
        // declared over fourteen hours early.
        trialsEndingBetween(admin, watDay(-1), watDay(0)),
      ]);
      if (endingError || endedError) throw new Error('Trial notice scan failed');

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
    } catch { bestEffortWarnings++; }
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
      const { data: bookings, error: bookingsError } = await admin.from('class_bookings')
        .select('member_id, gym_id, class_schedule_id')
        .eq('booking_date', today).eq('status', 'booked')
        .limit(2000);
      if (bookingsError) throw new Error('Class digest booking scan failed');
      const held = (bookings ?? []).filter((b) => b.member_id && b.gym_id && b.class_schedule_id);

      if (held.length) {
        // Name, instructor and room live two tables away from the booking, both
        // fetched in one batch each rather than per seat.
        const { data: scheds, error: schedsError } = await admin.from('class_schedules')
          .select('id, gym_id, class_id, start_time, room')
          .in('id', [...new Set(held.map((b) => b.class_schedule_id as string))]);
        if (schedsError) throw new Error('Class digest schedule lookup failed');
        const schedById = new Map((scheds ?? []).map((s) => [s.id, s]));
        const { data: classes, error: classesError } = await admin.from('classes')
          .select('id, gym_id, name, instructor')
          .in('id', [...new Set((scheds ?? []).map((s) => s.class_id).filter(Boolean) as string[])]);
        if (classesError) throw new Error('Class digest class lookup failed');
        const classById = new Map((classes ?? []).map((c) => [c.id, c]));

        // Sorted on the raw column, before display formatting: start_time is 24h
        // 'HH:MM:SS' so lexical order is chronological, whereas the "6:00 AM"
        // the member reads sorts the afternoon above the morning.
        const startOf = (scheduleId: string): string => schedById.get(scheduleId)?.start_time ?? '';
        const ordered = held
          .filter((b) => schedById.get(b.class_schedule_id as string)?.gym_id === b.gym_id)
          .sort((a, b) => startOf(a.class_schedule_id as string).localeCompare(startOf(b.class_schedule_id as string)));

        // One digest per member, not one per booking: someone with three classes
        // today gets their day, not three separate emails.
        const byMemberGym = new Map<string, { memberId: string; gymId: string; classes: ClassFacts[] }>();
        for (const b of ordered) {
          const sched = schedById.get(b.class_schedule_id as string)!;
          const candidate = sched.class_id ? classById.get(sched.class_id) : null;
          const cls = candidate?.gym_id === b.gym_id ? candidate : null;
          const memberId = b.member_id as string;
          const gymId = b.gym_id as string;
          const key = `${memberId}:${gymId}`;
          const entry = byMemberGym.get(key) ?? { memberId, gymId, classes: [] };
          entry.classes.push({
            className: cls?.name ?? 'Class',
            time: fmt12Hr(sched.start_time),
            instructor: cls?.instructor ?? null,
            location: sched.room ?? null,
          });
          byMemberGym.set(key, entry);
        }

        // Capped for the same reason the renewal fan-out is: this branch shares
        // a 60s budget with everything below it.
        const digests = [...byMemberGym.values()].filter((d) => d.classes.length > 0).slice(0, 500);
        const { gymById, contactById } = await emailTargets(admin, digests.map((d) => d.gymId), digests.map((d) => d.memberId));
        const spec = MEMBER_TEMPLATES.classesToday;

        await inSlices(digests, 5, async (d) => {
          const { memberId } = d;
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
            idempotencyKey: `classes_today:${memberId}:${d.gymId}:${today}`,
          });
          if (res.ok) classDigestsSent++;
        });
      }
    } catch { bestEffortWarnings++; }
  }

  // Auto-resume freezes whose scheduled window has ended. The RPC owns the
  // WAT calendar calculation, member-term lock, paid-coverage shift and audit;
  // using the same path as staff resume prevents a cron/payment race from
  // granting or losing days.
  let freezesResumed = 0;
  const resumed: Array<{ gymId: string; memberId: string; daysCredited: number; newEndDate: string }> = [];
  if (admin) {
    // watDay, matching the rest of this route — pause_end is a WAT date-only
    // column, so a UTC "today" resumes a freeze a day early or late.
    const today = watDay(0);
    const { data: due, error: dueError } = await admin.from('member_subscriptions')
      .select('id, gym_id')
      .eq('status', 'paused').not('pause_end', 'is', null).lte('pause_end', today)
      .order('pause_end', { ascending: true }).limit(200);
    if (dueError) throw new Error(`Automatic freeze scan failed: ${dueError.message}`);
    for (const s of due ?? []) {
      const { data, error } = await admin.rpc('resume_member_freeze' as never, {
        p_gym_id: s.gym_id,
        p_subscription_id: s.id,
      } as never);
      if (error) throw new Error(`Automatic freeze resume failed for ${s.id}: ${error.message}`);
      const result = data as unknown as {
        created: boolean; member_id: string; end_date: string; days_credited: number;
      } | null;
      if (!result?.created) continue;
      freezesResumed++;
      resumed.push({
        gymId: s.gym_id,
        memberId: result.member_id,
        daysCredited: result.days_credited,
        newEndDate: result.end_date,
      });
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
    } catch { bestEffortWarnings++; }
  }

  // Auto-close stale visits: a member who forgot to check out shouldn't
  // stay "in gym" indefinitely (breaks the front desk's "in gym now" count
  // and stops them re-entering the next day). Cap the session at 6h from
  // check-in so session-length analytics aren't skewed by wall-clock delta.
  let staleVisitsClosed = 0;
  if (admin) {
    const sixHoursAgoIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: stale, error: staleError } = await admin.from('check_ins')
      .select('id, checked_in_at')
      .eq('status', 'active').is('checked_out_at', null).lt('checked_in_at', sixHoursAgoIso)
      .limit(500);
    if (staleError) throw new Error(`Stale visit scan failed: ${staleError.message}`);
    for (const v of stale ?? []) {
      if (!v.checked_in_at) continue;
      const closedAt = new Date(new Date(v.checked_in_at).getTime() + 6 * 60 * 60 * 1000).toISOString();
      const { error } = await admin.from('check_ins')
        .update({ checked_out_at: closedAt, status: 'completed' })
        .eq('id', v.id).is('checked_out_at', null);
      if (error) throw new Error(`Stale visit close failed: ${error.message}`);
      staleVisitsClosed++;
    }
  }

  // Housekeeping: rate-limit windows are minutes-to-hours; anything older
  // than 2 days is dead weight. Webhook replay-ledger rows matter only while
  // Paystack could still retry the same body — 30 days is far beyond that.
  // Best-effort.
  if (admin) {
    const stale = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const { error: rateLimitError } = await admin.from('rate_limits').delete().lt('window_start', stale);
    if (rateLimitError) bestEffortWarnings++;
    const ledgerStale = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { error: webhookGcError } = await admin.from('webhook_events' as never).delete().lt('received_at', ledgerStale);
    if (webhookGcError) bestEffortWarnings++;

    // Two-factor leftovers. A challenge is dead 10 minutes after it is issued
    // and a trusted device at its expiry; both are kept a day past that purely
    // so an "it logged me out early" report can still be checked, then dropped.
    // Expired rows are already inert — judgeChallenge and hasTrustedDevice
    // both test expiry — so this is hygiene, not enforcement.
    const authStale = new Date(Date.now() - 86_400_000).toISOString();
    try {
      const [{ error: challengeGcError }, { error: deviceGcError }] = await Promise.all([
        admin.from('auth_challenges' as never).delete().lt('expires_at', authStale),
        admin.from('trusted_devices' as never).delete().lt('expires_at', authStale),
      ]);
      if (challengeGcError || deviceGcError) bestEffortWarnings++;
    } catch { bestEffortWarnings++; }
  }

  // Resend's delivery ledger: ops telemetry that answers "did the receipt
  // actually leave?" while someone is still asking, and dead weight after that.
  // It grows with send volume, so 90 days. Kept here rather than in Postgres
  // by the migration that created the table, next to the sweeps above.
  if (admin) {
    try {
      const eventsStale = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const { error } = await admin.from('email_events' as never).delete().lt('created_at', eventsStale);
      if (error) bestEffortWarnings++;
    } catch { bestEffortWarnings++; }
  }

  // WhatsApp housekeeping. Checkouts that were started and never finished are
  // marked abandoned so the gym's WhatsApp tab shows the truth rather than an
  // ever-growing list of things that look in-flight; expired Flow sessions and
  // spent email codes are deleted outright — a resumable half-open signup is
  // exactly what should not survive the hour it was issued in.
  let intentsExpired = 0;
  if (admin) {
    try {
      intentsExpired = await expireStaleIntents(admin);
      const now = new Date().toISOString();
      const { error: flowGcError } = await admin.from('whatsapp_flow_sessions').delete().lt('expires_at', now);
      const { error: otpGcError } = await admin.from('whatsapp_email_otps').delete().lt('expires_at', now);
      // The message log is a support tool, not an archive. 180 days keeps a
      // full season of context without holding members' conversations forever.
      const msgStale = new Date(Date.now() - 180 * 86_400_000).toISOString();
      const { error: messageGcError } = await admin.from('whatsapp_messages').delete().lt('created_at', msgStale);
      if (flowGcError || otpGcError || messageGcError) bestEffortWarnings++;
    } catch { bestEffortWarnings++; }
  }

  if (admin) await markJobSucceeded(admin, 'notifications');
  return Response.json({
    ok: true, warmed: true, serviceRole: Boolean(admin),
    remindersCreated, trialNoticesSent, classDigestsSent, freezesResumed, freezeNoticesSent, staleVisitsClosed,
    intentsExpired, bestEffortWarnings,
  });
  } catch (error) {
    if (admin) await markJobFailed(admin, 'notifications', error).catch(() => undefined);
    return Response.json({ ok: false, error: 'notification cron failed', bestEffortWarnings }, { status: 500 });
  }
}
