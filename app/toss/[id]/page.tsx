'use client';

// Toss — the pre-match coin toss, run by the umpire. One page, three staged
// moments: the call (who calls, heads or tails), THE flip (a 3D coin on the
// signature gradient), then the winner's decision. Confirming posts a single
// `toss` event; the engine records it and sets config.battingFirstIndex.
//
// The coin's final face is driven by state/class — .toss-coin gets
// show-heads/show-tails and a CSS transition spins it to a rotation that
// LANDS on that face. Under prefers-reduced-motion the global CSS kills the
// transition, so the same class change just shows the correct face instantly.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Wordmark } from '@/components/Logo';
import { useMatch, fetchJSON, type FetchJSONError } from '@/lib/useMatch';
import { teamsLine } from '@/lib/format';
import { toast } from '@/components/Toasts';
import TossLine from '@/components/TossLine';
import type { PublicState, TossCall, TossDecision } from '@/lib/engine';

// GET /api/matches/:id/role — only canScore matters here.
interface RoleResponse {
  canScore: boolean;
  adminKey: string | null;
}

type Stage = 'call' | 'flip' | 'result';

// The heads face: the CrixoMark crossed-bats-and-ball motif (ink on the
// gradient face, roundel omitted — the coin face itself is the gradient badge).
function HeadsGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="92" height="92" aria-hidden="true">
      <g fill="#4A2B0F">
        <rect x="21.3" y="12.5" width="5.4" height="27" rx="2.7" transform="rotate(30 24 26)" />
        <rect x="21.3" y="12.5" width="5.4" height="27" rx="2.7" transform="rotate(-30 24 26)" />
      </g>
      <circle cx="24" cy="11.6" r="4.7" fill="#C63D08" />
      <path
        d="M20.9 10.2 a4.4 4.4 0 0 1 6.2 0"
        stroke="#FFF9F0" strokeWidth="1.1" fill="none" strokeLinecap="round"
      />
    </svg>
  );
}

