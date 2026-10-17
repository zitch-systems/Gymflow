import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, EmptyState, ErrorState, Loading, Notice, Title, c, StaleDataNotice } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api, ApiError } from '@/api/client';
import { shortDate, time12 } from '@/lib/format';
import { bookingForSlot, canCancelBooking } from '@/lib/class-bookings';
import { radius, space } from '@/theme';
import type { Classes } from '@/api/types';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The gym's timetable and the member's own bookings, as two tabs — the same
// split the web schedule page uses.
export default function ClassesScreen() {
  const router = useRouter();
  const [waiverRequired, setWaiverRequired] = useState(false);
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh } = useResource<Classes>('/api/app/classes');
  const [tab, setTab] = useState<'schedule' | 'bookings'>('schedule');
  const [selectedDow, setSelectedDow] = useState<number | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const actionLock = useRef(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  const serverToday = data?.today ?? new Date().toISOString().slice(0, 10);
  const today = new Date(`${serverToday}T12:00:00`);
  const activeDow = selectedDow ?? today.getDay();

  // This is a recurring timetable, not a calendar for the current week.
  // Each card names the server's actual next occurrence before the member books.
  const week = WEEKDAYS.map((dow) => ({ dow, label: SHORT[dow], accessibilityLabel: LONG[dow] }));

  const book = useCallback(async (scheduleId: string) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setPending(scheduleId);
    setNotice(null);
    setWaiverRequired(false);
    try {
      const res = await api.post<{ ok: boolean; waitlisted: boolean; message: string | null }>('/api/app/classes', {
        action: 'book', schedule_id: scheduleId,
      });
      setNotice({ message: res.message ?? (res.waitlisted ? 'Added to the waitlist.' : 'You’re booked in.'), tone: 'success' });
      refresh();
    } catch (e) {
      setWaiverRequired(e instanceof ApiError && e.code === 'waiver_required');
      setNotice({ message: e instanceof Error ? e.message : 'Could not book that class.', tone: 'danger' });
    } finally {
      actionLock.current = false;
      setPending(null);
    }
  }, [refresh]);

  const cancel = useCallback((bookingId: string, name: string) => {
    // A cancellation frees the seat to whoever is next on the waitlist and
    // can't be undone with a tap, so it gets a confirmation.
    Alert.alert('Cancel booking?', `Give up your spot in ${name}?`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          if (actionLock.current) return;
          actionLock.current = true;
          setPending(bookingId);
          setNotice(null);
          try {
            await api.post('/api/app/classes', { action: 'cancel', booking_id: bookingId });
            setNotice({ message: 'Booking cancelled.', tone: 'success' });
            refresh();
          } catch (e) {
            setNotice({ message: e instanceof Error ? e.message : 'Could not cancel that booking.', tone: 'danger' });
          } finally {
            actionLock.current = false;
            setPending(null);
          }
        },
      },
    ]);
  }, [refresh]);

  if (loading && !data) return <Screen><Loading label="Loading the timetable…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><EmptyState title="No timetable yet" /></Screen>;

  const daySlots = data.schedule.filter((s) => s.day_of_week === activeDow);
  const bookedDows = new Set(data.schedule
    .filter((slot) => bookingForSlot(slot, data.bookings))
    .map((slot) => slot.day_of_week));
  const scheduledDows = new Set(data.schedule.map((s) => s.day_of_week));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <Title>Classes</Title>
      <Body tone="secondary" style={{ marginTop: space.sm }}>Choose a day to see its next available classes.</Body>

      <View style={styles.tabs}>
        <TabButton label="Schedule" active={tab === 'schedule'} onPress={() => setTab('schedule')} />
        <TabButton label="My bookings" active={tab === 'bookings'} onPress={() => setTab('bookings')} />
      </View>

      {notice ? <Notice message={notice.message} tone={notice.tone === 'success' ? 'success' : 'danger'} /> : null}
      {waiverRequired ? <Button label="Review gym waiver" onPress={() => router.push('/waiver')} style={{ marginBottom: space.lg }} /> : null}

      {tab === 'schedule' ? (
        <>
          <View style={styles.strip}>
            {week.map((d) => {
              const on = d.dow === activeDow;
              return (
                <Pressable
                  key={d.dow}
                  onPress={() => setSelectedDow(d.dow)}
                  style={[styles.day, on && { backgroundColor: c.brand, borderColor: c.brand }]}
                  accessibilityRole="button"
                  accessibilityLabel={d.accessibilityLabel}
                  accessibilityState={{ selected: on }}
                >
                  <Body size={11} style={{ color: on ? c.onBrand : c.textMuted }}>{d.label}</Body>
                  <View style={[
                    styles.mark,
                    { backgroundColor: scheduledDows.has(d.dow) ? (bookedDows.has(d.dow) ? c.accent : c.textMuted) : 'transparent' },
                  ]} />
                </Pressable>
              );
            })}
          </View>

          {daySlots.length === 0 ? (
            <EmptyState title="Rest day" message="No classes scheduled. Recovery counts too." />
          ) : (
            daySlots.map((s) => {
              const booking = bookingForSlot(s, data.bookings);
              return (
                <Card key={s.id} style={styles.slot}>
                  <View style={styles.slotTime}>
                    <Body weight="800" size={15}>{time12(s.start_time).split(' ')[0]}</Body>
                    <Body tone="muted" size={11}>{time12(s.start_time).split(' ')[1]}</Body>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Body weight="700" numberOfLines={1}>{s.name}</Body>
                    <Body tone="secondary" size={12} numberOfLines={1}>
                      {s.instructor ?? 'TBA'}{s.room ? ` · ${s.room}` : ''}{s.duration_minutes ? ` · ${s.duration_minutes}m` : ''}
                    </Body>
                    <Body tone="brand" size={12} style={{ marginTop: 4 }}>Next: {shortDate(s.next_date)}</Body>
                  </View>
                  {booking
                    ? <Badge label={booking.status === 'waitlisted' ? 'Waitlist' : 'Booked'} tone={booking.status === 'waitlisted' ? 'warning' : 'success'} />
                    : <Button label="Book" size="sm" onPress={() => void book(s.id)} loading={pending === s.id} disabled={pending !== null} style={{ paddingHorizontal: space.md }} />}
                </Card>
              );
            })
          )}
        </>
      ) : (
        data.bookings.length === 0 ? (
          <EmptyState
            title="No bookings yet"
            message="Browse the schedule and reserve your spot."
            action={<Button label="Browse classes" onPress={() => setTab('schedule')} />}
          />
        ) : (
          data.bookings.map((b) => {
            const upcoming = canCancelBooking(b, data.today);
            const d = b.booking_date ? new Date(`${b.booking_date}T00:00:00`) : null;
            return (
              <Card key={b.id} style={styles.slot}>
                <View style={styles.slotTime}>
                  <Body weight="800" size={17}>{d ? d.getDate() : '—'}</Body>
                  <Body tone="muted" size={11}>{d ? SHORT[d.getDay()] : ''}</Body>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Body weight="700" numberOfLines={1}>{b.name}</Body>
                  <Body tone="secondary" size={12} numberOfLines={1}>
                    {shortDate(b.booking_date)}{b.start_time ? ` · ${time12(b.start_time)}` : ''}{b.room ? ` · ${b.room}` : ''}
                  </Body>
                </View>
                {upcoming ? (
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    {b.status === 'waitlisted' ? <Badge label="Waitlist" tone="warning" /> : null}
                    <Button
                      label="Cancel"
                      size="sm"
                      variant="danger"
                      onPress={() => cancel(b.id, b.name)}
                      loading={pending === b.id}
                      disabled={pending !== null}
                    />
                  </View>
                ) : (
                  <Badge label={b.status === 'attended' ? 'Attended' : 'Past'} tone={b.status === 'attended' ? 'success' : 'neutral'} />
                )}
              </Card>
            );
          })
        )
      )}
    </Screen>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && { backgroundColor: c.surface, borderColor: c.border }]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Body size={13} weight={active ? '700' : '500'} tone={active ? 'default' : 'secondary'}>{label}</Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row', gap: 4, marginTop: space.lg, marginBottom: space.lg,
    backgroundColor: c.elevated, borderRadius: radius.sm, padding: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.xs, borderWidth: 1, borderColor: 'transparent' },
  strip: { flexDirection: 'row', gap: 6, marginBottom: space.lg },
  day: {
    flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.md,
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface,
  },
  mark: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },
  slot: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.md, paddingVertical: space.md },
  slotTime: { width: 52, alignItems: 'center' },
});
