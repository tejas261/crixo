// Signature: scoreboard plates with digit roll. Diffs each digit group
// right-aligned against the previous render so only genuinely changed digits
// roll. Nothing rolls on first paint; reduced motion swaps instantly.

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { useReducedMotion } from '../useReducedMotion';

interface ScorePlatesProps {
  runs: number;
  wickets: number;
  overs: string;
  big?: boolean;
}

interface PlateParts {
  r: string;
  w: string;
  o: string;
}

// One digit tile; when `roll` the digit slides in from above (translateY).
function PlateDigit({ char, em, roll }: { char: string; em: number; roll: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!roll || reduced) {
      anim.setValue(0);
      return;
    }
    anim.setValue(1);
    Animated.timing(anim, {
      toValue: 0,
      duration: 250,
      easing: Easing.bezier(0.2, 0.7, 0.3, 1),
      useNativeDriver: true,
    }).start();
    // A remount happens per changed char (key includes the char), so this
    // effect runs exactly once per roll.
  }, [anim, roll, reduced]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -1.05 * em * 1.26] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={[styles.plate, { width: 0.92 * em, height: 1.26 * em, borderRadius: 0.14 * em }]}>
      <Animated.Text
        style={[styles.plateDigit, { fontSize: 0.8 * em, transform: [{ translateY }], opacity }]}
      >
        {char}
      </Animated.Text>
    </View>
  );
}

export default function ScorePlates({ runs, wickets, overs, big = false }: ScorePlatesProps) {
  const parts: PlateParts = { r: String(runs), w: String(wickets), o: String(overs) };
  const em = big ? 44 : 32;      // plate scale driver (px)
  const oversEm = big ? 26 : 21;

  const prevRef = useRef<PlateParts | null>(null);
  const prev = prevRef.current;
  useEffect(() => { prevRef.current = parts; });

  const changedAt = (str: string, prevStr: string | undefined, idx: number): boolean => {
    if (!prev) return false; // first paint: no roll
    if (typeof prevStr !== 'string') return true;
    const prevIdx = prevStr.length - (str.length - idx);
    return prevIdx < 0 || prevStr[prevIdx] !== str[idx];
  };

  const group = (str: string, prevStr: string | undefined, keyPrefix: string, groupEm: number): ReactNode[] =>
    [...str].map((c, idx) => {
      if (/\d/.test(c)) {
        const roll = changedAt(str, prevStr, idx);
        return <PlateDigit key={`${keyPrefix}${idx}:${c}`} char={c} em={groupEm} roll={roll} />;
      }
      return (
        <Text key={`${keyPrefix}${idx}`} style={[styles.plateSep, { fontSize: 0.6 * groupEm }]}>
          {c}
        </Text>
      );
    });

  return (
    <View style={styles.scoreboard} accessibilityLiveRegion="polite">
      <View style={styles.plates} accessibilityLabel={`Score ${parts.r}/${parts.w}`}>
        {group(parts.r, prev?.r, 'r', em)}
        <Text style={[styles.plateSep, { fontSize: 0.6 * em }]}>/</Text>
        {group(parts.w, prev?.w, 'w', em)}
      </View>
      <View style={styles.plates} accessibilityLabel={`Overs ${parts.o}`}>
        {group(parts.o, prev?.o, 'o', oversEm)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scoreboard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 18,
    rowGap: 8,
  },
  plates: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  plateDigit: {
    fontFamily: fonts.display,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  plateSep: {
    fontFamily: fonts.display,
    color: colors.muted,
    paddingHorizontal: 1,
  },
});
