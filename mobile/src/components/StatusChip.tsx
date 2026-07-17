// Match status chip — pulsing gradient dot when live (pulse disabled under
// reduced motion).

import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, GRAD, GRAD_END, GRAD_START } from '../theme';
import { useReducedMotion } from '../useReducedMotion';
import type { MatchStatus } from '../types';

export function LiveDot() {
  const pulse = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) {
      pulse.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 950, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 950, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <Animated.View style={{ opacity: pulse, transform: [{ scale: pulse }] }}>
      <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.dot} />
    </Animated.View>
  );
}

export default function StatusChip({ status }: { status: MatchStatus }) {
  if (status === 'live') {
    return (
      <View style={[styles.chip, styles.chipLive]}>
        <LiveDot />
        <Text style={styles.chipTextLive}>Live</Text>
      </View>
    );
  }
  const label = status === 'completed'
    ? 'Completed'
    : status === 'innings_break'
      ? 'Innings break'
      : 'Setting up';
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
  },
  chipLive: {
    borderColor: colors.apricot,
    backgroundColor: colors.panel2,
  },
  chipText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.muted,
  },
  chipTextLive: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.text,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
