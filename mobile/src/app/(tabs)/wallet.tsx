import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, EmptyState, ErrorState, Group, Loading, Row, SectionTitle, Title, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { naira, shortDate } from '@/lib/format';
import { radius, space } from '@/theme';
import type { Wallet } from '@/api/types';

const STATUS_LABEL: Record<string, string> = {
  successful: 'Successful', pending: 'Pending', failed: 'Failed', refunded: 'Refunded',
};

export default function WalletScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useResource<Wallet>('/api/app/wallet');

  if (loading && !data) return <Screen><Loading label="Loading your wallet…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;
  if (!data) return <Screen><EmptyState title="Nothing here yet" /></Screen>;

  const { subscription: sub, months, transactions, cards } = data;
  const maxMonth = Math.max(1, ...months.map((m) => m.amount));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Title>Wallet</Title>

      <Card style={{ marginTop: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="wallet-outline" size={16} color={c.textSecondary} />
          <Body tone="secondary" size={13}>Total spent</Body>
        </View>
        <Body size={32} weight="800" style={{ marginTop: space.sm }}>{naira(data.total_spent)}</Body>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
          <Ionicons name="repeat-outline" size={15} color={c.textMuted} />
          <Body tone="muted" size={12.5}>
            {sub && sub.days_left > 0 ? `Renews ${shortDate(sub.end_date)}` : 'No active membership'}
          </Body>
        </View>
        <Button label="Renew plan" onPress={() => router.push('/renew')} style={{ marginTop: space.lg }} />
      </Card>

      {/* Six-month spend, as bars — the same chart the web wallet draws. */}
      {months.some((m) => m.amount > 0) ? (
        <Card style={{ marginTop: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Body weight="700">{naira(data.this_month)} <Body tone="secondary" size={12}>spent this month</Body></Body>
            <Body tone="muted" size={11}>Last 6 months</Body>
          </View>
          <View style={styles.bars}>
            {months.map((m, i) => (
              <View key={`${m.label}-${i}`} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View style={[
                    styles.barFill,
                    { height: `${Math.max(2, Math.round((m.amount / maxMonth) * 100))}%` },
                    i === months.length - 1 && { backgroundColor: c.brand },
                  ]} />
                </View>
                <Body tone="muted" size={10.5}>{m.label}</Body>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      <SectionTitle>Membership</SectionTitle>
      <Group>
        <Row
          icon={<Ionicons name="card-outline" size={18} color={c.brand} />}
          title="Renew or change plan"
          subtitle={sub?.plan_name
            ? `${sub.plan_name} · ${sub.days_left > 0 ? `renews ${shortDate(sub.end_date)}` : 'expired'}`
            : 'Pick a plan to start training'}
          right={<Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
          onPress={() => router.push('/renew')}
          last
        />
      </Group>

      <SectionTitle>Payment methods</SectionTitle>
      <Group>
        {cards.length > 0 ? cards.map((card, i) => (
          <Row
            key={card.id}
            icon={<Ionicons name="card" size={18} color={c.brand} />}
            title={`•••• ${card.last4 ?? '????'}`}
            subtitle={`${(card.brand ?? 'Card').toUpperCase()} · expires ${card.exp_month ?? '--'}/${card.exp_year ?? '--'}`}
            right={card.is_default ? <Badge label="Default" tone="brand" /> : undefined}
            last={i === cards.length - 1}
          />
        )) : (
          <Row
            icon={<Ionicons name="card-outline" size={18} color={c.textSecondary} />}
            title="No saved cards"
            subtitle="A card is saved automatically the first time you pay with Paystack"
            last
          />
        )}
      </Group>

      <SectionTitle>Transactions</SectionTitle>
      <Group>
        {transactions.length > 0 ? transactions.map((t, i) => {
          const refund = t.status === 'refunded';
          return (
            <Row
              key={t.id}
              icon={<Ionicons name={refund ? 'arrow-down-outline' : 'card-outline'} size={18} color={refund ? c.success : c.brand} />}
              title="Membership payment"
              subtitle={`${shortDate(t.date)} · ${t.method}`}
              right={
                <View style={{ alignItems: 'flex-end' }}>
                  <Body weight="700" size={14} tone={refund ? 'success' : 'default'}>
                    {refund ? '+' : '−'}{naira(t.amount)}
                  </Body>
                  <Body tone="muted" size={11}>{STATUS_LABEL[t.status ?? ''] ?? t.status}</Body>
                </View>
              }
              onPress={() => router.push(`/receipt/${t.id}`)}
              last={i === transactions.length - 1}
            />
          );
        }) : (
          <Row
            icon={<Ionicons name="receipt-outline" size={18} color={c.textSecondary} />}
            title="No payments yet"
            subtitle="Renewals show here"
            last
          />
        )}
      </Group>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, height: 96 },
  barCol: { flex: 1, alignItems: 'center', gap: 6 },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: c.elevated, borderRadius: radius.xs, overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: c.borderLight, borderRadius: radius.xs },
});
