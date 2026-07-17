'use client';

// Innings-break timer — a live mm:ss ticker styled with the brand gradient
// (gradient clock digits + animated gradient bar while the break is running).
// Null-guarded end to end: publicState only recently gained `inningsBreak`
// ({startedAt, endedAt, durationMs}, all nullable), so with old data —
// or a missing/naked field — this renders nothing at all.

import { useEffect, useState } from 'react';
import type { InningsBreak } from '@/lib/engine';

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface BreakTimerProps {
  inningsBreak: InningsBreak | null | undefined;
}

export default function BreakTimer({ inningsBreak }: BreakTimerProps) {
  const startedAt = inningsBreak?.startedAt ?? null;
  const endedAt = inningsBreak?.endedAt ?? null;
  const running = startedAt != null && endedAt == null;

  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer: ReturnType<typeof setInterval> = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (startedAt == null) return null;

  const reference = endedAt ?? now ?? startedAt;
  const elapsed = reference - startedAt;

  return (
    <div className="break-timer" role="timer" aria-label={`Innings break ${fmtClock(elapsed)}`}>
      <div className="break-timer-row">
        <span className="break-timer-label">Innings break</span>
        <span className="break-timer-clock">{fmtClock(elapsed)}</span>
      </div>
      <div className={`break-timer-bar${running ? ' running' : ''}`} aria-hidden="true" />
    </div>
  );
}
