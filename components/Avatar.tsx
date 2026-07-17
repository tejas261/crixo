'use client';

// Avatars — inline SVG, no images. Each is a small geometric illustration
// clipped to the circle: batter = helmet + raised bat silhouette, bowler =
// flat cap + wind-up arm with ball. Initials sit in a cream pill at the base.
// Per-player variation stays inside the two brand hues: batters lean apricot
// (soft orange), bowlers lean golden amber — hash(name) only varies
// saturation and lightness within the hue, so every avatar harmonises with
// the gradient. Fills are mid-tone warm with dark-ink figures so the
// illustrations stay readable on the light theme's white panels.

import { useId } from 'react';

export type AvatarRole = 'batsman' | 'bowler';

// useId output can contain characters (: « ») that are unreliable inside SVG
// url(#…) references; strip to a safe unique token.
function useSvgId(prefix: string): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '');
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
    bg: `hsl(${hue} ${sat}% ${lit}%)`,
    accent: `hsl(${hue} 100% 88%)`,      // pale warm highlight (bat, cap, ball)
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
      <rect
        x="24.6" y="2.6" width="4.6" height="14.5" rx="2.3"
        fill={accent} transform="rotate(32 26.9 9.9)"
      />
      {/* arm up to the bat */}
      <path
        d="M21.5 17.6 L25.9 11.9"
        stroke={body} strokeWidth="2.6" strokeLinecap="round" fill="none"
      />
      {/* torso */}
      <path
        d="M11.5 31 Q12 20.6 16.6 18.8 Q21.2 17.3 24.2 20.3 Q26.7 23 27.2 31 Z"
        fill={body}
      />
      {/* head */}
      <circle cx="16.8" cy="12.6" r="4.4" fill={body} />
      {/* helmet shell */}
      <path d="M12.1 12.2 A4.7 4.7 0 0 1 21.5 12.2 Z" fill={accent} />
      {/* helmet peak */}
      <path
        d="M11.9 12.6 H22.7"
        stroke={accent} strokeWidth="1.8" strokeLinecap="round" fill="none"
      />
      {/* grille */}
      <path
        d="M13.1 13.6 l-0.5 2 M15.2 13.8 l-0.3 2"
        stroke={accent} strokeWidth="1.1" strokeLinecap="round" fill="none"
      />
    </>
  );
}

function BowlerFigure({ accent, body }: FigureProps) {
  return (
    <>
      {/* wind-up arm, straight up */}
      <path
        d="M23.4 19.6 L26.1 7.6"
        stroke={body} strokeWidth="2.8" strokeLinecap="round" fill="none"
      />
      {/* ball in hand */}
      <circle cx="26.6" cy="5.8" r="2.4" fill={accent} />
      {/* seam */}
      <path
        d="M25.1 5.2 a2.4 2.4 0 0 0 3 1.2"
        stroke="rgba(74, 43, 15, 0.55)" strokeWidth="0.7" fill="none"
      />
      {/* torso */}
      <path
        d="M12.4 31 Q13.4 21 19.4 19.2 Q24.8 17.8 27.4 22.5 Q28.6 25.4 28.8 31 Z"
        fill={body}
      />
      {/* head */}
      <circle cx="19.2" cy="12.8" r="4.4" fill={body} />
      {/* flat cap */}
      <path d="M14.7 12.1 A4.6 4.6 0 0 1 23.9 12.1 Z" fill={accent} />
      {/* cap brim, forward */}
      <path
        d="M13.1 12.5 H21.2"
        stroke={accent} strokeWidth="1.8" strokeLinecap="round" fill="none"
      />
    </>
  );
}

interface AvatarProps {
  name: string;
  role: AvatarRole;
  small?: boolean;
}

// role: 'batsman' | 'bowler'
export default function Avatar({ name, role, small = false }: AvatarProps) {
  const clipId = useSvgId('avclip');
  const { bg, accent, body } = palette(name, role);
  return (
    <svg
      className={`avatar${small ? ' avatar-sm' : ''}`}
      viewBox="0 0 40 40"
      role="img"
      aria-label={name}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="20" cy="20" r="19" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="19" fill={bg} />
      <g clipPath={`url(#${clipId})`}>
        {role === 'bowler'
          ? <BowlerFigure accent={accent} body={body} />
          : <BatterFigure accent={accent} body={body} />}
        {/* initials pill */}
        <rect x="9.5" y="28.5" width="21" height="9.5" rx="4.75" fill="rgba(255, 250, 238, 0.92)" />
        <text
          x="20"
          y="35.6"
          textAnchor="middle"
          style={{ fontFamily: 'var(--font-body), sans-serif' }}
          fontSize="7.4"
          fontWeight="700"
          letterSpacing="0.6"
          fill="#4A2B0F"
        >
          {initials(name)}
        </text>
      </g>
      <circle cx="20" cy="20" r="19" fill="none" stroke="var(--line)" strokeWidth="1" />
    </svg>
  );
}

