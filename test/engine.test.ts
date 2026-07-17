// test/engine.test.ts — node:test unit tests for lib/engine.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initState, applyEvent, replay, publicState } from '../lib/engine';
import type { MatchConfig, MatchEvent, MatchState } from '../lib/engine';

// ---------- fixtures & helpers ----------

function makeConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    teams: [
      { name: 'Lions', players: ['Asha', 'Bina', 'Chitra', 'Devi', 'Esha'] },
      { name: 'Tigers', players: ['Kumar', 'Lalit', 'Mohan', 'Nikhil', 'Om'] },
    ],
    oversPerInnings: 2,
    battingFirstIndex: 0,
    ...overrides,
  };
}

const openingEvents: MatchEvent[] = [
  { type: 'start_innings' },
  { type: 'select_batsman', playerIndex: 0 }, // striker
  { type: 'select_batsman', playerIndex: 1 }, // non-striker
  { type: 'select_bowler', playerIndex: 0 },
];

function liveState(overrides: Partial<MatchConfig> = {}) {
  return replay(makeConfig(overrides), openingEvents);
}

// Intentionally loose: many tests feed invalid extras/wickets to assert rejection.
function ball(state: MatchState, runs: number, extra: string = 'none', wicket: unknown = null) {
  return applyEvent(state, { type: 'ball', extra, runs, wicket } as MatchEvent);
}

function ins(state: MatchState, i: number | null = null) {
  return state.innings[(i ?? state.currentInningsIndex)!];
}

function strikerName(state: MatchState) {
  const inn = ins(state);
  return inn.batsmen[inn.strikerIndex!].name;
}

function nonStrikerName(state: MatchState) {
  const inn = ins(state);
  return inn.batsmen[inn.nonStrikerIndex!].name;
}

// Bowl a full over of dot balls, then bring on the given next bowler.
function dotOver(state: MatchState, nextBowler?: number) {
  for (let i = 0; i < 6; i++) state = ball(state, 0);
  if (nextBowler !== undefined) {
    state = applyEvent(state, { type: 'select_bowler', playerIndex: nextBowler });
  }
  return state;
}

// ---------- init / lifecycle ----------

test('initState: setup status, needs.startInnings, empty innings', () => {
  const s = initState(makeConfig());
  assert.equal(s.status, 'setup');
  assert.equal(s.currentInningsIndex, null);
  assert.deepEqual(s.needs, { openers: false, newBatsman: false, newBowler: false, startInnings: true });
  assert.deepEqual(s.innings, []);
});

test('applyEvent does not mutate its input state', () => {
  const s0 = initState(makeConfig());
  const frozen = JSON.stringify(s0);
  const s1 = applyEvent(s0, { type: 'start_innings' });
  assert.equal(JSON.stringify(s0), frozen);
  assert.notEqual(s1.status, s0.status);
});

test('start_innings then openers flow: needs progress correctly', () => {
  let s = applyEvent(initState(makeConfig()), { type: 'start_innings' });
  assert.equal(s.status, 'live');
  assert.equal(s.needs.openers, true);
  assert.equal(s.needs.newBowler, true);
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 0 });
  assert.equal(s.needs.openers, true);
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 1 });
  assert.equal(s.needs.openers, false);
  assert.equal(s.needs.newBowler, true);
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 2 });
  assert.deepEqual(s.needs, { openers: false, newBatsman: false, newBowler: false, startInnings: false });
});

test('replay equals folding applyEvent', () => {
  const cfg = makeConfig();
  const events: MatchEvent[] = [...openingEvents, { type: 'ball', extra: 'none', runs: 4, wicket: null }];
  let folded = initState(cfg);
  for (const e of events) folded = applyEvent(folded, e);
  assert.deepEqual(replay(cfg, events), folded);
});

// ---------- scoring table: each extra type ----------

