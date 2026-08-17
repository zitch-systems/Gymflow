import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { c } from '@/components/ui';

// The launch route. It renders nothing but a spinner: the redirect decision
// belongs to the gate in _layout.tsx, which is the only place that knows
// whether the stored session survived. Anything drawn here would be a frame of
// the wrong screen.
export default function Boot() {
  return (
    <View style={styles.root}>
      <ActivityIndicator color={c.brand} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' },
});
