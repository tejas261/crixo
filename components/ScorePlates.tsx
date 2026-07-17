'use client';

// Signature: scoreboard plates with digit roll. Diffs each digit group
// right-aligned against the previous render so only genuinely changed digits
// roll — including digit-count changes (9 -> 10 rolls both digits, 19 -> 20
// rolls only the ones that differ). Nothing rolls on first paint.
// prefers-reduced-motion is honoured in CSS (.plate-digit.roll animation off).

import { useEffect, useRef, type ReactNode } from 'react';

interface ScorePlatesProps {
  runs: number;
  wickets: number;
  overs: string;
  big?: boolean;
}

interface PlateParts {
  r: string;
  w: string;
  o: string;
}

export default function ScorePlates({ runs, wickets, overs, big = false }: ScorePlatesProps) {
  const parts: PlateParts = { r: String(runs), w: String(wickets), o: String(overs) };

  // Previous render's strings live in a ref updated after commit, so React
  // strict-mode double renders see the same "previous" values.
  const prevRef = useRef<PlateParts | null>(null);
  const prev = prevRef.current;
  useEffect(() => { prevRef.current = parts; });

  const changedAt = (str: string, prevStr: string | undefined, idx: number): boolean => {
    if (!prev) return false; // first paint: no roll
    if (typeof prevStr !== 'string') return true;
    const prevIdx = prevStr.length - (str.length - idx);
    return prevIdx < 0 || prevStr[prevIdx] !== str[idx];
  };

  // The inner digit span is keyed by position + character: when the digit
  // changes it remounts, restarting the roll animation; unchanged digits keep
  // their node and never re-animate.
  const group = (str: string, prevStr: string | undefined, keyPrefix: string): ReactNode[] => [...str].map((c, idx) => {
    if (/\d/.test(c)) {
      const roll = changedAt(str, prevStr, idx);
      return (
        <span className="plate" key={`${keyPrefix}${idx}`}>
          <span
            key={`${keyPrefix}${idx}:${c}`}
            className={`plate-digit${roll ? ' roll' : ''}`}
          >
            {c}
          </span>
        </span>
      );
    }
    return <span className="plate-sep" key={`${keyPrefix}${idx}`}>{c}</span>;
  });

  const score = `${parts.r}/${parts.w}`;
  return (
    <div className={`scoreboard${big ? ' scoreboard--big' : ''}`} aria-live="polite">
      <span className={`plates${big ? ' plates--big' : ''}`} aria-label={`Score ${score}`}>
        {group(parts.r, prev?.r, 'r')}
        <span className="plate-sep">/</span>
        {group(parts.w, prev?.w, 'w')}
      </span>
      <span className="plates plates--overs" aria-label={`Overs ${parts.o}`}>
        {group(parts.o, prev?.o, 'o')}
      </span>
    </div>
  );
}
