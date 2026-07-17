// Batter card — on-strike gets the gradient treatment (gradient edge strip,
// gradient ring around the avatar, apricot bat glyph); non-striker dimmed.
// A null batsmanIndex renders the waiting placeholder so the slot is never
// blank mid-wicket.

import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Avatar, { AvatarRing, BatGlyph } from './Avatar';
import { BothChip } from './TossLine';
import { fmtSR } from '../format';
import { colors, fonts, GRAD, GRAD_END, GRAD_START, radius, shadowSm } from '../theme';
import type { PublicInnings } from '../types';

interface BatterCardProps {
  innings: PublicInnings;
  batsmanIndex: number | null;
  onStrike: boolean;
  commonName?: string | null;
}

export default function BatterCard({ innings, batsmanIndex, onStrike, commonName }: BatterCardProps) {
  if (batsmanIndex == null) {
    return (
      <View style={styles.card}>
        <Text style={styles.hint}>Waiting for next batsman…</Text>
      </View>
    );
  }
  const b = innings.batsmen[batsmanIndex];
  return (
    <View style={[styles.card, onStrike ? styles.striker : styles.nonStriker]}>
      {onStrike && (
        <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.edge} />
      )}
      {onStrike
        ? <AvatarRing name={b.name} role="batsman" size={36} />
        : <Avatar name={b.name} role="batsman" size={40} />}
      <View style={styles.main}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{b.name}</Text>
          {commonName != null && b.name === commonName && <BothChip />}
          {onStrike && <BatGlyph />}
        </View>
        <Text style={styles.sub}>
          4s <Text style={styles.subStrong}>{b.fours}</Text> · 6s{' '}
          <Text style={styles.subStrong}>{b.sixes}</Text> · SR{' '}
          <Text style={styles.subStrong}>{fmtSR(b.runs, b.balls)}</Text>
        </Text>
      </View>
      <Text style={styles.stat}>
        {b.runs}
        <Text style={styles.statBalls}> ({b.balls})</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
    ...shadowSm,
  },
  striker: {
    borderColor: 'rgba(232, 89, 12, 0.30)',
    paddingLeft: 14,
  },
  nonStriker: { opacity: 0.75 },
  edge: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  main: { flex: 1, minWidth: 0 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
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
  stat: {
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.text,
    textAlign: 'right',
  },
  statBalls: {
    fontSize: 12,
    color: colors.muted,
  },
  hint: { color: colors.muted, fontSize: 13 },
});
