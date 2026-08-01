'use client';

// Umpire console — drives the pad and sheets purely off publicState + `needs`.
// Port of public/js/umpire.js.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Logo';
import { useParams } from 'next/navigation';
import { useMatch, fetchJSON, type FetchJSONError } from '@/lib/useMatch';
import { fmtOvers, currentInnings, teamsLine } from '@/lib/format';
import { copyText, shareOrCopy } from '@/lib/share';
import { toast } from '@/components/Toasts';
import Avatar, { type AvatarRole } from '@/components/Avatar';
import ScorePlates from '@/components/ScorePlates';
import BatterCard from '@/components/BatterCard';
import BowlerCard from '@/components/BowlerCard';
import OverStrip from '@/components/OverStrip';
import Sheet from '@/components/Sheet';
import BreakTimer from '@/components/BreakTimer';
import TossLine from '@/components/TossLine';
import RematchButton from '@/components/RematchButton';
import type {
  BallEvent,
  BallExtra,
  MatchEvent,
  Needs,
  PublicInnings,
  PublicState,
  UndoEvent,
  WicketInfo,
  WicketKind,
} from '@/lib/engine';

// Extras selectable on the pad ('none' is the absence of a selection).
type PadExtra = Exclude<BallExtra, 'none'>;

// Everything the console POSTs to /api/matches/:id/events — the engine's
// event union plus `undo`, which the store handles by popping the log.
type PostableEvent = MatchEvent | UndoEvent;

type PostEvent = (event: PostableEvent) => Promise<boolean>;

// GET /api/matches/:id/role — this browser session's rights for the match.
// adminKey is present only when canScore (for cross-device handoff).
interface RoleResponse {
  canScore: boolean;
  adminKey: string | null;
}

const EXTRAS: [PadExtra, string][] = [
  ['wide', 'wide'],
  ['noball', 'no-ball'],
  ['bye', 'bye'],
  ['legbye', 'leg-bye'],
];

const WICKET_KINDS: [WicketKind, string][] = [
  ['bowled', 'Bowled'], ['caught', 'Caught'], ['lbw', 'Lbw'],
  ['stumped', 'Stumped'], ['run_out', 'Run out'], ['hit_wicket', 'Hit wicket'],
];

function legalKinds(extra: PadExtra | null): WicketKind[] {
  if (extra === 'wide') return ['run_out', 'stumped'];
  if (extra === 'noball') return ['run_out'];
  return WICKET_KINDS.map(([k]) => k);
}

