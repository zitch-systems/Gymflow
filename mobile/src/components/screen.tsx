import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { c } from '@/components/ui';
import { space } from '@/theme';

// Page chrome: the app's background, the safe-area padding, and pull-to-refresh.
//
// Android is edge-to-edge (app.json), so the insets are ours to apply — without
// this the first row of every screen sits under the status bar and the last one
// under the gesture bar.

export function Screen({
  children, refreshing, onRefresh, scroll = true, padded = true, footer,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Off for screens that own their own scrolling (a FlatList) or fill the frame (the camera). */
  scroll?: boolean;
  padded?: boolean;
  /** Pinned above the tab bar — a primary action that shouldn't scroll away. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const pad = padded ? space.lg : 0;

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={{ padding: pad, paddingTop: insets.top + pad, paddingBottom: pad + space.xxl }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh
          ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.brand} colors={[c.brand]} progressBackgroundColor={c.surface} />
          : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, { padding: pad, paddingTop: insets.top + pad }]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: space.md + Math.max(insets.bottom, 0) }]}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.bg },
  fill: { flex: 1 },
  footer: {
    paddingHorizontal: space.lg, paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.surface,
  },
});
