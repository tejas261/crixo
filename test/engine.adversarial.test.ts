// test/engine.adversarial.test.ts — adversarial cricket-laws review of lib/engine.ts.
// Each test encodes a strict reading of SPEC.md ("Scoring rules", "Events", "Result text").

import test from 'node:test';
import assert from 'node:assert/strict';
import { initState, applyEvent, replay, publicState } from '../lib/engine';
import type { Innings, MatchConfig, MatchEvent, MatchState } from '../lib/engine';

const NAMES_A = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
const NAMES_B = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5'];

function cfg({ overs = 2, a = 4, b = 4 } = {}): MatchConfig {
  return {
    teams: [
      { name: 'Alphas', players: NAMES_A.slice(0, a) },
      { name: 'Bravos', players: NAMES_B.slice(0, b) },
    ],
    oversPerInnings: overs,
    battingFirstIndex: 0,
  };
}

const OPENERS: MatchEvent[] = [
  { type: 'start_innings' },
  { type: 'select_batsman', playerIndex: 0 },
  { type: 'select_batsman', playerIndex: 1 },
  { type: 'select_bowler', playerIndex: 0 },
];

// Intentionally loose: several tests feed invalid extras/wickets to assert rejection.
const ball = (extra: string, runs: number, wicket: unknown = null) =>
  ({ type: 'ball', extra, runs, wicket }) as MatchEvent;
const dot = () => ball('none', 0);

function fold(config: MatchConfig, events: MatchEvent[]) {
  return replay(config, events);
}

function ins(s: MatchState): Innings {
  return s.innings[s.currentInningsIndex ?? s.innings.length - 1];
}

function strikerOf(i: Innings) {
  return i.batsmen[i.strikerIndex!];
}
function nonStrikerOf(i: Innings) {
  return i.batsmen[i.nonStrikerIndex!];
}

// ---------------------------------------------------------------------------
// Wide with 2 runs ran
// ---------------------------------------------------------------------------
test('wide + 2 ran: 3 to team/extras/bowler, no legal ball, no ball faced, no strike swap', () => {
  const s = fold(cfg(), [...OPENERS, ball('wide', 2)]);
  const i = ins(s);
  assert.equal(i.runs, 3, 'team runs = 1 + 2');
  assert.equal(i.extras.wides, 3, 'wides tally includes the +1');
  assert.equal(i.extras.total, 3);
  assert.equal(i.bowlers[0].runs, 3, 'bowler concedes 1 + runs on a wide');
  assert.equal(i.legalBalls, 0, 'wide is not a legal ball');
  assert.equal(i.bowlers[0].balls, 0, 'wide does not count toward bowler balls');
  assert.equal(strikerOf(i).playerIndex, 0, 'even runs on a wide: no strike swap');
  assert.equal(i.batsmen[0].runs, 0, 'no runs to the batsman on a wide');
  assert.equal(i.batsmen[0].balls, 0, 'wide is not a ball faced');
});

test('wide + 1 ran: odd runs swap the strike (spec: swap when `runs` is odd)', () => {
  const s = fold(cfg(), [...OPENERS, ball('wide', 1)]);
  const i = ins(s);
  assert.equal(i.runs, 2);
  assert.equal(strikerOf(i).playerIndex, 1, 'batsmen crossed once');
});

// ---------------------------------------------------------------------------
// No-ball with a boundary off the bat
// ---------------------------------------------------------------------------
test('noball + 4 off bat: batsman +4 & a four, ball faced, not legal, team +5, bowler +5, noballs extra +1 only', () => {
  const s = fold(cfg(), [...OPENERS, ball('noball', 4)]);
  const i = ins(s);
  assert.equal(i.runs, 5);
  assert.equal(i.batsmen[0].runs, 4, 'runs off the bat go to the striker');
  assert.equal(i.batsmen[0].fours, 1);
  assert.equal(i.batsmen[0].balls, 1, 'no-ball counts as a ball faced');
  assert.equal(i.legalBalls, 0, 'no-ball is not a legal delivery');
  assert.equal(i.bowlers[0].balls, 0);
  assert.equal(i.bowlers[0].runs, 5, 'bowler concedes 1 + runs');
  assert.equal(i.extras.noballs, 1, 'only the penalty is an extra; the 4 is off the bat');
  assert.equal(i.extras.total, 1);
});

