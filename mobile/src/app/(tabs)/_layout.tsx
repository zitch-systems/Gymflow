import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet } from 'react-native';
import { c } from '@/components/ui';

// The five member surfaces, in the order the web PWA's bottom nav uses them:
// home, check in, classes, wallet, profile.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size - 2} /> }}
      />
      <Tabs.Screen
        name="checkin"
        options={{ title: 'Check in', tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" color={color} size={size - 2} /> }}
      />
      <Tabs.Screen
        name="classes"
        options={{ title: 'Classes', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color} size={size - 2} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: ({ color, size }) => <Ionicons name="wallet-outline" color={color} size={size - 2} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size - 2} /> }}
      />
    </Tabs>
  );
}
