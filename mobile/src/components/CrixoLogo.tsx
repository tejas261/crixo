// Crixo brand mark — two crossed cricket bats forming an X with the leather
// ball above, on the signature apricot→butter gradient badge. Ported from
// the web app's components/Logo.tsx to react-native-svg.

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { colors, fonts } from '../theme';

let uidCounter = 0;

export function CrixoMark({ size = 24 }: { size?: number }) {
  const gradId = useMemo(() => `cx-grad-${++uidCounter}`, []);
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityLabel="Crixo logo">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFB86B" />
          <Stop offset="1" stopColor="#FFE08A" />
        </LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={22} fill={`url(#${gradId})`} />
      {/* crossed bats: blade+handle as one rounded rect each, ink */}
      <G fill="#4A2B0F">
        <Rect x={21.3} y={12.5} width={5.4} height={27} rx={2.7} transform="rotate(30 24 26)" />
        <Rect x={21.3} y={12.5} width={5.4} height={27} rx={2.7} transform="rotate(-30 24 26)" />
      </G>
      {/* leather ball with cream seam */}
      <Circle cx={24} cy={11.6} r={4.7} fill="#C63D08" />
      <Path
        d="M20.9 10.2 a4.4 4.4 0 0 1 6.2 0"
        stroke="#FFF9F0"
        strokeWidth={1.1}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

// Header wordmark — taps back to the home screen.
export function Wordmark() {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => {
        if (router.canGoBack()) router.dismissTo('/');
        else router.replace('/');
      }}
      style={styles.row}
    >
      <CrixoMark size={22} />
      <Text style={styles.word}>CRIXO</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  word: {
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: 0.9,
    color: colors.text,
  },
});
