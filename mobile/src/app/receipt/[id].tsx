import { Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Body, Button, Card, ErrorState, Group, Loading, Row, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { naira, shortDate } from '@/lib/format';
import { space } from '@/theme';
import type { Receipt } from '@/api/types';

const STATUS_LABEL: Record<string, string> = {
  successful: 'Successful', pending: 'Pending', failed: 'Failed', refunded: 'Refunded',
};

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refreshing, refresh } = useResource<{ receipt: Receipt }>(`/api/app/wallet/${id}`);

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><ErrorState message="Receipt not found." /></Screen>;

  const r = data.receipt;
  const ok = r.status === 'successful';
  const pending = r.status === 'pending';

  const share = () => {
    void Share.share({
      message: [
        `${r.gym} — payment receipt`,
        `${naira(r.amount)} · ${r.plan}`,
        `${shortDate(r.date)} · ${r.method}`,
        `Reference: ${r.reference}`,
      ].join('\n'),
    });
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Card style={styles.hero}>
        <View style={[
          styles.ring,
          !ok && !pending && { backgroundColor: c.dangerSoft, borderColor: c.danger },
          pending && { backgroundColor: c.warningSoft, borderColor: c.warning },
        ]}>
          <Ionicons
            name={ok ? 'checkmark' : pending ? 'time-outline' : 'close'}
            size={36}
            color={ok ? c.brand : pending ? c.warning : c.danger}
          />
        </View>
        <Body size={30} weight="800" style={{ marginTop: space.lg }}>{naira(r.amount)}</Body>
        <Body tone="secondary" style={{ marginTop: 4 }}>{r.plan}</Body>
      </Card>

      <View style={{ marginTop: space.lg }}>
        <Group>
          <Row title="Status" right={<Body weight="600" tone={ok ? 'success' : pending ? 'warning' : 'danger'}>{STATUS_LABEL[r.status ?? ''] ?? r.status ?? '—'}</Body>} />
          <Row title="Date" right={<Body weight="600">{shortDate(r.date)}</Body>} />
          <Row title="Method" right={<Body weight="600">{r.method}</Body>} />
          <Row title="Gym" right={<Body weight="600">{r.gym}</Body>} />
          <Row
            title="Reference"
            subtitle="Tap to copy"
            right={<Ionicons name="copy-outline" size={16} color={c.textMuted} />}
            onPress={() => void Clipboard.setStringAsync(r.reference)}
            last
          />
        </Group>
      </View>

      <Body tone="muted" size={11.5} style={{ marginTop: space.md, textAlign: 'center' }} numberOfLines={2}>
        {r.reference}
      </Body>

      <Button
        label="Share receipt"
        variant="secondary"
        icon={<Ionicons name="share-outline" size={17} color={c.text} />}
        onPress={share}
        style={{ marginTop: space.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space.xxl },
  ring: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: c.brandSoft,
    borderWidth: 2, borderColor: c.brand, alignItems: 'center', justifyContent: 'center',
  },
});
