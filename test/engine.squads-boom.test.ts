// test/engine.squads-boom.test.ts — v14 features: mid-match squad changes
// (add_player / remove_player, active-count all-out semantics) and the
// boom-boom over (boom_over arming, doubled team runs, −5 wicket penalty).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initState, applyEvent, replay, publicState } from '../lib/engine';
import type { Innings, MatchConfig, MatchEvent, MatchState } from '../lib/engine';
import { validateCreateBody } from '../lib/store';

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

const OPENERS: MatchEvent[] = [
  { type: 'start_innings' },
  { type: 'select_batsman', playerIndex: 0 },
  { type: 'select_batsman', playerIndex: 1 },
  { type: 'select_bowler', playerIndex: 0 },
];

// Intentionally loose so invalid payloads can be fed to assert rejection.
const ball = (runs: number, extra: string = 'none', wicket: unknown = null) =>
  ({ type: 'ball', extra, runs, wicket }) as MatchEvent;
const bowled = () => ball(0, 'none', { kind: 'bowled', fielder: null });
const add = (teamIndex: number, name: unknown) =>
  ({ type: 'add_player', teamIndex, name }) as MatchEvent;
const rem = (teamIndex: number, playerIndex: number) =>
  ({ type: 'remove_player', teamIndex, playerIndex }) as MatchEvent;
const boom = (enabled: boolean) => ({ type: 'boom_over', enabled }) as MatchEvent;
const selBat = (playerIndex: number) => ({ type: 'select_batsman', playerIndex }) as MatchEvent;
const selBowl = (playerIndex: number) => ({ type: 'select_bowler', playerIndex }) as MatchEvent;

function fold(config: MatchConfig, events: MatchEvent[]): MatchState {
  return replay(config, events);
}

function ins(s: MatchState, i: number | null = null): Innings {
  return s.innings[(i ?? s.currentInningsIndex ?? s.innings.length - 1)];
}

function liveState(overrides: Partial<MatchConfig> = {}) {
  return fold(makeConfig(overrides), OPENERS);
}

function liveBoom(overrides: Partial<MatchConfig> = {}) {
  return liveState({ boomBoom: true, ...overrides });
}

/** sum(batsmen) + extras.total − penaltyRuns === runs (client reconciliation). */
function assertReconciled(inn: Innings, msg = 'reconciliation invariant') {
  const batSum = inn.batsmen.reduce((a, b) => a + b.runs, 0);
  assert.equal(batSum + inn.extras.total - inn.penaltyRuns, inn.runs, msg);
}

// ===========================================================================
// FEATURE A — mid-match squad changes
// ===========================================================================

test('add_player: appears at the end of config players and is selectable', () => {
  let s = liveState();
  s = applyEvent(s, add(0, 'Fiona'));
  assert.deepEqual(s.config.teams[0].players, ['Asha', 'Bina', 'Chitra', 'Devi', 'Esha', 'Fiona']);
  assert.deepEqual(s.removed, [[], []]); // additions are active immediately
  s = applyEvent(s, bowled());
  s = applyEvent(s, selBat(5)); // the new player bats
  const inn = ins(s);
  assert.equal(inn.batsmen.at(-1)!.name, 'Fiona');
  assert.equal(inn.batsmen.at(-1)!.playerIndex, 5);
});

test('add_player: name is trimmed and internal spaces collapsed', () => {
  const s = applyEvent(liveState(), add(1, '  Rahul   Kumar  Jr '));
  assert.equal(s.config.teams[1].players.at(-1), 'Rahul Kumar Jr');
});

test('add_player: case-insensitive duplicate among ACTIVE players rejected; empty name rejected', () => {
  const s = liveState();
  assert.throws(() => applyEvent(s, add(0, 'asha')), /already in Lions/);
  assert.throws(() => applyEvent(s, add(0, '  ASHA ')), /already in Lions/);
  assert.throws(() => applyEvent(s, add(0, '   ')), /non-empty/);
  assert.throws(() => applyEvent(s, add(0, 42)), /non-empty/);
  assert.throws(() => applyEvent(s, add(2 as 0, 'X')), /teamIndex/);
  // same name on the OTHER team is fine (uniqueness is per team)
  assert.equal(applyEvent(s, add(1, 'Asha')).config.teams[1].players.at(-1), 'Asha');
});