test('extra none: team, striker, bowler all get runs; ball faced; boundary tally', () => {
  let s = ball(liveState(), 4);
  let inn = ins(s);
  assert.equal(inn.runs, 4);
  assert.equal(inn.legalBalls, 1);
  assert.equal(inn.batsmen[0].runs, 4);
  assert.equal(inn.batsmen[0].balls, 1);
  assert.equal(inn.batsmen[0].fours, 1);
  assert.equal(inn.bowlers[0].runs, 4);
  assert.equal(inn.bowlers[0].balls, 1);
  s = ball(s, 6);
  inn = ins(s);
  assert.equal(inn.batsmen[0].sixes, 1);
  assert.equal(inn.runs, 10);
  assert.equal(inn.extras.total, 0);
});

test('wide: 1+runs to team and bowler, nothing to batsman, no legal ball', () => {
  const s = ball(liveState(), 2, 'wide');
  const inn = ins(s);
  assert.equal(inn.runs, 3);
  assert.equal(inn.extras.wides, 3);
  assert.equal(inn.extras.total, 3);
  assert.equal(inn.bowlers[0].runs, 3);
  assert.equal(inn.legalBalls, 0);
  assert.equal(inn.bowlers[0].balls, 0);
  assert.equal(inn.batsmen[0].runs, 0);
  assert.equal(inn.batsmen[0].balls, 0); // does not count as ball faced
});

test('noball: 1+runs to team/bowler, runs off bat to batsman, counts as ball faced, not legal', () => {
  const s = ball(ball(liveState(), 4, 'noball'), 6, 'noball');
  const inn = ins(s);
  assert.equal(inn.runs, 12); // (1+4) + (1+6)
  assert.equal(inn.extras.noballs, 2); // penalty only
  assert.equal(inn.extras.total, 2);
  assert.equal(inn.batsmen[0].runs, 10);
  assert.equal(inn.batsmen[0].balls, 2);
  assert.equal(inn.batsmen[0].fours, 1);
  assert.equal(inn.batsmen[0].sixes, 1);
  assert.equal(inn.bowlers[0].runs, 12);
  assert.equal(inn.legalBalls, 0);
  assert.equal(inn.bowlers[0].balls, 0);
});

test('bye: team runs and extras only, bowler not charged, legal ball faced', () => {
  const s = ball(liveState(), 2, 'bye');
  const inn = ins(s);
  assert.equal(inn.runs, 2);
  assert.equal(inn.extras.byes, 2);
  assert.equal(inn.batsmen[0].runs, 0);
  assert.equal(inn.batsmen[0].balls, 1);
  assert.equal(inn.bowlers[0].runs, 0);
  assert.equal(inn.legalBalls, 1);
});

test('legbye: same as bye but tallied separately', () => {
  const s = ball(liveState(), 1, 'legbye');
  const inn = ins(s);
  assert.equal(inn.runs, 1);
  assert.equal(inn.extras.legbyes, 1);
  assert.equal(inn.extras.byes, 0);
  assert.equal(inn.bowlers[0].runs, 0);
  assert.equal(inn.batsmen[0].balls, 1);
});

// ---------- strike rotation ----------

test('odd runs swap strike; even runs do not', () => {
  let s = liveState();
  assert.equal(strikerName(s), 'Asha');
  s = ball(s, 1);
  assert.equal(strikerName(s), 'Bina');
  s = ball(s, 2);
  assert.equal(strikerName(s), 'Bina');
  s = ball(s, 3);
  assert.equal(strikerName(s), 'Asha');
});

test('odd runs on a wide swap strike without a legal ball', () => {
  const s = ball(liveState(), 1, 'wide');
  assert.equal(strikerName(s), 'Bina');
  assert.equal(ins(s).legalBalls, 0);
});

test('over end swaps strike', () => {
  let s = liveState();
  for (let i = 0; i < 6; i++) s = ball(s, 0);
  assert.equal(strikerName(s), 'Bina');
  assert.equal(nonStrikerName(s), 'Asha');
});

test('odd runs on last ball of over: both swaps apply, striker keeps strike', () => {
  let s = liveState();
  for (let i = 0; i < 5; i++) s = ball(s, 0);
  s = ball(s, 1); // odd swap + over-end swap cancel out
  assert.equal(strikerName(s), 'Asha');
});

// ---------- over end, bowler rotation, maidens ----------

