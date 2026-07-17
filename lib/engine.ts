// lib/engine.ts — pure, event-sourced cricket scoring engine (no I/O).
// See SPEC.md "Engine" section; this module is the single source of scoring truth.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MatchStatus = 'setup' | 'live' | 'innings_break' | 'completed';

export interface TeamConfig {
  name: string;
  players: string[];
}

export interface MatchConfig {
  teams: [TeamConfig, TeamConfig];
  oversPerInnings: number;
  battingFirstIndex: 0 | 1;
  /** Gully-cricket odd-headcount rule: one player who turns out for BOTH
   *  sides. Must appear in both teams' player lists; scoring treats them as
   *  a full member of each side — this field only records who they are. */
  commonPlayer?: string | null;
}

export type BallExtra = 'none' | 'wide' | 'noball' | 'bye' | 'legbye';

export type WicketKind = 'bowled' | 'caught' | 'lbw' | 'stumped' | 'run_out' | 'hit_wicket';

export interface WicketInfo {
  kind: WicketKind;
  outEnd: 'striker' | 'non_striker'; // run_out only; others always striker
  fielder: string | null;
}

// ---------- Toss ----------

export type TossCall = 'heads' | 'tails';
export type TossDecision = 'bat' | 'bowl';

// The recorded coin toss. `winnerIndex` is redundant with (callerIndex, call,
// outcome) but is carried explicitly so a mis-built event can be rejected
// instead of silently "corrected".
export interface TossInfo {
  callerIndex: 0 | 1;
  call: TossCall;
  outcome: TossCall;
  winnerIndex: 0 | 1;
  decision: TossDecision;
}

export type TossEvent = { type: 'toss'; at?: number } & TossInfo;

export interface StartInningsEvent {
  type: 'start_innings';
  at?: number;
}

export interface SelectBatsmanEvent {
  type: 'select_batsman';
  playerIndex: number;
  at?: number;
}

export interface SelectBowlerEvent {
  type: 'select_bowler';
  playerIndex: number;
  at?: number;
}

export interface BallEvent {
  type: 'ball';
  extra: BallExtra;
  runs: number;
  wicket: WicketInfo | null;
  at?: number;
}

export interface EndInningsEvent {
  type: 'end_innings';
  at?: number;
}

export interface EndMatchEvent {
  type: 'end_match';
  at?: number;
}

export type MatchEvent =
  | TossEvent
  | StartInningsEvent
  | SelectBatsmanEvent
  | SelectBowlerEvent
  | BallEvent
  | EndInningsEvent
  | EndMatchEvent;

// The store implements undo by popping the event log; if a bare undo event
// ever reaches the engine it throws 'nothing to undo'.
export interface UndoEvent {
  type: 'undo';
  at?: number;
}

export interface Dismissal {
  kind: WicketKind;
  fielder: string | null;
  bowler: string | null;
  text: string;
}

export interface PublicBatsman {
  playerIndex: number;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: Dismissal | null;
}

export interface PublicBowler {
  playerIndex: number;
  name: string;
  balls: number;
  maidens: number;
  runs: number;
  wickets: number;
}

export interface Extras {
  wides: number;
  noballs: number;
  byes: number;
  legbyes: number;
  total: number;
}

export interface FallOfWicket {
  score: number;
  wicket: number;
  batsmanName: string;
  over: string;
}

export interface TimelineEntry {
  over: string;
  badge: string;
  text: string;
}

// Public per-innings view (internal `_` fields stripped, derived fields added).
export interface PublicInnings {
  battingTeamIndex: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  target: number | null;
  batsmen: PublicBatsman[];
  strikerIndex: number | null;
  nonStrikerIndex: number | null;
  bowlers: PublicBowler[];
  currentBowlerIndex: number | null;
  extras: Extras;
  fallOfWickets: FallOfWicket[];
  timeline: TimelineEntry[];
  // Who bowled the last completed over (null if none); lets clients disable
  // that bowler in the new-bowler picker (currentBowlerIndex is null then).
  lastOverBowlerPlayerIndex: number | null;
  oversDisplay: string;
  crr: number | null;
  // 2nd innings (chase) only:
  rrr?: number;
  ballsRemaining?: number;
  runsNeeded?: number;
}