test('add_player: a removed player\'s name can be re-added as a NEW index', () => {
  let s = applyEvent(initState(makeConfig()), rem(0, 1)); // Bina removed in setup
  s = applyEvent(s, add(0, 'bina'));
  assert.equal(s.config.teams[0].players.length, 6);
  assert.equal(s.config.teams[0].players[5], 'bina');
  assert.deepEqual(s.removed[0], [1]); // old index stays removed, new one active
});

test('add_player: rejected at 11 active players; allowed again after a removal', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `P${i}`);
  const cfg = makeConfig({ teams: [{ name: 'Lions', players: eleven }, { name: 'Tigers', players: ['K', 'L'] }] });
  let s = initState(cfg);
  assert.throws(() => applyEvent(s, add(0, 'P11')), /already has 11 active/);
  s = applyEvent(s, rem(0, 3));
  s = applyEvent(s, add(0, 'P11')); // 10 active -> ok
  assert.equal(s.config.teams[0].players.length, 12);
});

test('add_player and remove_player rejected once the match is completed', () => {
  const s = applyEvent(liveState(), { type: 'end_match' });
  assert.equal(s.status, 'completed');
  assert.throws(() => applyEvent(s, add(0, 'Fiona')), /completed/);
  assert.throws(() => applyEvent(s, rem(0, 4)), /completed/);
});

test('remove_player guards: at-crease, out-this-innings, bad index, already removed', () => {
  let s = liveState();
  assert.throws(() => applyEvent(s, rem(0, 0)), /batted in this innings/); // striker
  assert.throws(() => applyEvent(s, rem(0, 1)), /batted in this innings/); // non-striker
  assert.throws(() => applyEvent(s, rem(0, 9)), /invalid playerIndex/);
  assert.throws(() => applyEvent(s, rem(2 as 0, 0)), /teamIndex/);
  s = applyEvent(s, bowled());
  s = applyEvent(s, selBat(2));
  // Asha is OUT but her innings-history row pins her until the innings ends.
  assert.throws(() => applyEvent(s, rem(0, 0)), /batted in this innings/);
  s = applyEvent(s, rem(0, 4)); // Esha never batted -> removable
  assert.deepEqual(s.removed[0], [4]);
  assert.throws(() => applyEvent(s, rem(0, 4)), /already removed/);
});

test('remove_player guards: current bowler (mid-over, wide-only over, and just-selected)', () => {
  // Mid-over (legal ball bowled).
  let s = applyEvent(liveState(), ball(0));
  assert.throws(() => applyEvent(s, rem(1, 0)), /current bowler/);
  s = applyEvent(s, rem(1, 3)); // a different fielder IS removable mid-over
  assert.deepEqual(s.removed[1], [3]);

  // Over "started" with only an illegal delivery: still the current bowler.
  const w = applyEvent(liveState(), ball(0, 'wide'));
  assert.throws(() => applyEvent(w, rem(1, 0)), /current bowler/);

  // Just selected, no delivery yet: rejected too (currentBowlerIndex must
  // never point at a removed player — undo the selection instead).
  assert.throws(() => applyEvent(liveState(), rem(1, 0)), /current bowler/);

  // At the over boundary the finished bowler is removable (no longer current).
  let t = liveState();
  for (let i = 0; i < 6; i++) t = applyEvent(t, ball(0));
  t = applyEvent(t, rem(1, 0));
  assert.deepEqual(t.removed[1], [0]);
});

test('remove_player guard: cannot drop a team below 2 active players', () => {
  const cfg = makeConfig({
    teams: [{ name: 'Lions', players: ['A', 'B', 'C'] }, { name: 'Tigers', players: ['K', 'L', 'M'] }],
  });
  let s = initState(cfg);
  s = applyEvent(s, rem(0, 2)); // 2 active left
  assert.throws(() => applyEvent(s, rem(0, 0)), /at least 2 active/);
  assert.throws(() => applyEvent(s, rem(0, 1)), /at least 2 active/);
});