// ---------------------------------------------------------------------------
// Run out of the NON-striker end after 1 completed run
// ---------------------------------------------------------------------------
test('run_out at non_striker end with runs:1 — ends resolve after the completed run', () => {
  // 1 completed run means the batsmen swapped; outEnd refers to the ends after
  // the run. So outEnd:'non_striker' dismisses the ORIGINAL striker (A0), and
  // the original non-striker (A1) holds the strike.
  const s = fold(cfg(), [
    ...OPENERS,
    ball('none', 1, { kind: 'run_out', outEnd: 'non_striker', fielder: 'B3' }),
  ]);
  const i = ins(s);
  assert.equal(i.runs, 1, 'the completed run counts');
  assert.equal(i.wickets, 1);
  assert.equal(i.batsmen[0].runs, 1, 'striker is credited the completed run');
  assert.equal(i.batsmen[0].out?.kind, 'run_out', 'A0 (post-run non-striker) is out');
  assert.equal(i.batsmen[1].out, null, 'A1 survives');
  assert.equal(strikerOf(i).playerIndex, 1, 'A1 keeps the strike');
  assert.equal(i.nonStrikerIndex, null, 'non-striker end is vacated');
  assert.equal(s.needs.newBatsman, true);
  assert.equal(i.bowlers[0].wickets, 0, 'run out is not credited to the bowler');
  // replacement takes the vacated (non-striker) end
  const s2 = applyEvent(s, { type: 'select_batsman', playerIndex: 2 });
  const i2 = ins(s2);
  assert.equal(strikerOf(i2).playerIndex, 1, 'strike unchanged by the replacement');
  assert.equal(nonStrikerOf(i2).playerIndex, 2, 'new batsman takes the vacated end');
});

// ---------------------------------------------------------------------------
// Run out on the last legal ball of an over: replacement end + over-end swap order
// ---------------------------------------------------------------------------
test('wicket on the over\'s 6th legal ball: replacement takes vacated end, THEN over-end swap applies', () => {
  const s = fold(cfg(), [
    ...OPENERS,
    dot(), dot(), dot(), dot(), dot(),
    ball('none', 0, { kind: 'run_out', outEnd: 'striker', fielder: 'B2' }),
  ]);
  const i = ins(s);
  assert.equal(i.legalBalls, 6, 'over is complete');
  assert.equal(s.needs.newBatsman, true);
  assert.equal(s.needs.newBowler, true, 'over ended too');
  assert.equal(nonStrikerOf(i).playerIndex, 1, 'survivor still at non-striker end until replacement resolves');

  const s2 = applyEvent(s, { type: 'select_batsman', playerIndex: 2 });
  const i2 = ins(s2);
  // Per spec: replacement takes the vacated (striker) end, then the over-end
  // swap is applied => survivor (A1) is on strike for the new over, A2 at the
  // non-striker end.
  assert.equal(strikerOf(i2).playerIndex, 1, 'over-end swap applied after replacement resolved');
  assert.equal(nonStrikerOf(i2).playerIndex, 2);

  assert.throws(
    () => applyEvent(s2, { type: 'select_bowler', playerIndex: 0 }),
    /consecutive/i,
    'previous over\'s bowler is ineligible',
  );
  const s3 = applyEvent(s2, { type: 'select_bowler', playerIndex: 1 });
  assert.equal(s3.needs.newBowler, false);
});

