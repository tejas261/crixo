'use client';

// Home — hero, create-match form, "Your matches" + "Live nearby" lists.
//
// Location: we ask for it once on mount (and again on "Try again"). With
// coordinates in hand, GET /api/matches?lat=&lng= returns live matches
// within 500m under `nearby`; without them the same endpoint returns only
// `mine`. Creating a match attaches the coordinates when we have them —
// creation never waits on the location prompt.

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchJSON } from '@/lib/useMatch';
import { useAccount } from '@/lib/useAccount';
import { useAds } from '@/lib/useAds';
import { toast } from '@/components/Toasts';
import StatusChip from '@/components/StatusChip';
import RosterBuilder from '@/components/RosterBuilder';
import AccountSheet from '@/components/AccountSheet';
import AccountAvatar from '@/components/AccountAvatar';
import RemoveAdsSheet from '@/components/RemoveAdsSheet';
import AdSlot from '@/components/AdSlot';
import { Wordmark, CrixoMark } from '@/components/Logo';
import { EmptyStateArt } from '@/components/Avatar';
import type { MatchStatus } from '@/lib/engine';

// One row of GET /api/matches; nearby rows carry distanceM (never raw coords).
interface MatchListItem {
  id: string;
  status: MatchStatus;
  teams: string[];
  score: string | null;
  result?: string;
  distanceM?: number;
}

// Shape of GET /api/matches (with or without lat/lng — nearby is [] without).
interface MatchLists {
  mine: MatchListItem[];
  nearby: MatchListItem[];
}

interface Coords {
  lat: number;
  lng: number;
}

// 'idle' only exists before the first request fires on mount.
type GeoStatus = 'idle' | 'requesting' | 'granted' | 'denied';

