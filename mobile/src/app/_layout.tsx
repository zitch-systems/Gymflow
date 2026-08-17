import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/context';
import { c } from '@/components/ui';

void SplashScreen.preventAutoHideAsync();

// The gate. Everything under (tabs) needs a member; everything under (auth)
// needs the absence of one. Doing this in one place — rather than a redirect in
// each screen — means there is no route that can be reached in the wrong state,
// including the ones a deep link jumps straight into.
function Gate() {
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  const inAuthGroup = segments[0] === '(auth)';

  useEffect(() => {
    if (status === 'loading') return;
    void SplashScreen.hideAsync();
    if (status === 'signed-out' && !inAuthGroup) router.replace('/(auth)/gym');
    else if (status === 'signed-in' && inAuthGroup) router.replace('/(tabs)');
  }, [status, inAuthGroup, router]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: c.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      <Stack.Screen name="renew" options={{ title: 'Membership plans' }} />
      <Stack.Screen name="receipt/[id]" options={{ title: 'Receipt' }} />
      <Stack.Screen name="edit-profile" options={{ title: 'Edit profile' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
