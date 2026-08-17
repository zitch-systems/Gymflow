import { Stack } from 'expo-router';
import { c } from '@/components/ui';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitle: '',
        contentStyle: { backgroundColor: c.bg },
      }}
    >
      <Stack.Screen name="gym" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
