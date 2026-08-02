'use client';

// /growth — internal GTM dashboard (v16). Paste the ANALYTICS_KEY (server
// env) to load; nothing renders without it and the key only lives in this
// tab's memory. Plain numbers-first tables on purpose — this is an internal
// readout, not a product surface.

import { useState } from 'react';
import { Wordmark } from '@/components/Logo';

interface DailyRow { day: string; events: number; devices: number; views: number }
interface CountRow { key: string | null; n: number }
interface PlatformRow { platform: string; events: number; devices: number }

interface Summary {
  windowDays: number;
  since: string;
  daily: DailyRow[];
  platforms: PlatformRow[];
  events: CountRow[];
  paths: CountRow[];
  referrers: CountRow[];
  utmSources: CountRow[];
  funnel: {
    matchesCreated: number;
    matchesTossed: number;
    matchesScored: number;
    matchesWith12PlusBalls: number;
    matchesEndedExplicitly: number;
    ballsLogged: number;
  };
  features: {
    boomMatches: number;
    squadChangeMatches: number;
    commonPlayerAddedMidMatch: number;
    strikeSwaps: number;
    bowlerChanges: number;
  };
}

export default function GrowthPage() {
  const [key, setKey] = useState('');
  const [days, setDays] = useState('30');
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/analytics/summary?days=${encodeURIComponent(days)}`,
        { headers: { 'x-analytics-key': key } },
      );
      const json: unknown = await res.json();
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || `HTTP ${res.status}`);
      }
      setData(json as Summary);
    } catch (err) {
      setData(null);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const f = data?.funnel;
  return (
    <div className="wrap">
      <header className="site-header">
        <Wordmark />
        <span className="header-teams">Growth — internal</span>
      </header>

      <section className="panel">
        <h2 className="panel-title">Load metrics</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text" placeholder="Analytics key" aria-label="Analytics key"
            value={key} onChange={(e) => setKey(e.target.value)}
            style={{ flex: 2, minWidth: 180 }}
          />
          <input
            type="number" min="1" max="365" aria-label="Window in days"
            value={days} onChange={(e) => setDays(e.target.value)}
            style={{ flex: 1, minWidth: 80 }}
          />
          <button className="btn" disabled={loading || !key.trim()} onClick={load}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
        {error && <p className="roster-error" role="alert">{error}</p>}
        {!data && !error && (
          <p className="form-hint form-hint--left">
            Last-N-days traffic, funnel, and feature usage. The key is ANALYTICS_KEY in the
            server&apos;s .env.
          </p>
        )}
      </section>

      {data && f && (
        <>
          <section className="panel">
            <h2 className="panel-title">Funnel — last {data.windowDays} days</h2>
            <StatTable rows={[
              ['Matches created', f.matchesCreated],
              ['… held a toss', f.matchesTossed],
              ['… scored at least 1 ball', f.matchesScored],
              ['… real games (12+ balls)', f.matchesWith12PlusBalls],
              ['… ended explicitly (floor for completions)', f.matchesEndedExplicitly],
              ['Balls logged in total', f.ballsLogged],
            ]} />
          </section>

          <section className="panel">
            <h2 className="panel-title">Feature usage</h2>
            <StatTable rows={[
              ['Matches that armed boom-boom', data.features.boomMatches],
              ['Matches with squad changes', data.features.squadChangeMatches],
              ['Mid-match common players added', data.features.commonPlayerAddedMidMatch],
              ['Strike swaps (corrections)', data.features.strikeSwaps],
              ['Bowler changes (corrections)', data.features.bowlerChanges],
            ]} />
          </section>

          <section className="panel">
            <h2 className="panel-title">Daily traffic</h2>
            <CountTable
              head={['Day', 'Devices', 'Views', 'Events']}
              rows={data.daily.map((d) => [d.day, d.devices, d.views, d.events])}
              empty="No analytics events in this window yet."
            />
          </section>

          <section className="panel">
            <h2 className="panel-title">Platforms</h2>
            <CountTable
              head={['Platform', 'Devices', 'Events']}
              rows={data.platforms.map((p) => [p.platform, p.devices, p.events])}
              empty="No platform data yet."
            />
          </section>

          <TopList title="Screens / pages" rows={data.paths} />
          <TopList title="External referrers" rows={data.referrers} />
          <TopList title="UTM sources" rows={data.utmSources} />
          <TopList title="All tracked events" rows={data.events} />
        </>
      )}
    </div>
  );
}

function StatTable({ rows }: { rows: [string, number][] }) {
  return (
    <div className="table-scroll">
      <table className="stats">
        <tbody>
          {rows.map(([label, n]) => (
            <tr key={label}>
              <td>{label}</td>
              <td><strong>{n}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountTable({ head, rows, empty }: {
  head: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  if (!rows.length) return <p className="hint">{empty}</p>;
  return (
    <div className="table-scroll">
      <table className="stats">
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: CountRow[] }) {
  return (
    <section className="panel">
      <h2 className="panel-title">{title}</h2>
      <CountTable
        head={[title, 'Count']}
        rows={rows.map((r) => [r.key ?? '(none)', r.n])}
        empty="Nothing recorded yet."
      />
    </section>
  );
}