test('plain over-end after an odd single on the 6th ball: both swaps apply (net: same striker)', () => {
  const s = fold(cfg(), [...OPENERS, dot(), dot(), dot(), dot(), dot(), ball('none', 1)]);
  const i = ins(s);
  assert.equal(i.legalBalls, 6);
  assert.equal(strikerOf(i).playerIndex, 0, 'odd-run swap then over-end swap cancel out');
  assert.equal(s.needs.newBowler, true);
});

// ---------------------------------------------------------------------------
// Wickets on wides / no-balls: legality matrix
// ---------------------------------------------------------------------------
test('stumped on a wide is legal, credited to the bowler, wide still scored, no ball faced', () => {
  const s = fold(cfg(), [
    ...OPENERS,
    ball('wide', 0, { kind: 'stumped', fielder: 'B1' }),
  ]);
  const i = ins(s);
  assert.equal(i.wickets, 1);
  assert.equal(i.extras.wides, 1, 'the wide is still an extra');
  assert.equal(i.runs, 1);
  assert.equal(i.legalBalls, 0);
  assert.equal(i.bowlers[0].wickets, 1, 'stumping is credited to the bowler');
  assert.equal(i.batsmen[0].balls, 0, 'wide is never a ball faced, even with a stumping');
  assert.equal(i.batsmen[0].out!.text, 'st B1 b B0');
});

test('bowled on a wide must be rejected', () => {
  const s = fold(cfg(), OPENERS);
  assert.throws(() => applyEvent(s, ball('wide', 0, { kind: 'bowled' })), /wide/i);
});

test('caught / lbw / hit_wicket on a wide must be rejected; run_out allowed', () => {
  const s = fold(cfg(), OPENERS);
  for (const kind of ['caught', 'lbw', 'hit_wicket']) {
    assert.throws(() => applyEvent(s, ball('wide', 0, { kind, fielder: 'B1' })), /wide/i, kind);
  }
  const ok = applyEvent(s, ball('wide', 1, { kind: 'run_out', outEnd: 'striker', fielder: 'B1' }));
  assert.equal(ins(ok).wickets, 1);
});

test('on a no-ball only run_out is legal (stumped must be rejected)', () => {
  const s = fold(cfg(), OPENERS);
  for (const kind of ['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket']) {
    assert.throws(() => applyEvent(s, ball('noball', 0, { kind, fielder: 'B1' })), /no.?ball/i, kind);
  }
  const ok = applyEvent(s, ball('noball', 0, { kind: 'run_out', outEnd: 'striker' }));
  assert.equal(ins(ok).wickets, 1);
});

// ---------------------------------------------------------------------------
// Maidens
// ---------------------------------------------------------------------------
test('an over of only leg-byes is still a maiden; a single wide is not', () => {
  const events = [...OPENERS];
  for (let k = 0; k < 6; k++) events.push(ball('legbye', 1));
  let s = fold(cfg(), events);
  let i = ins(s);
  assert.equal(i.bowlers[0].maidens, 1, 'byes/leg-byes do not break a maiden');
  assert.equal(i.bowlers[0].runs, 0, 'leg-byes are not conceded by the bowler');
  assert.equal(i.extras.legbyes, 6);

  // Second over by a different bowler: one wide, then 6 dots — not a maiden.
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 1 });
  s = applyEvent(s, ball('wide', 0));
  for (let k = 0; k < 6; k++) s = applyEvent(s, dot());
  i = ins(s);
  assert.equal(i.bowlers[1].balls, 6);
  assert.equal(i.bowlers[1].maidens, 0, 'a wide breaks the maiden');
  assert.equal(i.bowlers[1].runs, 1);
});