test('over end: needs.newBowler, same bowler rejected, another allowed, then eligible again', () => {
  let s = dotOver(liveState());
  assert.equal(s.needs.newBowler, true);
  assert.throws(
    () => applyEvent(s, { type: 'select_bowler', playerIndex: 0 }),
    /consecutive overs/
  );
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 1 });
  assert.equal(s.needs.newBowler, false);
  s = replay(makeConfig({ oversPerInnings: 5 }), openingEvents);
  s = dotOver(s, 1);
  s = dotOver(s, 0); // original bowler eligible again after a gap over
  assert.equal(ins(s).bowlers[ins(s).currentBowlerIndex!].playerIndex, 0);
});

test('ball while needs.newBowler is rejected', () => {
  const s = dotOver(liveState());
  assert.throws(() => ball(s, 0), /bowler/);
});

test('maiden: over with zero conceded increments maidens', () => {
  const s = dotOver(liveState());
  assert.equal(ins(s).bowlers[0].maidens, 1);
  assert.equal(ins(s).bowlers[0].balls, 6);
});

test('byes and legbyes do not break a maiden', () => {
  let s = liveState();
  s = ball(s, 2, 'bye');
  s = ball(s, 2, 'legbye'); // even runs keep strike simple
  for (let i = 0; i < 4; i++) s = ball(s, 0);
  assert.equal(ins(s).bowlers[0].maidens, 1);
  assert.equal(ins(s).bowlers[0].runs, 0);
});

test('a wide breaks a maiden; so does a noball', () => {
  let s = liveState();
  s = ball(s, 0, 'wide');
  for (let i = 0; i < 6; i++) s = ball(s, 0);
  assert.equal(ins(s).bowlers[0].maidens, 0);

  let t = liveState();
  t = ball(t, 0, 'noball');
  for (let i = 0; i < 6; i++) t = ball(t, 0);
  assert.equal(ins(t).bowlers[0].maidens, 0);
});

// ---------- wickets ----------

test('bowled: bowler credited, striker out with text, needs.newBatsman, replacement takes striker end', () => {
  let s = ball(liveState(), 0, 'none', { kind: 'bowled', fielder: null });
  let inn = ins(s);
  assert.equal(inn.wickets, 1);
  assert.equal(inn.bowlers[0].wickets, 1);
  assert.deepEqual(inn.batsmen[0].out, { kind: 'bowled', fielder: null, bowler: 'Kumar', text: 'b Kumar' });
  assert.equal(inn.strikerIndex, null);
  assert.equal(s.needs.newBatsman, true);
  assert.throws(() => ball(s, 0), /batsman/);
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 });
  inn = ins(s);
  assert.equal(inn.batsmen[inn.strikerIndex!].name, 'Chitra');
  assert.equal(inn.batsmen[inn.nonStrikerIndex!].name, 'Bina');
});

test('caught: scorecard text "c Fielder b Bowler"', () => {
  const s = ball(liveState(), 0, 'none', { kind: 'caught', fielder: 'Mohan' });
  assert.equal(ins(s).batsmen[0].out!.text, 'c Mohan b Kumar');
  assert.equal(ins(s).bowlers[0].wickets, 1);
});

test('lbw, stumped and hit_wicket texts', () => {
  assert.equal(ins(ball(liveState(), 0, 'none', { kind: 'lbw', fielder: null })).batsmen[0].out!.text, 'lbw b Kumar');
  assert.equal(ins(ball(liveState(), 0, 'none', { kind: 'stumped', fielder: 'Om' })).batsmen[0].out!.text, 'st Om b Kumar');
  assert.equal(ins(ball(liveState(), 0, 'none', { kind: 'hit_wicket', fielder: null })).batsmen[0].out!.text, 'hit wicket b Kumar');
});

test('run_out: no bowler credit, delivery runs still count, text "run out (Fielder)"', () => {
  const s = ball(liveState(), 1, 'none', { kind: 'run_out', outEnd: 'striker', fielder: 'Lalit' });
  const inn = ins(s);
  assert.equal(inn.runs, 1);
  assert.equal(inn.wickets, 1);
  assert.equal(inn.bowlers[0].wickets, 0);
  assert.equal(inn.bowlers[0].runs, 1);
  // runs:1 swapped ends first, so post-swap striker (Bina) is the one out
  assert.equal(inn.batsmen[1].out!.kind, 'run_out');
  assert.equal(inn.batsmen[1].out!.text, 'run out (Lalit)');
  assert.equal(inn.batsmen[1].out!.bowler, null);
});