export default function UmpirePage() {
  const params = useParams<{ id: string }>();
  const matchId = params?.id;
  const { state, setState, connected, error } = useMatch(matchId);

  // Scoring rights live server-side (session cookie -> DB grant); the client
  // only mirrors /role. `keyFallback` is the memory-only escape hatch for
  // cookie-blocked browsers: the pasted (verified) key rides along with each
  // event instead.
  const [scorer, setScorer] = useState(false); // this session may score
  const [roleAdminKey, setRoleAdminKey] = useState<string | null>(null); // for handoff display
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [keyFallback, setKeyFallback] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [selectedExtra, setSelectedExtra] = useState<PadExtra | null>(null); // null | 'wide' | 'noball' | 'bye' | 'legbye'
  const [wicketOpen, setWicketOpen] = useState(false);
  const [squadsOpen, setSquadsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'endInnings' | 'endMatch' | null>(null); // null | 'endInnings' | 'endMatch'
  const [completedDismissed, setCompletedDismissed] = useState(false); // completed sheet shows once, then stays closed
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false); // synchronous guard: React state lags a tap

  // The fixed one-thumb pad styling hangs off body.console-page.
  useEffect(() => {
    document.body.classList.add('console-page');
    return () => document.body.classList.remove('console-page');
  }, []);

  // Boom matches get a taller fixed pad (the boom row lives inside it), so
  // the reserved scroll space underneath has to grow with it.
  const boomMatch = Boolean(state?.config.boomBoom);
  useEffect(() => {
    if (!boomMatch) return undefined;
    document.body.classList.add('boom-page');
    return () => document.body.classList.remove('boom-page');
  }, [boomMatch]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    // A rematch pushes a new id onto this same route, so per-match UI state
    // must reset here (the component instance survives the navigation).
    setCompletedDismissed(false);
    setKeyFallback(null);
    setSquadsOpen(false);
    fetchJSON<RoleResponse>(`/api/matches/${matchId}/role`)
      .then((role) => {
        if (cancelled) return;
        setScorer(role.canScore);
        setRoleAdminKey(role.adminKey);
      })
      .catch(() => { /* read-only until the prompt resolves it */ })
      .finally(() => { if (!cancelled) setRoleLoaded(true); });
    return () => { cancelled = true; };
  }, [matchId]);

  // ---------- Event posting ----------
  // Returns true on success, false on any failure, so multi-event sequences
  // (openers flow) can abort instead of posting on top of a failed step.
  async function postEvent(event: PostableEvent): Promise<boolean> {
    if (postingRef.current) {
      toast('Still sending the last ball…');
      return false;
    }
    postingRef.current = true;
    setPosting(true); // pad is visibly inert while the POST is in flight
    try {
      // The session cookie authorizes; adminKey only rides along when the
      // cookie flow failed (cookies blocked) and a verified key is in memory.
      const next = await fetchJSON<PublicState>(`/api/matches/${matchId}/events`, {
        method: 'POST',
        body: JSON.stringify(keyFallback ? { event, adminKey: keyFallback } : { event }),
      });
      setState(next); // snappy; SSE will confirm with the same state
      return true;
    } catch (err) {
      const e = err as FetchJSONError;
      if (e.status === 403) {
        // Grant revoked or DB reset — back to read-only and re-prompt.
        toast('Scoring access was rejected — paste the admin key to score.');
        setScorer(false);
        setRoleAdminKey(null);
        setKeyFallback(null);
      } else {
        toast(e.message);
      }
      return false;
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  }

  // ---------- Derived ----------

  const i = currentInnings(state);
  const needs: Partial<Needs> = state?.needs || {};
  const canScore = scorer && state?.status === 'live'
    && !needs.openers && !needs.newBatsman && !needs.newBowler && !needs.startInnings;
  const padOk = canScore && !posting;

  // ---------- Sheet key (mirrors the vanilla sheetKeyFor) ----------

  const sheetKey = useMemo<string | null>(() => {
    if (!state) return null;
    // Dismissible so the console (including Undo) stays reachable after an
    // accidental end_match, and for read-only visitors.
    if (state.status === 'completed') return completedDismissed ? null : 'completed';
    if (!scorer) return null; // read-only: no action sheets
    // Squads outranks the needs-driven sheets: it can only be opened from the
    // pad footer (no sheet up) or from the start-innings sheet's own footer,
    // and a squad change may itself resolve/raise a `needs` flag — the needs
    // sheet takes back over the moment squads is dismissed.
    if (squadsOpen) return 'squads';
    const n: Partial<Needs> = state.needs || {};
    if (n.startInnings) return `start:${state.status}`;
    if (n.openers) return `openers:${state.currentInningsIndex}`;
    if (n.newBatsman) return `newBatsman:${i?.batsmen.length}`;
    if (n.newBowler) return `newBowler:${i?.legalBalls}`;
    if (confirmAction) return `confirm:${confirmAction}`;
    if (wicketOpen) return 'wicket';
    return null;
  }, [state, scorer, completedDismissed, squadsOpen, confirmAction, wicketOpen, i]);

  // A sheet the umpire may close without acting (Escape / backdrop). Needs-
  // driven sheets are not dismissible, but each carries its own Undo footer
  // so a mis-recorded ball is always correctable.
  const dismissHandler = useMemo<(() => void) | undefined>(() => {
    if (sheetKey === 'wicket') return () => setWicketOpen(false);
    if (sheetKey === 'squads') return () => setSquadsOpen(false);
    if (sheetKey?.startsWith('confirm:')) return () => setConfirmAction(null);
    if (sheetKey === 'completed') return () => setCompletedDismissed(true);
    return undefined;
  }, [sheetKey]);

  // Quiet escape hatch inside needs-driven sheets: a mis-recorded ball (e.g. a
  // phantom wicket) can be undone without first satisfying the sheet.
  const showUndoFooter = Boolean(
    state?.innings.length && (i?.timeline.length || state?.status === 'innings_break')
  );
  const undoFooter: ReactNode = showUndoFooter ? (
    <div className="pad-footer">
      <span />
      <button className="btn-quiet" onClick={() => postEvent({ type: 'undo' })}>
        Undo last ball
      </button>
    </div>
  ) : null;

  // ---------- Bits of render ----------

  function scoreContext(): ReactNode {
    if (error) return <>Couldn&apos;t load this match — {error}. Check the link and refresh.</>;
    if (!state) return 'Loading match…';
    if (state.status === 'setup') {
      return (
        <>
          Match set up — start the first innings when both sides are ready.
          <TossLine state={state} />
        </>
      );
    }
    if (state.status === 'completed') {
      return <strong>{state.result?.text || 'Match over'}</strong>;
    }
    if (state.status === 'innings_break') {
      const first = state.innings[0];
      const chaseTeam = state.config.teams[1 - first.battingTeamIndex].name;
      return <>Innings break — <strong>{chaseTeam}</strong> need {first.runs + 1} to win.</>;
    }
    if (i) {
      const batTeam = state.config.teams[i.battingTeamIndex].name;
      // Boom state rides on the context line so everyone (read-only included)
      // sees it; penalties reconcile the total with the batting card sums.
      const boomBits = (
        <>
          {i.boomActive && <> · <strong>BOOM ×2, wickets −5</strong></>}
          {i.penaltyRuns > 0 && <> · boom −{i.penaltyRuns}</>}
        </>
      );
      if (state.currentInningsIndex === 1 && i.target != null) {
        return (
          <>
            <strong>{batTeam}</strong> chasing {i.target} — need {i.runsNeeded} from{' '}
            {i.ballsRemaining} · CRR {i.crr} · RRR {i.rrr}{boomBits}
          </>
        );
      }
      return <><strong>{batTeam}</strong> batting · first innings · CRR {i.crr}{boomBits}</>;
    }
    return null;
  }

  async function saveKey() {
    const v = keyInput.trim();
    if (!v) {
      toast('Paste the admin key first.');
      return;
    }
    // Claim binds a scoring grant to this browser's session cookie.
    try {
      await fetchJSON<null>(`/api/matches/${matchId}/claim`, {
        method: 'POST',
        body: JSON.stringify({ adminKey: v }),
      });
    } catch (err) {
      toast((err as Error).message); // server's 403 'invalid admin key' / 404
      return;
    }
    setKeyInput('');
    // 204 = the key is right. Confirm the grant took via /role; if the cookie
    // didn't stick (cookies blocked), keep the verified key in memory and
    // send it with each event instead.
    let role: RoleResponse | null = null;
    try {
      role = await fetchJSON<RoleResponse>(`/api/matches/${matchId}/role`);
    } catch { /* treated as a cookie failure below */ }
    if (role?.canScore) {
      setScorer(true);
      setRoleAdminKey(role.adminKey);
      setKeyFallback(null);
    } else {
      setScorer(true);
      setRoleAdminKey(v);
      setKeyFallback(v);
    }
    toast('Key accepted — you can score now.', 'ok');
  }

  const shareSummary = () => shareOrCopy(`${location.origin}/summary/${matchId}`);

  function sheetContent(): ReactNode {
    if (!sheetKey || !state) return null;

    if (sheetKey === 'completed') {
      return (
        <CompletedSheet
          key={sheetKey}
          state={state}
          resultText={state.result?.text || ''}
          matchId={matchId}
          scorer={scorer}
          adminKey={roleAdminKey}
          onShare={shareSummary}
          onClose={() => setCompletedDismissed(true)}
          onUndo={() => postEvent({ type: 'undo' })}
        />
      );
    }
    if (sheetKey === 'squads') {
      return (
        <SquadsSheet
          key={sheetKey}
          state={state}
          postEvent={postEvent}
          posting={posting}
          onClose={() => setSquadsOpen(false)}
        />
      );
    }
    if (sheetKey.startsWith('start:')) {
      return (
        <StartInningsSheet
          key={sheetKey}
          state={state}
          matchId={matchId}
          onStart={() => postEvent({ type: 'start_innings' })}
          onSquads={() => setSquadsOpen(true)}
          onUndo={state.status === 'innings_break' && showUndoFooter
            ? () => postEvent({ type: 'undo' })
            : null}
        />
      );
    }
    if (sheetKey.startsWith('confirm:')) {
      const endMatch = sheetKey === 'confirm:endMatch';
      return (
        <ConfirmSheet
          key={sheetKey}
          endMatch={endMatch}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            setConfirmAction(null);
            postEvent({ type: endMatch ? 'end_match' : 'end_innings' });
          }}
        />
      );
    }
    // The needs-driven and wicket sheets only ever render while their innings
    // exists (the engine's `needs` flags guarantee it), hence the assertions.
    if (sheetKey.startsWith('openers:')) {
      return <OpenersSheet key={sheetKey} state={state} innings={i!} postEvent={postEvent} />;
    }
    if (sheetKey.startsWith('newBatsman:')) {
      return (
        <NewBatsmanSheet
          key={sheetKey}
          state={state}
          innings={i!}
          postEvent={postEvent}
          undoFooter={undoFooter}
        />
      );
    }
    if (sheetKey.startsWith('newBowler:')) {
      return (
        <NewBowlerSheet
          key={sheetKey}
          state={state}
          innings={i!}
          postEvent={postEvent}
          undoFooter={undoFooter}
        />
      );
    }
    if (sheetKey === 'wicket') {
      return (
        <WicketSheet
          key={sheetKey}
          innings={i!}
          selectedExtra={selectedExtra}
          onCancel={() => setWicketOpen(false)}
          onConfirm={(wicket, runs) => {
            const event: BallEvent = {
              type: 'ball',
              extra: selectedExtra || 'none',
              runs,
              wicket,
            };
            setWicketOpen(false);
            setSelectedExtra(null);
            postEvent(event);
          }}
        />
      );
    }
    return null;
  }

  return (
    <div className="wrap">
      <header className="site-header">
        <Wordmark />
        <span className="header-teams">{teamsLine(state)}</span>
        <span className="header-spacer" />
        <Link href={`/m/${matchId}`} className="hint">Live view</Link>
      </header>

      {roleLoaded && !scorer && (
        <div className="console-note">
          <p>This console is read-only — paste the admin key for this match to score it.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              type="text"
              placeholder="Admin key"
              aria-label="Admin key"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button className="btn" onClick={saveKey}>Save key</button>
          </div>
        </div>
      )}
      {scorer && roleAdminKey && (
        <div className="console-note">
          <ScoringKeyRow adminKey={roleAdminKey} />
        </div>
      )}

      <section className="panel score-panel">
        {i ? (
          <ScorePlates
            runs={i.runs}
            wickets={i.wickets}
            overs={i.oversDisplay ?? fmtOvers(i.legalBalls)}
          />
        ) : (
          <ScorePlates runs={0} wickets={0} overs="0.0" />
        )}
        <div className="score-context">{scoreContext()}</div>
      </section>

      <section className="player-cards" aria-label="Batsmen">
        {!i || state?.status === 'setup' ? (
          <div className="player-card">
            <div className="player-main">
              <span className="hint">Batsmen appear here once the innings starts.</span>
            </div>
          </div>
        ) : (
          <>
            <BatterCard innings={i} batsmanIndex={i.strikerIndex} onStrike commonName={state?.config.commonPlayer ?? null} />
            <BatterCard innings={i} batsmanIndex={i.nonStrikerIndex} onStrike={false} commonName={state?.config.commonPlayer ?? null} />
          </>
        )}
      </section>
      <section className="player-cards" aria-label="Bowler">
        {i && state?.status !== 'setup' && (
          <BowlerCard
            bowler={i.currentBowlerIndex != null ? i.bowlers[i.currentBowlerIndex] : null}
            waitingText="Waiting for a bowler…"
            commonName={state?.config.commonPlayer ?? null}
          />
        )}
      </section>

      <section className="panel panel--gap-top">
        <h2 className="panel-title">This over</h2>
        <div className="over-strip">
          <OverStrip innings={i} />
        </div>
      </section>

      <section className="panel pad" aria-label="Ball pad">
        {/* Boom-boom over (v14). Armed: THE gradient pill for everyone, with a
            quiet cancel for the scorer (the engine rejects it after the first
            delivery — the 400 surfaces as a toast). Not armed: an armed-style
            chip at every over boundary, a quiet hint mid-over (the row always
            renders in live boom matches so the fixed pad never jumps).
            legalBalls % 6 === 0 is a heuristic — after e.g. a first-ball wide
            the engine has already counted an illegal delivery and will 400
            with a clear message; we just surface it. */}
        {state?.config.boomBoom && state.status === 'live' && i && (
          <div className="boom-row">
            {i.boomActive ? (
              <>
                <span className="boom-pill" role="status">BOOM ×2 · wickets −5</span>
                {scorer && (
                  <button
                    className="btn-quiet"
                    disabled={posting}
                    onClick={() => postEvent({ type: 'boom_over', enabled: false })}
                  >
                    cancel
                  </button>
                )}
              </>
            ) : scorer && i.legalBalls % 6 === 0 ? (
              <button
                className="boom-arm"
                disabled={posting}
                onClick={() => postEvent({ type: 'boom_over', enabled: true })}
              >
                Boom-boom this over
              </button>
            ) : (
              <span className="hint">Boom-boom arms at the next over.</span>
            )}
          </div>
        )}
        <div className="run-grid">
          {[0, 1, 2, 3, 4, 6].map((r) => (
            <button
              key={r}
              className={`run-btn${r === 4 ? ' run-4' : r === 6 ? ' run-6' : ''}`}
              disabled={!padOk}
              onClick={() => {
                const event: BallEvent = {
                  type: 'ball',
                  extra: selectedExtra || 'none',
                  runs: r,
                  wicket: null,
                };
                setSelectedExtra(null);
                postEvent(event);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="extras-row" role="group" aria-label="Extras">
          {EXTRAS.map(([value, label]) => (
            <button
              key={value}
              className="chip"
              disabled={!padOk}
              aria-pressed={selectedExtra === value}
              onClick={() => setSelectedExtra(selectedExtra === value ? null : value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pad-actions">
          <button className="btn btn-danger" disabled={!padOk} onClick={() => setWicketOpen(true)}>
            Wicket
          </button>
          <button
            className="btn"
            disabled={!scorer || posting || !state || state.status === 'setup'}
            onClick={() => postEvent({ type: 'undo' })}
          >
            Undo last ball
          </button>
        </div>
        <div className="pad-footer">
          <button
            className="btn-quiet"
            disabled={!scorer || !state || state.status === 'completed'}
            onClick={() => setSquadsOpen(true)}
          >
            Squads
          </button>
          <button
            className="btn-quiet"
            disabled={!scorer || posting || state?.status !== 'live'}
            onClick={() => setConfirmAction('endInnings')}
          >
            End innings
          </button>
          <button
            className="btn-quiet"
            disabled={!scorer || posting || !state || state.status === 'completed'}
            onClick={() => setConfirmAction('endMatch')}
          >
            End match
          </button>
        </div>
      </section>

      <Sheet open={Boolean(sheetKey)} sheetKey={sheetKey} onDismiss={dismissHandler}>
        {sheetContent()}
      </Sheet>

      {!connected && <div className="reconnect-pill">Reconnecting…</div>}
    </div>
  );
}

// ---------- Scoring key row ----------

// Cross-device handoff: with localStorage gone, another phone can only take
// over by claiming this key. Shown to scorers only (/role returns it to them).
function ScoringKeyRow({ adminKey }: { adminKey: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="hint">Scoring key</span>
      <code
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          overflowWrap: 'anywhere',
          flex: 1,
          minWidth: 0,
        }}
      >
        {adminKey}
      </code>
      <button className="btn-quiet" onClick={() => copyText(adminKey)}>Copy</button>
    </div>
  );
}

// ---------- Shared pick button ----------

interface PickButtonProps {
  name: string;
  role: AvatarRole;
  pressed?: boolean;
  disabled?: boolean;
  note?: string | null;
  onClick: () => void;
}

function PickButton({ name, role, pressed = false, disabled = false, note = null, onClick }: PickButtonProps) {
  return (
    <button className="pick" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Avatar name={name} role={role} />
      <span>{name}</span>
      {note ? <span className="pick-note">{note}</span> : null}
    </button>
  );
}

// ---------- Sheets ----------

interface CompletedSheetProps {
  state: PublicState;
  resultText: string;
  matchId: string;
  scorer: boolean;
  adminKey: string | null; // for handoff; only ever set when scorer
  onShare: () => void;
  onClose: () => void;
  onUndo: () => void;
}

function CompletedSheet({ state, resultText, matchId, scorer, adminKey, onShare, onClose, onUndo }: CompletedSheetProps) {
  return (
    <>
      <h2>Match over</h2>
      <p className="sheet-sub">{resultText}</p>
      <a
        className="btn btn-primary btn-block sheet-confirm"
        href={`/summary/${matchId}`}
        style={{ textAlign: 'center' }}
      >
        View summary
      </a>
      <div style={{ marginTop: 8 }}>
        <RematchButton state={state} block />
      </div>
      <button className="btn btn-block" style={{ marginTop: 8 }} onClick={onShare}>
        Share summary
      </button>
      {adminKey && (
        <div style={{ marginTop: 12 }}>
          <ScoringKeyRow adminKey={adminKey} />
        </div>
      )}
      <div className="pad-footer">
        <button className="btn-quiet" onClick={onClose}>Close</button>
        {scorer && (
          <button className="btn-quiet" onClick={onUndo}>Undo last ball</button>
        )}
      </div>
    </>
  );
}

interface StartInningsSheetProps {
  state: PublicState;
  matchId: string;
  onStart: () => void;
  onSquads: () => void;
  onUndo: (() => void) | null;
}

function StartInningsSheet({ state, matchId, onStart, onSquads, onUndo }: StartInningsSheetProps) {
  const second = state.status === 'innings_break';
  return (
    <>
      <h2>{second ? 'Start second innings' : 'Start first innings'}</h2>
      <p className="sheet-sub">
        {second
          ? `${state.config.teams[1 - state.innings[0].battingTeamIndex].name} need ${state.innings[0].runs + 1} to win.`
          : `${state.config.teams[state.config.battingFirstIndex].name} bat first.`}
      </p>
      {!second && <TossLine state={state} />}
      {/* Live break clock (renders nothing when the backend field is absent). */}
      {second && <BreakTimer inningsBreak={state.inningsBreak} />}
      <button className="btn btn-primary btn-block sheet-confirm" onClick={onStart}>
        {second ? 'Start second innings' : 'Start innings'}
      </button>
      {/* Squads stays reachable while this sheet blocks the pad footer (add a
          latecomer before the innings starts); plus the quiet toss detour
          before the first ball, or Undo during the break. */}
      <div className="pad-footer">
        <button className="btn-quiet" onClick={onSquads}>Squads</button>
        {!second && !state.toss ? (
          <Link className="btn-quiet" href={`/toss/${matchId}`}>Hold the toss</Link>
        ) : onUndo ? (
          <button className="btn-quiet" onClick={onUndo}>Undo last ball</button>
        ) : (
          <span />
        )}
      </div>
    </>
  );
}

interface ConfirmSheetProps {
  endMatch: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmSheet({ endMatch, onCancel, onConfirm }: ConfirmSheetProps) {
  return (
    <>
      <h2>{endMatch ? 'End the match now?' : 'End this innings now?'}</h2>
      <p className="sheet-sub">
        {endMatch
          ? 'A result will be recorded from the current score.'
          : 'The innings will close at the current score.'}
      </p>
      <div style={{ display: 'flex', gap: 8 }} className="sheet-confirm">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-danger" style={{ flex: 1 }} onClick={onConfirm}>
          {endMatch ? 'End match' : 'End innings'}
        </button>
      </div>
    </>
  );
}

interface OpenersSheetProps {
  state: PublicState;
  innings: PublicInnings;
  postEvent: PostEvent;
}

// Openers — collects both batsmen AND the opening bowler in one flow. Picks
// live in local state that survives re-renders while the sheet key is stable;
// on confirm they are snapshotted and posted one event at a time, aborting on
// the first failure so a transient error can't install the wrong batsman at
// the wrong end.
function OpenersSheet({ state, innings, postEvent }: OpenersSheetProps) {
  const [striker, setStriker] = useState<number | null>(null);
  const [nonStriker, setNonStriker] = useState<number | null>(null);
  const [bowler, setBowler] = useState<number | null>(null);

  // Removed (unavailable) players never appear in a picker — the engine would
  // reject them with 'player is no longer available' anyway.
  const removedBat = state.removed[innings.battingTeamIndex] ?? [];
  const removedBowl = state.removed[1 - innings.battingTeamIndex] ?? [];
  const bat = state.config.teams[innings.battingTeamIndex].players
    .map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => !removedBat.includes(idx));
  const bowl = state.config.teams[1 - innings.battingTeamIndex].players
    .map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => !removedBowl.includes(idx));

  async function confirm() {
    // Snapshot the picks first: the sheet may unmount mid-sequence as `needs`
    // transitions after each accepted event. (Confirm is disabled until all
    // three picks are made, hence the non-null assertions.)
    const picks = { striker: striker!, nonStriker: nonStriker!, bowler: bowler! };
    // Engine takes one event at a time: striker first, then non-striker,
    // then bowler. Abort on any failure.
    if (!await postEvent({ type: 'select_batsman', playerIndex: picks.striker })) return;
    if (!await postEvent({ type: 'select_batsman', playerIndex: picks.nonStriker })) return;
    await postEvent({ type: 'select_bowler', playerIndex: picks.bowler });
  }

  return (
    <>
      <h2>Pick openers</h2>
      <p className="sheet-sub">Choose the two opening batsmen and the opening bowler.</p>
      <div className="sheet-section-label">On strike</div>
      <div className="pick-list">
        {bat.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="batsman"
            pressed={striker === idx}
            disabled={idx === nonStriker}
            onClick={() => setStriker(idx)}
          />
        ))}
      </div>
      <div className="sheet-section-label">Non-striker</div>
      <div className="pick-list">
        {bat.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="batsman"
            pressed={nonStriker === idx}
            disabled={idx === striker}
            onClick={() => setNonStriker(idx)}
          />
        ))}
      </div>
      <div className="sheet-section-label">Opening bowler</div>
      <div className="pick-list">
        {bowl.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="bowler"
            pressed={bowler === idx}
            onClick={() => setBowler(idx)}
          />
        ))}
      </div>
      <button
        className="btn btn-primary btn-block sheet-confirm"
        disabled={striker == null || nonStriker == null || bowler == null}
        onClick={confirm}
      >
        Start the over
      </button>
    </>
  );
}

