import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { API_BASE_URL } from '@/api/client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { Body, Button, Field, Notice, Title } from '@/components/ui';
import { useAuth } from '@/auth/context';
import { space } from '@/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const { code = '', gymName = '', gymSlug = '' } = useLocalSearchParams<{ code?: string; gymName?: string; gymSlug?: string }>();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  useEffect(() => {
    if (!String(code).trim()) router.replace('/(auth)/gym');
  }, [code, router]);

  const submit = async () => {
    if (actionLock.current) return;
    if (!String(code).trim()) { router.replace('/(auth)/gym'); return; }
    if (!fullName.trim()) { setError('Enter your name.'); return; }
    if (!email.trim()) { setError('Enter your email address.'); return; }
    if (!password) { setError('Choose a password.'); return; }
    actionLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await signUp({ code: String(code), email: email.trim(), password, fullName: fullName.trim(), phone: phone.trim() });
      if (result === 'confirmation-required') {
        setConfirmationRequired(true);
        actionLock.current = false;
        setBusy(false);
      }
    } catch (e) {
      // The password rules are the server's (lib/auth/password.ts) and it
      // returns them as a sentence — showing that verbatim beats keeping a
      // second, drifting copy of the rules in the app.
      setError(e instanceof Error ? e.message : 'Could not create your account.');
      actionLock.current = false;
      setBusy(false);
    }
  };

  if (!String(code).trim()) return <Screen><View /></Screen>;

  if (confirmationRequired) {
    return (
      <Screen>
        <View style={{ paddingTop: space.xxxl }}>
          <Title>Check your email</Title>
          <Body tone="secondary" style={{ marginTop: space.sm, lineHeight: 21 }}>
            Your account was created for {gymName || 'your gym'}. Open the confirmation
            link sent to {email.trim()}, then sign in.
          </Body>
          <View style={{ marginTop: space.xl }}>
            <Notice message="Account created. Confirm your email to finish signing up." tone="success" />
          </View>
          <Button
            label="Back to sign in"
            variant="secondary"
            onPress={() => router.replace({ pathname: '/(auth)/sign-in', params: { code, gymName, gymSlug } })}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ paddingBottom: space.xl }}>
        <Title>Create your account</Title>
        <Body tone="secondary" style={{ marginTop: space.sm }}>
          {gymName ? `You’ll be joined to ${gymName}.` : 'Join your gym on GymFlow.'}
        </Body>
      </View>

      {error ? <Notice message={error} /> : null}

      <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Ada Obi" autoCapitalize="words" autoComplete="name" editable={!busy} />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoCorrect={false} editable={!busy} />
      <Field label="Phone (optional)" value={phone} onChangeText={setPhone} placeholder="0803 123 4567" keyboardType="phone-pad" autoComplete="tel" editable={!busy} />
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" autoComplete="new-password" autoCorrect={false} returnKeyType="go" onSubmitEditing={submit} editable={!busy} />

      <Body tone="secondary" size={12} style={{ marginBottom: space.md, lineHeight: 18 }}>
        By creating an account, you agree to GymFlow’s terms and privacy policy.
      </Body>
      <Button label="Read terms & privacy" variant="ghost" disabled={busy} onPress={() => { void Linking.openURL(`${API_BASE_URL}/legal`).catch(() => setError('Could not open terms and privacy. Please try again.')); }} style={{ marginBottom: space.md }} />
      <Button label="Create account" onPress={submit} loading={busy} />

      <Body tone="muted" size={12} style={{ marginTop: space.lg, textAlign: 'center', lineHeight: 18 }}>
        Creating an account joins you to this gym. Your membership plan is set up
        by the gym, or you can pick one in the app once you’re in.
      </Body>
    </Screen>
  );
}
