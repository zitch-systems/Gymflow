import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Body, EmptyState, ErrorState, Group, Loading, Row, SectionTitle, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { inboxTime } from '@/lib/format';
import { space } from '@/theme';
import type { AppNotification, Inbox } from '@/api/types';

// The inbox — reminders, receipts, class alerts — grouped the way the web
// version groups them.

type Bucket = 'reminder' | 'class' | 'promo' | 'receipt' | 'system';

const BUCKET: Record<string, Bucket> = {
  reminder: 'reminder', class_reminder: 'reminder', expiry_reminder: 'reminder',
  class: 'class', class_booking: 'class', class_confirmed: 'class',
  promo: 'promo', referral: 'promo',
  payment: 'receipt', receipt: 'receipt', payout: 'receipt',
  announcement: 'system', system: 'system',
};

const ICON: Record<Bucket, keyof typeof Ionicons.glyphMap> = {
  reminder: 'notifications-outline',
  class: 'calendar-outline',
  promo: 'gift-outline',
  receipt: 'receipt-outline',
  system: 'sparkles-outline',
};

const DAY = 86_400_000;

function groupOf(iso: string | null, now: number): 'Today' | 'This week' | 'Earlier' {
  if (!iso) return 'Earlier';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'Earlier';
  if (new Date(t).toDateString() === new Date(now).toDateString()) return 'Today';
  return now - t < 7 * DAY ? 'This week' : 'Earlier';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh, set } = useResource<Inbox>('/api/app/notifications');
  const [marking, setMarking] = useState(false);
  // "Today" and "this week" are relative to when the screen opened, read once.
  // Reading the clock during render would make the grouping change under the
  // member on any incidental re-render.
  const [now] = useState(() => Date.now());

  const markAllRead = useCallback(async () => {
    setMarking(true);
    // Optimistic: the member has just watched the list, and a failed write is
    // corrected by the next refresh rather than worth a dialog.
    set((cur) => ({ unread: 0, notifications: cur.notifications.map((n) => ({ ...n, is_read: true })) }));
    try {
      await api.post('/api/app/notifications', { action: 'read_all' });
    } catch {
      refresh();
    } finally {
      setMarking(false);
    }
  }, [refresh, set]);

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;

  const rows = data?.notifications ?? [];
  if (rows.length === 0) {
    return (
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <EmptyState title="No messages yet" message="Reminders, receipts and gym alerts will appear here." />
      </Screen>
    );
  }

  const groups: Record<string, AppNotification[]> = { Today: [], 'This week': [], Earlier: [] };
  for (const n of rows) groups[groupOf(n.sent_at, now)].push(n);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {(data?.unread ?? 0) > 0 ? (
        <Pressable onPress={markAllRead} disabled={marking} style={styles.markAll} accessibilityRole="button">
          <Ionicons name="checkmark-done-outline" size={16} color={c.brand} />
          <Body tone="brand" size={13} weight="600">Mark all as read</Body>
        </Pressable>
      ) : null}

      {(['Today', 'This week', 'Earlier'] as const).map((label) =>
        groups[label].length === 0 ? null : (
          <View key={label}>
            <SectionTitle>{label}</SectionTitle>
            <Group>
              {groups[label].map((n, i) => {
                const bucket = (n.type && BUCKET[n.type]) || 'system';
                return (
                  <Row
                    key={n.id}
                    icon={<Ionicons name={ICON[bucket]} size={18} color={c.brand} />}
                    title={n.title ?? 'Notification'}
                    subtitle={[n.body, inboxTime(n.sent_at)].filter(Boolean).join('\n')}
                    right={!n.is_read ? <View style={styles.unreadDot} /> : undefined}
                    onPress={n.payment_id ? () => router.push(`/receipt/${n.payment_id}`) : undefined}
                    last={i === groups[label].length - 1}
                  />
                );
              })}
            </Group>
          </View>
        ),
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: space.sm },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand },
});
