import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';

type IconName = keyof typeof Feather.glyphMap;

export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useColors();
  return (
    <View style={[
      styles.surface,
      { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 8 },
      style,
    ]}>
      {children}
    </View>
  );
}

export function AppButton({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  testID?: string;
}) {
  const colors = useColors();
  const backgroundColor = variant === 'primary'
    ? colors.primary
    : variant === 'danger'
      ? colors.destructive
      : colors.secondary;
  const foregroundColor = variant === 'secondary' ? colors.foreground : colors.primaryForeground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        if (disabled || loading) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, borderRadius: colors.radius + 7 },
        disabled && styles.disabled,
        pressed && !disabled && !loading && styles.pressed,
      ]}
    >
      {loading
        ? <ActivityIndicator color={foregroundColor} />
        : <>
            {icon && <Feather name={icon} size={17} color={foregroundColor} />}
            <Text style={[styles.buttonText, { color: foregroundColor }]}>{label}</Text>
          </>}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  helper,
  style,
  ...inputProps
}: TextInputProps & { label: string; error?: string; helper?: string }) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        style={[
          styles.input,
          {
            backgroundColor: colors.background,
            borderColor: error ? colors.destructive : colors.border,
            borderRadius: colors.radius + 5,
            color: colors.foreground,
          },
          style,
        ]}
      />
      {error
        ? <Text style={[styles.helper, { color: colors.destructive }]}>{error}</Text>
        : helper
          ? <Text style={[styles.helper, { color: colors.mutedForeground }]}>{helper}</Text>
          : null}
    </View>
  );
}

export function StatusPill({ status, label }: { status: string; label: string }) {
  const colors = useColors();
  const lowerStatus = status.toLowerCase();
  const tone = ['completed', 'closed'].includes(lowerStatus)
    ? colors.success
    : ['cancelled', 'canceled'].includes(lowerStatus)
      ? colors.destructive
      : lowerStatus === 'in_progress'
        ? colors.primary
        : colors.warning;

  return (
    <View style={[styles.pill, { backgroundColor: `${tone}18`, borderColor: `${tone}55` }]}>
      <View style={[styles.pillDot, { backgroundColor: tone }]} />
      <Text style={[styles.pillText, { color: tone }]}>{label}</Text>
    </View>
  );
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  const colors = useColors();
  return (
    <View style={styles.state}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.stateText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.state}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
        <Feather name={icon} size={24} color={colors.primary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.stateText, { color: colors.mutedForeground }]}>{description}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    padding: 16,
  },
  button: {
    minHeight: 52,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  buttonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  helper: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.55,
  },
  state: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 12,
  },
  stateText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 290,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    marginBottom: 3,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    textAlign: 'center',
  },
});