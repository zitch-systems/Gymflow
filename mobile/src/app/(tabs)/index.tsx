import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Avatar, Badge, Body, Button, Card, EmptyState, ErrorState, Group, Heading, Loading, Row, SectionTitle, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { dayMonth, firstName, initial, plural, shortDate, time12 } from '@/lib/format';
import { radius, space } from '@/theme';
import type { Home } from '@/api/types';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Mon..Sun, as on the web

// The home screen — the same facts the web dashboard shows, in the same order:
// membership status first (it's what a member opens the app to check), then the
// quick actions, then the week, then the numbers.
export default function HomeScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useResource<Home>('/api/app/me');

  if (loading && !data) return <Screen><Loading label="Loading your gym…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><EmptyState title="Nothing to show yet" /></Screen>;

  const { gym, member, subscription: sub, stats, week, next_class: next, recent_checkins: recent, unread_notifications: unread } = data;

  const frozen = sub?.status === 'paused';
  const freezePending = sub?.status === 'pause_requested';
  const pastDue = sub?.status === 'past_due';
  const active = Boolean(sub) && !frozen && !freezePending && (sub?.days_left ?? 0) > 0;

  const statusLabel = frozen ? 'Frozen' : freezePending ? 'Freeze pending' : active ? 'Active' : sub ? 'Expired' : 'No plan';
  const statusTone = frozen || freezePending ? 'info' : active ? 'success' : 'warning';

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* Header */}
      <View style={styles.header}>
        <Avatar label={initial(member.full_name, member.email)} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Body tone="secondary" size={12}>{gym.name}</Body>
          <Body size={17} weight="800">Hi, {firstName(member.full_name)} 👋</Body>
        </View>
        <Pressable
          onPress={() => router.push('/notifications')}
          style={styles.bell}
          accessibilityRole="button"
          accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Ionicons name="notifications-outline" size={20} color={c.text} />
          {unread > 0 ? (
            <View style={styles.nub}><Body size={9.5} weight="800" style={{ color: c.onBrand }}>{unread > 99 ? '99+' : unread}</Body></View>
          ) : null}
        </Pressable>
      </View>

      {/* The two states worth interrupting for. */}
      {pastDue ? (
        <Card style={[styles.banner, { backgroundColor: c.dangerSoft, borderColor: c.danger }]}>
          <Body tone="danger" size={13.5} weight="600">Auto-renew payment failed.</Body>
          <Body tone="danger" size={13} style={{ marginTop: 2 }}>Update your payment to keep training.</Body>
          <Button label="Fix payment" size="sm" onPress={() => router.push('/renew')} style={{ marginTop: space.md, alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {frozen || freezePending ? (
        <Card style={[styles.banner, { backgroundColor: c.infoSoft, borderColor: c.info }]}>
          <Body size={13.5} weight="600" style={{ color: c.info }}>
            {frozen ? 'Membership frozen' : 'Freeze request pending'}
          </Body>
          <Body size={13} style={{ color: c.info, marginTop: 2 }}>
            {frozen
              ? `Your days are paused${sub?.pause_end ? ` until ${shortDate(sub.pause_end)}` : ''}. Contact the gym to resume early.`
              : 'Waiting for staff to approve your freeze.'}
          </Body>
        </Card>
      ) : null}

      {/* Membership status */}
      <Card style={styles.status}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Badge label={statusLabel} tone={statusTone} />
          {sub?.end_date && active ? <Body tone="secondary" size={12}>Renews {shortDate(sub.end_date)}</Body> : null}
        </View>
        <Heading style={{ marginTop: space.md }}>{sub ? sub.plan_name : 'No membership'}</Heading>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${sub?.progress_pct ?? 0}%` }]} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}>
          <Body tone="muted" size={12}>{sub?.start_date ? shortDate(sub.start_date) : '—'}</Body>
          <Body tone="muted" size={12}>{sub ? `${plural(sub.days_left, 'day')} left` : 'Not subscribed'}</Body>
        </View>
        <Button
          // A member who has never subscribed is starting a membership, not
          // renewing one.
          label={active || frozen || freezePending ? 'Manage membership' : sub ? 'Renew membership' : 'Choose a plan'}
          onPress={() => router.push(active || frozen || freezePending ? '/(tabs)/wallet' : '/renew')}
          style={{ marginTop: space.lg }}
        />
      </Card>

      {/* Quick actions */}
      <View style={styles.quick}>
        <QuickAction icon="scan-outline" label="Check in" onPress={() => router.push('/(tabs)/checkin')} />
        <QuickAction icon="calendar-outline" label="Schedule" onPress={() => router.push('/(tabs)/classes')} />
        <QuickAction icon="wallet-outline" label="Wallet" onPress={() => router.push('/(tabs)/wallet')} />
        <QuickAction icon="card-outline" label="Renew" onPress={() => router.push('/renew')} />
      </View>

      {/* Week + streak */}
      <Card style={{ marginTop: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View style={styles.flame}><Ionicons name="flame" size={18} color={c.brand} /></View>
            <View>
              <Body weight="700">{plural(stats.streak, 'day')} streak</Body>
              <Body tone="secondary" size={12}>
                {stats.best_streak > 0 ? `Best: ${plural(stats.best_streak, 'day')}` : 'Check in to start one'}
              </Body>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Body weight="800" size={16}>{stats.visits_this_week}/{stats.weekly_goal}</Body>
            <Body tone="secondary" size={11}>Weekly goal</Body>
          </View>
        </View>

        <View style={styles.week}>
          {week.map((d, i) => (
            <View key={d.date} style={{ alignItems: 'center', gap: 6 }}>
              <Body tone={d.today ? 'brand' : 'muted'} size={11} weight={d.today ? '800' : '400'}>{DAY_LABELS[i]}</Body>
              <View style={[
                styles.dot,
                d.done && { backgroundColor: c.brand, borderColor: c.brand },
                d.today && !d.done && { borderColor: c.brand },
                d.future && { opacity: 0.4 },
              ]}>
                {d.done ? <Ionicons name="checkmark" size={13} color={c.onBrand} /> : null}
              </View>
            </View>
          ))}
        </View>
      </Card>

      {/* Lifetime-ish numbers */}
      <View style={styles.stats}>
        <Stat value={String(stats.visits_this_month)} label="Visits this month" icon="pulse-outline" />
        <Stat value={String(stats.classes_attended)} label="Classes attended" icon="checkmark-done-outline" />
        <Stat value={stats.avg_session_minutes > 0 ? `${stats.avg_session_minutes}m` : '—'} label="Avg session" icon="timer-outline" />
      </View>

      <SectionTitle>Next class</SectionTitle>
      <Group>
        {next ? (
          <Row
            icon={<Ionicons name="calendar-clear-outline" size={18} color={c.brand} />}
            title={next.name}
            subtitle={`${shortDate(next.date)}${next.start_time ? ` · ${time12(next.start_time)}` : ''}`}
            right={<Badge label="Booked" tone="success" />}
            onPress={() => router.push('/(tabs)/classes')}
            last
          />
        ) : (
          <Row
            icon={<Ionicons name="calendar-outline" size={18} color={c.brand} />}
            title="No upcoming classes"
            subtitle="Browse the schedule to book one"
            right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
            onPress={() => router.push('/(tabs)/classes')}
            last
          />
        )}
      </Group>

      {recent.length > 0 ? (
        <>
          <SectionTitle>Recent check-ins</SectionTitle>
          <Group>
            {recent.map((v, i) => (
              <Row
                key={`${v.checked_in_at}-${i}`}
                icon={<Ionicons name="checkmark" size={18} color={c.brand} />}
                title={dayMonth(v.checked_in_at)}
                subtitle={v.method ? `via ${v.method}` : 'Checked in'}
                last={i === recent.length - 1}
              />
            ))}
          </Group>
        </>
      ) : null}
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.quickItem} android_ripple={{ color: 'rgba(255,255,255,0.06)', borderless: false }}>
      <View style={styles.quickTile}><Ionicons name={icon} size={20} color={c.brand} /></View>
      <Body size={11.5} tone="secondary">{label}</Body>
    </Pressable>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={16} color={c.textMuted} />
      <Body size={19} weight="800" style={{ marginTop: 4 }}>{value}</Body>
      <Body tone="secondary" size={11} style={{ textAlign: 'center', marginTop: 2 }}>{label}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  bell: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center',
  },
  nub: {
    position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  banner: { marginBottom: space.md, borderWidth: 1 },
  status: { paddingVertical: space.xl },
  bar: { height: 7, borderRadius: 4, backgroundColor: c.elevated, marginTop: space.lg, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: c.brand },
  quick: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  quickItem: { flex: 1, alignItems: 'center', gap: 6 },
  quickTile: {
    width: '100%', height: 54, borderRadius: radius.sm, backgroundColor: c.surface,
    borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center',
  },
  flame: { width: 34, height: 34, borderRadius: 17, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xl },
  dot: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: c.border,
    backgroundColor: c.elevated, alignItems: 'center', justifyContent: 'center',
  },
  stats: { flexDirection: 'row', gap: space.md, marginTop: space.lg },
  stat: {
    flex: 1, alignItems: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    borderRadius: radius.md, paddingVertical: space.lg, paddingHorizontal: space.sm,
  },
});