test('a player who batted in innings 1 is removable in innings 2 (their team now bowls)', () => {
  let s = liveState({ oversPerInnings: 1 });
  for (let i = 0; i < 6; i++) s = applyEvent(s, ball(0)); // innings 1 over
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBat(1));
  s = applyEvent(s, selBowl(2)); // Chitra bowls
  s = applyEvent(s, rem(0, 0)); // Asha batted in innings 1; that innings ended
  assert.deepEqual(s.removed[0], [0]);
});

test('removed players are not selectable as batsman or bowler', () => {
  let s = initState(makeConfig());
  s = applyEvent(s, rem(0, 2)); // Chitra out of the batting side
  s = applyEvent(s, rem(1, 1)); // Lalit out of the bowling side
  s = applyEvent(s, { type: 'start_innings' });
  assert.throws(() => applyEvent(s, selBat(2)), /no longer available/);
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBat(1));
  assert.throws(() => applyEvent(s, selBowl(1)), /no longer available/);
  s = applyEvent(s, selBowl(0));
  s = applyEvent(s, bowled());
  assert.throws(() => applyEvent(s, selBat(2)), /no longer available/);
});

test('innings ends when the eligible pool is exhausted with a shrunken squad', () => {
  let s = applyEvent(initState(makeConfig({ oversPerInnings: 50 })), rem(0, 4)); // 4 active
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBat(1));
  s = applyEvent(s, selBowl(0));
  s = applyEvent(s, bowled());
  s = applyEvent(s, selBat(2));
  s = applyEvent(s, bowled());
  s = applyEvent(s, selBat(3));
  s = applyEvent(s, bowled()); // no eligible batsman left among 4 active
  assert.equal(ins(s, 0).wickets, 3); // activeCount − 1
  assert.equal(s.status, 'innings_break');
  assert.equal(s.needs.newBatsman, false);
});

test('removing the last eligible batsman while a replacement is owed closes the innings', () => {
  let s = applyEvent(liveState({ oversPerInnings: 50 }), bowled()); // A0 out, replacement owed
  assert.equal(s.needs.newBatsman, true);
  s = applyEvent(s, rem(0, 2));
  s = applyEvent(s, rem(0, 3));
  s = applyEvent(s, rem(0, 4)); // eligible pool now empty, Bina stranded
  assert.equal(s.status, 'innings_break');
  assert.equal(ins(s, 0).wickets, 1);
  assert.equal(s.needs.newBatsman, false);
});

test('wickets-in-hand result text uses the ACTIVE count after a mid-chase add', () => {
  let s = liveState({ oversPerInnings: 1 });
  for (let i = 0; i < 6; i++) s = applyEvent(s, ball(1)); // Lions 6, target 7
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBat(1));
  s = applyEvent(s, selBowl(0));
  s = applyEvent(s, add(1, 'Pravin')); // Tigers now 6 active mid-chase
  s = applyEvent(s, ball(4));
  s = applyEvent(s, ball(4)); // 8 >= 7
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: 1, text: 'Tigers won by 5 wickets (4 balls left)' });
});

test('wickets-in-hand result text shrinks with a removed player on the chasing side', () => {
  let s = fold(makeConfig({ oversPerInnings: 1 }), [...OPENERS, { type: 'end_innings' }]); // Lions 0, target 1
  s = applyEvent(s, rem(1, 4)); // Tigers down to 4 active during the break
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBat(1));
  s = applyEvent(s, selBowl(0));
  s = applyEvent(s, ball(1));
  assert.deepEqual(s.result, { winnerIndex: 1, text: 'Tigers won by 3 wickets (5 balls left)' });
});