// Internal per-innings state kept by the engine; publicState() strips the
// `_`-prefixed fields.
export interface Innings {
  battingTeamIndex: number;
  runs: number;
  wickets: number;
  legalBalls: number;
  target: number | null;
  batsmen: PublicBatsman[];
  strikerIndex: number | null;
  nonStrikerIndex: number | null;
  bowlers: PublicBowler[];
  currentBowlerIndex: number | null;
  extras: Extras;
  fallOfWickets: FallOfWicket[];
  timeline: TimelineEntry[];
  _overConceded: number;
  _lastOverBowler: number | null;
  _pendingOverEndSwap: boolean;
}

export interface Needs {
  openers: boolean;
  newBatsman: boolean;
  newBowler: boolean;
  startInnings: boolean;
}

export interface MatchResult {
  winnerIndex: 0 | 1 | null;
  text: string;
}

export interface InningsBreak {
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
}

// Full internal engine state (what applyEvent folds over).
export interface MatchState {
  status: MatchStatus;
  config: MatchConfig;
  currentInningsIndex: number | null;
  result: MatchResult | null;
  toss: TossInfo | null;
  startedAt: number | null;
  endedAt: number | null;
  inningsBreak: InningsBreak | null;
  needs: Needs;
  innings: Innings[];
}

// The JSON view clients receive (`id` is added by the GET route).
export interface PublicState {
  status: MatchStatus;
  config: MatchConfig;
  currentInningsIndex: number | null;
  result: MatchResult | null;
  toss: TossInfo | null;
  needs: Needs;
  innings: PublicInnings[];
  inningsBreak: InningsBreak | null;
  startedAt: number | null;
  endedAt: number | null;
  lastOverBowlerPlayerIndex?: number | null;
  id?: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const EXTRAS: readonly BallExtra[] = ['none', 'wide', 'noball', 'bye', 'legbye'];
const WICKET_KINDS: readonly WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'run_out', 'hit_wicket'];
// Internal (non-public) fields kept per innings; stripped by publicState().
const INTERNAL_KEYS = ['_overConceded', '_lastOverBowler', '_pendingOverEndSwap'] as const;

// Innings as it looks mid-way through publicState(): public shape, with the
// internal fields still present (optional) until they are deleted.
type CloningInnings = PublicInnings & {
  _overConceded?: number;
  _lastOverBowler?: number | null;
  _pendingOverEndSwap?: boolean;
};

export function initState(config: MatchConfig): MatchState {
  const common = config.commonPlayer ?? null;
  if (common !== null) {
    if (typeof common !== 'string' || common.trim() === '') {
      throw new Error('commonPlayer must be a non-empty string or null');
    }
    if (!config.teams.every((t) => t.players.includes(common))) {
      throw new Error("commonPlayer must appear in both teams' player lists");
    }
  }
  const state: MatchState = {
    status: 'setup',
    config: structuredClone(config),
    currentInningsIndex: null,
    result: null,
    toss: null,
    // Wall-clock stamps (epoch ms) copied from event.at by applyEvent; null
    // when the triggering event carried no `at` (e.g. pure-engine tests).
    startedAt: null,   // first start_innings
    endedAt: null,     // event that completed the match
    inningsBreak: null, // {startedAt, endedAt, durationMs} once innings 1 closes
    needs: { openers: false, newBatsman: false, newBowler: false, startInnings: false },
    innings: [],
  };
  recomputeNeeds(state);
  return state;
}

export function applyEvent(state: MatchState, event: MatchEvent | UndoEvent): MatchState {
  if (!event || typeof (event as { type?: unknown }).type !== 'string') throw new Error('invalid event');
  const s = structuredClone(state);
  const prevStatus = s.status;
  switch (event.type) {
    case 'toss': doToss(s, event); break;
    case 'start_innings': doStartInnings(s); break;
    case 'select_batsman': doSelectBatsman(s, event); break;
    case 'select_bowler': doSelectBowler(s, event); break;
    case 'ball': doBall(s, event); break;
    case 'end_innings': doEndInningsEvent(s); break;
    case 'end_match': doEndMatch(s); break;
    case 'undo': throw new Error('nothing to undo');
    default: throw new Error(`unknown event type: ${(event as { type: string }).type}`);
  }
  stampTransitions(s, prevStatus, event.at ?? null);
  recomputeNeeds(s);
  return s;
}