// ---------------------------------------------------------------------------
// Innings / match termination
// ---------------------------------------------------------------------------
test('chase ends the instant the target is reached mid-over; result counts balls remaining', () => {
  const c = cfg({ overs: 2 }); // 12 balls per innings
  const s = fold(c, [
    ...OPENERS,
    ball('none', 4),
    { type: 'end_innings' },              // Alphas 4, target 5
    ...OPENERS,                            // Bravos openers, Alphas bowler
    ball('none', 6),                       // 6 >= 5 on the 1st legal ball
  ]);
  assert.equal(s.status, 'completed');
  assert.equal(s.innings[1].target, 5, 'target = innings 1 runs + 1');
  assert.equal(s.innings[1].legalBalls, 1);
  assert.equal(s.result!.winnerIndex, 1);
  // 4 players => players-1-wickets = 3 wickets in hand; 12-1 = 11 balls left.
  assert.equal(s.result!.text, 'Bravos won by 3 wickets (11 balls left)');
});

test('winning run off a wide: innings ends, and the wide consumes no ball (balls left unchanged)', () => {
  const c = cfg({ overs: 1 }); // 6 balls per innings
  const s = fold(c, [
    ...OPENERS,
    { type: 'end_innings' },  // Alphas 0, target 1
    ...OPENERS,
    ball('wide', 0),          // 1 run, no legal ball => Bravos win
  ]);
  assert.equal(s.status, 'completed');
  assert.equal(s.innings[1].legalBalls, 0);
  assert.equal(s.result!.text, 'Bravos won by 3 wickets (6 balls left)');
});

test('scores level at close of the 2nd innings = Match tied (winnerIndex null)', () => {
  const c = cfg({ overs: 1 });
  const six1s = [ball('none', 1), ball('none', 1), ball('none', 1), ball('none', 1), ball('none', 1), ball('none', 1)];
  const s = fold(c, [...OPENERS, ...six1s, { type: 'start_innings' },
    { type: 'select_batsman', playerIndex: 0 },
    { type: 'select_batsman', playerIndex: 1 },
    { type: 'select_bowler', playerIndex: 0 },
    ...six1s]);
  assert.equal(s.innings[0].runs, 6);
  assert.equal(s.innings[1].runs, 6);
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: null, text: 'Match tied' });
});

test('innings ends at players-1 wickets (last man cannot bat alone)', () => {
  const c = cfg({ a: 3, b: 3 }); // 3 players => innings ends at 2 wickets
  const s = fold(c, [
    ...OPENERS,
    ball('none', 0, { kind: 'bowled' }),
    { type: 'select_batsman', playerIndex: 2 },
    ball('none', 0, { kind: 'bowled' }),
  ]);
  assert.equal(s.innings[0].wickets, 2);
  assert.equal(s.status, 'innings_break', '2 wickets = 3 players - 1 closes the innings');
  assert.equal(s.needs.newBatsman, false, 'no replacement is owed after the innings closes');
  assert.equal(s.needs.startInnings, true);
});

test('defending side wins by runs when the chase falls short at close', () => {
  const c = cfg({ overs: 1 });
  const s = fold(c, [
    ...OPENERS,
    ball('none', 6), dot(), dot(), dot(), dot(), dot(),   // Alphas 6
    { type: 'start_innings' },
    { type: 'select_batsman', playerIndex: 0 },
    { type: 'select_batsman', playerIndex: 1 },
    { type: 'select_bowler', playerIndex: 0 },
    ball('none', 2), dot(), dot(), dot(), dot(), dot(),   // Bravos 2
  ]);
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: 0, text: 'Alphas won by 4 runs' });
});

// ---------------------------------------------------------------------------
// Undo semantics via replay
// ---------------------------------------------------------------------------
test('undo = pop + replay: replay(config, events.slice(0,-1)) equals the pre-event state', () => {
  const c = cfg();
  const events: MatchEvent[] = [
    ...OPENERS,
    ball('none', 1),
    ball('wide', 2),
    ball('noball', 3),
    ball('legbye', 1),
    ball('none', 0, { kind: 'caught', fielder: 'B3' }),
    { type: 'select_batsman', playerIndex: 2 },
    ball('bye', 1),
  ];
  // Every prefix must be reproducible: state_k+1 = applyEvent(state_k, e_k).
  let running = initState(c);
  for (let k = 0; k < events.length; k++) {
    assert.deepEqual(replay(c, events.slice(0, k)), running, `prefix ${k}`);
    running = applyEvent(running, events[k]);
  }
  assert.deepEqual(replay(c, events), running);
  // Undoing the last ball restores runs/extras exactly.
  const undone = replay(c, events.slice(0, -1));
  assert.equal(ins(undone).extras.byes, 0);
  assert.equal(ins(running).extras.byes, 1);
});

