'use client';

// Current-over badge strip. Only badges appended since the previous render
// get the roll-in animation (tracked with a count ref, like the vanilla
// version tracked data-count), so existing badges never re-animate.

import { useEffect, useRef } from 'react';
import { badgeClass, currentOverEntries } from '@/lib/format';
import type { PublicInnings, TimelineEntry } from '@/lib/engine';

interface OverStripProps {
  innings: PublicInnings | null | undefined;
}

export default function OverStrip({ innings }: OverStripProps) {
  const entries: TimelineEntry[] = innings ? currentOverEntries(innings) : [];

  const prevCountRef = useRef<number>(0);
  const prevCount = prevCountRef.current;
  useEffect(() => { prevCountRef.current = entries.length; });

  if (!entries.length) {
    return <span className="hint">No balls bowled in this over yet.</span>;
  }
  return (
    <>
      {entries.map((e, idx) => {
        const roll = idx >= prevCount && entries.length > prevCount;
        return (
          <span
            key={idx}
            className={`${badgeClass(e.badge)}${roll ? ' roll' : ''}`}
            title={e.text}
          >
            {e.badge}
          </span>
        );
      })}
    </>
  );
}