test('add_player during innings_break is usable in innings 2', () => {
  let s = liveState({ oversPerInnings: 1 });
  for (let i = 0; i < 6; i++) s = applyEvent(s, ball(0));
  assert.equal(s.status, 'innings_break');
  s = applyEvent(s, add(1, 'Pravin')); // joins the side batting second
  s = applyEvent(s, { type: 'start_innings' });
  s = applyEvent(s, selBat(5)); // opens the innings
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBowl(0));
  assert.equal(ins(s).batsmen[0].name, 'Pravin');
});

test('undo of add/remove via replay: every prefix is reproducible and undo restores config/removed', () => {
  const cfg = makeConfig();
  const events: MatchEvent[] = [
    ...OPENERS,
    add(0, 'Fiona'),
    ball(1),
    rem(0, 4),
    bowled(),
    selBat(5), // Fiona in
    rem(1, 3),
    ball(2),
  ];
  let running = initState(cfg);
  for (let k = 0; k < events.length; k++) {
    assert.deepEqual(replay(cfg, events.slice(0, k)), running, `prefix ${k}`);
    running = applyEvent(running, events[k]);
  }
  assert.deepEqual(replay(cfg, events), running);
  // Undo back past the squad changes: roster and removed lists fully restored.
  const undone = replay(cfg, events.slice(0, 4));
  assert.deepEqual(undone.config.teams[0].players, cfg.teams[0].players);
  assert.deepEqual(undone.removed, [[], []]);
});

test('publicState exposes removed verbatim and the grown roster in config', () => {
  let s = applyEvent(liveState(), add(0, 'Fiona'));
  s = applyEvent(s, rem(0, 3));
  s = applyEvent(s, rem(1, 2));
  const pub = publicState(s);
  assert.deepEqual(pub.removed, [[3], [2]]);
  assert.equal(pub.config.teams[0].players.length, 6);
});

// ===========================================================================
// FEATURE B — boom-boom over
// ===========================================================================

test('armed six: +12 team and batsman, sixes counts the RAW boundary, bowler concedes 12', () => {
  let s = applyEvent(liveBoom(), boom(true));
  assert.equal(ins(s).boomActive, true);
  s = applyEvent(s, ball(6));
  const inn = ins(s);
  assert.equal(inn.runs, 12);
  assert.equal(inn.batsmen[0].runs, 12);
  assert.equal(inn.batsmen[0].sixes, 1);
  assert.equal(inn.batsmen[0].fours, 0);
  assert.equal(inn.batsmen[0].balls, 1);
  assert.equal(inn.bowlers[0].runs, 12);
  assert.equal(inn.legalBalls, 1);
  assert.equal(inn.timeline.at(-1)!.boom, true);
  assert.equal(inn.timeline.at(-1)!.badge, '6');
  assertReconciled(inn);
});

test('armed four: fours +1 (raw), batsman credited 8', () => {
  const s = applyEvent(applyEvent(liveBoom(), boom(true)), ball(4));
  const inn = ins(s);
  assert.equal(inn.runs, 8);
  assert.equal(inn.batsmen[0].fours, 1);
  assert.equal(inn.batsmen[0].runs, 8);
});

test('armed wide with 1 ran: +4 extras (2×(1+1)), no legal ball, raw-odd strike swap', () => {
  const s = applyEvent(applyEvent(liveBoom(), boom(true)), ball(1, 'wide'));
  const inn = ins(s);
  assert.equal(inn.runs, 4);
  assert.equal(inn.extras.wides, 4);
  assert.equal(inn.extras.total, 4);
  assert.equal(inn.bowlers[0].runs, 4);
  assert.equal(inn.legalBalls, 0);
  assert.equal(inn.batsmen[inn.strikerIndex!].name, 'Bina'); // crossed once (raw 1)
  assert.equal(inn.timeline.at(-1)!.boom, true);
  assertReconciled(inn);
});

test('armed no-ball with 2 off the bat: team +6, batsman +4, noballs extra +2', () => {
  const s = applyEvent(applyEvent(liveBoom(), boom(true)), ball(2, 'noball'));
  const inn = ins(s);
  assert.equal(inn.runs, 6); // 2 × (1 + 2)
  assert.equal(inn.batsmen[0].runs, 4);
  assert.equal(inn.batsmen[0].balls, 1); // still a ball faced
  assert.equal(inn.extras.noballs, 2); // doubled penalty only
  assert.equal(inn.extras.total, 2);
  assert.equal(inn.bowlers[0].runs, 6);
  assert.equal(inn.legalBalls, 0);
  assertReconciled(inn);
});

