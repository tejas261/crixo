// Batter card — on-strike gets the gradient treatment (gradient edge strip
// via CSS, gradient ring around the avatar, pulsing apricot bat glyph);
// non-striker dimmed. A null batsmanIndex renders the "waiting" placeholder
// so the slot is never blank mid-wicket.

import Avatar, { BatGlyph } from '@/components/Avatar';
import { fmtSR } from '@/lib/format';
import type { PublicInnings } from '@/lib/engine';

interface BatterCardProps {
  innings: PublicInnings;
  batsmanIndex: number | null;
  onStrike: boolean;
  /** config.commonPlayer — badges the player who turns out for both sides. */
  commonName?: string | null;
}

export default function BatterCard({ innings, batsmanIndex, onStrike, commonName }: BatterCardProps) {
  if (batsmanIndex == null) {
    return (
      <div className="player-card">
        <div className="player-main">
          <div className="player-name">
            <span className="name-text hint">Waiting for next batsman…</span>
          </div>
        </div>
      </div>
    );
  }
  const b = innings.batsmen[batsmanIndex];
  return (
    <div className={`player-card ${onStrike ? 'striker' : 'non-striker'}`}>
      {onStrike ? (
        <span className="avatar-ring">
          <Avatar name={b.name} role="batsman" />
        </span>
      ) : (
        <Avatar name={b.name} role="batsman" />
      )}
      <div className="player-main">
        <div className="player-name">
          <span className="name-text">{b.name}</span>
          {commonName != null && b.name === commonName && (
            <span className="both-chip" title="Plays for both sides">both sides</span>
          )}
          {onStrike && <BatGlyph />}
        </div>
        <div className="player-sub">
          4s <strong>{b.fours}</strong> · 6s <strong>{b.sixes}</strong> · SR{' '}
          <strong>{fmtSR(b.runs, b.balls)}</strong>
        </div>
      </div>
      <div className="player-stat">
        {b.runs}
        <span className="hint">({b.balls})</span>
      </div>
    </div>
  );
}
