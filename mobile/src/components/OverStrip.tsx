// Current-over badge strip.

import { StyleSheet, View } from 'react-native';
import { currentOverEntries } from '../format';
import Badge from './Badge';
import { Hint } from './ui';
import type { PublicInnings } from '../types';

export default function OverStrip({ innings }: { innings: PublicInnings | null | undefined }) {
  const entries = innings ? currentOverEntries(innings) : [];
  if (!entries.length) {
    return <Hint>No balls bowled in this over yet.</Hint>;
  }
  return (
    <View style={styles.strip}>
      {entries.map((e, idx) => <Badge key={idx} badge={e.badge} boom={e.boom} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 28,
  },
});
