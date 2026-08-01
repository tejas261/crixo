// Ball badge — the mono chip used in the over strip and timeline.
// W = danger fill, 4 = apricot outline, 6 = THE gradient, extras muted.
// `boom` wraps the chip in a gradient ring: deliveries of a boom-boom over.

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { badgeKind } from '../format';
import { colors, fonts, GRAD, GRAD_END, GRAD_START } from '../theme';

export default function Badge({ badge, boom = false }: { badge: string; boom?: boolean }) {
  const kind = badgeKind(badge);
  const chip: ReactNode = kind === 'six' ? (
    <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.base}>
      <Text style={[styles.text, styles.sixText]}>{badge}</Text>
    </LinearGradient>
  ) : (
    <View
      style={[
        styles.base,
        styles.bordered,
        kind === 'w' && styles.w,
        kind === 'four' && styles.four,
      ]}
    >
      <Text
        style={[
          styles.text,
          kind === 'w' && styles.wText,
          kind === 'four' && styles.fourText,
          kind === 'extra' && styles.extraText,
        ]}
      >
        {badge}
      </Text>
    </View>
  );
  if (!boom) return <>{chip}</>;
  return (
    <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.boomRing}>
      {chip}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bordered: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel2,
  },
  // Gradient-accent ring around boom-over deliveries.
  boomRing: {
    padding: 2,
    borderRadius: 9,
  },
  w: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  four: {
    borderColor: colors.apricotDeep,
  },
  text: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
  },
  wText: { color: '#FFFFFF' },
  fourText: { color: colors.apricotInk },
  sixText: { color: colors.ink, fontFamily: fonts.monoBold },
  extraText: { color: colors.muted },
});