test('armed byes double; strike swap still uses the raw runs', () => {
  const s = applyEvent(applyEvent(liveBoom(), boom(true)), ball(1, 'bye'));
  const inn = ins(s);
  assert.equal(inn.runs, 2);
  assert.equal(inn.extras.byes, 2);
  assert.equal(inn.bowlers[0].runs, 0); // byes never charged to the bowler
  assert.equal(inn.batsmen[inn.strikerIndex!].name, 'Bina'); // raw 1 => swap
  assertReconciled(inn);
});

test('armed single: strike swaps on the RAW run, batsman credited 2', () => {
  const s = applyEvent(applyEvent(liveBoom(), boom(true)), ball(1));
  const inn = ins(s);
  assert.equal(inn.runs, 2);
  assert.equal(inn.batsmen[0].runs, 2);
  assert.equal(inn.batsmen[inn.strikerIndex!].name, 'Bina');
});

test('wicket in a boom over: team −5, penaltyRuns 5, FoW records the post-penalty score', () => {
  let s = applyEvent(liveBoom(), boom(true));
  s = applyEvent(s, ball(4)); // 8/0
  s = applyEvent(s, bowled()); // −5 => 3/1
  const inn = ins(s);
  assert.equal(inn.runs, 3);
  assert.equal(inn.penaltyRuns, 5);
  assert.equal(inn.wickets, 1);
  assert.equal(inn.bowlers[0].wickets, 1); // wicket credit unchanged
  assert.deepEqual(inn.fallOfWickets, [{ score: 3, wicket: 1, batsmanName: 'Asha', over: '0.2' }]);
  assert.equal(inn.timeline.at(-1)!.boom, true);
  assertReconciled(inn);
});

test('run_out in a boom over also costs 5; innings total MAY go negative', () => {
  const s = applyEvent(
    applyEvent(liveBoom(), boom(true)),
    ball(1, 'none', { kind: 'run_out', outEnd: 'striker', fielder: 'Om' })
  );
  const inn = ins(s);
  assert.equal(inn.runs, -3); // 2×1 − 5
  assert.equal(inn.penaltyRuns, 5);
  assert.equal(inn.bowlers[0].wickets, 0); // run out still not the bowler's
  assert.deepEqual(inn.fallOfWickets[0].score, -3);
  assertReconciled(inn);
});

test('boom over completes: auto-disarm, boomOvers records the 0-based index, next over normal', () => {
  let s = liveBoom({ oversPerInnings: 3 });
  for (let i = 0; i < 6; i++) s = applyEvent(s, ball(0)); // over 0: normal
  s = applyEvent(s, boom(true)); // armed at the boundary, while a new bowler is owed
  s = applyEvent(s, selBowl(1));
  for (let i = 0; i < 6; i++) s = applyEvent(s, ball(1)); // over 1: boom
  let inn = ins(s);
  assert.equal(inn.runs, 12); // 6 raw singles doubled
  assert.equal(inn.boomActive, false, 'auto-disarmed at over end');
  assert.deepEqual(inn.boomOvers, [1]);
  assert.equal(inn.bowlers[1].maidens, 0, 'doubled conceded > 0 is no maiden');
  assert.equal(inn.timeline.at(-1)!.boom, true, '6th ball of the boom over is still boom');
  s = applyEvent(s, selBowl(0));
  s = applyEvent(s, ball(1)); // over 2: back to normal scoring
  inn = ins(s);
  assert.equal(inn.runs, 13);
  assert.equal(inn.timeline.at(-1)!.boom, undefined);
  assertReconciled(inn);
});

test('arming rejected mid-over — including after only an illegal delivery', () => {
  const mid = applyEvent(liveBoom(), ball(0));
  assert.throws(() => applyEvent(mid, boom(true)), /before the over starts/);
  const wided = applyEvent(liveBoom(), ball(0, 'wide')); // no legal ball, but the over has started
  assert.throws(() => applyEvent(wided, boom(true)), /before the over starts/);
});

