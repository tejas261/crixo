// One-line toss sentence — shared by the umpire console (setup context), the
// live viewer's idle card and the summary page. Renders nothing pre-toss.

import type { PublicState } from '@/lib/engine';

interface TossLineProps {
  state: PublicState;
  className?: string;
}

export default function TossLine({ state, className }: TossLineProps) {
  const toss = state.toss;
  if (!toss) return null;
  return (
    <div className={`toss-line${className ? ` ${className}` : ''}`}>
      <strong>{state.config.teams[toss.winnerIndex].name}</strong> won the toss and chose
      to <span className="toss-mono">{toss.decision}</span> first
    </div>
  );
}
