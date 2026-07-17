// Pure formatting / derivation helpers — ported from the web app's
// lib/format.ts (no DOM access there, none here).

import type { PublicInnings, PublicState, TimelineEntry } from './types';

export function fmtOvers(legalBalls: number): string {
  const b = Number(legalBalls) || 0;
  return `${Math.floor(b / 6)}.${b % 6}`;
}

export function fmtSR(runs: number, balls: number): string {
  if (!balls) return '—';
  return ((runs / balls) * 100).toFixed(1);
}

export function fmtEcon(runs: number, balls: number): string {
  if (!balls) return '—';
  return (runs / (balls / 6)).toFixed(2);
}

// "87/3 (9.2)" — score string for an innings.
export function fmtScore(innings: PublicInnings): string {
  const overs = innings.oversDisplay ?? fmtOvers(innings.legalBalls);
  return `${innings.runs}/${innings.wickets} (${overs})`;
}

export type BadgeKind = 'w' | 'four' | 'six' | 'extra' | 'plain';

export function badgeKind(badge: string): BadgeKind {
  if (badge === 'W') return 'w';
  if (badge === '4') return 'four';
  if (badge === '6') return 'six';
  if (/^(wd|nb|b\d|lb\d|wd\+)/.test(badge)) return 'extra';
  return 'plain';
}

// Entries of the most recent over, taken from the timeline (badges strip).
export function currentOverEntries(innings: PublicInnings | null | undefined): TimelineEntry[] {
  const tl = innings?.timeline || [];
  if (!tl.length) return [];
  const last = tl[tl.length - 1];
  const prefix = String(last.over).split('.')[0];
  const entries: TimelineEntry[] = [];
  for (let i = tl.length - 1; i >= 0; i--) {
    if (String(tl[i].over).split('.')[0] !== prefix) break;
    entries.unshift(tl[i]);
  }
  return entries;
}

// The innings currently in play, or the last one when the match is between
// innings / over. Null while the match is still in setup.
export function currentInnings(state: PublicState | null | undefined): PublicInnings | null {
  if (!state) return null;
  if (state.currentInningsIndex != null) return state.innings[state.currentInningsIndex];
  return state.innings.length ? state.innings[state.innings.length - 1] : null;
}

export function teamsLine(state: PublicState | null | undefined): string {
  if (!state?.config?.teams) return '';
  return `${state.config.teams[0].name} v ${state.config.teams[1].name}`;
}
