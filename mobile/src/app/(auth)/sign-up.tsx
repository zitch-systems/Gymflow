import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/screen';
import { Body, Button, Field, Notice, Title } from '@/components/ui';
import { useAuth } from '@/auth/context';
import { space } from '@/theme';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const { code = '', gymName = '' } = useLocalSearchParams<{ code?: string; gymName?: string }>();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!fullName.trim()) { setError('Enter your name.'); return; }
    if (!email.trim()) { setError('Enter your email address.'); return; }
    if (!password) { setError('Choose a password.'); return; }
    setBusy(true);
    setError(null);
    try {
      await signUp({ code: String(code), email: email.trim(), password, fullName: fullName.trim(), phone: phone.trim() });
    } catch (e) {
      // The password rules are the server's (lib/auth/password.ts) and it
      // returns them as a sentence — showing that verbatim beats keeping a
      // second, drifting copy of the rules in the app.
      setError(e instanceof Error ? e.message : 'Could not create your account.');
      setBusy(false);
    }
  };

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
      <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" autoComplete="new-password" returnKeyType="go" onSubmitEditing={submit} editable={!busy} />

      <Button label="Create account" onPress={submit} loading={busy} />

      <Body tone="muted" size={12} style={{ marginTop: space.lg, textAlign: 'center', lineHeight: 18 }}>
        Creating an account joins you to this gym. Your membership plan is set up
        by the gym, or you can pick one in the app once you’re in.
      </Body>
    </Screen>
  );
}