test('engine rejects a bare undo event with "nothing to undo"', () => {
  assert.throws(() => applyEvent(initState(cfg()), { type: 'undo' }), /nothing to undo/);
});

test('applyEvent does not mutate its input state', () => {
  const s = fold(cfg(), OPENERS);
  const frozen = structuredClone(s);
  applyEvent(s, ball('none', 4, null));
  assert.deepEqual(s, frozen);
});

// ---------------------------------------------------------------------------
// Bowler selection rules
// ---------------------------------------------------------------------------
test('same bowler for consecutive overs rejected; alternating B0,B1,B0 allowed', () => {
  let s = fold(cfg({ overs: 3 }), OPENERS);
  for (let k = 0; k < 6; k++) s = applyEvent(s, dot());
  assert.throws(() => applyEvent(s, { type: 'select_bowler', playerIndex: 0 }), /consecutive/i);
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 1 });
  for (let k = 0; k < 6; k++) s = applyEvent(s, dot());
  s = applyEvent(s, { type: 'select_bowler', playerIndex: 0 }); // 2 overs ago: fine
  assert.equal(s.needs.newBowler, false);
  const i = ins(s);
  assert.equal(i.bowlers.length, 2, 'returning bowler reuses his card');
});

test('ball is rejected while a new batsman or bowler is owed', () => {
  const afterWicket = fold(cfg(), [...OPENERS, ball('none', 0, { kind: 'bowled' })]);
  assert.throws(() => applyEvent(afterWicket, dot()), /batsman/i);

  let s = fold(cfg(), OPENERS);
  for (let k = 0; k < 6; k++) s = applyEvent(s, dot());
  assert.throws(() => applyEvent(s, dot()), /bowler/i);
});

test('an out batsman cannot be re-selected', () => {
  const s = fold(cfg(), [...OPENERS, ball('none', 0, { kind: 'bowled' })]);
  assert.throws(() => applyEvent(s, { type: 'select_batsman', playerIndex: 0 }), /out|already/i);
});

// ---------------------------------------------------------------------------
// Fall of wickets
// ---------------------------------------------------------------------------
test('fallOfWickets records score INCLUDING the runs on the dismissal delivery', () => {
  const s = fold(cfg(), [
    ...OPENERS,
    ball('none', 4),                                                  // 4/0
    ball('none', 1, { kind: 'run_out', outEnd: 'non_striker', fielder: 'B2' }), // run counts: 5/1
    { type: 'select_batsman', playerIndex: 2 },
    ball('none', 0, { kind: 'bowled' }),                              // 5/2
  ]);
  const i = ins(s);
  assert.deepEqual(
    i.fallOfWickets.map(({ score, wicket, batsmanName }) => ({ score, wicket, batsmanName })),
    [
      { score: 5, wicket: 1, batsmanName: 'A0' }, // A0 was at the non-striker end after the single
      { score: 5, wicket: 2, batsmanName: 'A1' },
    ],
  );
  for (const f of i.fallOfWickets) assert.match(f.over, /^\d+\.\d$/);
});

