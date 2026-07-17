// Bowler card with O-M-R-W and economy. Pass bowler=null for the waiting
// placeholder (text differs per page, hence the prop).

import Avatar from '@/components/Avatar';
import { fmtOvers, fmtEcon } from '@/lib/format';
import type { PublicBowler } from '@/lib/engine';

interface BowlerCardProps {
  bowler: PublicBowler | null;
  waitingText?: string;
  /** config.commonPlayer — badges the player who turns out for both sides. */
  commonName?: string | null;
}

export default function BowlerCard({ bowler, waitingText = 'Waiting for a bowler…', commonName }: BowlerCardProps) {
  if (!bowler) {
    return (
      <div className="player-card">
        <div className="player-main">
          <span className="hint">{waitingText}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="player-card">
      <Avatar name={bowler.name} role="bowler" />
      <div className="player-main">
        <div className="player-name">
          <span className="name-text">{bowler.name}</span>
          {commonName != null && bowler.name === commonName && (
            <span className="both-chip" title="Plays for both sides">both sides</span>
          )}
        </div>
        <div className="player-sub">
          O <strong>{fmtOvers(bowler.balls)}</strong> · M <strong>{bowler.maidens}</strong> · R{' '}
          <strong>{bowler.runs}</strong> · W <strong>{bowler.wickets}</strong> · Econ{' '}
          <strong>{fmtEcon(bowler.runs, bowler.balls)}</strong>
        </div>
      </div>
    </div>
  );
}