test('boom_over rejected when the rule is off, when not live, and double-arm/disarm', () => {
  assert.throws(() => applyEvent(liveState(), boom(true)), /not enabled/);
  assert.throws(() => applyEvent(initState(makeConfig({ boomBoom: true })), boom(true)), /no innings/);
  const armed = applyEvent(liveBoom(), boom(true));
  assert.throws(() => applyEvent(armed, boom(true)), /already armed/);
  assert.throws(() => applyEvent(liveBoom(), boom(false)), /not armed/);
  assert.throws(() => applyEvent(liveBoom(), { type: 'boom_over', enabled: 'yes' } as unknown as MatchEvent), /enabled boolean/);
});

test('disarm before the first ball is fine; after the first ball it is rejected', () => {
  let s = applyEvent(applyEvent(liveBoom(), boom(true)), boom(false));
  assert.equal(ins(s).boomActive, false);
  s = applyEvent(s, ball(1));
  assert.equal(ins(s).runs, 1, 'disarmed over scores normally');
  const armedAndBowled = applyEvent(applyEvent(liveBoom(), boom(true)), ball(0));
  assert.throws(() => applyEvent(armedAndBowled, boom(false)), /before the over starts/);
});

test('all-dot boom over with a wicket is STILL a maiden (penalty is a team adjustment, not conceded)', () => {
  let s = applyEvent(liveBoom(), boom(true));
  s = applyEvent(s, ball(0));
  s = applyEvent(s, ball(0));
  s = applyEvent(s, bowled());
  s = applyEvent(s, selBat(2));
  for (let i = 0; i < 3; i++) s = applyEvent(s, ball(0));
  const inn = ins(s);
  assert.equal(inn.legalBalls, 6);
  assert.equal(inn.bowlers[0].maidens, 1);
  assert.equal(inn.bowlers[0].runs, 0);
  assert.equal(inn.runs, -5);
  assert.equal(inn.penaltyRuns, 5);
  assert.deepEqual(inn.boomOvers, [0]);
  assertReconciled(inn);
});

test('negative innings-1 total: target = runs + 1 (≤ 0) and the chase completes on its first ball', () => {
  const cfg = makeConfig({
    boomBoom: true,
    teams: [{ name: 'Lions', players: ['A0', 'A1', 'A2'] }, { name: 'Tigers', players: ['B0', 'B1', 'B2'] }],
  });
  let s = fold(cfg, OPENERS);
  s = applyEvent(s, boom(true));
  s = applyEvent(s, bowled()); // −5/1
  s = applyEvent(s, selBat(2));
  s = applyEvent(s, bowled()); // −10/2: pool exhausted, innings over
  assert.equal(s.status, 'innings_break');
  assert.equal(ins(s, 0).runs, -10);
  assert.equal(ins(s, 0).penaltyRuns, 10);
  s = applyEvent(s, { type: 'start_innings' });
  assert.equal(ins(s, 1).target, -9);
  assert.equal(publicState(s).innings[1].runsNeeded, 0);
  s = applyEvent(s, selBat(0));
  s = applyEvent(s, selBat(1));
  s = applyEvent(s, selBowl(0));
  s = applyEvent(s, ball(0)); // 0 >= −9: generic comparison ends the chase
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: 1, text: 'Tigers won by 2 wickets (11 balls left)' });
});

