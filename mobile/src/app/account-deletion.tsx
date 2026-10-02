import { useState } from 'react';
import { Alert, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, ErrorState, Field, Group, Loading, Notice, Row, StaleDataNotice, Title, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { shortDate } from '@/lib/format';
import { space } from '@/theme';

type DeletionRequest = {
  id: string;
  status: 'pending' | 'processing' | 'completed';
  requested_at: string;
  due_at: string;
  completed_at: string | null;
  status_message: string | null;
};

type AccountDeletionPayload = {
  request: DeletionRequest | null;
  processing_days: number;
  message: string;
};

const STATUS = {
  pending: { label: 'Pending', tone: 'warning' as const },
  processing: { label: 'Processing', tone: 'info' as const },
  completed: { label: 'Completed', tone: 'success' as const },
};

export default function AccountDeletionScreen() {
  const resource = useResource<AccountDeletionPayload>('/api/app/account-deletion');
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh, set } = resource;
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const next = await api.post<AccountDeletionPayload>('/api/app/account-deletion', { confirmation: 'DELETE' });
      set(() => next);
      setConfirmation('');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not submit your deletion request.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmSubmit = () => {
    if (confirmation !== 'DELETE') {
      setSubmitError('Type DELETE exactly to continue.');
      return;
    }
    Alert.alert(
      'Submit account deletion request?',
      'Your account will remain available while the request is reviewed and processed. This request cannot be undone in the app.',
      [
        { text: 'Keep account', style: 'cancel' },
        { text: 'Request deletion', style: 'destructive', onPress: () => void submit() },
      ],
    );
  };

  if (loading && !data) return <Screen><Loading label="Checking deletion status…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><ErrorState message="Could not load account deletion status." onRetry={refresh} /></Screen>;

  const request = data.request;
  const status = request ? STATUS[request.status] : null;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <Title>Delete your account</Title>
      <Body tone="secondary" style={{ marginTop: space.sm, lineHeight: 21 }}>
        Request deletion of your whole GymFlow account and personal information across all gyms. Processing can take up to {data.processing_days} days.
      </Body>

      {request ? (
        <>
          <Card style={{ marginTop: space.xl }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
                <Ionicons name="document-text-outline" size={20} color={c.brand} />
                <Body weight="700">Deletion request</Body>
              </View>
              {status ? <Badge label={status.label} tone={status.tone} /> : null}
            </View>
            <Body tone="secondary" size={13} style={{ marginTop: space.md, lineHeight: 19 }}>
              {request.status_message || data.message}
            </Body>
          </Card>

          <View style={{ marginTop: space.lg }}>
            <Group>
              <Row title="Requested" right={<Body weight="600">{shortDate(request.requested_at)}</Body>} />
              <Row title="Processing due" right={<Body weight="600">{shortDate(request.due_at)}</Body>} />
              {request.completed_at ? <Row title="Completed" right={<Body weight="600">{shortDate(request.completed_at)}</Body>} /> : null}
              <Row title="Receipt" subtitle={request.id} last />
            </Group>
          </View>

          <Notice
            tone={request.status === 'completed' ? 'success' : 'warning'}
            message={request.status === 'completed'
              ? 'This request is marked completed. Some records may still be kept where required by law.'
              : 'Your account remains active until processing is completed. Some records may be retained where required by law.'}
          />
        </>
      ) : (
        <>
          <Card style={{ marginTop: space.xl }}>
            <Body weight="700">Before you continue</Body>
            <Body tone="secondary" size={13} style={{ marginTop: space.sm, lineHeight: 20 }}>
              {data.message}
            </Body>
            <Body tone="secondary" size={13} style={{ marginTop: space.sm, lineHeight: 20 }}>
              This request covers every gym linked to your GymFlow account. Existing renewals continue until they are cancelled. Your account remains available during manual processing. Payment, tax, fraud-prevention, and other records may be retained when the law requires it.
            </Body>
          </Card>

          <View style={{ marginTop: space.xl }}>
            {submitError ? <Notice message={submitError} /> : null}
            <Field
              label="Type DELETE to confirm"
              value={confirmation}
              onChangeText={(value) => { setConfirmation(value); setSubmitError(null); }}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!submitting}
              returnKeyType="done"
              onSubmitEditing={confirmSubmit}
            />
            <Button
              label="Request account deletion"
              variant="danger"
              onPress={confirmSubmit}
              loading={submitting}
              disabled={confirmation !== 'DELETE'}
            />
          </View>
        </>
      )}
    </Screen>
  );
}
