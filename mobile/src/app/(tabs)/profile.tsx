import { Alert, Linking, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Avatar, Badge, Body, Button, EmptyState, ErrorState, Group, Loading, Row, SectionTitle, Title, c, StaleDataNotice } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { useAuth } from '@/auth/context';
import { API_BASE_URL } from '@/api/client';
import { initial, shortDate } from '@/lib/format';
import { space } from '@/theme';
import type { ProfilePayload } from '@/api/types';

const STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'warning' | 'danger' }> = {
  active: { label: 'Active', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  frozen: { label: 'Frozen', tone: 'info' },
  freeze_pending: { label: 'Freeze pending', tone: 'info' },
  expired: { label: 'Expired', tone: 'warning' },
  past_due: { label: 'Payment failed', tone: 'danger' },
};

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh } = useResource<ProfilePayload>('/api/app/profile');

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You’ll need your gym code and password to sign back in.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (error && !data) return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <ErrorState message={error} onRetry={refresh} />
      <Button label="Account deletion" variant="secondary" onPress={() => router.push('/account-deletion')} />
      <Button label="Sign out" variant="ghost" onPress={confirmSignOut} style={{ marginTop: space.md }} />
    </Screen>
  );
  if (!data) return <Screen><EmptyState title="Nothing to show" /></Screen>;

  const { profile, gym, stats, membership } = data;
  const name = profile.full_name || profile.email || 'Member';
  const joined = profile.joined_at
    ? new Date(profile.joined_at).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })
    : null;
  const statusKey = membership?.status === 'past_due' && membership.display_state === 'active'
    ? 'past_due'
    : membership?.display_state;
  const status = statusKey ? STATUS[statusKey] : null;
  const membershipDate = membership?.display_state === 'scheduled' ? membership.start_date : membership?.end_date;
  const membershipDateLabel = membership?.display_state === 'scheduled' ? 'Starts' : membership?.auto_renew ? 'Renews' : membership?.display_state === 'expired' ? 'Ended' : 'Ends';

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <View style={styles.hero}>
        <Avatar label={initial(profile.full_name, profile.email)} size={78} />
        <Title style={{ marginTop: space.lg, textAlign: 'center' }}>{name}</Title>
        <Body tone="secondary" size={13} style={{ marginTop: 4, textAlign: 'center' }}>
          {joined ? `Member since ${joined} · ${gym.name}` : gym.name}
        </Body>
        {status ? <View style={{ marginTop: space.md }}><Badge label={status.label} tone={status.tone} /></View> : null}
      </View>

      <View style={styles.stats}>
        <Stat value={String(stats.visits)} label="Visits" />
        <Stat value={String(stats.classes_attended)} label="Classes" />
        <Stat value={membershipDate ? shortDate(membershipDate) : '—'} label={membershipDateLabel} small />
      </View>

      <SectionTitle>Membership</SectionTitle>
      <Group>
        <Row
          icon={<Ionicons name="wallet-outline" size={18} color={c.brand} />}
          title="Wallet & billing"
          subtitle="Membership, payments & receipts"
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/(tabs)/wallet')}
        />
        <Row
          icon={<Ionicons name="card-outline" size={18} color={c.brand} />}
          title="Renew or change plan"
          subtitle={membership?.auto_renew ? 'Auto-renew is on' : 'Auto-renew is off'}
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/renew')}
        />
        <Row
          icon={<Ionicons name="qr-code-outline" size={18} color={c.brand} />}
          title="My check-in code"
          subtitle="Show at the door"
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/(tabs)/checkin')}
          last
        />
      </Group>

      <SectionTitle>Account</SectionTitle>
      <Group>
        <Row
          icon={<Ionicons name="person-outline" size={18} color={c.brand} />}
          title="Edit profile"
          subtitle={profile.phone ?? profile.email ?? undefined}
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/edit-profile')}
        />
        <Row
          icon={<Ionicons name="notifications-outline" size={18} color={c.brand} />}
          title="Notifications"
          subtitle="Reminders & receipts"
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/notifications')}
        />
        <Row
          icon={<Ionicons name="settings-outline" size={18} color={c.brand} />}
          title="Account deletion"
          subtitle="Request deletion and check its status"
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/account-deletion')}
        />
        <Row
          icon={<Ionicons name="shield-checkmark-outline" size={18} color={c.brand} />}
          title="Waiver & documents"
          subtitle="Gym waiver, acceptance status and data information"
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/waiver')}
        />
        <Row
          icon={<Ionicons name="snow-outline" size={18} color={c.brand} />}
          title="Manage membership"
          subtitle="Freeze requests and automatic renewal"
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/membership')}
        />
        {data.whatsapp_url ? <Row
          icon={<Ionicons name="logo-whatsapp" size={18} color={c.brand} />}
          title="GymFlow on WhatsApp"
          subtitle="Open your gym assistant"
          right={<Ionicons name="open-outline" size={16} color={c.textMuted} />}
          onPress={() => void Linking.openURL(data.whatsapp_url!).catch(() => Alert.alert('Could not open WhatsApp', 'Please try again shortly.'))}
        /> : null}
        <Row
          icon={<Ionicons name="help-buoy-outline" size={18} color={c.brand} />}
          title="Privacy & terms"
          subtitle="How GymFlow handles your information"
          right={<Ionicons name="open-outline" size={16} color={c.textMuted} />}
          onPress={() => void Linking.openURL(`${API_BASE_URL}/legal`).catch(() => Alert.alert('Could not open privacy and terms', 'Please try again shortly.'))}
        />
        <Row
          icon={<Ionicons name="help-buoy-outline" size={18} color={c.brand} />}
          title="Help & support"
          subtitle="hello@gymflow.ng"
          right={<Ionicons name="open-outline" size={16} color={c.textMuted} />}
          onPress={() => void Linking.openURL('mailto:hello@gymflow.ng').catch(() => Alert.alert('Contact support', 'Email hello@gymflow.ng from your email app.'))}
          last
        />
      </Group>

      <View style={{ marginTop: space.xl }}>
        <Group>
          <Row
            icon={<Ionicons name="log-out-outline" size={18} color={c.danger} />}
            title="Sign out"
            danger
            onPress={confirmSignOut}
            last
          />
        </Group>
      </View>

      <Body tone="muted" size={11} style={{ textAlign: 'center', marginTop: space.xl }}>
        GymFlow · {gym.name}{gym.member_code ? ` · code ${gym.member_code}` : ''}
      </Body>
    </Screen>
  );
}

function Stat({ value, label, small }: { value: string; label: string; small?: boolean }) {
  return (
    <View style={styles.stat}>
      <Body size={small ? 13 : 20} weight="800" numberOfLines={1}>{value}</Body>
      <Body tone="secondary" size={11} style={{ marginTop: 2 }}>{label}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space.xl },
  stats: {
    flexDirection: 'row', backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
    borderRadius: 16, paddingVertical: space.lg, marginBottom: space.sm,
  },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: space.sm },
});
