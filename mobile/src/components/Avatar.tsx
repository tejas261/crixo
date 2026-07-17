// Avatars — inline SVG mini-illustrations, ported from the web components.
// Batter = helmet + raised bat silhouette, bowler = flat cap + wind-up arm
// with ball; initials in a cream pill at the base. hash(name) varies only
// saturation/lightness within the role hue (batters hue 28, bowlers hue 45,
// S 46–64%, L 46–58%) so every avatar harmonises with the gradient.

import { useMemo } from 'react';
import Svg, { Circle, ClipPath, Defs, G, LinearGradient as SvgLinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, GRAD, GRAD_END, GRAD_START } from '../theme';

export type AvatarRole = 'batsman' | 'bowler';

let uidCounter = 0;
function useSvgId(prefix: string): string {
  return useMemo(() => `${prefix}${++uidCounter}`, []);
}

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string): string {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0][0] || '';
  const second = words.length > 1 ? (words[words.length - 1][0] || '') : '';
  return (first + second).toUpperCase();
}

const APRICOT_HUE = 28; // hue A — batters
const AMBER_HUE = 45;   // hue B — bowlers

function palette(name: string, role: AvatarRole): { bg: string; accent: string; body: string } {
  const hue = role === 'bowler' ? AMBER_HUE : APRICOT_HUE;
  const h = nameHash(String(name));
  const sat = 46 + (h % 4) * 6;          // 46–64%
  const lit = 46 + ((h >> 3) % 4) * 4;   // 46–58%
  return {
    bg: `hsl(${hue}, ${sat}%, ${lit}%)`,
    accent: `hsl(${hue}, 100%, 88%)`,    // pale warm highlight (bat, cap, ball)
    body: 'rgba(74, 43, 15, 0.88)',      // dark-ink figure on the mid-tone fill
  };
}

interface FigureProps {
  accent: string;
  body: string;
}

function BatterFigure({ accent, body }: FigureProps) {
  return (
    <>
      {/* raised bat */}
      <Rect
        x={24.6} y={2.6} width={4.6} height={14.5} rx={2.3}
        fill={accent} transform="rotate(32 26.9 9.9)"
      />
      {/* arm up to the bat */}
      <Path d="M21.5 17.6 L25.9 11.9" stroke={body} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      {/* torso */}
      <Path d="M11.5 31 Q12 20.6 16.6 18.8 Q21.2 17.3 24.2 20.3 Q26.7 23 27.2 31 Z" fill={body} />
      {/* head */}
      <Circle cx={16.8} cy={12.6} r={4.4} fill={body} />
      {/* helmet shell */}
      <Path d="M12.1 12.2 A4.7 4.7 0 0 1 21.5 12.2 Z" fill={accent} />
      {/* helmet peak */}
      <Path d="M11.9 12.6 H22.7" stroke={accent} strokeWidth={1.8} strokeLinecap="round" fill="none" />
      {/* grille */}
      <Path d="M13.1 13.6 l-0.5 2 M15.2 13.8 l-0.3 2" stroke={accent} strokeWidth={1.1} strokeLinecap="round" fill="none" />
    </>
  );
}

function BowlerFigure({ accent, body }: FigureProps) {
  return (
    <>
      {/* wind-up arm, straight up */}
      <Path d="M23.4 19.6 L26.1 7.6" stroke={body} strokeWidth={2.8} strokeLinecap="round" fill="none" />
      {/* ball in hand */}
      <Circle cx={26.6} cy={5.8} r={2.4} fill={accent} />
      {/* seam */}
      <Path d="M25.1 5.2 a2.4 2.4 0 0 0 3 1.2" stroke="rgba(74, 43, 15, 0.55)" strokeWidth={0.7} fill="none" />
      {/* torso */}
      <Path d="M12.4 31 Q13.4 21 19.4 19.2 Q24.8 17.8 27.4 22.5 Q28.6 25.4 28.8 31 Z" fill={body} />
      {/* head */}
      <Circle cx={19.2} cy={12.8} r={4.4} fill={body} />
      {/* flat cap */}
      <Path d="M14.7 12.1 A4.6 4.6 0 0 1 23.9 12.1 Z" fill={accent} />
      {/* cap brim, forward */}
      <Path d="M13.1 12.5 H21.2" stroke={accent} strokeWidth={1.8} strokeLinecap="round" fill="none" />
    </>
  );
}

interface AvatarProps {
  name: string;
  role: AvatarRole;
  size?: number;
}

export default function Avatar({ name, role, size = 40 }: AvatarProps) {
  const clipId = useSvgId('avclip');
  const { bg, accent, body } = palette(name, role);
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessibilityLabel={name}>
      <Defs>
        <ClipPath id={clipId}>
          <Circle cx={20} cy={20} r={19} />
        </ClipPath>
      </Defs>
      <Circle cx={20} cy={20} r={19} fill={bg} />
      <G clipPath={`url(#${clipId})`}>
        {role === 'bowler'
          ? <BowlerFigure accent={accent} body={body} />
          : <BatterFigure accent={accent} body={body} />}
        {/* initials pill */}
        <Rect x={9.5} y={28.5} width={21} height={9.5} rx={4.75} fill="rgba(255, 250, 238, 0.92)" />
        <SvgText
          x={20}
          y={35.6}
          textAnchor="middle"
          fontSize={7.4}
          fontWeight="700"
          letterSpacing={0.6}
          fill="#4A2B0F"
        >
          {initials(name)}
        </SvgText>
      </G>
      <Circle cx={20} cy={20} r={19} fill="none" stroke={colors.line} strokeWidth={1} />
    </Svg>
  );
}

