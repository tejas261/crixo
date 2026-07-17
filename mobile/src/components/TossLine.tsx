// One-line toss sentence — console setup context, live idle card, summary.
// Renders nothing pre-toss. Also home of the "both sides" badge chip used
// everywhere the common player's name appears.

import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import type { PublicState } from '../types';

export default function TossLine({ state, center = false }: { state: PublicState; center?: boolean }) {
  const toss = state.toss;
  if (!toss) return null;
  return (
    <Text style={[styles.line, center && styles.center]}>
      <Text style={styles.strong}>{state.config.teams[toss.winnerIndex].name}</Text>
      {' '}won the toss and chose to <Text style={styles.mono}>{toss.decision}</Text> first
    </Text>
  );
}

// "Both sides" badge for the common player.
export function BothChip() {
  return (
    <View style={styles.bothChip}>
      <Text style={styles.bothChipText}>both sides</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4,
  },
  center: { textAlign: 'center' },
  strong: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.text,
  },
  bothChip: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: 'rgba(232, 89, 12, 0.35)',
    borderRadius: 999,
    backgroundColor: colors.butterPale,
  },
  bothChipText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.apricotInk,
    letterSpacing: 0.3,
  },
});