// ---------------------------------------------------------------------------
// Dismissal text formats (spec examples)
// ---------------------------------------------------------------------------
test('dismissal texts match the scorecard formats in the spec', () => {
  const c = cfg({ a: 6, b: 6 });
  let s = fold(c, OPENERS);
  const wick = (kind: string, fielder: string | null = null, extra = 'none') =>
    ball(extra, 0, { kind, fielder });

  s = applyEvent(s, wick('bowled'));                       // A0
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 2 });
  s = applyEvent(s, wick('caught', 'B3'));                 // A2 (took the striker end)
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 3 });
  s = applyEvent(s, wick('lbw'));                          // A3
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 4 });
  s = applyEvent(s, wick('hit_wicket'));                   // A4
  s = applyEvent(s, { type: 'select_batsman', playerIndex: 5 });
  s = applyEvent(s, wick('stumped', 'B1', 'wide'));        // A5 st on a wide — 5th wicket ends innings

  const texts = Object.fromEntries(
    s.innings[0].batsmen.filter((b) => b.out).map((b) => [b.name, b.out!.text] as [string, string]),
  );
  assert.equal(texts.A0, 'b B0');
  assert.equal(texts.A2, 'c B3 b B0');
  assert.equal(texts.A3, 'lbw b B0');
  assert.equal(texts.A4, 'hit wicket b B0');
  assert.equal(texts.A5, 'st B1 b B0');
  assert.equal(s.status, 'innings_break', '5 wickets with 6 players closes the innings');
});

test('run out text with and without fielder', () => {
  const c = cfg({ a: 3, b: 3 });
  const s = fold(c, [
    ...OPENERS,
    ball('none', 0, { kind: 'run_out', outEnd: 'striker', fielder: 'B2' }),
    { type: 'select_batsman', playerIndex: 2 },
    ball('none', 0, { kind: 'run_out', outEnd: 'striker', fielder: null }),
  ]);
  const outs = s.innings[0].batsmen.filter((b) => b.out).map((b) => b.out!);
  assert.equal(outs[0].text, 'run out (B2)');
  assert.equal(outs[1].text, 'run out');
  assert.equal(outs[0].bowler, null, 'run out carries no bowler credit');
});

// ---------------------------------------------------------------------------
// publicState derived fields for a chase
// ---------------------------------------------------------------------------
test('publicState exposes ballsRemaining/runsNeeded/rrr for the chase and hides internals', () => {
  const c = cfg({ overs: 1 });
  const s = fold(c, [
    ...OPENERS,
    ball('none', 6), dot(), dot(), dot(), dot(), dot(),  // Alphas 6, target 7
    { type: 'start_innings' },
    { type: 'select_batsman', playerIndex: 0 },
    { type: 'select_batsman', playerIndex: 1 },
    { type: 'select_bowler', playerIndex: 0 },
    ball('none', 2), ball('wide', 0),                    // 3/0 after 1 legal ball
  ]);
  const p = publicState(s);
  const i2 = p.innings[1];
  assert.equal(i2.target, 7);
  assert.equal(i2.ballsRemaining, 5, 'wide consumed no ball');
  assert.equal(i2.runsNeeded, 4);
  assert.equal(i2.oversDisplay, '0.1');
  assert.equal(i2.rrr, 4.8);
  for (const inn of p.innings) {
    assert.ok(!('_overConceded' in inn) && !('_lastOverBowler' in inn) && !('_pendingOverEndSwap' in inn),
      'internal fields must not leak to clients');
  }
});

test('end_match after both innings started uses normal result logic, not "abandoned"', () => {
  const c = cfg({ overs: 2 });
  const s = fold(c, [
    ...OPENERS,
    ball('none', 4),
    { type: 'end_innings' },
    ...OPENERS,
    ball('none', 1),
    { type: 'end_match' },
  ]);
  assert.equal(s.status, 'completed');
  assert.deepEqual(s.result, { winnerIndex: 0, text: 'Alphas won by 3 runs' });

  const abandoned = fold(c, [...OPENERS, ball('none', 4), { type: 'end_match' }]);
  assert.deepEqual(abandoned.result, { winnerIndex: null, text: 'Match abandoned' });
});
