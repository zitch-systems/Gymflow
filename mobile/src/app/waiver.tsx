import { useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, ErrorState, Loading, Notice, StaleDataNotice, Title, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api, API_BASE_URL, ApiError } from '@/api/client';
import type { WaiverPayload } from '@/api/types';
import { shortDate } from '@/lib/format';
import { space } from '@/theme';

export default function WaiverScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh, set } = useResource<WaiverPayload>('/api/app/waiver');
  // Consent applies only to the exact revision the member saw. A refresh that
  // brings a replacement document automatically clears this confirmation.
  const [checkedRevision, setCheckedRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionLock = useRef(false);

  const leave = () => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile');
  const accept = async () => {
    if (!data || data.accepted || stale || checkedRevision !== data.document.revision || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setActionError(null);
    try {
      const next = await api.post<WaiverPayload>('/api/app/waiver', {
        gymId: data.gym.id,
        revision: data.document.revision,
        accepted: true,
      });
      set(() => next);
      setCheckedRevision(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not save your acceptance. Please try again.');
      if (error instanceof ApiError && error.status === 409) {
        setCheckedRevision(null);
        refresh();
      }
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  if (loading && !data) return <Screen><Loading label="Loading your gym waiver…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><ErrorState message="Could not load your gym waiver." onRetry={refresh} /></Screen>;
  const checked = checkedRevision === data.document.revision;

  return (
    <Screen refreshing={refreshing} onRefresh={busy ? undefined : refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <Body tone="secondary" size={13} style={{ marginBottom: space.sm }}>{data.gym.name}</Body>
      <Title>{data.document.title}</Title>
      {data.document.version ? <View style={{ alignSelf: 'flex-start', marginTop: space.md }}><Badge label={`Version ${data.document.version}`} /></View> : null}
      {data.accepted ? (
        <View style={{ marginTop: space.lg }}>
          <Notice tone="success" message={`You accepted this waiver${data.signedAt ? ` on ${shortDate(data.signedAt)}` : ''}.`} />
        </View>
      ) : (
        <Body tone="secondary" style={{ marginTop: space.md, lineHeight: 21 }}>
          {data.document.id ? 'Read your gym’s waiver below. Accept it to continue with class bookings and check-in.' : 'Read the acknowledgement below before choosing whether to accept it.'}
        </Body>
      )}
      <Card style={{ marginTop: space.lg }}>
        <Body style={{ lineHeight: 24 }}>{data.document.content}</Body>
      </Card>
      {actionError ? <View style={{ marginTop: space.lg }}><Notice message={actionError} /></View> : null}
      {!data.accepted ? (
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I have read and accept this gym waiver"
            accessibilityState={{ checked, disabled: busy || stale }}
            disabled={busy || stale}
            onPress={() => setCheckedRevision(checked ? null : data.document.revision)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingVertical: space.md, marginTop: space.lg }}
          >
            <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={26} color={checked ? c.brand : c.textMuted} />
            <Body style={{ flex: 1, lineHeight: 21 }}>I have read and accept this gym waiver.</Body>
          </Pressable>
          <Button label="Accept waiver" onPress={accept} loading={busy} disabled={!checked || stale} />
        </>
      ) : null}
      <Button label={data.accepted ? 'Done' : 'Cancel'} variant="secondary" onPress={leave} disabled={busy} style={{ marginTop: space.md }} />
      <Button
        label="Privacy & terms"
        variant="ghost"
        onPress={() => { void Linking.openURL(`${API_BASE_URL}/legal`).catch(() => setActionError('Could not open privacy and terms. Please try again.')); }}
        style={{ marginTop: space.sm }}
      />
    </Screen>
  );
}
