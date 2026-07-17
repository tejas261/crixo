// Full-innings timeline, newest first, inside a scrollable container.
// Rows are keyed by innings + stable ball index, so on each new ball React
// only inserts the new row(s) at the top and keeps every existing DOM node —
// a mid-read viewer's scroll position survives every ball. Keys change
// wholesale only when the innings changes (full rebuild, like the original).

import type { ReactElement } from 'react';
import { badgeClass } from '@/lib/format';
import type { PublicInnings } from '@/lib/engine';

interface TimelineProps {
  innings: PublicInnings | null | undefined;
  inningsKey: string;
}

export default function Timeline({ innings, inningsKey }: TimelineProps) {
  if (!innings) {
    return (
      <div className="timeline-list">
        <span className="hint">Every ball will be logged here.</span>
      </div>
    );
  }
  const entries = innings.timeline || [];
  if (!entries.length) {
    return (
      <div className="timeline-list">
        <span className="hint">No balls bowled yet — every delivery will be logged here.</span>
      </div>
    );
  }
  const rows: ReactElement[] = [];
  for (let idx = entries.length - 1; idx >= 0; idx--) {
    const e = entries[idx];
    rows.push(
      <div className="timeline-row" key={`${inningsKey}:${idx}`}>
        <span className="over-num">{e.over}</span>
        <span className={badgeClass(e.badge)}>{e.badge}</span>
        <span className="tl-text">{e.text}</span>
      </div>
    );
  }
  return <div className="timeline-list">{rows}</div>;
}
