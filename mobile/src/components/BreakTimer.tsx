// Innings-break timer — a live mm:ss ticker with the brand-gradient bar.
// Null-guarded end to end: renders nothing when the field is absent.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, GRAD, GRAD_END, GRAD_START } from '../theme';
import type { InningsBreak } from '../types';

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function BreakTimer({ inningsBreak }: { inningsBreak: InningsBreak | null | undefined }) {
  const startedAt = inningsBreak?.startedAt ?? null;
  const endedAt = inningsBreak?.endedAt ?? null;
  const running = startedAt != null && endedAt == null;

  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (startedAt == null) return null;

  const reference = endedAt ?? now ?? startedAt;
  const elapsed = reference - startedAt;

  return (
    <View accessibilityLabel={`Innings break ${fmtClock(elapsed)}`}>
      <View style={styles.row}>
        <Text style={styles.label}>Innings break</Text>
        <Text style={styles.clock}>{fmtClock(elapsed)}</Text>
      </View>
      <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.bar} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
  },
  label: { color: colors.muted, fontSize: 13 },
  clock: {
    fontFamily: fonts.display,
    fontSize: 32,
    lineHeight: 36,
    color: colors.apricotInk,
  },
  bar: {
    marginTop: 10,
    height: 4,
    borderRadius: 2,
  },
});
