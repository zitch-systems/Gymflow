import { Share, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Body, Button, Card, ErrorState, Group, Loading, Row, c, StaleDataNotice } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { naira, shortDate } from '@/lib/format';
import { space } from '@/theme';
import type { Receipt } from '@/api/types';

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const receiptId = typeof id === 'string' ? id.trim() : '';
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh } = useResource<{ receipt: Receipt }>(
    receiptId ? `/api/app/wallet/${encodeURIComponent(receiptId)}` : '',
  );

  if (!receiptId) return <Screen><ErrorState message="Receipt not found." /></Screen>;

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><ErrorState message="Receipt not found." /></Screen>;

  const r = data.receipt;
  const ok = r.status === 'successful';
  const pending = r.status === 'pending';
  const refund = r.refund_state !== 'none';

  const share = () => {
    void Share.share({
      message: [
        `${r.gym} — payment receipt`,
        `${naira(r.amount)} net · ${r.plan}`,
        ...(refund ? [`${naira(r.refunded_amount)} refunded from ${naira(r.gross_amount)}`] : []),
        `${shortDate(r.date)} · ${r.method}`,
        `Reference: ${r.reference}`,
      ].join('\n'),
    });
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <Card style={styles.hero}>
        <View style={[
          styles.ring,
          !ok && !pending && !refund && { backgroundColor: c.dangerSoft, borderColor: c.danger },
          refund && { backgroundColor: c.warningSoft, borderColor: c.warning },
          pending && { backgroundColor: c.warningSoft, borderColor: c.warning },
        ]}>
          <Ionicons
            name={refund ? 'arrow-down-outline' : ok ? 'checkmark' : pending ? 'time-outline' : 'close'}
            size={36}
            color={refund ? c.warning : ok ? c.brand : pending ? c.warning : c.danger}
          />
        </View>
        <Body size={30} weight="800" style={{ marginTop: space.lg }}>{naira(r.amount)}</Body>
        <Body tone="secondary" style={{ marginTop: 4 }}>{r.plan}</Body>
      </Card>

      <View style={{ marginTop: space.lg }}>
        <Group>
          <Row title="Status" right={<Body weight="600" tone={refund || pending ? 'warning' : ok ? 'success' : 'danger'}>{r.status_label}</Body>} />
          {refund ? <Row title="Original charge" right={<Body weight="600">{naira(r.gross_amount)}</Body>} /> : null}
          {refund ? <Row title="Refunded" right={<Body weight="600" tone="warning">{naira(r.refunded_amount)}</Body>} /> : null}
          {refund ? <Row title="Net paid" right={<Body weight="600">{naira(r.amount)}</Body>} /> : null}
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
