import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Body, EmptyState, ErrorState, Group, Loading, Notice, Row, SectionTitle, c, StaleDataNotice } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { inboxTime, sameWatDay } from '@/lib/format';
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
  if (sameWatDay(new Date(t), new Date(now))) return 'Today';
  return now - t < 7 * DAY ? 'This week' : 'Earlier';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh, set } = useResource<Inbox>('/api/app/notifications');
  const [marking, setMarking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // "Today" and "this week" are relative to when the screen opened, read once.
  // Reading the clock during render would make the grouping change under the
  // member on any incidental re-render.
  const [now] = useState(() => Date.now());

  const markAllRead = useCallback(async () => {
    setMarking(true);
    setActionError(null);
    try {
      await api.post('/api/app/notifications', { action: 'read_all' });
      set((cur) => ({ unread: 0, notifications: cur.notifications.map((n) => ({ ...n, is_read: true })) }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not mark your notifications as read.');
    } finally {
      setMarking(false);
    }
  }, [set]);

  const openNotification = (notification: AppNotification) => {
    // The list is a preview. Every message needs a way to read its full body.
    Alert.alert(notification.title ?? 'Notification', notification.body ?? 'No additional details.', [
      { text: 'Close', style: 'cancel' },
      ...(notification.payment_id ? [{ text: 'View receipt', onPress: () => router.push(`/receipt/${notification.payment_id}`) }] : []),
    ]);
    if (notification.is_read) return;
    void api.post('/api/app/notifications', { action: 'read', id: notification.id }).then(() => {
      set((cur) => ({
        unread: Math.max(0, cur.unread - (cur.notifications.some((n) => n.id === notification.id && !n.is_read) ? 1 : 0)),
        notifications: cur.notifications.map((n) => n.id === notification.id ? { ...n, is_read: true } : n),
      }));
    }).catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : 'Could not mark this notification as read.');
    });
  };

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;

  const rows = data?.notifications ?? [];
  if (rows.length === 0) {
    return (
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
        <EmptyState title="No messages yet" message="Reminders, receipts and gym alerts will appear here." />
      </Screen>
    );
  }

  const groups: Record<string, AppNotification[]> = { Today: [], 'This week': [], Earlier: [] };
  for (const n of rows) groups[groupOf(n.sent_at, now)].push(n);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      {actionError ? <Notice message={actionError} /> : null}
      {(data?.unread ?? 0) > 0 ? (
        <Pressable
          onPress={markAllRead}
          disabled={marking}
          style={styles.markAll}
          accessibilityRole="button"
          accessibilityLabel="Mark all notifications as read"
          accessibilityState={{ disabled: marking, busy: marking }}
        >
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
                    onPress={() => openNotification(n)}
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
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', paddingVertical: space.sm, minHeight: 44 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.brand },
});
