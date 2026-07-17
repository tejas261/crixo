// Match status chip — gradient-bordered with a pulsing gradient dot when
// live (pulse disabled under prefers-reduced-motion in CSS).

import type { MatchStatus } from '@/lib/engine';

interface StatusChipProps {
  status: MatchStatus;
}

export default function StatusChip({ status }: StatusChipProps) {
  if (status === 'live') {
    return (
      <span className="status-chip live">
        <span className="live-dot" />
        Live
      </span>
    );
  }
  const label = status === 'completed'
    ? 'Completed'
    : status === 'innings_break'
      ? 'Innings break'
      : 'Setting up';
  return <span className="status-chip">{label}</span>;
}