// Record wall-clock timestamps for status transitions. `at` is the epoch-ms
// stamp the store put on the event (null for unstamped events); replay of the
// stored log therefore reproduces identical timestamps, and undo correctness
// falls out of replay.
function stampTransitions(s: MatchState, prevStatus: MatchStatus, at: number | null): void {
  if (prevStatus === 'setup' && s.status === 'live') {
    s.startedAt = at; // first start_innings
  }
  if (prevStatus === 'live' && s.status === 'innings_break') {
    s.inningsBreak = { startedAt: at, endedAt: null, durationMs: null };
  }
  if (prevStatus === 'innings_break' && s.status === 'live' && s.inningsBreak) {
    s.inningsBreak.endedAt = at;
    s.inningsBreak.durationMs =
      s.inningsBreak.startedAt !== null && at !== null ? at - s.inningsBreak.startedAt : null;
  }
  if (prevStatus !== 'completed' && s.status === 'completed') {
    s.endedAt = at;
  }
}

export function replay(config: MatchConfig, events: ReadonlyArray<MatchEvent | UndoEvent>): MatchState {
  let state = initState(config);
  for (const event of events) state = applyEvent(state, event);
  return state;
}

export function publicState(state: MatchState): PublicState {
  const s = structuredClone(state) as unknown as Omit<PublicState, 'innings'> & { innings: CloningInnings[] };
  const totalBalls = s.config.oversPerInnings * 6;
  s.innings.forEach((ins, i) => {
    // Expose who bowled the last completed over so clients can disable that
    // bowler in the new-bowler picker (currentBowlerIndex is null at over end).
    ins.lastOverBowlerPlayerIndex = ins._lastOverBowler ?? null;
    for (const k of INTERNAL_KEYS) delete ins[k];
    ins.oversDisplay = oversDisplay(ins.legalBalls);
    ins.crr = ins.legalBalls > 0 ? round2(ins.runs / (ins.legalBalls / 6)) : 0;
    if (i === 1) {
      const ballsRemaining = Math.max(0, totalBalls - ins.legalBalls);
      const runsNeeded = Math.max(0, (ins.target as number) - ins.runs);
      ins.ballsRemaining = ballsRemaining;
      ins.runsNeeded = runsNeeded;
      ins.rrr = ballsRemaining > 0 ? round2(runsNeeded / (ballsRemaining / 6)) : 0;
    }
  });
  return s;
}

// ---------- event handlers ----------

// Coin toss: setup-only, once. The batting-first mutation lives HERE (not in
// initState), so replaying the log without the toss event — the store's undo —
// automatically restores the creator's original battingFirstIndex: initState
// re-clones the ORIGINAL config on every replay.
function doToss(s: MatchState, event: TossEvent): void {
  if (s.toss) throw new Error('toss already done — undo it first');
  if (s.status !== 'setup') throw new Error('toss can only happen before the first innings');
  const { callerIndex, call, outcome, winnerIndex, decision } = event;
  if (callerIndex !== 0 && callerIndex !== 1) throw new Error('invalid toss callerIndex');
  if (call !== 'heads' && call !== 'tails') throw new Error('invalid toss call');
  if (outcome !== 'heads' && outcome !== 'tails') throw new Error('invalid toss outcome');
  if (winnerIndex !== 0 && winnerIndex !== 1) throw new Error('invalid toss winnerIndex');
  if (decision !== 'bat' && decision !== 'bowl') throw new Error('invalid toss decision');
  const expectedWinner = (outcome === call ? callerIndex : 1 - callerIndex) as 0 | 1;
  if (winnerIndex !== expectedWinner) throw new Error('toss winner does not match the call');
  s.toss = { callerIndex, call, outcome, winnerIndex, decision };
  s.config.battingFirstIndex = decision === 'bat' ? winnerIndex : (1 - winnerIndex) as 0 | 1;
}

function doStartInnings(s: MatchState): void {
  if (s.status !== 'setup' && s.status !== 'innings_break') {
    throw new Error('cannot start an innings now');
  }
  const idx = s.innings.length;
  const battingTeamIndex = idx === 0
    ? s.config.battingFirstIndex
    : 1 - s.config.battingFirstIndex;
  s.innings.push({
    battingTeamIndex,
    runs: 0,
    wickets: 0,
    legalBalls: 0,
    target: idx === 1 ? s.innings[0].runs + 1 : null,
    batsmen: [],
    strikerIndex: null,
    nonStrikerIndex: null,
    bowlers: [],
    currentBowlerIndex: null,
    extras: { wides: 0, noballs: 0, byes: 0, legbyes: 0, total: 0 },
    fallOfWickets: [],
    timeline: [],
    _overConceded: 0,
    _lastOverBowler: null,
    _pendingOverEndSwap: false,
  });
  s.currentInningsIndex = idx;
  s.status = 'live';
}