test('run_out of non-striker with 1 run completed: original striker is out at non-striker end', () => {
  let s = ball(liveState(), 1, 'none', { kind: 'run_out', outEnd: 'non_striker', fielder: 'Om' });
  let inn = ins(s);
  // Asha and Bina crossed on the single; Asha (now at non-striker end) is out.
  assert.equal(inn.batsmen[0].name, 'Asha');
  assert.equal(inn.batsmen[0].out!.kind, 'run_out');
  assert.equal(inn.nonStrikerIndex, null);
  assert.equal(strikerName(s), 'Bina'); // Bina keeps strike
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 });
  assert.equal(nonStrikerName(s), 'Chitra'); // replacement takes vacated end
  assert.equal(strikerName(s), 'Bina');
});

test('fall of wickets records score, wicket number, name and over', () => {
  let s = ball(liveState(), 4);
  s = ball(s, 0, 'none', { kind: 'bowled', fielder: null });
  assert.deepEqual(ins(s).fallOfWickets, [
    { score: 4, wicket: 1, batsmanName: 'Asha', over: '0.2' },
  ]);
});

test('wicket on last legal ball of over: over-end swap applied after replacement', () => {
  let s = liveState();
  for (let i = 0; i < 5; i++) s = ball(s, 0);
  s = ball(s, 0, 'none', { kind: 'bowled', fielder: null }); // 6th ball, striker Asha out
  assert.equal(s.needs.newBatsman, true);
  assert.equal(s.needs.newBowler, true);
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 }); // Chitra takes striker end
  // then over-end swap: Bina on strike for the new over, Chitra at non-striker
  assert.equal(strikerName(s), 'Bina');
  assert.equal(nonStrikerName(s), 'Chitra');
});

// ---------- wicket/extra legality ----------

test('bowled, caught, lbw and hit_wicket are rejected on a wide', () => {
  const s = liveState();
  for (const kind of ['bowled', 'caught', 'lbw', 'hit_wicket']) {
    assert.throws(() => ball(s, 0, 'wide', { kind, fielder: null }), /wide/);
  }
});

test('stumped and run_out are legal on a wide', () => {
  const st = ball(liveState(), 0, 'wide', { kind: 'stumped', fielder: 'Om' });
  assert.equal(ins(st).wickets, 1);
  assert.equal(ins(st).runs, 1); // wide penalty still counts
  assert.equal(ins(st).bowlers[0].wickets, 1);
  const ro = ball(liveState(), 0, 'wide', { kind: 'run_out', outEnd: 'striker', fielder: 'Om' });
  assert.equal(ins(ro).wickets, 1);
  assert.equal(ins(ro).bowlers[0].wickets, 0);
});

test('on a noball only run_out is legal', () => {
  const s = liveState();
  for (const kind of ['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket']) {
    assert.throws(() => ball(s, 0, 'noball', { kind, fielder: null }), /no-ball/);
  }
  const ok = ball(s, 1, 'noball', { kind: 'run_out', outEnd: 'striker', fielder: null });
  assert.equal(ins(ok).wickets, 1);
  assert.equal(ins(ok).runs, 2); // 1 penalty + 1 run
});

// ---------- innings end ----------

test('innings ends when wickets reach players - 1', () => {
  let s = liveState({ oversPerInnings: 50 });
  for (let i = 0; i < 4; i++) {
    s = ball(s, 0, 'none', { kind: 'bowled', fielder: null });
    if (i < 3) s = applyEvent(s, { type: 'select_batsman', playerIndex: i + 2 });
  }
  assert.equal(ins(s, 0).wickets, 4); // 5 players -> all out at 4
  assert.equal(s.status, 'innings_break');
  assert.equal(s.needs.startInnings, true);
  assert.equal(s.needs.newBatsman, false);
});

test('innings ends when overs are done', () => {
  let s = replay(makeConfig({ oversPerInnings: 1 }), openingEvents);
  for (let i = 0; i < 6; i++) s = ball(s, 0);
  assert.equal(s.status, 'innings_break');
  assert.equal(ins(s, 0).legalBalls, 6);
});

