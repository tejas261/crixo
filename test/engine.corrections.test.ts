// test/engine.corrections.test.ts — v15 features: swap_strike, change_bowler
// (selection corrections) and add_common_player (mid-match common player).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../lib/engine';
import type { Innings, MatchConfig, MatchEvent, MatchState } from '../lib/engine';

// ---------- fixtures & helpers ----------

function makeConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    teams: [
      { name: 'Lions', players: ['Asha', 'Bina', 'Chitra', 'Devi', 'Esha'] },
      { name: 'Tigers', players: ['Kumar', 'Lalit', 'Mohan', 'Nikhil', 'Om'] },
    ],
    oversPerInnings: 3,
    battingFirstIndex: 0,
    ...overrides,
  };
}

const OPENERS: MatchEvent[] = [
  { type: 'start_innings' },
  { type: 'select_batsman', playerIndex: 0 },
  { type: 'select_batsman', playerIndex: 1 },
  { type: 'select_bowler', playerIndex: 0 },
];

const ball = (runs: number, extra: string = 'none', wicket: unknown = null) =>
  ({ type: 'ball', extra, runs, wicket }) as MatchEvent;
const bowled = () => ball(0, 'none', { kind: 'bowled', fielder: null });
const swap = () => ({ type: 'swap_strike' }) as MatchEvent;
const change = (playerIndex: number) => ({ type: 'change_bowler', playerIndex }) as MatchEvent;
const addCommon = (name: unknown) => ({ type: 'add_common_player', name }) as MatchEvent;
const selBat = (playerIndex: number) => ({ type: 'select_batsman', playerIndex }) as MatchEvent;
const selBowl = (playerIndex: number) => ({ type: 'select_bowler', playerIndex }) as MatchEvent;

function fold(events: MatchEvent[], overrides: Partial<MatchConfig> = {}): MatchState {
  return replay(makeConfig(overrides), events);
}

function ins(s: MatchState): Innings {
  return s.innings[(s.currentInningsIndex ?? s.innings.length - 1)];
}

const OVER_OF_DOTS: MatchEvent[] = Array.from({ length: 6 }, () => ball(0));

// ---------- swap_strike ----------

test('swap_strike swaps striker and non-striker', () => {
  const s = fold([...OPENERS, swap()]);
  assert.equal(ins(s).batsmen[ins(s).strikerIndex as number].playerIndex, 1);
  assert.equal(ins(s).batsmen[ins(s).nonStrikerIndex as number].playerIndex, 0);
});

test('swap_strike undo (replay without it) restores the original ends', () => {
  const withSwap = fold([...OPENERS, swap()]);
  const without = fold(OPENERS);
  assert.notEqual(ins(withSwap).strikerIndex, ins(without).strikerIndex);
  assert.equal(ins(without).batsmen[ins(without).strikerIndex as number].playerIndex, 0);
});

test('swap_strike works between overs (after the over-end auto swap)', () => {
  const base = [...OPENERS, ...OVER_OF_DOTS];
  const s = fold([...base, swap()]);
  const auto = fold(base);
  assert.equal(s.needs.newBowler, true);
  assert.notEqual(ins(s).strikerIndex, ins(auto).strikerIndex);
});

test('swap_strike is rejected outside live play', () => {
  assert.throws(() => fold([swap()]), /no innings in progress/);
});

test('swap_strike is rejected while a replacement batsman is owed', () => {
  assert.throws(
    () => fold([...OPENERS, bowled(), swap()]),
    /both batsmen must be at the crease/,
  );
});

// ---------- change_bowler ----------

test('change_bowler replaces a fresh selection and drops the phantom entry', () => {
  const s = fold([...OPENERS, change(2)]);
  const inn = ins(s);
  assert.equal(inn.bowlers.length, 1); // the mis-selected bowler left no row
  assert.equal(inn.bowlers[inn.currentBowlerIndex as number].playerIndex, 2);
  assert.equal(inn.bowlers[0].name, 'Mohan');
});