function doSelectBatsman(s: MatchState, event: SelectBatsmanEvent): void {
  if (s.status !== 'live') throw new Error('cannot select a batsman now');
  if (!s.needs.openers && !s.needs.newBatsman) throw new Error('no batsman is needed');
  const ins = cur(s);
  const players = s.config.teams[ins.battingTeamIndex].players;
  const { playerIndex } = event;
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= players.length) {
    throw new Error('invalid batsman playerIndex');
  }
  if (ins.batsmen.some((b) => b.playerIndex === playerIndex)) {
    throw new Error('batsman is out or already batting');
  }
  ins.batsmen.push({
    playerIndex,
    name: players[playerIndex],
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    out: null,
  });
  const bi = ins.batsmen.length - 1;
  // New batsman takes the vacated end (striker end first for openers).
  if (ins.strikerIndex === null) ins.strikerIndex = bi;
  else ins.nonStrikerIndex = bi;
  // Wicket fell on the over's last legal ball: apply the deferred over-end swap
  // only once the replacement is resolved.
  if (ins._pendingOverEndSwap && ins.strikerIndex !== null && ins.nonStrikerIndex !== null) {
    swapStrike(ins);
    ins._pendingOverEndSwap = false;
  }
}

function doSelectBowler(s: MatchState, event: SelectBowlerEvent): void {
  if (s.status !== 'live') throw new Error('cannot select a bowler now');
  if (!s.needs.newBowler) throw new Error('no bowler is needed');
  const ins = cur(s);
  const bowlingTeamIndex = 1 - ins.battingTeamIndex;
  const players = s.config.teams[bowlingTeamIndex].players;
  const { playerIndex } = event;
  if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= players.length) {
    throw new Error('invalid bowler playerIndex');
  }
  if (playerIndex === ins._lastOverBowler) {
    throw new Error('same bowler cannot bowl consecutive overs');
  }
  let bi = ins.bowlers.findIndex((b) => b.playerIndex === playerIndex);
  if (bi === -1) {
    ins.bowlers.push({
      playerIndex,
      name: players[playerIndex],
      balls: 0,
      maidens: 0,
      runs: 0,
      wickets: 0,
    });
    bi = ins.bowlers.length - 1;
  }
  ins.currentBowlerIndex = bi;
}