interface NewPlayerSheetProps {
  state: PublicState;
  innings: PublicInnings;
  postEvent: PostEvent;
  undoFooter: ReactNode;
}

function NewBatsmanSheet({ state, innings, postEvent, undoFooter }: NewPlayerSheetProps) {
  const bat = state.config.teams[innings.battingTeamIndex].players;
  const used = new Set(innings.batsmen.map((b) => b.playerIndex));
  const removed = state.removed[innings.battingTeamIndex] ?? [];
  const eligible = bat.map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => !used.has(idx) && !removed.includes(idx));
  return (
    <>
      <h2>New batsman</h2>
      <p className="sheet-sub">Pick who comes in next.</p>
      <div className="pick-list">
        {eligible.length ? (
          eligible.map(({ p, idx }) => (
            <PickButton
              key={idx} name={p} role="batsman"
              onClick={() => postEvent({ type: 'select_batsman', playerIndex: idx })}
            />
          ))
        ) : (
          <span className="hint">No batsmen left to come in.</span>
        )}
      </div>
      {undoFooter}
    </>
  );
}

function NewBowlerSheet({ state, innings, postEvent, undoFooter }: NewPlayerSheetProps) {
  const removed = state.removed[1 - innings.battingTeamIndex] ?? [];
  const bowl = state.config.teams[1 - innings.battingTeamIndex].players
    .map((p, idx) => ({ p, idx }))
    .filter(({ idx }) => !removed.includes(idx));
  // currentBowlerIndex is null at over end; the engine exposes the last
  // completed over's bowler separately so we can disable them here.
  const prev = innings.lastOverBowlerPlayerIndex ?? null;
  return (
    <>
      <h2>New bowler</h2>
      <p className="sheet-sub">Pick who bowls the next over.</p>
      <div className="pick-list">
        {bowl.map(({ p, idx }) => (
          <PickButton
            key={idx} name={p} role="bowler"
            disabled={idx === prev}
            note={idx === prev ? 'bowled the last over' : null}
            onClick={() => postEvent({ type: 'select_bowler', playerIndex: idx })}
          />
        ))}
      </div>
      {undoFooter}
    </>
  );
}

