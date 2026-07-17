'use client';

// Live viewer — big score plates, live cards, timeline; SSE with reconnect.
// Port of public/js/live.js.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Logo';
import { useParams } from 'next/navigation';
import { useMatch } from '@/lib/useMatch';
import { useAds } from '@/lib/useAds';
import AdSlot from '@/components/AdSlot';
import { fmtOvers, currentInnings, teamsLine } from '@/lib/format';
import ScorePlates from '@/components/ScorePlates';
import BatterCard from '@/components/BatterCard';
import BowlerCard from '@/components/BowlerCard';
import OverStrip from '@/components/OverStrip';
import Timeline from '@/components/Timeline';
import StatusChip from '@/components/StatusChip';
import BreakTimer from '@/components/BreakTimer';
import TossLine from '@/components/TossLine';
import type { PublicInnings } from '@/lib/engine';

interface Burst {
  id: string;
  kind: string; // '4' | '6' | 'W'
}

// Celebration moments: when a NEW timeline entry lands (diffed by timeline
// length in the render path, same trick OverStrip uses) and its badge is a
// 4, 6 or W, remount a one-shot gradient sweep behind the score. The sweep
// div is invisible at rest (opacity 0) and only its CSS animation reveals it,
// so prefers-reduced-motion (animation: none) shows nothing.
function useCelebration(innings: PublicInnings | null, inningsKey: string): Burst | null {
  const [burst, setBurst] = useState<Burst | null>(null);
  const prevRef = useRef<{ key: string; len: number }>({ key: inningsKey, len: innings?.timeline?.length ?? 0 });
  useEffect(() => {
    const len = innings?.timeline?.length ?? 0;
    const prev = prevRef.current;
    if (prev.key === inningsKey && len > prev.len) {
      // len > 0 here, so the innings (and its timeline) must exist.
      const last = innings!.timeline[len - 1];
      if (last && (last.badge === '4' || last.badge === '6' || last.badge === 'W')) {
        setBurst({ id: `${inningsKey}:${len}`, kind: last.badge });
      }
    }
    prevRef.current = { key: inningsKey, len };
  }, [innings, inningsKey]);
  return burst;
}

export default function LivePage() {
  const params = useParams<{ id: string }>();
  const matchId = params?.id;
  const { state, connected, error } = useMatch(matchId);
  const { showAds } = useAds();
  const i = currentInnings(state);

  function scoreContext() {
    if (error) return <>Couldn&apos;t load this match — {error}. Check the link and refresh.</>;
    if (!state) return 'Loading match…';
    if (!i) return 'The match is being set up — the first ball will appear here.';
    const batTeam = state.config.teams[i.battingTeamIndex].name;
    if (state.status === 'innings_break') {
      const chaseTeam = state.config.teams[1 - i.battingTeamIndex].name;
      return <>Innings break — <strong>{chaseTeam}</strong> need {i.runs + 1} to win.</>;
    }
    if (state.currentInningsIndex === 1 && i.target != null) {
      return (
        <>
          <strong>{batTeam}</strong> chasing {i.target} — need <strong>{i.runsNeeded}</strong> from{' '}
          <strong>{i.ballsRemaining}</strong> · CRR {i.crr} · RRR {i.rrr}
        </>
      );
    }
    return <><strong>{batTeam}</strong> batting · CRR {i.crr}</>;
  }

  // Never blank: explain what is (or isn't) happening.
  const idleCardsMessage = state?.status === 'innings_break'
    ? 'Innings break — the chase starts shortly.'
    : state?.status === 'completed'
      ? 'Match over — the full scorecard is on the summary page.'
      : 'The match is being set up — players appear when the first innings starts.';

  const x = i?.extras;
  const inningsKey = state
    ? String(state.currentInningsIndex ?? state.innings.length - 1)
    : '0';
  const burst = useCelebration(i, inningsKey);

  // Innings-break timer replaces the bare break state — but only when the
  // backend provides the field (older matches render exactly as before).
  const showBreakTimer = state?.status === 'innings_break'
    && state?.inningsBreak?.startedAt != null;

  return (
    <div className="wrap">
      <header className="site-header">
        <Wordmark />
        <span className="header-teams">{teamsLine(state)}</span>
        <span className="header-spacer" />
        {state ? (
          <StatusChip status={state.status} />
        ) : (
          <span className="status-chip">Loading…</span>
        )}
      </header>

      {state?.status === 'completed' && state.result && (
        <div className="result-banner">
          <div className="result-text">{state.result.text}</div>
          <a className="btn" href={`/summary/${matchId}`}>View full scorecard</a>
        </div>
      )}

      <section className="panel score-panel">
        {burst && (
          <div
            key={burst.id}
            className={`celebrate${burst.kind === 'W' ? ' celebrate--w' : ''}`}
            aria-hidden="true"
          />
        )}
        {i ? (
          <ScorePlates
            big
            runs={i.runs}
            wickets={i.wickets}
            overs={i.oversDisplay ?? fmtOvers(i.legalBalls)}
          />
        ) : (
          <ScorePlates big runs={0} wickets={0} overs="0.0" />
        )}
        <div className="score-context">{scoreContext()}</div>
      </section>

      {/* One ad below the score panel — viewers only, never the console. */}
      {showAds && <AdSlot />}

      {showBreakTimer && (
        <section className="panel" aria-label="Innings break">
          <BreakTimer inningsBreak={state.inningsBreak} />
        </section>
      )}

      <section className="player-cards" aria-label="Batsmen">
        {!i || state?.status !== 'live' ? (
          showBreakTimer ? null : (
            <div className="player-card">
              <div className="player-main">
                <span className="hint">{idleCardsMessage}</span>
                {state?.status === 'setup' && <TossLine state={state} />}
              </div>
            </div>
          )
        ) : (
          <>
            <BatterCard innings={i} batsmanIndex={i.strikerIndex} onStrike commonName={state.config.commonPlayer} />
            <BatterCard innings={i} batsmanIndex={i.nonStrikerIndex} onStrike={false} commonName={state.config.commonPlayer} />
          </>
        )}
      </section>
      <section className="player-cards" aria-label="Bowler">
        {i && state?.status === 'live' && (
          <BowlerCard
            bowler={i.currentBowlerIndex != null ? i.bowlers[i.currentBowlerIndex] : null}
            waitingText="Waiting for the next bowler…"
            commonName={state.config.commonPlayer}
          />
        )}
      </section>

      <section className="panel panel--gap-top">
        <h2 className="panel-title">This over</h2>
        <div className="over-strip">
          <OverStrip innings={i} />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Innings</h2>
        <div className="extras-line" style={{ marginBottom: 10 }}>
          {x ? `Extras ${x.total} (wd ${x.wides}, nb ${x.noballs}, b ${x.byes}, lb ${x.legbyes})` : ''}
        </div>
        <div className="fow-list">
          {!i ? (
            <span className="hint">Fall of wickets will appear here.</span>
          ) : i.fallOfWickets.length ? (
            i.fallOfWickets.map((w, idx) => (
              <span key={idx}>
                <strong>{w.score}/{w.wicket}</strong> {w.batsmanName} · {w.over} ov
              </span>
            ))
          ) : (
            <span className="hint">No wickets down yet.</span>
          )}
        </div>
        <details className="timeline" style={{ marginTop: 12 }}>
          <summary>Full timeline</summary>
          <Timeline innings={i} inningsKey={inningsKey} />
        </details>
      </section>

      {!connected && <div className="reconnect-pill">Reconnecting…</div>}
    </div>
  );
}
