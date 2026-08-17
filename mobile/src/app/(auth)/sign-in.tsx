import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { Body, Button, Field, Notice, Title } from '@/components/ui';
import { useAuth } from '@/auth/context';
import { API_BASE_URL } from '@/api/client';
import { space } from '@/theme';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { code = '', gymName = '' } = useLocalSearchParams<{ code?: string; gymName?: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true);
    setError(null);
    try {
      await signIn({ code: String(code), email: email.trim(), password });
      // No navigation here: the gate in _layout.tsx moves to the tabs the moment
      // status flips to signed-in, and a push from both places double-navigates.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign you in.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingBottom: space.xl }}>
        <Title>Sign in</Title>
        <Body tone="secondary" style={{ marginTop: space.sm }}>
          {gymName ? `Signing in to ${gymName}.` : 'Welcome back.'}
        </Body>
      </View>

      {error ? <Notice message={error} /> : null}

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!busy}
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Your password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!busy}
      />

      <Button label="Sign in" onPress={submit} loading={busy} />

      <Button
        label="New here? Create an account"
        variant="ghost"
        onPress={() => router.push({ pathname: '/(auth)/sign-up', params: { code, gymName } })}
        style={{ marginTop: space.md }}
      />

      {/* Password reset is an email round-trip and lives on the web, where the
          reset link lands. Sending the member there beats a dead end. */}
      <Pressable onPress={() => void Linking.openURL(`${API_BASE_URL}/forgot-password`)} style={{ padding: space.md, alignSelf: 'center' }}>
        <Body tone="muted" size={13}>Forgot your password?</Body>
      </Pressable>
    </Screen>
  );
}
