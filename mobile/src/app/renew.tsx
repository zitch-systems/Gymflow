import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Badge, Body, Button, Card, EmptyState, ErrorState, Loading, Notice, Title, c, StaleDataNotice } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { naira, plural, shortDate } from '@/lib/format';
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

function checkoutReturn(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function membershipVersion(plans: Plans | null): string {
  const current = plans?.current;
  return JSON.stringify({
    plan: current?.plan_name ?? null,
    start: current?.start_date ?? null,
    end: current?.end_date ?? null,
    state: current?.display_state ?? null,
    scheduled: plans?.plans.filter((p) => p.is_scheduled).map((p) => p.id).sort() ?? [],
  });
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export default function RenewScreen() {
  const router = useRouter();
  const { data, error, loading, refreshing, lastRefreshedAt, stale, offline, refresh, set } = useResource<Plans>('/api/app/plans');

  const [selected, setSelected] = useState<string | null>(null);
  const [withTrainer, setWithTrainer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'danger' | 'success' | 'warning' } | null>(null);

  const plans = data?.plans ?? [];
  const chosen = plans.find((p) => p.id === selected) ?? null;
  const trainerOn = withTrainer && Boolean(chosen?.trainer_addon.available);
  const total = chosen ? (trainerOn ? chosen.trainer_addon.total_with_trainer : chosen.price) : 0;

  // Plain function, not useCallback: the React Compiler memoizes this itself,
  // and a hand-written dependency list on a value derived from `plans` only
  // gets in its way.
  const pay = async () => {
    if (!chosen) return;
    const beforePayment = membershipVersion(data);
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post<{ ok: boolean; authorization_url: string; reference: string | null }>('/api/app/renew', {
        plan_id: chosen.id,
        with_trainer: trainerOn,
      });

      const result = await WebBrowser.openAuthSessionAsync(res.authorization_url, RETURN_URL);

      const callback = result.type === 'success' ? checkoutReturn(result.url) : null;
      const returnedReference = callback?.searchParams.get('reference') ?? null;
      const verified = callback?.protocol === 'gymflow:'
        && callback.hostname === 'pay'
        && callback.pathname === '/callback'
        && callback.searchParams.get('status') === 'success'
        && Boolean(res.reference)
        && returnedReference === res.reference;

      if (verified) {
        // The callback verifies the charge, but fulfilment may still be queued.
        // Poll the authoritative plans payload and only claim an update once it
        // actually changes. The webhook remains the fallback after this window.
        setNotice({ message: 'Payment verified. Confirming your membership update…', tone: 'warning' });
        let updated = false;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          if (attempt > 0) await wait(1500);
          try {
            const next = await api.get<Plans>('/api/app/plans');
            set(() => next);
            if (membershipVersion(next) !== beforePayment) {
              updated = true;
              break;
            }
          } catch {
            // Keep polling within the short confirmation window. The final
            // message remains pending and pull-to-refresh stays available.
          }
        }
        setNotice(updated
          ? { message: 'Your payment is confirmed and your membership is updated.', tone: 'success' }
          : { message: 'Payment confirmed. Your membership update is still processing; refresh again shortly.', tone: 'warning' });
      } else if (result.type === 'success') {
        // Treat malformed or mismatched callbacks as unverified. A webhook can
        // still settle a real charge, so don't tell the member to pay twice.
        setNotice({ message: 'We couldn’t confirm the checkout return. Refresh your membership before trying again.', tone: 'warning' });
        refresh();
      } else {
        // dismiss / cancel: the member closed the tab. A payment may still have
        // gone through and be settling, so this stays neutral rather than
        // claiming failure — the refresh below tells the truth either way.
        setNotice({ message: 'Checkout closed. If you completed the payment, it’ll reflect here shortly.', tone: 'warning' });
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
        {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
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
      {stale ? <StaleDataNotice lastRefreshedAt={lastRefreshedAt} offline={offline} onRetry={refresh} refreshing={refreshing} /> : null}
      <Title>Choose your plan</Title>
      <Body tone="secondary" style={{ marginTop: space.sm, lineHeight: 21 }}>
        {/* Paying while still covered is a RENEWAL: the days stack onto the end
            date rather than starting today. Naming that date is the difference
            between a member who understands what they bought and one who
            expects their new month to start this morning. */}
        {current?.display_state === 'scheduled'
          ? `Your ${current.plan_name ?? 'membership'} starts ${shortDate(current.start_date)}${current.end_date ? ` and is already set up through ${shortDate(current.end_date)}` : ''}. Paying now adds another period after that.`
          : current?.display_state === 'active'
            ? `You’re covered for another ${plural(current.days_left, 'day')}${current.end_date ? `, through ${shortDate(current.end_date)}` : ''}. Paying now is a renewal — the days are added on top of that date, so nothing you’ve already paid for is lost.`
          : 'Pick a plan to start training.'}
      </Body>

      {notice ? <View style={{ marginTop: space.lg }}><Notice message={notice.message} tone={notice.tone} /></View> : null}

      <View style={{ marginTop: space.lg, gap: space.md }}>
        {plans.map((p) => {
          const on = p.id === selected;
          return (
            <Pressable
              key={p.id}
              onPress={() => { setSelected(p.id); setWithTrainer(false); }}
              accessibilityRole="radio"
              accessibilityLabel={`${p.name}, ${naira(p.price)}, ${planPeriod(p)}`}
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
                      {p.is_current ? <Badge label="Current" tone="brand" /> : p.is_scheduled ? <Badge label="Scheduled" tone="info" /> : null}
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
                      accessibilityLabel="Add a private trainer"
                      accessibilityState={{ checked: withTrainer }}
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