function doBall(s: MatchState, event: BallEvent): void {
  if (s.status !== 'live') throw new Error('no innings in progress');
  if (s.needs.openers) throw new Error('select opening batsmen first');
  if (s.needs.newBatsman) throw new Error('select a new batsman first');
  if (s.needs.newBowler) throw new Error('select a bowler first');

  const extra = event.extra ?? 'none';
  const runs = event.runs;
  const wicket = event.wicket ?? null;
  if (!EXTRAS.includes(extra)) throw new Error(`invalid extra: ${extra}`);
  if (!Number.isInteger(runs) || runs < 0 || runs > 6) throw new Error('runs must be 0..6');
  if (wicket) {
    if (!WICKET_KINDS.includes(wicket.kind)) throw new Error(`invalid wicket kind: ${wicket.kind}`);
    if (extra === 'wide' && wicket.kind !== 'run_out' && wicket.kind !== 'stumped') {
      throw new Error(`${wicket.kind} is not possible on a wide`);
    }
    if (extra === 'noball' && wicket.kind !== 'run_out') {
      throw new Error(`${wicket.kind} is not possible on a no-ball`);
    }
    if (wicket.kind === 'run_out' && wicket.outEnd !== 'striker' && wicket.outEnd !== 'non_striker') {
      throw new Error('run_out requires outEnd of striker or non_striker');
    }
  }

  const ins = cur(s);
  const bowler = ins.bowlers[ins.currentBowlerIndex as number];
  const striker = ins.batsmen[ins.strikerIndex as number];
  const preStrikerIdx = ins.strikerIndex;
  // Delivery label: the ball about to be bowled (illegal deliveries re-use it).
  const overStr = `${Math.floor(ins.legalBalls / 6)}.${(ins.legalBalls % 6) + 1}`;

  // Scoring-rules table.
  let legal = true;
  let faced = true;
  let batRuns = 0;
  let conceded = 0;
  let teamRuns = 0;
  switch (extra) {
    case 'none':
      teamRuns = runs; batRuns = runs; conceded = runs;
      break;
    case 'wide':
      teamRuns = 1 + runs; conceded = 1 + runs; legal = false; faced = false;
      ins.extras.wides += 1 + runs;
      break;
    case 'noball':
      teamRuns = 1 + runs; batRuns = runs; conceded = 1 + runs; legal = false;
      ins.extras.noballs += 1; // penalty only; the runs are off the bat
      break;
    case 'bye':
      teamRuns = runs; ins.extras.byes += runs;
      break;
    case 'legbye':
      teamRuns = runs; ins.extras.legbyes += runs;
      break;
  }
  ins.extras.total = ins.extras.wides + ins.extras.noballs + ins.extras.byes + ins.extras.legbyes;

  ins.runs += teamRuns;
  striker.runs += batRuns;
  if (faced) striker.balls += 1;
  if ((extra === 'none' || extra === 'noball')) {
    if (runs === 4) striker.fours += 1;
    if (runs === 6) striker.sixes += 1;
  }
  bowler.runs += conceded;
  ins._overConceded += conceded;
  if (legal) {
    ins.legalBalls += 1;
    bowler.balls += 1;
  }

  // Strike: swap when the keyed runs are odd (applies before resolving run_out ends).
  if (runs % 2 === 1) swapStrike(ins);

  let outBatsmanForText: PublicBatsman | null = null;
  if (wicket) {
    ins.wickets += 1;
    if (wicket.kind !== 'run_out') bowler.wickets += 1;
    // run_out outEnd refers to the ends after completed runs; other kinds always
    // dismiss the batsman who faced the delivery.
    let outIdx;
    if (wicket.kind === 'run_out') {
      outIdx = wicket.outEnd === 'striker' ? ins.strikerIndex : ins.nonStrikerIndex;
    } else {
      outIdx = preStrikerIdx;
    }
    const outBatsman = ins.batsmen[outIdx as number];
    outBatsmanForText = outBatsman;
    const fielder = wicket.fielder ?? null;
    outBatsman.out = {
      kind: wicket.kind,
      fielder,
      bowler: wicket.kind === 'run_out' ? null : bowler.name,
      text: dismissalText(wicket.kind, fielder, bowler.name),
    };
    ins.fallOfWickets.push({
      score: ins.runs,
      wicket: ins.wickets,
      batsmanName: outBatsman.name,
      over: overStr,
    });
    // Vacate the out batsman's end; the replacement takes it.
    if (ins.strikerIndex === outIdx) ins.strikerIndex = null;
    else ins.nonStrikerIndex = null;
  }

  // Over end: after the 6th legal ball.
  if (legal && ins.legalBalls % 6 === 0) {
    if (ins._overConceded === 0) bowler.maidens += 1;
    ins._overConceded = 0;
    ins._lastOverBowler = bowler.playerIndex;
    ins.currentBowlerIndex = null;
    if (ins.strikerIndex === null || ins.nonStrikerIndex === null) {
      ins._pendingOverEndSwap = true; // defer until replacement batsman arrives
    } else {
      swapStrike(ins);
    }
  }

  ins.timeline.push({
    over: overStr,
    badge: ballBadge(extra, runs, wicket),
    text: ballText(bowler.name, striker.name, extra, runs, wicket, outBatsmanForText),
  });

  // Innings-end conditions.
  const teamSize = s.config.teams[ins.battingTeamIndex].players.length;
  const maxBalls = s.config.oversPerInnings * 6;
  const chaseDone = ins.target !== null && ins.runs >= ins.target;
  if (ins.wickets >= teamSize - 1 || ins.legalBalls >= maxBalls || chaseDone) {
    closeCurrentInnings(s);
  }
}

function doEndInningsEvent(s: MatchState): void {
  if (s.status !== 'live') throw new Error('no innings in progress');
  closeCurrentInnings(s);
}

function doEndMatch(s: MatchState): void {
  if (s.status === 'completed') throw new Error('match already completed');
  s.status = 'completed';
  s.result = s.innings.length === 2
    ? computeResult(s)
    : { winnerIndex: null, text: 'Match abandoned' };
}

// ---------- helpers ----------

function cur(s: MatchState): Innings {
  return s.innings[s.currentInningsIndex as number];
}

