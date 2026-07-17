// Shared page scaffold: warm white -> peach -> butter page wash, safe-area
// padding, and the site header (wordmark + teams line + a right-hand slot).

import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wordmark } from './CrixoLogo';
import { colors } from '../theme';

export function PageBackground({ children }: { children: ReactNode }) {
  return (
    <LinearGradient
      colors={['#FFFDF8', colors.bg, '#FFF3DA']}
      locations={[0, 0.48, 1]}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={styles.fill}
    >
      {children}
    </LinearGradient>
  );
}

interface SiteHeaderProps {
  teams?: string;
  right?: ReactNode;
}

export function SiteHeader({ teams, right }: SiteHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <Wordmark />
      {teams ? (
        <Text style={styles.teams} numberOfLines={1}>{teams}</Text>
      ) : null}
      <View style={styles.spacer} />
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    marginBottom: 16,
  },
  teams: {
    color: colors.muted,
    fontSize: 13,
    flexShrink: 1,
  },
  spacer: { flexGrow: 1, flexShrink: 0 },
});
