// test/engine.toss.test.ts — pre-match coin toss: records TossInfo, sets
// config.battingFirstIndex from the winner's decision, and undoes cleanly via
// replay (initState re-clones the ORIGINAL config, so dropping the toss event
// from the log restores the creator's batting-first choice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, initState, publicState, replay } from '../lib/engine';
import type { MatchConfig, MatchEvent, TossEvent } from '../lib/engine';

function makeConfig(): MatchConfig {
  return {
    teams: [
      { name: 'Lions', players: ['Asha', 'Bina', 'Chitra'] },
      { name: 'Tigers', players: ['Kumar', 'Lalit', 'Mohan'] },
    ],
    oversPerInnings: 2,
    battingFirstIndex: 0,
  };
}

// A valid toss: Tigers call heads, it lands heads, Tigers win and bat.
function tossEvent(overrides: Partial<TossEvent> = {}): TossEvent {
  return {
    type: 'toss',
    callerIndex: 1,
    call: 'heads',
    outcome: 'heads',
    winnerIndex: 1,
    decision: 'bat',
    ...overrides,
  };
}

test('winner bats: battingFirstIndex becomes the winner', () => {
  const s = applyEvent(initState(makeConfig()), tossEvent());
  assert.equal(s.status, 'setup');
  assert.deepEqual(s.toss, {
    callerIndex: 1, call: 'heads', outcome: 'heads', winnerIndex: 1, decision: 'bat',
  });
  assert.equal(s.config.battingFirstIndex, 1);
  // publicState exposes the toss verbatim.
  assert.deepEqual(publicState(s).toss, s.toss);
});

test('winner bowls: battingFirstIndex becomes the other side', () => {
  const s = applyEvent(initState(makeConfig()), tossEvent({ decision: 'bowl' }));
  assert.equal(s.toss?.winnerIndex, 1);
  assert.equal(s.config.battingFirstIndex, 0);
});

test('caller loses when the outcome differs from the call', () => {
  // Lions call heads, it lands tails -> Tigers win and choose to bowl.
  const s = applyEvent(initState(makeConfig()), tossEvent({
    callerIndex: 0, call: 'heads', outcome: 'tails', winnerIndex: 1, decision: 'bowl',
  }));
  assert.equal(s.toss?.winnerIndex, 1);
  assert.equal(s.config.battingFirstIndex, 0); // loser bats
});

test('winnerIndex that contradicts the call is rejected', () => {
  assert.throws(
    () => applyEvent(initState(makeConfig()), tossEvent({ outcome: 'tails', winnerIndex: 1 })),
    /toss winner does not match the call/,
  );
  assert.throws(
    () => applyEvent(initState(makeConfig()), tossEvent({ winnerIndex: 0 })),
    /toss winner does not match the call/,
  );
});

test('malformed fields are rejected', () => {
  const bad = [
    tossEvent({ callerIndex: 2 as unknown as 0 }),
    tossEvent({ call: 'edge' as unknown as 'heads' }),
    tossEvent({ outcome: 'edge' as unknown as 'heads' }),
    tossEvent({ winnerIndex: -1 as unknown as 0 }),
    tossEvent({ decision: 'field' as unknown as 'bat' }),
  ];
  for (const e of bad) {
    assert.throws(() => applyEvent(initState(makeConfig()), e), /invalid toss/);
  }
});

test('toss is rejected once the match is live', () => {
  const s = applyEvent(initState(makeConfig()), { type: 'start_innings' });
  assert.throws(
    () => applyEvent(s, tossEvent()),
    /toss can only happen before the first innings/,
  );
});

test('a second toss is rejected', () => {
  const s = applyEvent(initState(makeConfig()), tossEvent());
  assert.throws(() => applyEvent(s, tossEvent()), /toss already done — undo it first/);
});

test('undo (replay without the toss) restores battingFirstIndex and toss:null', () => {
  const config = makeConfig();
  const events: MatchEvent[] = [tossEvent({ decision: 'bat' })]; // flips batting to team 1
  const before = replay(config, events);
  assert.equal(before.config.battingFirstIndex, 1);

  // Server undo = pop the last event and replay the log.
  const after = replay(config, events.slice(0, -1));
  assert.equal(after.toss, null);
  assert.equal(after.config.battingFirstIndex, 0); // original creator choice
  assert.equal(publicState(after).toss, null);
});

test('start_innings after the toss uses the tossed batting side', () => {
  // Tigers (1) win and bat -> innings 1 is Tigers', overriding the config's
  // original battingFirstIndex of 0.
  const s = replay(makeConfig(), [tossEvent({ decision: 'bat' }), { type: 'start_innings' }]);
  assert.equal(s.status, 'live');
  assert.equal(s.innings[0].battingTeamIndex, 1);

  // And the bowl-first branch: winner 1 bowls -> team 0 bats.
  const s2 = replay(makeConfig(), [tossEvent({ decision: 'bowl' }), { type: 'start_innings' }]);
  assert.equal(s2.innings[0].battingTeamIndex, 0);
});
