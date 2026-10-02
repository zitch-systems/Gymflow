import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Screen } from '@/components/screen';
import { Body, Button, Card, Title, c } from '@/components/ui';
import { space } from '@/theme';

// Fallback for a checkout that returns after the browser auth session has been
// dismissed or the OS has recreated the app. The active auth-session path is
// handled by renew.tsx; this route prevents the same valid deep link from
// landing on Expo Router's unmatched screen.
export default function PaymentCallbackScreen() {
  const router = useRouter();
  const { status } = useLocalSearchParams<{ status?: string | string[] }>();
  const completed = status === 'success';

  return (
    <Screen>
      <Card style={{ alignItems: 'center', marginTop: space.xxl, paddingVertical: space.xxl }}>
        <Ionicons
          name={completed ? 'checkmark-circle-outline' : 'alert-circle-outline'}
          size={64}
          color={completed ? c.brand : c.warning}
        />
        <Title style={{ textAlign: 'center', marginTop: space.lg }}>
          {completed ? 'Checkout returned' : 'Payment not confirmed'}
        </Title>
        <Body tone="secondary" style={{ textAlign: 'center', marginTop: space.sm, lineHeight: 21 }}>
          {completed
            ? 'Open your membership plans to refresh and confirm your current coverage.'
            : 'Your membership status is unchanged here. Check your plans before trying the payment again.'}
        </Body>
      </Card>
      <View style={{ marginTop: space.xl }}>
        <Button label="View membership plans" onPress={() => router.replace('/renew')} />
        <Button label="Go home" variant="ghost" onPress={() => router.replace('/(tabs)')} style={{ marginTop: space.sm }} />
      </View>
    </Screen>
  );
}
