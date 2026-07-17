// Bowler card with O-M-R-W and economy. Pass bowler=null for the waiting
// placeholder (text differs per page, hence the prop).

import { StyleSheet, Text, View } from 'react-native';
import Avatar from './Avatar';
import { BothChip } from './TossLine';
import { fmtEcon, fmtOvers } from '../format';
import { colors, fonts, radius, shadowSm } from '../theme';
import type { PublicBowler } from '../types';

interface BowlerCardProps {
  bowler: PublicBowler | null;
  waitingText?: string;
  commonName?: string | null;
}

export default function BowlerCard({ bowler, waitingText = 'Waiting for a bowler…', commonName }: BowlerCardProps) {
  if (!bowler) {
    return (
      <View style={styles.card}>
        <Text style={styles.hint}>{waitingText}</Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <Avatar name={bowler.name} role="bowler" size={40} />
      <View style={styles.main}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{bowler.name}</Text>
          {commonName != null && bowler.name === commonName && <BothChip />}
        </View>
        <Text style={styles.sub}>
          O <Text style={styles.subStrong}>{fmtOvers(bowler.balls)}</Text> · M{' '}
          <Text style={styles.subStrong}>{bowler.maidens}</Text> · R{' '}
          <Text style={styles.subStrong}>{bowler.runs}</Text> · W{' '}
          <Text style={styles.subStrong}>{bowler.wickets}</Text> · Econ{' '}
          <Text style={styles.subStrong}>{fmtEcon(bowler.runs, bowler.balls)}</Text>
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...shadowSm,
  },
  main: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: {
    fontWeight: '600',
    fontSize: 15,
    color: colors.text,
    flexShrink: 1,
  },
  sub: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  subStrong: { color: colors.text },
  hint: { color: colors.muted, fontSize: 13 },
});
