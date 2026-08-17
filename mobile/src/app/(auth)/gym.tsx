import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { Body, Button, Field, Notice, Title, c } from '@/components/ui';
import { useAuth } from '@/auth/context';
import { storage } from '@/auth/storage';
import { space } from '@/theme';

// Step one of sign-in: which gym?
//
// GymFlow is multi-tenant and a member's account only means anything inside a
// gym, so the app asks for the short code the gym prints on its wall before it
// asks for anything personal. Resolving it first also means the sign-in screen
// can show the gym's name — the member can see they're about to hand their
// password to the right place.
export default function GymCodeScreen() {
  const router = useRouter();
  const { resolveGym } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members re-open this screen after every sign-out; retyping the same code is
  // needless friction.
  useEffect(() => {
    void storage.getLastCode().then((last) => { if (last) setCode(last); });
  }, []);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) { setError('Enter your gym code.'); return; }
    setBusy(true);
    setError(null);
    try {
      const gym = await resolveGym(trimmed);
      router.push({ pathname: '/(auth)/sign-in', params: { code: trimmed, gymName: gym.name } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find that gym.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: space.xxxl, paddingBottom: space.xl }}>
        <View style={{
          width: 56, height: 56, borderRadius: 16, backgroundColor: c.brandSoft,
          alignItems: 'center', justifyContent: 'center', marginBottom: space.xl,
        }}>
          <Body size={26} weight="800" tone="brand">GF</Body>
        </View>
        <Title>Welcome to GymFlow</Title>
        <Body tone="secondary" style={{ marginTop: space.sm, lineHeight: 21 }}>
          Enter the member code for your gym. It’s on your gym’s wall, your welcome
          email, or ask at the front desk.
        </Body>
      </View>

      {error ? <Notice message={error} /> : null}

      <Field
        label="Gym code"
        value={code}
        onChangeText={(t) => setCode(t.toUpperCase())}
        placeholder="e.g. IRON01"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />

      <Button label="Continue" onPress={submit} loading={busy} />
    </Screen>
  );
}