// On-strike gradient ring around the avatar (the web's .avatar-ring).
export function AvatarRing({ name, role, size = 36 }: AvatarProps) {
  return (
    <LinearGradient colors={GRAD} start={GRAD_START} end={GRAD_END} style={styles.ring}>
      <Avatar name={name} role={role} size={size} />
    </LinearGradient>
  );
}

// Small bat glyph for the on-strike batsman (apricot).
export function BatGlyph({ size = 14 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      <Path
        d="M9.2 1.2 L14.8 6.8 L8.6 13 a1.6 1.6 0 0 1 -2.3 0 L3 9.7 a1.6 1.6 0 0 1 0 -2.3 Z"
        fill={colors.apricotDeep} opacity={0.9}
      />
      <Path
        d="M3.4 10.3 L1.2 12.5 a1.1 1.1 0 0 0 0 1.6 l0.7 0.7 a1.1 1.1 0 0 0 1.6 0 L5.7 12.6 Z"
        fill={colors.apricotDeep}
      />
    </Svg>
  );
}

// Gradient trophy for the summary result banner.
export function TrophyMark({ size = 40 }: { size?: number }) {
  const gradId = useSvgId('trophy');
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Defs>
        <SvgLinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFA94D" />
          <Stop offset="1" stopColor="#FFD43B" />
        </SvgLinearGradient>
      </Defs>
      <Path
        d="M14 11 H7.5 v3.5 c0 5 3.2 8.4 8 9.4 M34 11 h6.5 v3.5 c0 5 -3.2 8.4 -8 9.4"
        fill="none" stroke={`url(#${gradId})`} strokeWidth={2.4} strokeLinecap="round"
      />
      <Path
        d="M13.5 7 h21 v6.5 c0 8.5 -4.4 13.6 -10.5 14.8 c-6.1 -1.2 -10.5 -6.3 -10.5 -14.8 Z"
        fill={`url(#${gradId})`}
      />
      <Path
        d="M24 12.2 l1.5 3 3.3 0.5 -2.4 2.3 0.6 3.3 -3 -1.6 -3 1.6 0.6 -3.3 -2.4 -2.3 3.3 -0.5 Z"
        fill="rgba(74, 43, 15, 0.55)"
      />
      <Rect x={21.8} y={28} width={4.4} height={6} fill={`url(#${gradId})`} />
      <Rect x={15.5} y={34} width={17} height={4.5} rx={2.25} fill={`url(#${gradId})`} />
    </Svg>
  );
}

// Illustrated empty state for the home "Live now" list: stumps waiting for a
// delivery, ball mid-flight on a dotted arc.
export function EmptyStateArt() {
  const gradId = useSvgId('nolive');
  return (
    <View style={styles.emptyArt}>
      <Svg width={136} height={78} viewBox="0 0 132 76">
        <Defs>
          <SvgLinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#FFA94D" />
            <Stop offset="1" stopColor="#FFD43B" />
          </SvgLinearGradient>
        </Defs>
        {/* ground */}
        <Path d="M18 62 H114" stroke={colors.line} strokeWidth={2} strokeLinecap="round" />
        {/* stumps */}
        <Rect x={76} y={26} width={4.5} height={36} rx={2.25} fill={colors.panel2} stroke={colors.line} strokeWidth={1} />
        <Rect x={86} y={26} width={4.5} height={36} rx={2.25} fill={colors.panel2} stroke={colors.line} strokeWidth={1} />
        <Rect x={96} y={26} width={4.5} height={36} rx={2.25} fill={colors.panel2} stroke={colors.line} strokeWidth={1} />
        {/* bails */}
        <Rect x={77} y={22.5} width={10.5} height={3} rx={1.5} fill={colors.muted} opacity={0.7} />
        <Rect x={89} y={22.5} width={10.5} height={3} rx={1.5} fill={colors.muted} opacity={0.7} />
        {/* flight path */}
        <Path
          d="M22 24 Q 46 8 68 22"
          fill="none" stroke={colors.muted} strokeWidth={1.6}
          strokeLinecap="round" strokeDasharray="1 6" opacity={0.8}
        />
        {/* ball */}
        <Circle cx={22} cy={26} r={7} fill={`url(#${gradId})`} />
        <Path d="M17.5 21.5 a7 7 0 0 0 9 9" fill="none" stroke="rgba(74, 43, 15, 0.45)" strokeWidth={1.2} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    padding: 2,
    borderRadius: 999,
  },
  emptyArt: {
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
});