export default function HomePage() {
  const router = useRouter();

  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [playersA, setPlayersA] = useState<string[]>([]);
  const [playersB, setPlayersB] = useState<string[]>([]);
  const [commonPlayer, setCommonPlayer] = useState('');
  const [overs, setOvers] = useState('10');
  // 'toss' = decide on the toss page after create (a provisional 0 is sent;
  // the toss event overrides battingFirstIndex when it's recorded).
  const [battingFirst, setBattingFirst] = useState<0 | 1 | 'toss'>(0);
  const [boomBoom, setBoomBoom] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [lists, setLists] = useState<MatchLists | null>(null); // null = loading
  const [listError, setListError] = useState<string | null>(null);

  // Geolocation. The ref mirrors coords for the create handler (no stale
  // closure if the grant lands mid-form-fill).
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [coords, setCoords] = useState<Coords | null>(null);
  const coordsRef = useRef<Coords | null>(null);

  const requestLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('denied');
      return;
    }
    setGeoStatus('requesting');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        coordsRef.current = c;
        setCoords(c);
        setGeoStatus('granted');
      },
      () => { setGeoStatus('denied'); },
      { timeout: 8000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => { requestLocation(); }, [requestLocation]);

  // Account + ads. `sheet` picks which bottom sheet is open (never both).
  const { me, loading: meLoading, refresh } = useAccount();
  const { showAds, purchases } = useAds();
  const [sheet, setSheet] = useState<'account' | 'ads' | null>(null);

  // The Google OAuth callback lands back here; a failed sign-in carries
  // ?auth_error=… — surface it once, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (!authError) return;
    toast(`Couldn't sign in — ${authError.replace(/[_-]+/g, ' ')}`);
    params.delete('auth_error');
    const qs = params.toString();
    window.history.replaceState(
      null, '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
  }, []);

  // Fetch the lists right away ("mine" works without location), then again
  // with lat/lng once the grant lands so "nearby" fills in.
  useEffect(() => {
    let cancelled = false;
    const qs = coords
      ? `?lat=${encodeURIComponent(coords.lat)}&lng=${encodeURIComponent(coords.lng)}`
      : '';
    fetchJSON<MatchLists>(`/api/matches${qs}`)
      .then((res) => {
        if (cancelled) return;
        setLists(res);
        setListError(null);
      })
      .catch((err: Error) => { if (!cancelled) setListError(err.message); });
    return () => { cancelled = true; };
  }, [coords]);

  const oversNum = Number(overs);
  const common = commonPlayer.trim().replace(/\s+/g, ' ');
  const commonSize = common ? 1 : 0;
  const commonClashes = Boolean(common) &&
    [...playersA, ...playersB].some((p) => p.toLowerCase() === common.toLowerCase());
  const missing: string[] = [];
  if (!teamA.trim() || !teamB.trim()) missing.push('name both teams');
  if (playersA.length + commonSize < 2 || playersB.length + commonSize < 2) missing.push('add at least 2 players per side');
  if (commonClashes) missing.push(`pick a different common player (${common} is already in a squad)`);
  if (playersA.length + commonSize > 11 || playersB.length + commonSize > 11) {
    missing.push('squads are capped at 11 including the common player');
  }
  if (!Number.isInteger(oversNum) || oversNum < 1 || oversNum > 50) missing.push('set overs between 1 and 50');
  const formReady = missing.length === 0;
  const readyHint = `To start: ${missing.join(', ')}.`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The common player is a full member of both squads (batting last on each
    // side); config.commonPlayer records who they are for the "both sides"
    // badges. Location rides along only if the grant already succeeded —
    // creating never waits on the prompt.
    const location = coordsRef.current;
    const body = {
      teams: [
        { name: teamA.trim(), players: common ? [...playersA, common] : playersA },
        { name: teamB.trim(), players: common ? [...playersB, common] : playersB },
      ],
      oversPerInnings: Number(overs),
      battingFirstIndex: battingFirst === 'toss' ? 0 : battingFirst,
      commonPlayer: common || null,
      boomBoom,
      ...(location ? { location } : {}),
    };
    setSubmitting(true);
    try {
      // The server grants scoring rights to this browser's session cookie
      // during the POST; the console reads /role, so nothing to store here.
      const { id } = await fetchJSON<{ id: string; adminKey: string }>('/api/matches', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(battingFirst === 'toss' ? `/toss/${id}` : `/umpire/${id}`);
    } catch (err) {
      toast((err as Error).message);
      setSubmitting(false);
    }
  }

  const mine = lists?.mine ?? [];
  const nearby = lists?.nearby ?? [];

  return (
    <div className="wrap">
      <header className="site-header">
        <Wordmark />
        <span className="header-spacer" />
        {!meLoading && me != null && (
          <div className="account-area">
            {purchases && !me.adFree && (
              <button
                type="button" className="btn-quiet"
                aria-haspopup="dialog"
                onClick={() => setSheet('ads')}
              >
                Remove ads
              </button>
            )}
            <button
              type="button" className="btn-quiet account-btn"
              aria-haspopup="dialog"
              aria-label={me.signedIn
                ? `Account — signed in as ${me.name ?? me.email ?? 'you'}`
                : 'Sign in'}
              onClick={() => setSheet('account')}
            >
              {me.signedIn ? (
                <>
                  <AccountAvatar name={me.name} email={me.email} picture={me.picture} size={26} />
                  <span className="account-btn-name">
                    {(me.name ?? me.email ?? 'Account').split(' ')[0]}
                  </span>
                </>
              ) : 'Sign in'}
            </button>
          </div>
        )}
      </header>

      <section className="hero">
        <h1><CrixoMark size={52} /> Crixo</h1>
        <p>Ball-by-ball scoring for your match, live for everyone.</p>
      </section>

      <section className="panel" aria-labelledby="create-title">
        <h2 className="panel-title" id="create-title">Create a match</h2>
        <form onSubmit={onSubmit} noValidate>
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="team-a">Team A name</label>
              <input
                type="text" id="team-a" placeholder="Willowdale CC" required
                value={teamA} onChange={(e) => setTeamA(e.target.value)}
              />
              <RosterBuilder
                label="Team A" teamName={teamA} idPrefix="a"
                players={playersA} onChange={setPlayersA} commonName={common}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="team-b">Team B name</label>
              <input
                type="text" id="team-b" placeholder="Oakfield XI" required
                value={teamB} onChange={(e) => setTeamB(e.target.value)}
              />
              <RosterBuilder
                label="Team B" teamName={teamB} idPrefix="b"
                players={playersB} onChange={setPlayersB} commonName={common}
              />
            </div>
          </div>

          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="common-player">Common player (optional)</label>
              <input
                type="text" id="common-player" placeholder="Odd headcount? They play for both sides"
                maxLength={40} autoComplete="off"
                value={commonPlayer} onChange={(e) => setCommonPlayer(e.target.value)}
              />
              {commonClashes && (
                <p className="roster-error" role="alert">
                  {common} is already in a squad — remove them there, or use a different name here.
                </p>
              )}
            </div>
            <div />
          </div>

          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="overs">Overs per innings</label>
              <input
                type="number" id="overs" min="1" max="50" required
                value={overs} onChange={(e) => setOvers(e.target.value)}
              />
            </div>
            <div>
              <span className="field-label">Who bats first</span>
              <div className="toggle-row" role="group" aria-label="Who bats first">
                <button
                  type="button" className="btn"
                  aria-pressed={battingFirst === 0}
                  onClick={() => setBattingFirst(0)}
                >
                  {teamA.trim() || 'Team A'}
                </button>
                <button
                  type="button" className="btn"
                  aria-pressed={battingFirst === 1}
                  onClick={() => setBattingFirst(1)}
                >
                  {teamB.trim() || 'Team B'}
                </button>
                <button
                  type="button" className="btn"
                  aria-pressed={battingFirst === 'toss'}
                  onClick={() => setBattingFirst('toss')}
                >
                  Toss decides
                </button>
              </div>
            </div>
          </div>

          <div className="form-grid">
            <div>
              <span className="field-label">Boom-boom overs</span>
              <div className="toggle-row" role="group" aria-label="Boom-boom overs">
                <button
                  type="button" className="btn"
                  aria-pressed={!boomBoom}
                  onClick={() => setBoomBoom(false)}
                >
                  Off
                </button>
                <button
                  type="button" className="btn"
                  aria-pressed={boomBoom}
                  onClick={() => setBoomBoom(true)}
                >
                  On
                </button>
              </div>
              <p className="form-hint form-hint--left">
                Arm any over from the console: runs count double, every wicket costs 5.
              </p>
            </div>
            <div />
          </div>

          <div className="form-submit">
            <button
              type="submit" className="btn btn-primary btn-block"
              disabled={submitting || !formReady}
            >
              {submitting ? 'Creating match…' : 'Start scoring'}
            </button>
            {!formReady && (
              <p className="form-hint" aria-live="polite">{readyHint}</p>
            )}
            <p className="form-hint">
              {coords
                ? 'Your match is discoverable by people within 500m.'
                : 'Enable location to make this match discoverable nearby.'}
            </p>
          </div>
        </form>
      </section>

      {showAds && <AdSlot />}

      {/* Your matches: anything this browser created or scored, any status;
          the panel only exists once there is something to show. */}
      {mine.length > 0 && (
        <section className="panel" aria-labelledby="mine-title">
          <h2 className="panel-title" id="mine-title">Your matches</h2>
          <div className="match-list">
            {mine.map((m) => <MatchRow key={m.id} match={m} mine />)}
          </div>
        </section>
      )}

      {/* Live nearby: always rendered — the empty states carry the location
          story (loading / granted-but-quiet / denied), never a blank panel. */}
      <section className="panel" aria-labelledby="nearby-title">
        <h2 className="panel-title" id="nearby-title">Live nearby</h2>
        <div className="match-list">
          {lists == null ? (
            <div className="empty-state">
              {listError
                ? <>Couldn&apos;t load matches — {listError}. Refresh to try again.</>
                : 'Loading matches…'}
            </div>
          ) : nearby.length > 0 ? (
            nearby.map((m) => <MatchRow key={m.id} match={m} />)
          ) : geoStatus === 'granted' ? (
            <div className="empty-state">
              <EmptyStateArt />
              Nothing on within 500m — start one!
            </div>
          ) : geoStatus === 'denied' ? (
            <div className="empty-state">
              Turn on location to find matches near you.
              <div>
                <button type="button" className="btn-quiet" onClick={requestLocation}>
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Checking for matches near you…</div>
          )}
        </div>
      </section>

      <AccountSheet
        open={sheet === 'account'}
        me={me}
        purchases={purchases}
        onClose={() => setSheet(null)}
        refresh={refresh}
        onRemoveAds={() => setSheet('ads')}
      />
      <RemoveAdsSheet
        open={sheet === 'ads'}
        me={me}
        onClose={() => setSheet(null)}
        refresh={refresh}
      />
    </div>
  );
}

// One row of either match list. Finished matches land on the scorecard;
// nearby (other people's) matches go to the live view. Your own unfinished
// matches resume the umpire console — the post-create redirect is otherwise
// the only door to it, and the console itself degrades to read-only for
// sessions without a scoring grant. Nearby rows show how far away the game
// is (rounded metres; the API never exposes coordinates).
function MatchRow({ match: m, mine = false }: { match: MatchListItem; mine?: boolean }) {
  const done = m.status === 'completed';
  const resume = mine && !done;
  const href = done ? `/summary/${m.id}` : resume ? `/umpire/${m.id}` : `/m/${m.id}`;
  return (
    <Link className="match-row" href={href}>
      <span className="teams">{m.teams.join(' v ')}</span>
      <span className="score">{m.result ? m.result : (m.score || '')}</span>
      {typeof m.distanceM === 'number' && (
        <span className="distance">~{Math.round(m.distanceM)}m away</span>
      )}
      {resume && <span className="score-cta">Score ›</span>}
      <StatusChip status={m.status} />
    </Link>
  );
}