test('change_bowler keeps the row of a bowler with an earlier spell', () => {
  // Over 1: bowler 0. Over 2: bowler 1. Over 3: bowler 0 again (legal), then
  // corrected to bowler 2 — bowler 0's 6-ball row must survive.
  const s = fold([
    ...OPENERS, ...OVER_OF_DOTS,
    selBowl(1), ...OVER_OF_DOTS,
    selBowl(0), change(2),
  ]);
  const inn = ins(s);
  assert.equal(inn.bowlers.length, 3);
  assert.equal(inn.bowlers[0].playerIndex, 0);
  assert.equal(inn.bowlers[0].balls, 6);
  assert.equal(inn.bowlers[inn.currentBowlerIndex as number].playerIndex, 2);
});

test('change_bowler is rejected once any delivery has been bowled', () => {
  assert.throws(
    () => fold([...OPENERS, ball(0), change(2)]),
    /before the over starts/,
  );
  // Illegal deliveries count too (same boundary rule as boom_over).
  assert.throws(
    () => fold([...OPENERS, ball(0, 'wide'), change(2)]),
    /before the over starts/,
  );
});

test('change_bowler eligibility mirrors select_bowler', () => {
  const base = [...OPENERS, ...OVER_OF_DOTS, selBowl(1)];
  // Last over's bowler is ineligible.
  assert.throws(() => fold([...base, change(0)]), /consecutive overs/);
  // The already-selected bowler is not a change.
  assert.throws(() => fold([...base, change(1)]), /already selected/);
  // Removed players are unavailable.
  assert.throws(
    () => fold([
      ...OPENERS,
      { type: 'remove_player', teamIndex: 1, playerIndex: 2 } as MatchEvent,
      change(2),
    ]),
    /no longer available/,
  );
  // No bowler on (over just ended): nothing to change.
  assert.throws(
    () => fold([...OPENERS, ...OVER_OF_DOTS, change(2)]),
    /no bowler selected/,
  );
});

test('change_bowler undo (replay without it) restores the original bowler', () => {
  const s = fold(OPENERS);
  assert.equal(ins(s).bowlers[ins(s).currentBowlerIndex as number].playerIndex, 0);
});

// ---------- add_common_player ----------

test('add_common_player joins both rosters and is immediately selectable', () => {
  const s = fold([...OPENERS, addCommon('  Zed   Q '), bowled(), selBat(5)]);
  assert.equal(s.config.commonPlayer, 'Zed Q'); // trimmed + collapsed
  assert.equal(s.config.teams[0].players[5], 'Zed Q');
  assert.equal(s.config.teams[1].players[5], 'Zed Q');
  const inn = ins(s);
  assert.equal(inn.batsmen[inn.batsmen.length - 1].name, 'Zed Q');
});

test('add_common_player is rejected when a common player already exists', () => {
  // Create-time common player blocks it...
  assert.throws(
    () => replay(makeConfig({
      teams: [
        { name: 'Lions', players: ['Asha', 'Bina', 'Pat'] },
        { name: 'Tigers', players: ['Kumar', 'Lalit', 'Pat'] },
      ],
      commonPlayer: 'Pat',
    }), [addCommon('Zed')]),
    /already plays for both sides/,
  );
  // ...and so does a previously added one.
  assert.throws(
    () => fold([addCommon('Zed'), addCommon('Yan')]),
    /already plays for both sides/,
  );
});

test('add_common_player rejects clashes with an active name on either side', () => {
  assert.throws(() => fold([addCommon('asha')]), /already in Lions/);
  assert.throws(() => fold([addCommon('KUMAR')]), /already in Tigers/);
  assert.throws(() => fold([addCommon('   ')]), /non-empty/);
});

test('add_common_player is rejected when either squad is at 11 active', () => {
  const fill: MatchEvent[] = Array.from({ length: 6 }, (_, k) => (
    { type: 'add_player', teamIndex: 0, name: `Extra${k}` } as MatchEvent
  ));
  assert.throws(() => fold([...fill, addCommon('Zed')]), /Lions already has 11 active/);
});

test('add_common_player is rejected after the match completes', () => {
  assert.throws(
    () => fold([{ type: 'end_match' } as MatchEvent, addCommon('Zed')]),
    /after the match is completed/,
  );
});