export default function TossPage() {
  const params = useParams<{ id: string }>();
  const matchId = params?.id;
  const router = useRouter();
  const { state, error } = useMatch(matchId);

  const [canScore, setCanScore] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);

  const [stage, setStage] = useState<Stage>('call');
  const [callerIndex, setCallerIndex] = useState<0 | 1 | null>(null);
  const [call, setCall] = useState<TossCall | null>(null);
  const [outcome, setOutcome] = useState<TossCall | null>(null);
  const [posting, setPosting] = useState(false);
  const flipTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    fetchJSON<RoleResponse>(`/api/matches/${matchId}/role`)
      .then((role) => { if (!cancelled) setCanScore(role.canScore); })
      .catch(() => { /* read-only view below */ })
      .finally(() => { if (!cancelled) setRoleLoaded(true); });
    return () => { cancelled = true; };
  }, [matchId]);

  useEffect(() => () => {
    if (flipTimer.current != null) window.clearTimeout(flipTimer.current);
  }, []);

  const teams = state?.config.teams;
  const winnerIndex: 0 | 1 | null =
    callerIndex != null && call != null && outcome != null
      ? (outcome === call ? callerIndex : (1 - callerIndex) as 0 | 1)
      : null;

  function flip() {
    if (callerIndex == null || call == null || outcome != null) return;
    // The flip happens NOW: one crypto bit decides, the CSS just lands on it.
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    const landed: TossCall = (buf[0] & 1) === 0 ? 'heads' : 'tails';
    setOutcome(landed); // -> .show-heads/.show-tails, the transition spins
    setStage('flip');
    // Reveal the result once the spin lands (~1.6s). Under reduced motion the
    // final face is already showing, so cut almost straight to the result.
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    flipTimer.current = window.setTimeout(() => setStage('result'), reduced ? 250 : 1750);
  }

  async function confirm(decision: TossDecision) {
    if (posting || callerIndex == null || call == null || outcome == null || winnerIndex == null) return;
    setPosting(true);
    try {
      // Session cookie authorizes (same flow as the console, minus the
      // pasted-key fallback — the umpire got here from the create form).
      await fetchJSON<PublicState>(`/api/matches/${matchId}/events`, {
        method: 'POST',
        body: JSON.stringify({
          event: { type: 'toss', callerIndex, call, outcome, winnerIndex, decision },
        }),
      });
      router.push(`/umpire/${matchId}`);
    } catch (err) {
      toast((err as FetchJSONError).message);
      setPosting(false);
    }
  }

  function body() {
    if (error) {
      return (
        <section className="panel">
          <div className="empty-state">
            Couldn&apos;t load this match — {error}. Check the link and refresh.
          </div>
        </section>
      );
    }
    if (!state || !roleLoaded || !teams) {
      return (
        <section className="panel">
          <div className="empty-state">Loading match…</div>
        </section>
      );
    }
    // Toss already recorded (any status): show the result, point at the console.
    if (state.toss) {
      return (
        <section className="panel" aria-labelledby="toss-title">
          <h2 className="panel-title" id="toss-title">The toss</h2>
          <p className="toss-result-text">
            <strong>{teams[state.toss.winnerIndex].name}</strong> won the toss
          </p>
          <TossLine state={state} className="toss-line--center" />
          {state.status === 'setup' && (
            <p className="hint toss-hint-center">
              Recorded it wrong? Undo it from the console and toss again.
            </p>
          )}
          <Link className="btn btn-primary btn-block sheet-confirm" href={`/umpire/${matchId}`}>
            Back to the console
          </Link>
        </section>
      );
    }
    if (state.status !== 'setup') {
      return (
        <section className="panel">
          <div className="empty-state">
            The match has moved on —{' '}
            <Link href={`/umpire/${matchId}`}>back to the console</Link>.
          </div>
        </section>
      );
    }
    if (!canScore) {
      return (
        <section className="panel">
          <div className="empty-state">
            Only the umpire runs the toss — this page needs scoring access.
            Follow the match on the <Link href={`/m/${matchId}`}>live view</Link> instead.
          </div>
        </section>
      );
    }

    return (
      <section className="panel" aria-labelledby="toss-title">
        <h2 className="panel-title" id="toss-title">The toss</h2>

        <div className="toss-coin-wrap">
          <div className={`toss-coin${outcome ? ` show-${outcome}` : ''}`}>
            <div className="toss-coin-face toss-coin-face--heads"><HeadsGlyph /></div>
            <div className="toss-coin-face toss-coin-face--tails" aria-hidden="true">T</div>
          </div>
        </div>

        {stage === 'call' && (
          <div className="toss-stage">
            <span className="field-label">Who calls?</span>
            <div className="toggle-row" role="group" aria-label="Who calls">
              {teams.map((t, idx) => (
                <button
                  key={idx} type="button" className="btn"
                  aria-pressed={callerIndex === idx}
                  onClick={() => setCallerIndex(idx as 0 | 1)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <span className="field-label">Their call</span>
            <div className="toss-call-row" role="group" aria-label="Their call">
              {(['heads', 'tails'] as const).map((c) => (
                <button
                  key={c} type="button" className="btn"
                  aria-pressed={call === c}
                  onClick={() => setCall(c)}
                >
                  {c === 'heads' ? 'Heads' : 'Tails'}
                </button>
              ))}
            </div>
            <button
              type="button" className="btn btn-primary btn-block toss-flip-btn"
              disabled={callerIndex == null || call == null}
              onClick={flip}
            >
              Flip the coin
            </button>
          </div>
        )}

        {stage === 'flip' && (
          <p className="hint toss-hint-center" aria-live="polite">The coin is in the air…</p>
        )}

        {stage === 'result' && winnerIndex != null && callerIndex != null && (
          <div className="toss-stage" aria-live="polite">
            <p className="toss-result-text">
              <strong>{teams[winnerIndex].name}</strong> won the toss
            </p>
            <p className="hint toss-hint-center">
              It&apos;s {outcome} — {teams[callerIndex].name} called {call}.{' '}
              {teams[winnerIndex].name} choose:
            </p>
            <div className="toss-decide">
              <button
                type="button" className="btn btn-primary" disabled={posting}
                onClick={() => confirm('bat')}
              >
                Bat first
              </button>
              <button
                type="button" className="btn btn-primary" disabled={posting}
                onClick={() => confirm('bowl')}
              >
                Bowl first
              </button>
            </div>
          </div>
        )}

        <div className="pad-footer">
          <span />
          <Link className="btn-quiet" href={`/umpire/${matchId}`}>Skip the toss</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="wrap">
      <header className="site-header">
        <Wordmark />
        <span className="header-teams">{teamsLine(state)}</span>
        <span className="header-spacer" />
        <Link href={`/umpire/${matchId}`} className="hint">Console</Link>
      </header>
      {body()}
    </div>
  );
}
