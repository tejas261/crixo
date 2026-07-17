'use client';

// Match summary — shareable scorecard. Renders from one GET (no live stream:
// the card is a snapshot; refresh for the latest if the match is still on).
// Port of public/js/summary.js.

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Wordmark } from '@/components/Logo';
import { useParams } from 'next/navigation';
import { fetchJSON } from '@/lib/useMatch';
import { useAds } from '@/lib/useAds';
import AdSlot from '@/components/AdSlot';
import { fmtOvers, fmtSR, fmtEcon, teamsLine } from '@/lib/format';
import { shareOrCopy } from '@/lib/share';
import Avatar, { TrophyMark, type AvatarRole } from '@/components/Avatar';
import TossLine from '@/components/TossLine';
import type { PublicBatsman, PublicBowler, PublicInnings, PublicState } from '@/lib/engine';

// "Innings break · Xm Ys" — only when the backend recorded a duration.
function fmtBreak(durationMs: number): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

export default function SummaryPage() {
  const params = useParams<{ id: string }>();
  const matchId = params?.id;
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { showAds } = useAds();

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    fetchJSON<PublicState>(`/api/matches/${matchId}`)
      .then((s) => { if (!cancelled) setState(s); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [matchId]);

  return (
    <div className="wrap">
      <header className="site-header">
        <Wordmark />
        <span className="header-teams">{teamsLine(state)}</span>
        <span className="header-spacer" />
        <button className="btn-quiet" onClick={() => shareOrCopy(location.href)}>
          Copy link
        </button>
      </header>

      <ResultBanner state={state} error={error} matchId={matchId} />

      {state && <TossLine state={state} className="toss-line--summary" />}

      {state && <Highlights state={state} />}

      {/* One ad above the innings sections. */}
      {showAds && state != null && state.innings.length > 0 && <AdSlot />}

      {state && state.innings.map((i, idx) => (
        <Fragment key={idx}>
          <InningsSection state={state} innings={i} index={idx} />
          {idx === 0 && state.inningsBreak?.durationMs != null && (
            <div className="break-line">Innings break · {fmtBreak(state.inningsBreak.durationMs)}</div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

interface ResultBannerProps {
  state: PublicState | null;
  error: string | null;
  matchId: string;
}

function ResultBanner({ state, error, matchId }: ResultBannerProps) {
  if (error) {
    return (
      <div className="panel">
        <div className="empty-state">
          Couldn&apos;t load this match — {error}. Check the link and refresh.
        </div>
      </div>
    );
  }
  if (!state) {
    return <div className="empty-state">Loading scorecard…</div>;
  }
  if (state.result) {
    return (
      <div className="result-banner">
        <TrophyMark />
        <div className="result-text">{state.result.text}</div>
      </div>
    );
  }
  if (state.status === 'live' || state.status === 'innings_break') {
    return (
      <div className="panel">
        <div className="empty-state">
          This match is still in play — <a href={`/m/${matchId}`}>watch it live</a>. The full
          scorecard will appear here when it ends.
        </div>
      </div>
    );
  }
  return (
    <div className="panel">
      <div className="empty-state">No play has happened in this match yet.</div>
    </div>
  );
}

function Highlights({ state }: { state: PublicState }) {
  let topBat: PublicBatsman | null = null;
  let topBowl: PublicBowler | null = null;
  for (const i of state.innings) {
    for (const b of i.batsmen) {
      if (!topBat || b.runs > topBat.runs) topBat = b;
    }
    for (const bw of i.bowlers) {
      if (!topBowl || bw.wickets > topBowl.wickets
          || (bw.wickets === topBowl.wickets && bw.runs < topBowl.runs)) topBowl = bw;
    }
  }
  if (!topBat && !topBowl) return null;
  return (
    <section className="panel">
      <h2 className="panel-title">Player highlights</h2>
      <div className="highlight-cards">
        {topBat && (
          <HighlightCard title="Top scorer" name={topBat.name} role="batsman">
            <strong>{topBat.runs}</strong> off {topBat.balls} · 4s {topBat.fours} · 6s{' '}
            {topBat.sixes} · SR {fmtSR(topBat.runs, topBat.balls)}
          </HighlightCard>
        )}
        {topBowl && (
          <HighlightCard title="Best bowler" name={topBowl.name} role="bowler">
            <strong>{topBowl.wickets}/{topBowl.runs}</strong> in {fmtOvers(topBowl.balls)} ov ·
            Econ {fmtEcon(topBowl.runs, topBowl.balls)}
          </HighlightCard>
        )}
      </div>
    </section>
  );
}

interface HighlightCardProps {
  title: string;
  name: string;
  role: AvatarRole;
  children: ReactNode;
}

function HighlightCard({ title, name, role, children }: HighlightCardProps) {
  return (
    <div className="player-card">
      <Avatar name={name} role={role} />
      <div className="player-main">
        <div className="player-name"><span className="name-text">{name}</span></div>
        <div className="player-sub">{children}</div>
      </div>
      <div className="player-stat"><small>{title}</small></div>
    </div>
  );
}

function BattingTable({ innings, commonName }: { innings: PublicInnings; commonName: string | null }) {
  return (
    <div className="table-scroll">
      <table className="stats">
        <thead>
          <tr><th>Batting</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
        </thead>
        <tbody>
          {innings.batsmen.length ? (
            innings.batsmen.map((b, idx) => (
              <tr key={idx}>
                <td>
                  <div className="bat-cell">
                    <Avatar name={b.name} role="batsman" small />
                    <div>
                      {b.name}
                      {commonName != null && b.name === commonName && (
                        <span className="both-chip" title="Plays for both sides">both sides</span>
                      )}
                      <span className={`dismissal${b.out ? '' : ' not-out'}`}>
                        {b.out ? b.out.text : 'not out'}
                      </span>
                    </div>
                  </div>
                </td>
                <td>{b.runs}</td>
                <td>{b.balls}</td>
                <td>{b.fours}</td>
                <td>{b.sixes}</td>
                <td>{fmtSR(b.runs, b.balls)}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={6} className="hint">No one batted.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function BowlingTable({ innings, commonName }: { innings: PublicInnings; commonName: string | null }) {
  return (
    <div className="table-scroll">
      <table className="stats">
        <thead>
          <tr><th>Bowling</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
        </thead>
        <tbody>
          {innings.bowlers.length ? (
            innings.bowlers.map((bw, idx) => (
              <tr key={idx}>
                <td>
                  <div className="bat-cell">
                    <Avatar name={bw.name} role="bowler" small />
                    <div>
                      {bw.name}
                      {commonName != null && bw.name === commonName && (
                        <span className="both-chip" title="Plays for both sides">both sides</span>
                      )}
                    </div>
                  </div>
                </td>
                <td>{fmtOvers(bw.balls)}</td>
                <td>{bw.maidens}</td>
                <td>{bw.runs}</td>
                <td>{bw.wickets}</td>
                <td>{fmtEcon(bw.runs, bw.balls)}</td>
              </tr>
            ))
          ) : (
            <tr><td colSpan={6} className="hint">No one bowled.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

interface InningsSectionProps {
  state: PublicState;
  innings: PublicInnings;
  index: number;
}

function InningsSection({ state, innings, index }: InningsSectionProps) {
  const team = state.config.teams[innings.battingTeamIndex];
  const x = innings.extras;
  const oversText = innings.oversDisplay ?? fmtOvers(innings.legalBalls);
  const batted = new Set(innings.batsmen.map((b) => b.playerIndex));
  const dnb = team.players.filter((_, pi) => !batted.has(pi));
  return (
    <section className="panel">
      <h2 className="panel-title panel-title--row">
        <span>{index === 0 ? 'First innings' : 'Second innings'} — {team.name}</span>
        <span className="panel-title-score">
          {innings.runs}/{innings.wickets} ({oversText})
        </span>
      </h2>
      <BattingTable innings={innings} commonName={state.config.commonPlayer ?? null} />
      <p className="extras-line extras-line--summary">
        Extras {x.total} (wd {x.wides}, nb {x.noballs}, b {x.byes}, lb {x.legbyes}) · Total{' '}
        <strong>{innings.runs}/{innings.wickets}</strong> in {oversText} overs
      </p>
      {dnb.length > 0 && (
        <p className="hint dnb-line">Did not bat: {dnb.join(', ')}</p>
      )}
      <div className="sheet-section-label">Fall of wickets</div>
      <div className="fow-list">
        {innings.fallOfWickets.length ? (
          innings.fallOfWickets.map((w, idx) => (
            <span key={idx}>
              <strong>{w.score}/{w.wicket}</strong> {w.batsmanName} · {w.over} ov
            </span>
          ))
        ) : (
          <span className="hint">No wickets fell.</span>
        )}
      </div>
      <div className="sheet-section-label">Bowling</div>
      <BowlingTable innings={innings} commonName={state.config.commonPlayer ?? null} />
    </section>
  );
}
