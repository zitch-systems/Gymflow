import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { Body, Button, Card, ErrorState, Field, Loading, Notice, SectionTitle, StaleDataNotice, Title } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import type { MembershipSettings } from '@/api/types';
import { shortDate } from '@/lib/format';
import { space } from '@/theme';

type Result = { ok: boolean; error: string | null; message?: string };

export default function MembershipScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh, set } = useResource<MembershipSettings>('/api/app/membership');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);
  const actionLock = useRef(false);

  async function submit(action: 'request_freeze' | 'cancel_auto_renew') {
    if (!data?.subscription || stale || actionLock.current) return;
    if (action === 'request_freeze' && !data.freeze.can_request) return;
    if (action === 'cancel_auto_renew' && !data.subscription.auto_renew) return;
    actionLock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.post<Result>('/api/app/membership', action === 'request_freeze'
        ? { action, start: start || data.today, end, reason }
        : { action, subscription_id: data.subscription.id, confirmed: true });
      if (!result.ok) throw new Error(result.error || 'Your membership could not be updated. Please try again.');
      // Reflect only a server-confirmed write, then reload authoritative state.
      set((current) => ({ ...current,
        subscription: current.subscription ? { ...current.subscription,
          ...(action === 'cancel_auto_renew' ? { auto_renew: false } : { status: 'pause_requested', pause_start: start || data.today, pause_end: end, pause_reason: reason }),
        } : null,
        freeze: action === 'request_freeze' ? { ...current.freeze, can_request: false, unavailable_reason: 'Freeze requested — waiting for staff approval.' } : current.freeze,
      }));
      setNotice({ message: result.message || 'Your membership settings have been updated.', tone: 'success' });
      refresh();
    } catch (failure) {
      setNotice({ message: failure instanceof Error ? failure.message : 'Please try again.', tone: 'danger' });
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  function confirmCancellation() {
    if (busy || stale) return;
    Alert.alert('Turn off automatic renewal?', 'Future automatic charges will stop. Your access continues until the current paid period ends.', [
      { text: 'Keep auto-renew', style: 'cancel' },
      { text: 'Turn off', style: 'destructive', onPress: () => { void submit('cancel_auto_renew'); } },
    ]);
  }

  if (loading && !data) return <Screen><Loading label="Loading membership settings…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><ErrorState message="Could not load your membership." onRetry={refresh} /></Screen>;
  const sub = data.subscription;

  return (
    <Screen refreshing={refreshing} onRefresh={busy ? undefined : refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <Title>Manage membership</Title>
      <Body tone="secondary" style={{ marginTop: space.sm }}>{data.gym.name}</Body>
      {notice ? <View style={{ marginTop: space.lg }}><Notice {...notice} /></View> : null}

      <SectionTitle>Automatic renewal</SectionTitle>
      <Card>
        <Body weight="700">{sub?.auto_renew ? 'Auto-renew is on' : 'Auto-renew is off'}</Body>
        <Body tone="secondary" style={{ marginTop: space.sm, lineHeight: 22 }}>
          {sub?.auto_renew ? 'Your saved payment mandate is charged each period. You can stop future renewals here.' : 'Renew from membership plans when you are ready.'}
          {sub?.end_date ? ` Current period ends ${shortDate(sub.end_date)}.` : ''}
        </Body>
        {sub?.auto_renew ? <Button label="Turn off auto-renew" variant="secondary" onPress={confirmCancellation} disabled={busy || stale} style={{ marginTop: space.lg }} /> : null}
      </Card>

      <SectionTitle>Membership freeze</SectionTitle>
      {data.freeze.can_request ? (
        <Card>
          <Body tone="secondary" style={{ marginBottom: space.lg, lineHeight: 22 }}>Ask your gym to pause your membership. Staff must approve the request before the freeze takes effect.</Body>
          <Field label="Freeze from" placeholder="YYYY-MM-DD" value={start || data.today} onChangeText={setStart} maxLength={10} autoCapitalize="none" autoCorrect={false} editable={!busy && !stale} hint={`Today or later, up to ${shortDate(sub?.end_date)}`} />
          <Field label="Resume on" placeholder="YYYY-MM-DD" value={end} onChangeText={setEnd} maxLength={10} autoCapitalize="none" autoCorrect={false} editable={!busy && !stale} />
          <Field label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={500} multiline editable={!busy && !stale} />
          <Button label="Request freeze" onPress={() => submit('request_freeze')} loading={busy} disabled={!end || stale} />
        </Card>
      ) : (
        <Card>
          <Body>{data.freeze.unavailable_reason || 'Freeze requests are not available.'}</Body>
          {sub?.pause_start && sub?.pause_end ? <Body tone="secondary" style={{ marginTop: space.sm }}>{shortDate(sub.pause_start)} → {shortDate(sub.pause_end)}</Body> : null}
        </Card>
      )}
      <Button label="View membership plans" variant="secondary" onPress={() => router.push('/renew')} disabled={busy} style={{ marginTop: space.xl }} />
    </Screen>
  );
}