test('second innings gets target = first innings runs + 1', () => {
  let s = replay(makeConfig({ oversPerInnings: 1 }), openingEvents);
  for (let i = 0; i < 6; i++) s = ball(s, 2); // 12 runs
  s = applyEvent(s, { type: 'start_innings' });
  assert.equal(s.currentInningsIndex, 1);
  assert.equal(ins(s, 1).target, 13);
  assert.equal(ins(s, 1).battingTeamIndex, 1);
});

// ---------- full-match results ----------

interface Play {
  runs: number;
  extra?: string;
  wicket?: unknown;
}

function playSecondInnings(firstInningsBalls: Play[], secondInningsPlays: Play[]) {
  let s = replay(makeConfig({ oversPerInnings: 1 }), openingEvents);
  for (const b of firstInningsBalls) s = ball(s, b.runs, b.extra ?? 'none', b.wicket ?? null);
  if (s.status === 'live') s = applyEvent(s, { type: 'end_innings' });
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 0 });
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 1 });
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 0 });
  for (const b of secondInningsPlays) {
    if (s.status !== 'live') break;
    s = ball(s, b.runs, b.extra ?? 'none', b.wicket ?? null);
  }
  return s;
}

const sixBalls = (runs: number): Play[] => Array.from({ length: 6 }, () => ({ runs }));

test('chase win: innings 2 passes target -> wickets margin and balls left', () => {
  // Lions 12/0; Tigers chase 13, reach it on ball 3 of their over (4,4,6)
  const s = playSecondInnings(sixBalls(2), [{ runs: 4 }, { runs: 4 }, { runs: 6 }]);
  assert.equal(s.status, 'completed');
  assert.equal(ins(s, 1).runs, 14);
  assert.deepEqual(s.result, { winnerIndex: 1, text: 'Tigers won by 4 wickets (3 balls left)' });
});

test('defend win: innings 2 falls short -> margin in runs', () => {
  // Lions 12/0; Tigers 6/0 off their over
  const s = playSecondInnings(sixBalls(2), sixBalls(1));
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: 0, text: 'Lions won by 6 runs' });
});

test('tie: equal scores at close', () => {
  const s = playSecondInnings(sixBalls(1), sixBalls(1));
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: null, text: 'Match tied' });
});

test('end_match before innings 2 -> Match abandoned; during innings 2 -> result logic', () => {
  const abandoned = applyEvent(ball(liveState(), 4), { type: 'end_match' });
  assert.equal(abandoned.status, 'completed');
  assert.deepEqual(abandoned.result, { winnerIndex: null, text: 'Match abandoned' });

  // innings 2 reached, behind the target -> defenders win by runs
  let s = playSecondInnings(sixBalls(2), [{ runs: 1 }, { runs: 1 }]);
  s = applyEvent(s, { type: 'end_match' });
  assert.deepEqual(s.result, { winnerIndex: 0, text: 'Lions won by 10 runs' });
});

// ---------- validation rejections ----------

test('ball is rejected in wrong status and before openers', () => {
  assert.throws(() => ball(initState(makeConfig()), 0), /innings/);
  const started = applyEvent(initState(makeConfig()), { type: 'start_innings' });
  assert.throws(() => ball(started, 0), /opening batsmen/);
});

test('select_batsman rejects out or already-batting players and bad indices', () => {
  let s = ball(liveState(), 0, 'none', { kind: 'bowled', fielder: null });
  assert.throws(() => applyEvent(s, { type: 'select_batsman', playerIndex: 0 }), /out or already/); // out
  assert.throws(() => applyEvent(s, { type: 'select_batsman', playerIndex: 1 }), /out or already/); // batting
  assert.throws(() => applyEvent(s, { type: 'select_batsman', playerIndex: 9 }), /invalid/);
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 });
  assert.throws(() => applyEvent(s, { type: 'select_batsman', playerIndex: 3 }), /no batsman/);
});

test('select_bowler rejected when no new bowler is needed; bad index rejected', () => {
  const s = liveState();
  assert.throws(() => applyEvent(s, { type: 'select_bowler', playerIndex: 1 }), /no bowler/);
  const fresh = applyEvent(initState(makeConfig()), { type: 'start_innings' });
  assert.throws(() => applyEvent(fresh, { type: 'select_bowler', playerIndex: 11 }), /invalid/);
});

