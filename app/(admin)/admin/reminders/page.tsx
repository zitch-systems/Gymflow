import { Clock, MessageCircle, Reply, Zap, Mail } from 'lucide-react';
import { requireStaff } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import { daysLeft, watDateISO } from '@/lib/format';
import { RemindButton, RemindAllButton } from '@/components/admin/reminder-buttons';

export const metadata = { title: 'Reminders' };

export default async function AdminReminders() {
  const { gym } = await requireStaff();
  const supabase = await createClient();

  // WAT day boundaries — see the same fix in lib/actions/reminders.ts, so the
  // page and the action that sends from it agree on which day it is.
  const today = watDateISO();
  const weekAhead = watDateISO(new Date(Date.now() + 7 * 86_400_000));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [{ data: expiring }, { data: sentRows }, { data: log }] = await Promise.all([
    supabase.from('member_subscriptions')
      .select('id, member_id, end_date, plan_id, membership_plans(name)')
      .eq('gym_id', gym.id).eq('status', 'active').gte('end_date', today).lte('end_date', weekAhead)
      .order('end_date', { ascending: true }).limit(50),
    supabase.from('reminder_logs').select('sent_count').eq('gym_id', gym.id).gte('created_at', monthStart.toISOString()),
    supabase.from('reminder_logs').select('id, action, channel, sent_count, recipient_count, created_at').eq('gym_id', gym.id).order('created_at', { ascending: false }).limit(6),
  ]);

  const sent = (sentRows ?? []).reduce((s, r) => s + Number(r.sent_count ?? 0), 0);
  const ids = [...new Set((expiring ?? []).map((e) => e.member_id).filter(Boolean) as string[])];
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? 'Member']));

  const rows = (expiring ?? []).map((e) => {
    const nm = e.member_id ? (nameById.get(e.member_id) ?? 'Member') : 'Member';
    const plan = (e as unknown as { membership_plans: { name: string } | null }).membership_plans?.name ?? 'Membership';
    const left = daysLeft(e.end_date);
    return { id: e.id, name: nm, initial: nm.charAt(0).toUpperCase(), sub: `${plan} · expires in ${left} day${left === 1 ? '' : 's'}` };
  });

  return (
    <>
      <div className="page-h">
        <div><h1>Reminders</h1><p>{rows.length} membership{rows.length === 1 ? '' : 's'} expiring this week · {sent ?? 0} reminders sent this month</p></div>
        <RemindAllButton />
      </div>

      <section className="kpis">
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#ffb0201f', color: '#ffb020' }}><Clock strokeWidth={1.9} /></div></div><div className="kpi-val">{rows.length}</div><div className="kpi-lbl">Expiring this week</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#11d18b1f', color: '#11d18b' }}><MessageCircle strokeWidth={1.9} /></div></div><div className="kpi-val">{sent ?? 0}</div><div className="kpi-lbl">Sent this month</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#4080ff1f', color: '#4080ff' }}><Reply strokeWidth={1.9} /></div></div><div className="kpi-val">—</div><div className="kpi-lbl">Renewed after nudge</div></div>
        <div className="kpi"><div className="kpi-top"><div className="kpi-ic" style={{ background: '#c6f24e1f', color: '#a8d92e' }}><Zap strokeWidth={1.9} /></div></div><div className="kpi-val">On</div><div className="kpi-lbl">Auto-reminders</div></div>
      </section>

      <section className="grid2">
        <div className="panel">
          <div className="panel-h"><div><h3>Expiring this week</h3><div className="sub">Nudge before they lapse</div></div></div>
          {rows.length === 0 ? (
            <div className="empty"><div className="eic"><Clock strokeWidth={1.6} /></div><h3>Nothing expiring</h3><p>No active memberships lapse in the next 7 days.</p></div>
          ) : rows.map((m) => (
            <div className="rm" key={m.id}>
              <span className="gf-avatar gf-avatar-sm">{m.initial}</span>
              <div className="m"><strong>{m.name}</strong><small>{m.sub}</small></div>
              <RemindButton subscriptionId={m.id} />
            </div>
          ))}
        </div>
        <div className="panel">
          <div className="panel-h"><div><h3>Recent reminders</h3><div className="sub">Delivery log</div></div></div>
          {(log ?? []).length === 0 ? (
            <div className="empty"><div className="eic"><Mail strokeWidth={1.6} /></div><h3>No reminders sent yet</h3><p>Delivery history will appear here.</p></div>
          ) : (log ?? []).map((l) => {
            const isEmail = (l.channel ?? '').toLowerCase().includes('email');
            const t = l.created_at ? new Date(l.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '';
            return (
              <div className="log" key={l.id}>
                <div className="ic" style={{ background: isEmail ? 'var(--gf-info-soft)' : 'var(--gf-brand-soft)', color: isEmail ? 'var(--gf-info)' : 'var(--gf-brand)' }}>{isEmail ? <Mail strokeWidth={1.9} /> : <MessageCircle strokeWidth={1.9} />}</div>
                <div className="m"><strong>{l.action ?? 'Reminder'} · {l.channel ?? 'WhatsApp'}</strong><small>{l.sent_count}/{l.recipient_count} delivered</small></div>
                <span className="t">{t}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
