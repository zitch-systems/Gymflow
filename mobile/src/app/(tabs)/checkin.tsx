import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Body, Button, Card, ErrorState, Group, Loading, Notice, Row, SectionTitle, Title, c } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { clockTime, dayMonth, duration, plural } from '@/lib/format';
import { radius, space } from '@/theme';
import type { CheckinState } from '@/api/types';

// Check in and out.
//
// Three ways in, same as the web: scan the QR at the door, tap to self
// check-in, or take a 6-digit code to the front desk. Which direction each one
// runs depends on whether the member is currently inside — the server is the
// authority on that, and every gate (lapsed membership, suspended member, gym
// switched off) is enforced there too. This screen only decides what to draw.

const METHOD_LABEL: Record<string, string> = {
  self: 'Self', qr: 'QR scan', front_desk: 'Front desk', code: 'Front-desk code', manual: 'Manual',
};

// How often to ask whether reception has redeemed the code on screen.
const CODE_POLL_MS = 4000;

export default function CheckinScreen() {
  const { data, error, loading, refreshing, refresh, set } = useResource<CheckinState>('/api/app/checkin');

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { direction: 'in' | 'out'; note: string | null }>(null);
  const [scanning, setScanning] = useState(false);
  const [code, setCode] = useState<{ value: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [permission, requestPermission] = useCameraPermissions();

  // The camera fires onBarcodeScanned repeatedly while the code is in frame;
  // without this latch one scan becomes a dozen check-in requests.
  const scanLatch = useRef(false);

  const checkedIn = data?.checked_in ?? false;

  const run = useCallback(async (action: 'in' | 'out') => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ ok: boolean; checked_in: boolean; days_left?: number | null }>('/api/app/checkin', { action });
      setCode(null);
      setDone({
        direction: action,
        note: action === 'in' && res.days_left != null ? `${plural(res.days_left, 'day')} left on your plan.` : null,
      });
      // Optimistic flip so the screen behind the success panel is already right;
      // the refresh then brings the real visit history.
      set((cur) => ({ ...cur, checked_in: res.checked_in }));
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not complete that.');
      // "You're not checked in right now" means the server and this screen
      // disagree — auto-checkout ran, or reception closed the visit. Believe the
      // server rather than insisting the member is still inside.
      if (e instanceof Error && /not checked in/i.test(e.message)) refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, set]);

  const getCode = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ ok: boolean; code: string; expires_at: string }>('/api/app/checkin', { action: 'code' });
      setNow(Date.now());
      setCode({ value: res.code, expiresAt: new Date(res.expires_at).getTime() });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not get a code.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Tick the countdown, and watch for reception redeeming the code so the phone
  // flips to the success panel without the member having to do anything.
  useEffect(() => {
    if (!code) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await api.post<{ checked_in: boolean }>('/api/app/checkin', { action: 'state' });
        if (res.checked_in !== checkedIn) {
          setCode(null);
          setDone({ direction: res.checked_in ? 'in' : 'out', note: null });
          set((cur) => ({ ...cur, checked_in: res.checked_in }));
          refresh();
        }
      } catch {
        // A dropped poll is not worth a message — the countdown keeps running
        // and the next tick tries again.
      }
    }, CODE_POLL_MS);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [code, checkedIn, refresh, set]);

  const openScanner = useCallback(async () => {
    setActionError(null);
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        setActionError('Camera access is needed to scan the door QR. You can still tap to check in below.');
        return;
      }
    }
    scanLatch.current = false;
    setScanning(true);
  }, [permission, requestPermission]);

  const onScanned = useCallback((value: string) => {
    if (scanLatch.current) return;
    scanLatch.current = true;
    setScanning(false);
    // The door QR encodes the gym's /checkin?via=qr URL. Anything else is
    // somebody's Wi-Fi code or a poster — say so rather than silently doing
    // nothing.
    if (/\/checkin/i.test(value) || /[?&]via=qr/i.test(value)) {
      void run(checkedIn ? 'out' : 'in');
    } else {
      setActionError('That isn’t this gym’s check-in code. Scan the QR at the entrance.');
    }
  }, [checkedIn, run]);

  if (loading && !data) return <Screen><Loading label="Checking your status…" /></Screen>;
  if (error && !data) return <Screen refreshing={refreshing} onRefresh={refresh}><ErrorState message={error} onRetry={refresh} /></Screen>;

  // ── Success panel ────────────────────────────────────────────────────────
  if (done) {
    return (
      <Screen>
        <View style={styles.successWrap}>
          <View style={styles.ring}><Ionicons name="checkmark" size={44} color={c.brand} /></View>
          <Title style={{ textAlign: 'center' }}>{done.direction === 'in' ? 'You’re in!' : 'See you next time!'}</Title>
          <Body tone="secondary" style={{ textAlign: 'center', marginTop: space.sm }}>
            {done.direction === 'in' ? 'Checked in just now' : 'Checked out just now'}{done.note ? ` · ${done.note}` : ''}
          </Body>
          <Button label="Done" variant="secondary" onPress={() => setDone(null)} style={{ marginTop: space.xxl, alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  // ── Front-desk code ──────────────────────────────────────────────────────
  if (code) {
    const secondsLeft = Math.max(0, Math.ceil((code.expiresAt - now) / 1000));
    const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;
    return (
      <Screen>
        <Title style={{ textAlign: 'center' }}>Show this at the desk</Title>
        <Body tone="secondary" style={{ textAlign: 'center', marginTop: space.sm }}>
          Reception enters this code to check you {checkedIn ? 'out' : 'in'}.
        </Body>

        <Card style={styles.codeCard}>
          <Body
            size={44}
            weight="800"
            style={styles.codeDigits}
            accessibilityLabel={`Your code is ${code.value.split('').join(' ')}`}
          >
            {code.value}
          </Body>
          {secondsLeft > 0
            ? <Body tone="secondary" size={13} style={{ marginTop: space.sm }}>Expires in {countdown}</Body>
            : <Body tone="danger" size={13} style={{ marginTop: space.sm }}>This code has expired.</Body>}
        </Card>

        {actionError ? <Notice message={actionError} /> : null}

        {secondsLeft === 0 ? (
          <Button label="Get a new code" onPress={getCode} loading={busy} style={{ marginTop: space.lg }} />
        ) : null}
        <Button label="Back" variant="ghost" onPress={() => setCode(null)} style={{ marginTop: space.md }} />
      </Screen>
    );
  }

  // ── Default ──────────────────────────────────────────────────────────────
  const history = data?.history ?? [];
  const inTime = clockTime(data?.checked_in_at ?? null);

  return (
    <>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Title style={{ textAlign: 'center' }}>{checkedIn ? 'Check out' : 'Check in'}</Title>
        <Body tone="secondary" style={{ textAlign: 'center', marginTop: space.sm, lineHeight: 21 }}>
          {checkedIn
            ? `You’re checked in${inTime ? ` since ${inTime}` : ''}. Scan the door QR on your way out, or tap below.`
            : 'Scan the gym’s QR code at the entrance, or tap to self check-in.'}
        </Body>

        {actionError ? <View style={{ marginTop: space.lg }}><Notice message={actionError} /></View> : null}

        <Pressable onPress={openScanner} style={styles.scanTarget} accessibilityRole="button" accessibilityLabel="Open the camera to scan the door QR">
          <Ionicons name="qr-code-outline" size={64} color={c.brand} />
          <Body tone="secondary" size={13} style={{ marginTop: space.md }}>Tap to scan the door QR</Body>
        </Pressable>

        <Button
          label={`Scan to check ${checkedIn ? 'out' : 'in'}`}
          icon={<Ionicons name="camera-outline" size={18} color={c.onBrand} />}
          onPress={openScanner}
          disabled={busy}
        />
        <Button
          label={`Get front-desk check-${checkedIn ? 'out' : 'in'} code`}
          variant="secondary"
          icon={<Ionicons name="keypad-outline" size={18} color={c.text} />}
          onPress={getCode}
          loading={busy}
          style={{ marginTop: space.md }}
        />
        <Button
          label={busy ? '' : `Or tap to self check-${checkedIn ? 'out' : 'in'}`}
          variant="ghost"
          onPress={() => void run(checkedIn ? 'out' : 'in')}
          loading={busy}
          style={{ marginTop: space.sm }}
        />

        {history.length > 0 ? (
          <>
            <SectionTitle>Recent visits</SectionTitle>
            <Group>
              {history.map((v, i) => {
                const inT = clockTime(v.checked_in_at);
                const outT = clockTime(v.checked_out_at);
                const dur = duration(v.checked_in_at, v.checked_out_at);
                const stillIn = v.status === 'active' && !v.checked_out_at;
                return (
                  <Row
                    key={v.id}
                    icon={<Ionicons name="scan-outline" size={18} color={c.brand} />}
                    title={dayMonth(v.checked_in_at)}
                    subtitle={[
                      `${inT ?? '—'}${outT ? ` – ${outT}` : ''}`,
                      dur,
                      v.method ? (METHOD_LABEL[v.method] ?? v.method) : null,
                    ].filter(Boolean).join(' · ')}
                    right={stillIn ? <Body tone="brand" size={12} weight="700">In gym</Body> : null}
                    last={i === history.length - 1}
                  />
                );
              })}
            </Group>
          </>
        ) : null}
      </Screen>

      <Modal visible={scanning} animationType="slide" onRequestClose={() => setScanning(false)} statusBarTranslucent>
        <View style={styles.cameraRoot}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data: value }) => onScanned(value)}
          />
          <View style={styles.cameraOverlay} pointerEvents="box-none">
            <View style={styles.reticle} />
            <Body size={14} style={{ color: '#fff', marginTop: space.xl, textAlign: 'center' }}>
              Point at the QR code by the door
            </Body>
            <Button label="Cancel" variant="secondary" onPress={() => setScanning(false)} style={styles.cameraCancel} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxxl },
  ring: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: c.brandSoft,
    borderWidth: 2, borderColor: c.brand, alignItems: 'center', justifyContent: 'center', marginBottom: space.xl,
  },
  codeCard: { alignItems: 'center', paddingVertical: space.xxl, marginTop: space.xxl, marginBottom: space.lg },
  codeDigits: { letterSpacing: 8, color: c.brand },
  scanTarget: {
    alignItems: 'center', justifyContent: 'center', height: 200,
    borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: c.border,
    backgroundColor: c.surface, marginVertical: space.xxl,
  },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  reticle: { width: 240, height: 240, borderRadius: radius.lg, borderWidth: 3, borderColor: c.brand },
  cameraCancel: { position: 'absolute', left: space.xl, right: space.xl, bottom: space.xxxl },
});