test('invalid runs, extras, wicket kinds and missing run_out outEnd are rejected', () => {
  const s = liveState();
  assert.throws(() => ball(s, 7), /runs/);
  assert.throws(() => ball(s, -1), /runs/);
  assert.throws(() => applyEvent(s, { type: 'ball', extra: 'overthrow', runs: 1, wicket: null } as unknown as MatchEvent), /extra/);
  assert.throws(() => ball(s, 0, 'none', { kind: 'timed_out', fielder: null }), /wicket kind/);
  assert.throws(() => ball(s, 1, 'none', { kind: 'run_out', fielder: null }), /outEnd/);
});

test('start_innings rejected while live; end_innings rejected when not live; unknown event rejected', () => {
  const s = liveState();
  assert.throws(() => applyEvent(s, { type: 'start_innings' }), /cannot start/);
  assert.throws(() => applyEvent(initState(makeConfig()), { type: 'end_innings' }), /no innings/);
  assert.throws(() => applyEvent(s, { type: 'jump' } as unknown as MatchEvent), /unknown event/);
});

test('undo reaching the engine throws "nothing to undo"', () => {
  assert.throws(() => applyEvent(liveState(), { type: 'undo' }), /nothing to undo/);
});

// ---------- timeline & publicState ----------

test('timeline badges: dot, runs, boundaries, extras and wickets', () => {
  let s = liveState();
  s = ball(s, 0);
  s = ball(s, 4);
  s = ball(s, 0, 'wide');
  s = ball(s, 2, 'wide');
  s = ball(s, 0, 'noball');
  s = ball(s, 1, 'bye');
  s = ball(s, 2, 'legbye');
  s = ball(s, 0, 'none', { kind: 'bowled', fielder: null });
  assert.deepEqual(ins(s).timeline.map((t) => t.badge), ['·', '4', 'wd', 'wd+2', 'nb', 'b1', 'lb2', 'W']);
  const w = ins(s).timeline.at(-1)!;
  assert.match(w.text, /WICKET!/);
  assert.match(w.text, /b Kumar/);
  assert.match(w.over, /^\d+\.\d$/);
});

test('publicState: derived fields present, internals and adminless shape', () => {
  let s = playSecondInnings(sixBalls(2), [{ runs: 4 }]);
  const pub = publicState(s);
  assert.equal(pub.innings[0].oversDisplay, '1.0');
  assert.equal(pub.innings[0].crr, 12);
  assert.equal(pub.innings[1].oversDisplay, '0.1');
  assert.equal(pub.innings[1].ballsRemaining, 5);
  assert.equal(pub.innings[1].runsNeeded, 9); // target 13, scored 4
  assert.equal(pub.innings[1].rrr, round2(9 / (5 / 6)));
  assert.ok(pub.needs);
  for (const inn of pub.innings) {
    assert.equal('_overConceded' in inn, false);
    assert.equal('_lastOverBowler' in inn, false);
    assert.equal('_pendingOverEndSwap' in inn, false);
  }
  // publicState must not mutate the state it was given
  assert.equal('_overConceded' in s.innings[0], true);
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

test('chase ending mid-over: innings closes immediately on passing target', () => {
  const s = playSecondInnings(sixBalls(1), [{ runs: 6 }, { runs: 1 }]);
  assert.equal(s.status, 'completed');
  assert.equal(ins(s, 1).legalBalls, 2);
  assert.equal(s.result!.winnerIndex, 1);
  assert.match(s.result!.text, /^Tigers won by 4 wickets \(4 balls left\)$/);
});

test('wide can win the chase (target passed without a legal ball)', () => {
  const s = playSecondInnings(
    [{ runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }, { runs: 0 }], // Lions 0
    [{ runs: 0, extra: 'wide' }] // Tigers 1/0, target 1
  );
  assert.equal(s.status, 'completed');
  assert.equal(s.result!.winnerIndex, 1);
  assert.match(s.result!.text, /won by 4 wickets \(6 balls left\)/);
});
