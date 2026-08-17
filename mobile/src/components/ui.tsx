import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { palettes, radius, space } from '@/theme';

// The app's shared vocabulary of surfaces, buttons and states.
//
// Everything is built against the dark palette from src/theme.ts, which is the
// same palette the member PWA uses, so a member moving between the two doesn't
// change products.

export const c = palettes.dark;

// ── Text ───────────────────────────────────────────────────────────────────

type TextTone = 'default' | 'secondary' | 'muted' | 'brand' | 'danger' | 'success' | 'warning';

const TONE: Record<TextTone, string> = {
  default: c.text,
  secondary: c.textSecondary,
  muted: c.textMuted,
  brand: c.brand,
  danger: c.danger,
  success: c.success,
  warning: c.warning,
};

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.title, style]}>{children}</Text>;
}

export function Heading({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Body({
  children, tone = 'default', size = 15, weight = '400', style, numberOfLines, accessibilityLabel,
}: {
  children: ReactNode;
  tone?: TextTone;
  size?: number;
  weight?: TextStyle['fontWeight'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  /** Overrides what a screen reader announces — e.g. reading a check-in code
   *  digit by digit instead of as one six-figure number. */
  accessibilityLabel?: string;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityLabel={accessibilityLabel}
      style={[{ color: TONE[tone], fontSize: size, fontWeight: weight }, style]}
    >
      {children}
    </Text>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionTitleText}>{children}</Text>
      {action}
    </View>
  );
}

// ── Surfaces ───────────────────────────────────────────────────────────────

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** A list of rows inside one bordered surface — the web's `.group`. */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.group, style]}>{children}</View>;
}

export function Row({
  icon, title, subtitle, right, onPress, danger, last,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string | null;
  right?: ReactNode;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const content = (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      {icon ? <View style={[styles.rowIcon, danger && { backgroundColor: c.dangerSoft }]}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, danger && { color: c.danger }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} android_ripple={{ color: 'rgba(255,255,255,0.06)' }}>
      {content}
    </Pressable>
  );
}

// ── Buttons ────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label, onPress, variant = 'primary', loading, disabled, icon, style, size = 'lg',
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const off = Boolean(disabled || loading);
  const pad = size === 'sm' ? 8 : size === 'md' ? 12 : 15;
  const variantStyle: ViewStyle =
    variant === 'primary' ? { backgroundColor: c.brand }
    : variant === 'danger' ? { backgroundColor: c.dangerSoft, borderWidth: 1, borderColor: c.danger }
    : variant === 'secondary' ? { backgroundColor: c.elevated, borderWidth: 1, borderColor: c.border }
    : { backgroundColor: 'transparent' };
  const labelColor =
    variant === 'primary' ? c.onBrand
    : variant === 'danger' ? c.danger
    : variant === 'ghost' ? c.textSecondary
    : c.text;

  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      android_ripple={variant === 'ghost' ? undefined : { color: 'rgba(0,0,0,0.12)' }}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: Boolean(loading) }}
      style={[styles.button, variantStyle, { paddingVertical: pad }, off && { opacity: 0.55 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonLabel, { color: labelColor, fontSize: size === 'sm' ? 13 : 15 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

// ── Badges + states ────────────────────────────────────────────────────────

type BadgeTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  brand: { bg: c.brandSoft, fg: c.brand },
  success: { bg: c.successSoft, fg: c.success },
  warning: { bg: c.warningSoft, fg: c.warning },
  danger: { bg: c.dangerSoft, fg: c.danger },
  info: { bg: c.infoSoft, fg: c.info },
  neutral: { bg: c.elevated, fg: c.textSecondary },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const t = BADGE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.badgeText, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ label, size = 42 }: { label: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: c.brand, fontWeight: '800', fontSize: size * 0.4 }}>{label}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={c.brand} />
      {label ? <Text style={[styles.rowSubtitle, { marginTop: space.md }]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

/** An inline error with a retry — what every screen shows when a fetch fails. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.rowIcon, { backgroundColor: c.dangerSoft, marginBottom: space.md }]}>
        <Text style={{ color: c.danger, fontSize: 20, fontWeight: '700' }}>!</Text>
      </View>
      <Text style={styles.emptyTitle}>Something went wrong</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: space.lg, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

/** A message pinned above a form — the thing that tells a member WHY it failed. */
export function Notice({ message, tone = 'danger' }: { message: string; tone?: BadgeTone }) {
  const t = BADGE[tone];
  return (
    <View style={[styles.notice, { backgroundColor: t.bg, borderColor: t.fg }]} accessibilityLiveRegion="polite">
      <Text style={{ color: t.fg, fontSize: 13.5, lineHeight: 19 }}>{message}</Text>
    </View>
  );
}

// ── Form fields ────────────────────────────────────────────────────────────

export const Field = forwardRef<TextInput, TextInputProps & { label: string; hint?: string }>(
  function Field({ label, hint, style, ...props }, ref) {
    return (
      <View style={{ marginBottom: space.lg }}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <TextInput
          ref={ref}
          placeholderTextColor={c.textMuted}
          style={[styles.input, style]}
          {...props}
        />
        {hint ? <Text style={[styles.rowSubtitle, { marginTop: 6 }]}>{hint}</Text> : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  title: { color: c.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  heading: { color: c.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  sectionTitle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: space.xl, marginBottom: space.md,
  },
  sectionTitleText: { color: c.textSecondary, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    padding: space.lg,
  },
  group: {
    backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: 14, paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
  },
  rowIcon: {
    width: 38, height: 38, borderRadius: radius.sm, backgroundColor: c.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { color: c.text, fontSize: 15, fontWeight: '600' },
  rowSubtitle: { color: c.textSecondary, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    borderRadius: radius.sm, paddingHorizontal: space.lg,
  },
  buttonLabel: { fontWeight: '700' },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  avatar: { backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.lg },
  emptyTitle: { color: c.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyMessage: { color: c.textSecondary, fontSize: 13.5, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  notice: { borderRadius: radius.sm, borderWidth: 1, padding: space.md, marginBottom: space.lg },
  fieldLabel: { color: c.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 7 },
  input: {
    backgroundColor: c.elevated, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm,
    paddingHorizontal: space.lg, paddingVertical: 13, color: c.text, fontSize: 15,
  },
});
