// Small shared UI kit — panels, buttons, chips, labels — porting the web
// design system's .panel / .btn / .chip / .field-label styles.

import { type ReactNode } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, GRAD, GRAD_END, GRAD_START, radius, shadow, shadowSm } from '../theme';

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

// Section title with the deliberate-gradient underline.
export function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.panelTitleWrap}>
      <View style={right != null ? styles.panelTitleRow : undefined}>
        <View>
          <Text style={styles.panelTitleText}>{children}</Text>
          <LinearGradient
            colors={GRAD}
            start={GRAD_START}
            end={GRAD_END}
            style={styles.panelTitleUnderline}
          />
        </View>
        {right != null && <Text style={styles.panelTitleScore}>{right}</Text>}
      </View>
    </View>
  );
}

export type BtnVariant = 'default' | 'primary' | 'danger' | 'quiet';

interface BtnProps {
  title: string;
  onPress: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  busy?: boolean;
  pressed?: boolean; // aria-pressed look for toggle rows
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}

export function Btn({
  title, onPress, variant = 'default', disabled = false, busy = false,
  pressed = false, style, small = false,
}: BtnProps) {
  const inert = disabled || busy;
  if (variant === 'primary') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inert }}
        disabled={inert}
        onPress={onPress}
        style={({ pressed: p }) => [
          styles.btnBase, styles.btnPrimaryFrame, inert && styles.btnDisabled,
          p && !inert && styles.btnPressed, style,
        ]}
      >
        <LinearGradient
          colors={GRAD}
          start={GRAD_START}
          end={GRAD_END}
          style={[styles.btnPrimaryFill, small && styles.btnSmallFill]}
        >
          {busy
            ? <ActivityIndicator color={colors.ink} />
            : <Text style={[styles.btnText, styles.btnPrimaryText]}>{title}</Text>}
        </LinearGradient>
      </Pressable>
    );
  }
  if (variant === 'quiet') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: inert }}
        disabled={inert}
        onPress={onPress}
        style={({ pressed: p }) => [styles.btnQuiet, inert && styles.btnDisabled, p && !inert && styles.btnPressed, style]}
      >
        <Text style={styles.btnQuietText}>{title}</Text>
      </Pressable>
    );
  }
  const danger = variant === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed: p }) => [
        styles.btnBase,
        small ? styles.btnSmallFill : styles.btnFill,
        danger && styles.btnDanger,
        pressed && styles.btnToggled,
        inert && styles.btnDisabled,
        p && !inert && styles.btnPressed,
        style,
      ]}
    >
      {busy
        ? <ActivityIndicator color={danger ? '#FFFFFF' : colors.text} />
        : (
          <Text
            style={[
              styles.btnText,
              danger && styles.btnDangerText,
              pressed && styles.btnToggledText,
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
        )}
    </Pressable>
  );
}

export function Hint({ children, center = false, style }: { children: ReactNode; center?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Text style={[styles.hint, center && styles.center, style as object]}>{children}</Text>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <Text style={styles.emptyState}>{children}</Text>;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function SheetSectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sheetSectionLabel}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor="rgba(126, 106, 78, 0.7)"
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 16,
    paddingHorizontal: 14,
    marginBottom: 16,
    ...shadow,
  },
  panelTitleWrap: { marginBottom: 12 },
  panelTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
  },
  panelTitleText: {
    fontSize: 12,
    letterSpacing: 0.5,
    color: colors.muted,
  },
  panelTitleUnderline: {
    width: 26,
    height: 2,
    borderRadius: 1,
    marginTop: 6,
  },
  panelTitleScore: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
  },

  btnBase: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    ...shadowSm,
  },
  btnFill: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmallFill: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btnPrimaryFrame: {
    borderWidth: 0,
  },
  btnPrimaryFill: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  btnPrimaryText: {
    color: colors.ink,
    fontSize: 16,
  },
  btnDanger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  btnDangerText: { color: '#FFFFFF' },
  btnToggled: {
    borderColor: colors.apricotDeep,
    // Opaque equivalent of rgba(255,169,77,.14) over white: translucent
    // backgrounds + border + radius double-composite unevenly on Android
    // (visible lighter box inside the button), so pre-blend the tint.
    backgroundColor: '#FFF3E6',
  },
  btnToggledText: { color: colors.apricotInk },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { transform: [{ scale: 0.97 }] },
  btnQuiet: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  btnQuietText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '500',
  },

  hint: { color: colors.muted, fontSize: 13 },
  center: { textAlign: 'center' },
  emptyState: {
    color: colors.muted,
    fontSize: 14,
    paddingVertical: 20,
    paddingHorizontal: 4,
    textAlign: 'center',
  },
  fieldLabel: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 12,
    marginBottom: 4,
  },
  sheetSectionLabel: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
});
