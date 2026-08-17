import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, EmptyState, ErrorState, Loading, Notice, Title, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { shortDate, time12 } from '@/lib/format';
import { radius, space } from '@/theme';
import type { Classes } from '@/api/types';

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The gym's timetable and the member's own bookings, as two tabs — the same
// split the web schedule page uses.
export default function ClassesScreen() {
  const { data, error, loading, refreshing, refresh } = useResource<Classes>('/api/app/classes');
  const [tab, setTab] = useState<'schedule' | 'bookings'>('schedule');
  const [selectedDow, setSelectedDow] = useState(() => new Date().getDay());
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);

  // This week, Monday first — the strip along the top.
  const week = useMemo(() => {
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return { dow: d.getDay(), dom: d.getDate(), label: SHORT[d.getDay()], isToday: d.toDateString() === today.toDateString() };
    });
  }, []);

  const book = useCallback(async (scheduleId: string) => {
    setPending(scheduleId);
    setNotice(null);
    try {
      const res = await api.post<{ ok: boolean; waitlisted: boolean; message: string | null }>('/api/app/classes', {
        action: 'book', schedule_id: scheduleId,
      });
      setNotice({ message: res.message ?? (res.waitlisted ? 'Added to the waitlist.' : 'You’re booked in.'), tone: 'success' });
      refresh();
    } catch (e) {
      setNotice({ message: e instanceof Error ? e.message : 'Could not book that class.', tone: 'danger' });
    } finally {
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
          setPending(bookingId);
          setNotice(null);
          try {
            await api.post('/api/app/classes', { action: 'cancel', booking_id: bookingId });
            setNotice({ message: 'Booking cancelled.', tone: 'success' });
            refresh();
          } catch (e) {
            setNotice({ message: e instanceof Error ? e.message : 'Could not cancel that booking.', tone: 'danger' });
          } finally {
            setPending(null);
          }
        },
      },
    ]);
  }, [refresh]);

  if (loading && !data) return <Screen><Loading label="Loading the timetable…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><EmptyState title="No timetable yet" /></Screen>;

  const daySlots = data.schedule.filter((s) => s.day_of_week === selectedDow);
  const bookedScheduleIds = new Set(
    data.bookings.filter((b) => (b.booking_date ?? '') >= data.today).map((b) => b.class_schedule_id),
  );
  const bookedDows = new Set(
    data.bookings
      .filter((b) => (b.booking_date ?? '') >= data.today && b.booking_date)
      .map((b) => new Date(`${b.booking_date}T00:00:00`).getDay()),
  );
  const scheduledDows = new Set(data.schedule.map((s) => s.day_of_week));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Title>Schedule</Title>

      <View style={styles.tabs}>
        <TabButton label="Schedule" active={tab === 'schedule'} onPress={() => setTab('schedule')} />
        <TabButton label="My bookings" active={tab === 'bookings'} onPress={() => setTab('bookings')} />
      </View>

      {notice ? <Notice message={notice.message} tone={notice.tone === 'success' ? 'success' : 'danger'} /> : null}

      {tab === 'schedule' ? (
        <>
          <View style={styles.strip}>
            {week.map((d) => {
              const on = d.dow === selectedDow;
              return (
                <Pressable
                  key={d.dow}
                  onPress={() => setSelectedDow(d.dow)}
                  style={[styles.day, on && { backgroundColor: c.brand, borderColor: c.brand }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Body size={11} style={{ color: on ? c.onBrand : c.textMuted }}>{d.label}</Body>
                  <Body size={16} weight="800" style={{ color: on ? c.onBrand : c.text }}>{d.dom}</Body>
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
              const booked = bookedScheduleIds.has(s.id);
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
                  </View>
                  {booked
                    ? <Badge label="Booked" tone="success" />
                    : <Button label="Book" size="sm" onPress={() => void book(s.id)} loading={pending === s.id} style={{ paddingHorizontal: space.lg }} />}
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
            const upcoming = (b.booking_date ?? '') >= data.today;
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
                    {b.start_time ? time12(b.start_time) : shortDate(b.booking_date)}{b.room ? ` · ${b.room}` : ''}
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
