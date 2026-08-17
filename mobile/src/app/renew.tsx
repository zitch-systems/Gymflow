import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, EmptyState, ErrorState, Loading, Notice, Title, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { naira, plural } from '@/lib/format';
import { radius, space } from '@/theme';
import type { Plan, Plans } from '@/api/types';

// Renewing a membership.
//
// The money never touches this screen. It asks the server to open a Paystack
// checkout (/api/app/renew), hands the URL to the system browser, and waits for
// Paystack to redirect back to gymflow://pay/callback. Everything between those
// two points — card entry, 3-D Secure, the bank's own app — belongs to Paystack
// and the browser, which is exactly where a member's card details should be
// typed.
//
// The membership itself is extended server-side by the webhook (and by the
// callback route as backup), never by anything this screen is told. When the
// browser closes, the app simply asks the server what is true now.

const RETURN_URL = 'gymflow://pay/callback';

function planPeriod(p: Plan): string {
  if (p.duration_months) return plural(p.duration_months, 'month');
  if (p.duration_days) return plural(p.duration_days, 'day');
  return 'per period';
}

export default function RenewScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, refresh } = useResource<Plans>('/api/app/plans');

  const [selected, setSelected] = useState<string | null>(null);
  const [withTrainer, setWithTrainer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'danger' | 'success' } | null>(null);

  const plans = data?.plans ?? [];
  const chosen = plans.find((p) => p.id === selected) ?? null;
  const trainerOn = withTrainer && Boolean(chosen?.trainer_addon.available);
  const total = chosen ? (trainerOn ? chosen.trainer_addon.total_with_trainer : chosen.price) : 0;

  // Plain function, not useCallback: the React Compiler memoizes this itself,
  // and a hand-written dependency list on a value derived from `plans` only
  // gets in its way.
  const pay = async () => {
    if (!chosen) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post<{ ok: boolean; authorization_url: string }>('/api/app/renew', {
        plan_id: chosen.id,
        with_trainer: trainerOn,
      });

      const result = await WebBrowser.openAuthSessionAsync(res.authorization_url, RETURN_URL);

      if (result.type === 'success' && result.url.includes('status=success')) {
        setNotice({ message: 'Payment received. Your membership has been extended.', tone: 'success' });
        refresh();
      } else if (result.type === 'success') {
        setNotice({ message: 'That payment didn’t complete. Nothing has been charged — you can try again.', tone: 'danger' });
      } else {
        // dismiss / cancel: the member closed the tab. A payment may still have
        // gone through and be settling, so this stays neutral rather than
        // claiming failure — the refresh below tells the truth either way.
        setNotice({ message: 'Checkout closed. If you completed the payment, it’ll reflect here shortly.', tone: 'danger' });
        refresh();
      }
    } catch (e) {
      setNotice({ message: e instanceof Error ? e.message : 'Could not start the payment.', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Screen><Loading label="Loading plans…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;

  if (plans.length === 0) {
    return (
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <EmptyState
          title="No plans available"
          message="This gym hasn’t published any plans yet. Ask at the front desk."
          action={<Button label="Go back" variant="secondary" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }

  const current = data?.current ?? null;

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={refresh}
      footer={
        <>
          {chosen ? (
            <View style={styles.totalRow}>
              <Body tone="secondary" size={13}>Total</Body>
              <Body size={19} weight="800">{naira(total)}</Body>
            </View>
          ) : null}
          <Button
            label={chosen ? `Pay ${naira(total)}` : 'Choose a plan'}
            onPress={pay}
            loading={busy}
            disabled={!chosen}
          />
          <Body tone="muted" size={11} style={{ textAlign: 'center', marginTop: space.sm }}>
            Secured by Paystack. Your card details never touch this app.
          </Body>
        </>
      }
    >
      <Title>Choose your plan</Title>
      <Body tone="secondary" style={{ marginTop: space.sm, lineHeight: 21 }}>
        {current && current.days_left > 0
          ? `Your ${current.plan_name ?? 'membership'} renews in ${plural(current.days_left, 'day')}. Renewing early adds to your current term.`
          : 'Pick a plan to start training.'}
      </Body>

      {notice ? <View style={{ marginTop: space.lg }}><Notice message={notice.message} tone={notice.tone === 'success' ? 'success' : 'danger'} /></View> : null}

      <View style={{ marginTop: space.lg, gap: space.md }}>
        {plans.map((p) => {
          const on = p.id === selected;
          return (
            <Pressable
              key={p.id}
              onPress={() => { setSelected(p.id); setWithTrainer(false); }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Card style={[styles.plan, on && { borderColor: c.brand, borderWidth: 2 }]}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
                  <View style={[styles.radio, on && { borderColor: c.brand }]}>
                    {on ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                      <Body weight="700" size={16}>{p.name}</Body>
                      {p.is_current ? <Badge label="Current" tone="brand" /> : null}
                    </View>
                    {p.description ? (
                      <Body tone="secondary" size={12.5} style={{ marginTop: 4, lineHeight: 18 }}>{p.description}</Body>
                    ) : null}
                    <Body tone="muted" size={12} style={{ marginTop: 6 }}>{planPeriod(p)}</Body>
                  </View>
                  <Body weight="800" size={17}>{naira(p.price)}</Body>
                </View>

                {/* The trainer add-on only exists on plans the gym enabled it
                    for, and only the chosen plan's switch is live. */}
                {on && p.trainer_addon.available ? (
                  <View style={styles.addon}>
                    <View style={{ flex: 1 }}>
                      <Body size={14} weight="600">Add a private trainer</Body>
                      <Body tone="secondary" size={12} style={{ marginTop: 2 }}>
                        {p.trainer_addon.price > 0 ? `+${naira(p.trainer_addon.price)} per period` : 'Included at no extra cost'}
                      </Body>
                    </View>
                    <Switch
                      value={withTrainer}
                      onValueChange={setWithTrainer}
                      trackColor={{ false: c.elevated, true: c.brandSoft }}
                      thumbColor={withTrainer ? c.brand : c.textMuted}
                    />
                  </View>
                ) : null}
              </Card>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.reassurance}>
        <Ionicons name="lock-closed-outline" size={14} color={c.textMuted} />
        <Body tone="muted" size={11.5} style={{ flex: 1, lineHeight: 17 }}>
          Payment opens in your browser on Paystack’s secure page, then returns you here.
        </Body>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  plan: { padding: space.lg },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.brand },
  addon: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg,
    paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  reassurance: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl,
    padding: space.md, borderRadius: radius.sm, backgroundColor: c.surface,
  },
});