// Small bat glyph for the on-strike batsman (apricot via CSS currentColor).
export function BatGlyph() {
  return (
    <svg className="bat-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9.2 1.2 L14.8 6.8 L8.6 13 a1.6 1.6 0 0 1 -2.3 0 L3 9.7 a1.6 1.6 0 0 1 0 -2.3 Z"
        fill="currentColor" opacity="0.9"
      />
      <path
        d="M3.4 10.3 L1.2 12.5 a1.1 1.1 0 0 0 0 1.6 l0.7 0.7 a1.1 1.1 0 0 0 1.6 0 L5.7 12.6 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// Gradient trophy for the summary result banner.
export function TrophyMark() {
  const gradId = useSvgId('trophy');
  return (
    <svg className="trophy-mark" viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFA94D" />
          <stop offset="1" stopColor="#FFD43B" />
        </linearGradient>
      </defs>
      {/* handles */}
      <path
        d="M14 11 H7.5 v3.5 c0 5 3.2 8.4 8 9.4 M34 11 h6.5 v3.5 c0 5 -3.2 8.4 -8 9.4"
        fill="none" stroke={`url(#${gradId})`} strokeWidth="2.4" strokeLinecap="round"
      />
      {/* cup */}
      <path
        d="M13.5 7 h21 v6.5 c0 8.5 -4.4 13.6 -10.5 14.8 c-6.1 -1.2 -10.5 -6.3 -10.5 -14.8 Z"
        fill={`url(#${gradId})`}
      />
      {/* star on the cup */}
      <path
        d="M24 12.2 l1.5 3 3.3 0.5 -2.4 2.3 0.6 3.3 -3 -1.6 -3 1.6 0.6 -3.3 -2.4 -2.3 3.3 -0.5 Z"
        fill="rgba(74, 43, 15, 0.55)"
      />
      {/* stem + base */}
      <rect x="21.8" y="28" width="4.4" height="6" fill={`url(#${gradId})`} />
      <rect x="15.5" y="34" width="17" height="4.5" rx="2.25" fill={`url(#${gradId})`} />
    </svg>
  );
}

// Illustrated empty state for the home "Live now" list: stumps waiting for a
// delivery, ball mid-flight on a dotted arc.
export function EmptyStateArt() {
  const gradId = useSvgId('nolive');
  return (
    <svg className="empty-art" viewBox="0 0 132 76" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFA94D" />
          <stop offset="1" stopColor="#FFD43B" />
        </linearGradient>
      </defs>
      {/* ground */}
      <line x1="18" y1="62" x2="114" y2="62" stroke="var(--line)" strokeWidth="2" strokeLinecap="round" />
      {/* stumps */}
      <rect x="76" y="26" width="4.5" height="36" rx="2.25" fill="var(--panel-2)" stroke="var(--line)" strokeWidth="1" />
      <rect x="86" y="26" width="4.5" height="36" rx="2.25" fill="var(--panel-2)" stroke="var(--line)" strokeWidth="1" />
      <rect x="96" y="26" width="4.5" height="36" rx="2.25" fill="var(--panel-2)" stroke="var(--line)" strokeWidth="1" />
      {/* bails */}
      <rect x="77" y="22.5" width="10.5" height="3" rx="1.5" fill="var(--muted)" opacity="0.7" />
      <rect x="89" y="22.5" width="10.5" height="3" rx="1.5" fill="var(--muted)" opacity="0.7" />
      {/* flight path */}
      <path
        d="M22 24 Q 46 8 68 22"
        fill="none" stroke="var(--muted)" strokeWidth="1.6"
        strokeLinecap="round" strokeDasharray="1 6" opacity="0.8"
      />
      {/* ball */}
      <circle cx="22" cy="26" r="7" fill={`url(#${gradId})`} />
      <path
        d="M17.5 21.5 a7 7 0 0 0 9 9"
        fill="none" stroke="rgba(74, 43, 15, 0.45)" strokeWidth="1.2"
      />
    </svg>
  );
}