function swapStrike(ins: Innings): void {
  const t = ins.strikerIndex;
  ins.strikerIndex = ins.nonStrikerIndex;
  ins.nonStrikerIndex = t;
}

function closeCurrentInnings(s: MatchState): void {
  if (s.currentInningsIndex === 0) {
    s.status = 'innings_break';
  } else {
    s.status = 'completed';
    s.result = computeResult(s);
  }
}

function computeResult(s: MatchState): MatchResult {
  const [i1, i2] = s.innings;
  const target = i1.runs + 1;
  if (i2.runs >= target) {
    const teamIdx = i2.battingTeamIndex as 0 | 1;
    const team = s.config.teams[teamIdx];
    const wicketsInHand = team.players.length - 1 - i2.wickets;
    const ballsLeft = s.config.oversPerInnings * 6 - i2.legalBalls;
    return {
      winnerIndex: teamIdx,
      text: `${team.name} won by ${wicketsInHand} wickets (${ballsLeft} balls left)`,
    };
  }
  if (i2.runs === i1.runs) {
    return { winnerIndex: null, text: 'Match tied' };
  }
  const teamIdx = i1.battingTeamIndex as 0 | 1;
  return {
    winnerIndex: teamIdx,
    text: `${s.config.teams[teamIdx].name} won by ${i1.runs - i2.runs} runs`,
  };
}

function dismissalText(kind: WicketKind, fielder: string | null, bowlerName: string): string {
  switch (kind) {
    case 'bowled': return `b ${bowlerName}`;
    case 'caught': return `c ${fielder ?? 'sub'} b ${bowlerName}`;
    case 'lbw': return `lbw b ${bowlerName}`;
    case 'stumped': return `st ${fielder ?? 'sub'} b ${bowlerName}`;
    case 'hit_wicket': return `hit wicket b ${bowlerName}`;
    case 'run_out': return fielder ? `run out (${fielder})` : 'run out';
    default: return kind;
  }
}

function ballBadge(extra: BallExtra, runs: number, wicket: WicketInfo | null): string {
  if (wicket) return 'W';
  switch (extra) {
    case 'none': return runs === 0 ? '·' : String(runs);
    case 'wide': return runs > 0 ? `wd+${runs}` : 'wd';
    case 'noball': return runs > 0 ? `nb+${runs}` : 'nb';
    case 'bye': return `b${runs}`;
    case 'legbye': return `lb${runs}`;
  }
}

function ballText(
  bowlerName: string,
  strikerName: string,
  extra: BallExtra,
  runs: number,
  wicket: WicketInfo | null,
  outBatsman: PublicBatsman | null,
): string {
  const head = `${bowlerName} to ${strikerName}: `;
  if (wicket && outBatsman) {
    const extraBit = runs > 0 || extra !== 'none' ? ` (${describeRuns(extra, runs)})` : '';
    return `${head}WICKET! ${outBatsman.name} ${(outBatsman.out as Dismissal).text}${extraBit}`;
  }
  return head + describeRuns(extra, runs);
}

function describeRuns(extra: BallExtra, runs: number): string {
  switch (extra) {
    case 'none':
      if (runs === 0) return 'no run';
      if (runs === 4) return 'FOUR';
      if (runs === 6) return 'SIX';
      return `${runs} run${runs === 1 ? '' : 's'}`;
    case 'wide': return runs > 0 ? `wide + ${runs} run${runs === 1 ? '' : 's'}` : 'wide';
    case 'noball': return runs > 0 ? `no-ball, ${runs} off the bat` : 'no-ball';
    case 'bye': return `${runs} bye${runs === 1 ? '' : 's'}`;
    case 'legbye': return `${runs} leg bye${runs === 1 ? '' : 's'}`;
  }
}

function recomputeNeeds(s: MatchState): void {
  const needs: Needs = { openers: false, newBatsman: false, newBowler: false, startInnings: false };
  if (s.status === 'setup' || s.status === 'innings_break') {
    needs.startInnings = true;
  } else if (s.status === 'live') {
    const ins = cur(s);
    if (ins.batsmen.length < 2) {
      needs.openers = true;
    } else if (ins.strikerIndex === null || ins.nonStrikerIndex === null) {
      needs.newBatsman = true;
    }
    if (ins.currentBowlerIndex === null) needs.newBowler = true;
  }
  s.needs = needs;
}

function oversDisplay(legalBalls: number): string {
  return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
