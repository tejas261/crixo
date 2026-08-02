// GET /api/analytics/summary?days=30&key=… — internal GTM metrics (v16).
//
// Read-only rollup for the /growth page: traffic from analytics_events
// (first-party collector) joined with product depth from the existing
// matches/events tables. Gated by env ANALYTICS_KEY — the endpoint is
// disabled (503) until the key is configured, and 403s on a mismatch.

import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface DailyRow {
  day: string;
  events: number;
  devices: number;
  views: number;
}

interface CountRow {
  key: string | null;
  n: number;
}

interface PlatformRow {
  platform: string;
  events: number;
  devices: number;
}

interface EventTypeRow {
  type: string | null;
  n: number;
  matches: number;
}

// count(*) comes back as BigInt from pg; ::int casts keep rows JSON-safe,
// but normalize defensively anyway.
function num(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.ANALYTICS_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'analytics is not configured (set ANALYTICS_KEY)' }, { status: 503 });
  }
  const key = req.nextUrl.searchParams.get('key') ?? req.headers.get('x-analytics-key');
  if (key !== expected) {
    return NextResponse.json({ error: 'invalid analytics key' }, { status: 403 });
  }

  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const prisma = db();

  const [daily, platforms, names, paths, referrers, utm, eventTypes, matchesCreated, deepMatches] =
    await Promise.all([
      prisma.$queryRaw<DailyRow[]>`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
               count(*)::int AS events,
               count(DISTINCT device_id)::int AS devices,
               (count(*) FILTER (WHERE name IN ('pageview', 'screen')))::int AS views
        FROM analytics_events WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 1 DESC`,
      prisma.$queryRaw<PlatformRow[]>`
        SELECT platform, count(*)::int AS events, count(DISTINCT device_id)::int AS devices
        FROM analytics_events WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 2 DESC`,
      prisma.$queryRaw<CountRow[]>`
        SELECT name AS key, count(*)::int AS n
        FROM analytics_events WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 2 DESC LIMIT 30`,
      prisma.$queryRaw<CountRow[]>`
        SELECT path AS key, count(*)::int AS n
        FROM analytics_events
        WHERE created_at >= ${since} AND name IN ('pageview', 'screen') AND path IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      prisma.$queryRaw<CountRow[]>`
        SELECT referrer AS key, count(*)::int AS n
        FROM analytics_events
        WHERE created_at >= ${since} AND referrer IS NOT NULL AND referrer <> ''
          AND referrer NOT LIKE '%crixo.duckdns.org%'
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      prisma.$queryRaw<CountRow[]>`
        SELECT props->>'utm_source' AS key, count(*)::int AS n
        FROM analytics_events
        WHERE created_at >= ${since} AND props->>'utm_source' IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
      // Product depth straight from the event-sourced core: every scoring
      // action already lives in `events` — no client tracking needed.
      prisma.$queryRaw<EventTypeRow[]>`
        SELECT e.event->>'type' AS type, count(*)::int AS n, count(DISTINCT e.match_id)::int AS matches
        FROM events e JOIN matches m ON m.id = e.match_id
        WHERE m.created_at >= ${since}
        GROUP BY 1 ORDER BY 2 DESC`,
      prisma.match.count({ where: { createdAt: { gte: since } } }),
      // "Real games": matches that got at least two overs of deliveries.
      prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT e.match_id FROM events e JOIN matches m ON m.id = e.match_id
          WHERE m.created_at >= ${since} AND e.event->>'type' = 'ball'
          GROUP BY 1 HAVING count(*) >= 12
        ) deep`,
    ]);

  const typeStat = (t: string) => eventTypes.find((r) => r.type === t);
  const funnel = {
    matchesCreated,
    matchesTossed: num(typeStat('toss')?.matches),
    matchesScored: num(typeStat('ball')?.matches),
    matchesWith12PlusBalls: num(deepMatches[0]?.n),
    // Explicit closes only — auto-completed chases carry no end_match event,
    // so treat this as a floor, not the true completion count.
    matchesEndedExplicitly: num(typeStat('end_match')?.matches),
    ballsLogged: num(typeStat('ball')?.n),
  };
  const features = {
    boomMatches: num(typeStat('boom_over')?.matches),
    squadChangeMatches: Math.max(
      num(typeStat('add_player')?.matches),
      num(typeStat('remove_player')?.matches),
    ),
    commonPlayerAddedMidMatch: num(typeStat('add_common_player')?.matches),
    strikeSwaps: num(typeStat('swap_strike')?.n),
    bowlerChanges: num(typeStat('change_bowler')?.n),
    undos: 0, // undo pops the log — by design it leaves no row to count
  };

  return NextResponse.json({
    windowDays: days,
    since: since.toISOString(),
    daily,
    platforms,
    events: names,
    paths,
    referrers,
    utmSources: utm,
    funnel,
    features,
    scoringEventTypes: eventTypes,
  });
}