test('reconciliation invariant holds after every event of a mixed boom innings', () => {
  const cfg = makeConfig({ boomBoom: true, oversPerInnings: 4 });
  const events: MatchEvent[] = [
    ...OPENERS,
    ball(4), ball(1), ball(0, 'wide'), ball(2, 'bye'), ball(0), ball(3), ball(1), // over 0 (normal)
    boom(true), selBowl(1),
    ball(6), ball(1, 'wide'), ball(2, 'noball'),
    ball(1, 'none', { kind: 'run_out', outEnd: 'striker', fielder: 'Om' }), selBat(2),
    ball(0), ball(2, 'legbye'), ball(0), ball(1), // over 1 (boom) complete
    selBowl(0), ball(1), ball(4), // over 2 (normal again)
  ];
  let s = initState(cfg);
  for (const e of events) {
    s = applyEvent(s, e);
    if (s.innings.length > 0) assertReconciled(ins(s), `after ${JSON.stringify(e)}`);
  }
  const inn = ins(s);
  assert.deepEqual(inn.boomOvers, [1]);
  assert.equal(inn.penaltyRuns, 5);
  assert.equal(inn.boomActive, false);
});

test('undo across boom arm and boom balls: every replay prefix deep-equals the fold', () => {
  const cfg = makeConfig({ boomBoom: true, oversPerInnings: 3 });
  const events: MatchEvent[] = [
    ...OPENERS,
    boom(true),
    ball(6),
    ball(1, 'wide'),
    bowled(),
    selBat(2),
    ball(1),
  ];
  let running = initState(cfg);
  for (let k = 0; k < events.length; k++) {
    assert.deepEqual(replay(cfg, events.slice(0, k)), running, `prefix ${k}`);
    running = applyEvent(running, events[k]);
  }
  assert.deepEqual(replay(cfg, events), running);
  // Undoing the arm restores a normal over exactly.
  const beforeArm = replay(cfg, events.slice(0, 4));
  assert.equal(ins(beforeArm).boomActive, false);
  assert.equal(ins(beforeArm).penaltyRuns, 0);
  const rearmedScore = applyEvent(applyEvent(beforeArm, ball(6)), ball(6));
  assert.equal(ins(rearmedScore).runs, 12, 'post-undo balls score normally');
});

test('publicState: boomActive/boomOvers/penaltyRuns exposed; _ballsThisOver stripped; config carries boomBoom', () => {
  let s = applyEvent(liveBoom(), boom(true));
  s = applyEvent(s, ball(4));
  s = applyEvent(s, bowled());
  const pub = publicState(s);
  const inn = pub.innings[0];
  assert.equal(inn.boomActive, true);
  assert.deepEqual(inn.boomOvers, []);
  assert.equal(inn.penaltyRuns, 5);
  assert.equal(pub.config.boomBoom, true);
  assert.deepEqual(pub.removed, [[], []]);
  assert.equal('_ballsThisOver' in inn, false);
  assert.equal('_overConceded' in inn, false);
});

test('innings closing mid-boom-over: boomActive cleared, partial over NOT in boomOvers, boom balls keep flags', () => {
  let s = applyEvent(liveBoom(), boom(true));
  s = applyEvent(s, ball(4)); // one boom ball
  s = applyEvent(s, { type: 'end_innings' });
  const inn = ins(s, 0);
  assert.equal(s.status, 'innings_break');
  assert.equal(inn.boomActive, false, 'a closed innings never reads as armed');
  assert.deepEqual(inn.boomOvers, [], 'only COMPLETED boom overs are recorded');
  assert.equal(inn.timeline.at(-1)!.boom, true, 'deliveries already bowled keep their flag');
});

// ===========================================================================
// Store validation (pure function; no DB touched)
// ===========================================================================

test('validateCreateBody: optional boomBoom boolean accepted, non-boolean rejected', () => {
  const base = {
    teams: [
      { name: 'Lions', players: ['A', 'B'] },
      { name: 'Tigers', players: ['C', 'D'] },
    ],
    oversPerInnings: 2,
    battingFirstIndex: 0,
  };
  assert.equal(validateCreateBody(base), null);
  assert.equal(validateCreateBody({ ...base, boomBoom: true }), null);
  assert.equal(validateCreateBody({ ...base, boomBoom: false }), null);
  assert.equal(validateCreateBody({ ...base, boomBoom: null }), null); // treated as absent
  assert.match(validateCreateBody({ ...base, boomBoom: 'yes' })!, /boomBoom must be a boolean/);
  assert.match(validateCreateBody({ ...base, boomBoom: 1 })!, /boomBoom must be a boolean/);
});
