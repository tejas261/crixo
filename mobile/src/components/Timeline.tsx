// Full-innings timeline row (newest first — the screen's FlatList owns the
// list; this renders one row).

import { StyleSheet, Text, View } from 'react-native';
import Badge from './Badge';
import { colors, fonts } from '../theme';
import type { TimelineEntry } from '../types';

export default function TimelineRow({ entry }: { entry: TimelineEntry }) {
  return (
    <View style={styles.row}>
      <Text style={styles.over}>{entry.over}</Text>
      <Badge badge={entry.badge} boom={entry.boom} />
      <Text style={styles.text}>{entry.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 3,
  },
  over: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.muted,
    width: 40,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
});
