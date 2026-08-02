// Domain types — copied verbatim from the backend's lib/engine.ts (types
// only; engine-internal state shapes stripped). Do NOT import across the
// repo boundary: this file is the mobile app's own copy of the contract.

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
  /** Availability of the boom-boom over rule (see BoomOverEvent). Absent =
   *  false: boom_over events are rejected unless this is true. */
  boomBoom?: boolean;
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

// ---------- Mid-match squad changes (v14) ----------

// Append a player to a team's roster. Valid in setup/live/innings_break.
// Existing player indexes never shift (the new player is pushed at the end).
export interface AddPlayerEvent {
  type: 'add_player';
  teamIndex: 0 | 1;
  name: string;
  at?: number;
}

// Mark a player unavailable (soft delete — the name stays in config so
// historical scorecard rows keep resolving). Valid in setup/live/innings_break.
export interface RemovePlayerEvent {
  type: 'remove_player';
  teamIndex: 0 | 1;
  playerIndex: number;
  at?: number;
}

// ---------- Boom-boom over (v14) ----------

// Arm (enabled:true) or disarm (enabled:false) the boom-boom rule for the
// over about to start. Only valid when config.boomBoom, status 'live', and no
// delivery (legal or illegal) has been bowled in the current over yet.
export interface BoomOverEvent {
  type: 'boom_over';
  enabled: boolean;
  at?: number;
}

// ---------- Corrections + mid-match common player (v15) ----------

// Swap which of the two current batsmen is on strike (scorer correction).
// Valid while live with both batsmen at the crease.
export interface SwapStrikeEvent {
  type: 'swap_strike';
  at?: number;
}

// Replace the selected bowler before the over's first delivery (legal or
// illegal). Same eligibility rules as select_bowler.
export interface ChangeBowlerEvent {
  type: 'change_bowler';
  playerIndex: number;
  at?: number;
}

// Add a latecomer who plays for BOTH sides, mid-match. Only when
// config.commonPlayer is not already set.
export interface AddCommonPlayerEvent {
  type: 'add_common_player';
  name: string;
  at?: number;
}

export type MatchEvent =
  | TossEvent
  | StartInningsEvent
  | SelectBatsmanEvent
  | SelectBowlerEvent
  | BallEvent
  | EndInningsEvent
  | EndMatchEvent
  | AddPlayerEvent
  | RemovePlayerEvent
  | BoomOverEvent
  | SwapStrikeEvent
  | ChangeBowlerEvent
  | AddCommonPlayerEvent;

// The store implements undo by popping the event log.
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
  /** true for deliveries bowled while a boom-boom over was armed. */
  boom?: boolean;
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
  // Boom-boom over (v14): armed for the over in progress / about to start;
  // 0-based indexes of COMPLETED boom overs; total wicket penalties applied.
  // Reconciliation invariant: sum(batsmen.runs) + extras.total - penaltyRuns
  // === runs (runs MAY go negative from boom wicket penalties).
  boomActive: boolean;
  boomOvers: number[];
  penaltyRuns: number;
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

// The JSON view clients receive (`id` is added by the GET route).
export interface PublicState {
  status: MatchStatus;
  config: MatchConfig;
  currentInningsIndex: number | null;
  result: MatchResult | null;
  toss: TossInfo | null;
  needs: Needs;
  innings: PublicInnings[];
  // Removed (unavailable) players per team, as playerIndex lists into
  // config.teams[t].players. Names stay in config for historical rows.
  removed: [number[], number[]];
  inningsBreak: InningsBreak | null;
  startedAt: number | null;
  endedAt: number | null;
  lastOverBowlerPlayerIndex?: number | null;
  id?: string;
}

// One row of GET /api/matches (see the backend's listMatches()).
export interface MatchListItem {
  id: string;
  status: MatchStatus;
  teams: string[];
  score: string | null;
  result?: string;
  // Nearby rows only: metres from the caller's coordinates.
  distanceM?: number;
}

// GET /api/matches response: the caller's own matches, plus other people's
// live matches near the ?lat=&lng= coords (empty without coords).
export interface MatchLists {
  mine: MatchListItem[];
  nearby: MatchListItem[];
}