// ---------- Squads (v14 mid-match squad changes) ----------

interface SquadsSheetProps {
  state: PublicState;
  postEvent: PostEvent;
  posting: boolean;
  onClose: () => void;
}

// Both squads side by side (stacked at phone widths). The remove affordance
// mirrors the engine guards so it never shows when the server would refuse,
// but the server stays the authority — a rejected event's 400 message
// surfaces as a toast via postEvent.
function SquadsSheet({ state, postEvent, posting, onClose }: SquadsSheetProps) {
  return (
    <>
      <h2>Squads</h2>
      <p className="sheet-sub">
        Add latecomers, or remove players who left — their scorecard entries stay.
      </p>
      <div className="squads-grid">
        <SquadColumn state={state} teamIndex={0} postEvent={postEvent} posting={posting} />
        <SquadColumn state={state} teamIndex={1} postEvent={postEvent} posting={posting} />
      </div>
      <div className="pad-footer">
        <span />
        <button className="btn-quiet" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

interface SquadColumnProps {
  state: PublicState;
  teamIndex: 0 | 1;
  postEvent: PostEvent;
  posting: boolean;
}

function SquadColumn({ state, teamIndex, postEvent, posting }: SquadColumnProps) {
  const [name, setName] = useState('');
  const team = state.config.teams[teamIndex];
  const removed = state.removed[teamIndex] ?? [];
  const activeCount = team.players.length - removed.length;
  const full = activeCount >= 11;

  // Live-innings guards only apply while an innings is actually in progress
  // (during setup / innings break the engine allows removing anyone, down to
  // the 2-active floor).
  const live = state.status === 'live' && state.currentInningsIndex != null
    ? state.innings[state.currentInningsIndex]
    : null;
  const batting = live != null && live.battingTeamIndex === teamIndex;
  const currentBowlerPlayer = live != null && !batting && live.currentBowlerIndex != null
    ? live.bowlers[live.currentBowlerIndex].playerIndex
    : null;

  async function add() {
    const v = name.trim().replace(/\s+/g, ' ');
    if (!v) return;
    if (await postEvent({ type: 'add_player', teamIndex, name: v })) setName('');
  }

  return (
    <div>
      <div className="squad-team-name">
        {team.name} <span className="squad-count">{activeCount} active</span>
      </div>
      <div className="squad-list">
        {team.players.map((p, idx) => {
          const left = removed.includes(idx);
          // A batsmen entry in the CURRENT innings (out or at the crease)
          // blocks removal until the innings ends — same rule as the engine.
          const entry = batting ? live!.batsmen.find((b) => b.playerIndex === idx) : undefined;
          const atCrease = entry != null && entry.out == null;
          const bowling = currentBowlerPlayer === idx;
          const tag = left ? 'left'
            : atCrease ? 'at crease'
              : entry != null ? 'out'
                : bowling ? 'bowling'
                  : null;
          const removable = !left && activeCount > 2 && entry == null && !bowling;
          return (
            <div key={idx} className={`squad-row${left ? ' squad-row--left' : ''}`}>
              <Avatar name={p} role={batting ? 'batsman' : 'bowler'} small />
              <span className="squad-name">
                {p}
                {state.config.commonPlayer != null && p === state.config.commonPlayer && !left && (
                  <span className="both-chip" title="Plays for both sides">both sides</span>
                )}
              </span>
              {tag != null && (
                <span className={`squad-tag${atCrease || bowling ? ' squad-tag--on' : ''}`}>
                  {tag}
                </span>
              )}
              {removable && (
                <button
                  type="button"
                  className="roster-x"
                  disabled={posting}
                  aria-label={`Remove ${p} from ${team.name}`}
                  onClick={() => postEvent({ type: 'remove_player', teamIndex, playerIndex: idx })}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="squad-add">
        <input
          type="text"
          value={name}
          placeholder="Add a player"
          aria-label={`Add a player to ${team.name}`}
          maxLength={40}
          autoComplete="off"
          disabled={full}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
        />
        <button
          type="button"
          className="btn roster-add"
          disabled={full || !name.trim() || posting}
          onClick={() => { void add(); }}
        >
          Add
        </button>
      </div>
      {full && <p className="roster-hint">Squad is full — 11 active players.</p>}
    </div>
  );
}

interface WicketSheetProps {
  innings: PublicInnings;
  selectedExtra: PadExtra | null;
  onCancel: () => void;
  onConfirm: (wicket: WicketInfo, runs: number) => void;
}

// Wicket sheet (user-opened; the pad composes ONE `ball` event on confirm).
function WicketSheet({ innings, selectedExtra, onCancel, onConfirm }: WicketSheetProps) {
  const [kind, setKindRaw] = useState<WicketKind | null>(null);
  const [runs, setRuns] = useState(0);
  const [outEnd, setOutEnd] = useState<'striker' | 'non_striker'>('striker');
  const [fielder, setFielder] = useState('');

  const setKind = (k: WicketKind) => {
    setKindRaw(k);
    if (k !== 'run_out') {
      setRuns(0);
      setOutEnd('striker');
    }
  };

  const allowed = legalKinds(selectedExtra);
  const isRunOut = kind === 'run_out';
  const striker = innings.strikerIndex != null
    ? innings.batsmen[innings.strikerIndex].name : 'Striker';
  const nonStriker = innings.nonStrikerIndex != null
    ? innings.batsmen[innings.nonStrikerIndex].name : 'Non-striker';

  return (
    <>
      <h2>Wicket</h2>
      <p className="sheet-sub">
        {selectedExtra
          ? `On a ${selectedExtra === 'noball' ? 'no-ball' : selectedExtra} — only ${allowed.map((k) => k.replace('_', ' ')).join(' and ')} ${allowed.length > 1 ? 'are' : 'is'} possible.`
          : 'How did the batsman get out?'}
      </p>
      <div className="pick-list">
        {WICKET_KINDS.map(([k, label]) => (
          <button
            key={k}
            className="pick"
            aria-pressed={kind === k}
            disabled={!allowed.includes(k)}
            onClick={() => setKind(k)}
          >
            <span style={{ paddingLeft: 8 }}>{label}</span>
          </button>
        ))}
      </div>
      {isRunOut && (
        <>
          <div className="sheet-section-label">Runs completed before the run out</div>
          <div className="pick-list">
            {[0, 1, 2, 3, 4, 5, 6].map((r) => (
              <button
                key={r}
                className="pick"
                aria-pressed={runs === r}
                onClick={() => setRuns(r)}
              >
                <span style={{ padding: '0 8px' }}>{r}</span>
              </button>
            ))}
          </div>
          <div className="sheet-section-label">Who is out</div>
          <div className="pick-list">
            <button
              className="pick"
              aria-pressed={outEnd === 'striker'}
              onClick={() => setOutEnd('striker')}
            >
              <span style={{ paddingLeft: 8 }}>{striker} (striker)</span>
            </button>
            <button
              className="pick"
              aria-pressed={outEnd === 'non_striker'}
              onClick={() => setOutEnd('non_striker')}
            >
              <span style={{ paddingLeft: 8 }}>{nonStriker} (non-striker)</span>
            </button>
          </div>
        </>
      )}
      <label className="field-label" htmlFor="fielder-input">Fielder (optional)</label>
      <input
        type="text"
        id="fielder-input"
        placeholder="Fielder's name"
        value={fielder}
        onChange={(e) => setFielder(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 8 }} className="sheet-confirm">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button
          className="btn btn-danger"
          style={{ flex: 1 }}
          disabled={!kind}
          onClick={() => onConfirm(
            {
              // Confirm is disabled while kind is null, hence the assertion.
              kind: kind!,
              outEnd: kind === 'run_out' ? outEnd : 'striker',
              fielder: fielder.trim() || null,
            },
            kind === 'run_out' ? runs : 0
          )}
        >
          Confirm wicket
        </button>
      </div>
    </>
  );
}
