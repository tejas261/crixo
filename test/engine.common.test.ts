// Common player (gully-cricket odd-headcount rule): one player listed in
// BOTH teams' squads, recorded in config.commonPlayer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, applyEvent, publicState, type MatchConfig, type MatchState } from '../lib/engine';

const cfg = (commonPlayer?: string | null): MatchConfig => ({
  teams: [
    { name: 'A', players: ['Asha', 'Bo', 'Kai'] },
    { name: 'B', players: ['Fay', 'Gus', 'Kai'] },
  ],
  oversPerInnings: 2,
  battingFirstIndex: 0,
  ...(commonPlayer === undefined ? {} : { commonPlayer }),
});

test('accepts a common player present in both squads and exposes it publicly', () => {
  const s = initState(cfg('Kai'));
  assert.equal(publicState(s).config.commonPlayer, 'Kai');
});

test('rejects a common player missing from either squad', () => {
  assert.throws(() => initState({
    ...cfg(),
    teams: [
      { name: 'A', players: ['Asha', 'Bo', 'Kai'] },
      { name: 'B', players: ['Fay', 'Gus'] },
    ],
    commonPlayer: 'Kai',
  }), /both teams/);
});

test('rejects an empty-string common player; null and absent are fine', () => {
  assert.throws(() => initState(cfg('')), /non-empty/);
  assert.equal(initState(cfg(null)).config.commonPlayer, null);
  assert.equal(initState(cfg()).config.commonPlayer ?? null, null);
});

test('the common player can bat for both sides across the two innings', () => {
  let s: MatchState = initState(cfg('Kai'));
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 }); // Kai opens for A
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 0 });
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 2 }); // Kai can't bowl here (batting side) — bowler is B's Kai? No: bowling side is B, index 2 = Kai for B.
  // Kai bowls for B while batting for A is impossible in real life, but the
  // engine's job is roster membership, not simultaneity — the umpire controls
  // reality. Score two legal balls, close the innings early, switch sides.
  s = applyEvent(s, { type: 'ball', extra: 'none', runs: 1, wicket: null });
  s = applyEvent(s, { type: 'end_innings' });
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 }); // Kai opens for B too
  const innings2 = publicState(s).innings[1]!;
  assert.equal(innings2.batsmen[0]!.name, 'Kai');
});
