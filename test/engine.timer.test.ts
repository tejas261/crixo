// test/engine.timer.test.ts — wall-clock timer fields (startedAt / endedAt /
// inningsBreak) driven by the `at` stamp the store puts on accepted events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initState, applyEvent, replay, publicState } from '../lib/engine';
import type { MatchConfig, MatchEvent } from '../lib/engine';

function makeConfig(): MatchConfig {
  return {
    teams: [
      { name: 'Lions', players: ['Asha', 'Bina', 'Chitra'] },
      { name: 'Tigers', players: ['Kumar', 'Lalit', 'Mohan'] },
    ],
    oversPerInnings: 1,
    battingFirstIndex: 0,
  };
}

// Event log for a full 1-over innings: openers + bowler, then 6 dots.
// `ats` maps event index offsets to timestamps (events are plain otherwise).
function inningsEvents(startAt?: number, lastBallAt?: number): MatchEvent[] {
  return [
    { type: 'start_innings', ...(startAt !== undefined ? { at: startAt } : {}) },
    { type: 'select_batsman', playerIndex: 0 },
    { type: 'select_batsman', playerIndex: 1 },
    { type: 'select_bowler', playerIndex: 0 },
    ...Array.from({ length: 6 }, (_, i) => ({
      type: 'ball',
      extra: 'none',
      runs: 0,
      wicket: null,
      ...(i === 5 && lastBallAt !== undefined ? { at: lastBallAt } : {}),
    })),
  ] as MatchEvent[];
}

test('initState: timer fields present and null', () => {
  const s = initState(makeConfig());
  assert.equal(s.startedAt, null);
  assert.equal(s.endedAt, null);
  assert.equal(s.inningsBreak, null);
});

test('timer fields populated when events carry `at`', () => {
  const events: MatchEvent[] = [
    ...inningsEvents(1_000, 60_000), // innings 1: starts at 1000, closes at 60000
    { type: 'start_innings', at: 300_000 }, // innings 2 after a 240s break
    ...inningsEvents(undefined, undefined).slice(1, 4), // openers + bowler
  ];
  let s = replay(makeConfig(), events);

  assert.equal(s.startedAt, 1_000);
  assert.deepEqual(s.inningsBreak, { startedAt: 60_000, endedAt: 300_000, durationMs: 240_000 });
  assert.equal(s.endedAt, null); // match still live

  // Complete the match: 6 dots, last one stamped.
  for (let i = 0; i < 6; i++) {
    s = applyEvent(s, { type: 'ball', extra: 'none', runs: 0, wicket: null, ...(i === 5 ? { at: 999_000 } : {}) });
  }
  assert.equal(s.status, 'completed');
  assert.equal(s.endedAt, 999_000);
  assert.equal(s.startedAt, 1_000); // untouched by later events

  const ps = publicState(s);
  assert.equal(ps.startedAt, 1_000);
  assert.equal(ps.endedAt, 999_000);
  assert.deepEqual(ps.inningsBreak, { startedAt: 60_000, endedAt: 300_000, durationMs: 240_000 });
});

test('end_innings and end_match stamp transitions too', () => {
  let s = replay(makeConfig(), inningsEvents(500, undefined).slice(0, 5)); // 1 ball bowled
  s = applyEvent(s, { type: 'end_innings', at: 7_000 });
  assert.equal(s.status, 'innings_break');
  assert.deepEqual(s.inningsBreak, { startedAt: 7_000, endedAt: null, durationMs: null });

  s = applyEvent(s, { type: 'end_match', at: 8_000 });
  assert.equal(s.status, 'completed');
  assert.equal(s.endedAt, 8_000);
});

test('events without `at` (existing behavior) leave all timer fields null', () => {
  const events: MatchEvent[] = [...inningsEvents(), { type: 'start_innings' }];
  const s = replay(makeConfig(), events);
  assert.equal(s.startedAt, null);
  assert.equal(s.endedAt, null);
  assert.deepEqual(s.inningsBreak, { startedAt: null, endedAt: null, durationMs: null });

  const ps = publicState(s);
  assert.equal(ps.startedAt, null);
  assert.equal(ps.endedAt, null);
  assert.deepEqual(ps.inningsBreak, { startedAt: null, endedAt: null, durationMs: null });
});

test('mixed stamps: break start unstamped -> durationMs stays null', () => {
  const events: MatchEvent[] = [...inningsEvents(1_000, undefined), { type: 'start_innings', at: 90_000 }];
  const s = replay(makeConfig(), events);
  assert.deepEqual(s.inningsBreak, { startedAt: null, endedAt: 90_000, durationMs: null });
});

test('undo of start_innings(2) restores endedAt/durationMs to null (replay)', () => {
  const events: MatchEvent[] = [...inningsEvents(1_000, 60_000), { type: 'start_innings', at: 300_000 }];
  const before = replay(makeConfig(), events);
  assert.deepEqual(before.inningsBreak, { startedAt: 60_000, endedAt: 300_000, durationMs: 240_000 });

  // Server undo = pop the last event and replay the log.
  const after = replay(makeConfig(), events.slice(0, -1));
  assert.equal(after.status, 'innings_break');
  assert.deepEqual(after.inningsBreak, { startedAt: 60_000, endedAt: null, durationMs: null });
  assert.equal(after.startedAt, 1_000);
  assert.equal(after.endedAt, null);
});
