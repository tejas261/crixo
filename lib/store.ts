// Umpire store — all match state, validation, persistence, and fan-out.
// Persistence is Postgres via Prisma (event-sourced):
//   - matches(id, admin_key, config, created_at) — one row per match
//   - events(match_id, seq, event)               — the append-only event log
//   - in-memory cache of derived states, rebuilt by replay on load
//   - per-match serialized DB writes via a promise chain
//   - match-id validation before any query — defense in depth
//   - commit-to-memory only after the DB write succeeds; queue-aware rollback
//   - adminKey never appears in any public output
//
// All mutable singletons live on globalThis so Next dev/HMR module reloads
// don't fork the store (a reloaded module must see the same Maps/client).
import crypto from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { initState, applyEvent, replay, publicState } from './engine';
import type { MatchConfig, MatchEvent, MatchState, MatchStatus, PublicState, TeamConfig, UndoEvent } from './engine';
import { db } from './db';
import { StoreError } from './errors';
import { VICINITY_M, haversineMeters } from './geo';
import type { GeoPoint } from './geo';

// Re-export so existing `import { StoreError } from '@/lib/store'` keeps working.
export { StoreError };

// SPEC: match ids are 8-char base36. Validate everywhere an id is used in a
// query or read back from the database — not just Map lookups.
const ID_RE = /^[a-z0-9]{8}$/;

// Session tokens are 24-byte hex cookies minted by lib/session.ts. Validate
// before any grant query — defense in depth, same as ID_RE.
const TOKEN_RE = /^[0-9a-f]{48}$/;

export interface MatchListEntry {
  id: string;
  status: MatchStatus;
  teams: string[];
  score: string | null;
  result?: string;
  /** Present only on `nearby` rows: metres from the query point, rounded. */
  distanceM?: number;
}

/** Dashboard shape (v12): the caller's own matches + non-completed matches
 *  within VICINITY_M of the query point. Raw coordinates NEVER leave here. */
export interface MatchLists {
  mine: MatchListEntry[];
  nearby: MatchListEntry[];
}

type Subscriber = (state: PublicState) => void;

// Who is asking to score: an admin key (cross-device paste) and/or a session
// cookie token (DB-backed grant). Either one authorizes the event.
export interface EventAuth {
  adminKey?: string | null;
  token?: string | null;
}

interface MatchRecord {
  id: string;
  adminKey: string;
  config: MatchConfig;
  events: MatchEvent[];
  createdAt: string;
  accountId: string | null; // creating account (null: legacy/internal)
  lat: number | null; // creation coordinates (null: no location shared);
  lng: number | null; // never exposed raw — only derived distances are

  state: MatchState;
  grantTokens: Set<string>; // cache of granted session tokens (seeded from DB on load)
  _writeLock?: Promise<void>;
  _dbSeq: number; // highest seq known committed in the DB
}

interface StoreSingleton {
  matches: Map<string, MatchRecord>;
  subscribers: Map<string, Set<Subscriber>>;
  ready: Promise<void> | null; // promise: existing matches loaded
}

// ---------------------------------------------------------------------------
// HMR-safe singletons
// ---------------------------------------------------------------------------
const g = globalThis as typeof globalThis & { __umpireStore?: StoreSingleton };
const store = (g.__umpireStore ??= {
  matches: new Map(),
  subscribers: new Map(),
  ready: null,
});

// Shared client (lib/db.ts) — same pool as the accounts/credits layer.
function prisma(): PrismaClient {
  return db();
}

function ready(): Promise<void> {
  // A failed init (e.g. DB briefly down at boot) is not cached: the next
  // request retries instead of permanently serving 500s.
  store.ready ??= init().catch((err) => {
    store.ready = null;
    throw err;
  });
  return store.ready;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
// Schema is managed by Prisma (`prisma db push` / migrations); init only has
// to load every match and replay its event log into the cache.
async function init(): Promise<void> {
  const rows = await prisma().match.findMany({
    include: {
      events: { orderBy: { seq: 'asc' } },
      grants: { select: { token: true } },
    },
  });
  for (const row of rows) {
    if (typeof row.id !== 'string' || !ID_RE.test(row.id)) {
      console.error(`Skipping match row with invalid id: ${row.id}`);
      continue;
    }
    try {
      const events = row.events.map((r) => r.event as unknown as MatchEvent);
      const config = row.config as unknown as MatchConfig;
      const state = replay(config, events);
      store.matches.set(row.id, {
        id: row.id,
        adminKey: row.adminKey,
        config,
        events,
        createdAt: row.createdAt.toISOString(),
        accountId: row.accountId,
        lat: row.lat,
        lng: row.lng,
        state,
        grantTokens: new Set(row.grants.map((gr) => gr.token)),
        _dbSeq: events.length, // highest seq known committed in the DB
      });
    } catch (err) {
      // A corrupt record must not prevent boot; skip it.
      console.error(`Skipping unreplayable match ${row.id}:`, (err as Error).message);
    }
  }
}

// Serialize DB writes per match with a promise chain so concurrent event
// POSTs can never interleave (an insert landing before an earlier one commits
// could violate ordering assumptions; the chain keeps writes FIFO per match).
function enqueueWrite(m: MatchRecord, fn: () => Promise<void>): Promise<void> {
  const link = (m._writeLock ?? Promise.resolve())
    .catch(() => {}) // a failed earlier write must not poison the chain
    .then(fn);
  m._writeLock = link;
  return link;
}

function newMatchId(): string {
  // 8-char base36 from crypto randomness.
  let id = '';
  while (id.length < 8) {
    id += BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString(36);
  }
  return id.slice(0, 8);
}

function newAdminKey(): string {
  return crypto.randomBytes(12).toString('hex'); // 24 hex chars
}

// Load-on-demand: cache miss -> query the DB (covers matches created by
// another process after this one booted).
async function getMatch(id: unknown): Promise<MatchRecord | null> {
  await ready();
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const cached = store.matches.get(id);
  if (cached) return cached;
  try {
    const row = await prisma().match.findUnique({
      where: { id },
      include: {
        events: { orderBy: { seq: 'asc' } },
        grants: { select: { token: true } },
      },
    });
    if (!row) return null;
    const events = row.events.map((r) => r.event as unknown as MatchEvent);
    const config = row.config as unknown as MatchConfig;
    const state = replay(config, events);
    // Another concurrent load may have won the race; keep the first entry.
    if (!store.matches.has(id)) {
      store.matches.set(id, {
        id: row.id,
        adminKey: row.adminKey,
        config,
        events,
        createdAt: row.createdAt.toISOString(),
        accountId: row.accountId,
        lat: row.lat,
        lng: row.lng,
        state,
        grantTokens: new Set(row.grants.map((gr) => gr.token)),
        _dbSeq: events.length,
      });
    }
    return store.matches.get(id) ?? null;
  } catch (err) {
    console.error(`Failed to load match ${id}:`, (err as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validation for match creation
// ---------------------------------------------------------------------------
export function validateCreateBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'request body must be a JSON object';
  const { teams, oversPerInnings, battingFirstIndex } =
    body as { teams?: unknown; oversPerInnings?: unknown; battingFirstIndex?: unknown };
  if (!Array.isArray(teams) || teams.length !== 2) return 'teams must be an array of exactly 2 teams';
  for (const [i, team] of teams.entries()) {
    if (typeof team !== 'object' || team === null) return `teams[${i}] must be an object`;
    const { name, players } = team as { name?: unknown; players?: unknown };
    if (typeof name !== 'string' || name.trim() === '') return `teams[${i}].name must be a non-empty string`;
    if (!Array.isArray(players) || players.length < 2 || players.length > 11) {
      return `teams[${i}].players must have 2-11 players`;
    }
    for (const p of players) {
      if (typeof p !== 'string' || p.trim() === '') return `teams[${i}].players must all be non-empty strings`;
    }
  }
  if (!Number.isInteger(oversPerInnings) || (oversPerInnings as number) < 1 || (oversPerInnings as number) > 50) {
    return 'oversPerInnings must be an integer between 1 and 50';
  }
  if (battingFirstIndex !== 0 && battingFirstIndex !== 1) {
    return 'battingFirstIndex must be 0 or 1';
  }
  const { commonPlayer } = body as { commonPlayer?: unknown };
  if (commonPlayer != null && (typeof commonPlayer !== 'string' || commonPlayer.trim() === '')) {
    return 'commonPlayer must be a non-empty string when provided';
  }
  const { boomBoom } = body as { boomBoom?: unknown };
  if (boomBoom != null && typeof boomBoom !== 'boolean') {
    return 'boomBoom must be a boolean when provided';
  }
  const { location } = body as { location?: unknown };
  if (location != null) {
    if (typeof location !== 'object' || Array.isArray(location)) {
      return 'location must be an object with lat and lng numbers';
    }
    const { lat, lng } = location as { lat?: unknown; lng?: unknown };
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return 'location.lat must be a number between -90 and 90';
    }
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return 'location.lng must be a number between -180 and 180';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Subscriber fan-out (SSE)
// ---------------------------------------------------------------------------
function notify(id: string): void {
  const subs = store.subscribers.get(id);
  if (!subs || subs.size === 0) return;
  const m = store.matches.get(id);
  if (!m) return;
  const state = publicState(m.state);
  for (const fn of subs) {
    try {
      fn(state);
    } catch {
      // A broken subscriber (e.g. a closed SSE stream) must not affect others.
    }
  }
}

/**
 * subscribe(id, fn) -> unsubscribe
 * fn is called with the match's publicState after every accepted event.
 */
export function subscribe(id: string, fn: Subscriber): () => void {
  let subs = store.subscribers.get(id);
  if (!subs) {
    subs = new Set();
    store.subscribers.set(id, subs);
  }
  subs.add(fn);
  return () => {
    subs.delete(fn);
    if (subs.size === 0) store.subscribers.delete(id);
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * createMatch(body, accountId?) -> {id, adminKey}
 * Creation is FREE and unlimited (v12 — credits retired); accountId (all API
 * creations) is recorded on the match so the dashboard can list "my matches".
 * Optional body.location {lat, lng} is stored for nearby discovery.
 * Throws StoreError(400) on validation/engine errors, StoreError(500) on
 * persistence failure.
 */
export async function createMatch(
  body: unknown,
  accountId?: string | null
): Promise<{ id: string; adminKey: string }> {
  await ready();

  const error = validateCreateBody(body);
  if (error) throw new StoreError(400, error);

  const valid = body as {
    teams: { name: string; players: string[] }[];
    oversPerInnings: number;
    battingFirstIndex: 0 | 1;
    commonPlayer?: string | null;
    boomBoom?: boolean | null;
    location?: { lat: number; lng: number } | null;
  };
  const config: MatchConfig = {
    teams: valid.teams.map((t): TeamConfig => ({
      name: t.name.trim(),
      players: t.players.map((p) => p.trim()),
    })) as [TeamConfig, TeamConfig],
    oversPerInnings: valid.oversPerInnings,
    battingFirstIndex: valid.battingFirstIndex,
    commonPlayer: valid.commonPlayer?.trim() || null,
    boomBoom: valid.boomBoom === true, // absent/null/false => rule unavailable
  };

  let state: MatchState;
  try {
    state = initState(config);
  } catch (err) {
    throw new StoreError(400, (err as Error).message);
  }

  let id = newMatchId();
  while (store.matches.has(id)) id = newMatchId();

  const adminKey = newAdminKey();
  const lat = valid.location?.lat ?? null;
  const lng = valid.location?.lng ?? null;
  let createdAt: string;
  try {
    const row = await prisma().match.create({
      data: {
        id,
        adminKey,
        accountId: accountId ?? null,
        lat,
        lng,
        config: config as unknown as Prisma.InputJsonValue,
      },
    });
    createdAt = row.createdAt.toISOString();
  } catch (err) {
    throw new StoreError(500, `failed to persist match: ${(err as Error).message}`);
  }

  store.matches.set(id, {
    id, adminKey, config, events: [], createdAt,
    accountId: accountId ?? null, lat, lng, state,
    grantTokens: new Set(), _dbSeq: 0,
  });
  return { id, adminKey };
}

// ---------------------------------------------------------------------------
// Session-token scoring grants (DB-backed cookie sessions)
// ---------------------------------------------------------------------------

// DB fallback for a token missing from the in-memory set (e.g. granted by a
// previous process before a restart mid-flight, or a cache/DB race). A hit
// back-fills the cache so the per-ball path stays memory-only.
async function grantInDb(m: MatchRecord, token: string): Promise<boolean> {
  try {
    const row = await prisma().adminGrant.findUnique({
      where: { token_matchId: { token, matchId: m.id } },
      select: { token: true },
    });
    if (!row) return false;
    m.grantTokens.add(token);
    return true;
  } catch (err) {
    console.error(`Grant lookup failed for match ${m.id}:`, (err as Error).message);
    return false;
  }
}

/**
 * grantAdmin(token, matchId) — record that this session token may score the
 * match. Idempotent (upsert). Throws StoreError 404 on unknown match, 400 on
 * a malformed token, 500 on persistence failure.
 */
export async function grantAdmin(token: unknown, matchId: unknown): Promise<void> {
  const m = await getMatch(matchId);
  if (!m) throw new StoreError(404, 'match not found');
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new StoreError(400, 'invalid session token');
  }
  if (m.grantTokens.has(token)) return; // already granted (and thus in the DB)
  try {
    await prisma().adminGrant.upsert({
      where: { token_matchId: { token, matchId: m.id } },
      create: { token, matchId: m.id },
      update: {},
    });
  } catch (err) {
    throw new StoreError(500, `failed to persist grant: ${(err as Error).message}`);
  }
  m.grantTokens.add(token); // commit to memory only after the DB write
}

/**
 * hasGrant(token, matchId) — true iff the session token may score the match.
 * Cache first; falls back to a DB check on miss. Never throws for bad input.
 */
export async function hasGrant(token: unknown, matchId: unknown): Promise<boolean> {
  const m = await getMatch(matchId);
  if (!m) return false;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  if (m.grantTokens.has(token)) return true;
  return grantInDb(m, token);
}

/**
 * claimAdmin(token, matchId, adminKey) — verify the pasted admin key against
 * the match, then grant the session token. Throws StoreError 404 unknown
 * match, 403 'invalid admin key'.
 */
export async function claimAdmin(token: unknown, matchId: unknown, adminKey: unknown): Promise<void> {
  const m = await getMatch(matchId);
  if (!m) throw new StoreError(404, 'match not found');
  if (adminKey !== m.adminKey) throw new StoreError(403, 'invalid admin key');
  await grantAdmin(token, matchId);
}

/**
 * getAdminKeyIfGranted(token, matchId) — the match's admin key, but ONLY for
 * a session that already holds a grant (same-device handoff display).
 */
export async function getAdminKeyIfGranted(token: unknown, matchId: unknown): Promise<string | null> {
  if (!(await hasGrant(token, matchId))) return null;
  const m = await getMatch(matchId);
  return m ? m.adminKey : null;
}

function toListEntry(m: MatchRecord, distanceM?: number): MatchListEntry {
  const ps = publicState(m.state);
  const last = ps.innings[ps.innings.length - 1];
  const entry: MatchListEntry = {
    id: m.id,
    status: ps.status,
    teams: m.config.teams.map((t: TeamConfig) => t.name),
    score: last ? `${last.runs}/${last.wickets} (${last.oversDisplay})` : null,
  };
  if (ps.result) entry.result = ps.result.text;
  if (distanceM !== undefined) entry.distanceM = distanceM;
  return entry;
}

/**
 * listMatches(accountId?, near?) -> {mine, nearby} (v12 dashboard shape).
 * - mine: the account's matches (any status), newest first, cap 20;
 *   [] when the caller has no account.
 * - nearby: matches WITH coordinates within VICINITY_M of `near`, not
 *   completed, excluding the caller's own, newest first, cap 20, each with
 *   distanceM (rounded metres). [] when no query point is given.
 * Raw match coordinates never appear in the output.
 */
export async function listMatches(
  accountId?: string | null,
  near?: GeoPoint | null
): Promise<MatchLists> {
  await ready();
  const newestFirst = [...store.matches.values()].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );

  const mine: MatchListEntry[] = accountId
    ? newestFirst
        .filter((m) => m.accountId === accountId)
        .slice(0, 20)
        .map((m) => toListEntry(m))
    : [];

  const nearby: MatchListEntry[] = [];
  if (near) {
    for (const m of newestFirst) {
      if (nearby.length >= 20) break;
      if (m.lat === null || m.lng === null) continue;
      if (accountId && m.accountId === accountId) continue;
      if (m.state.status === 'completed') continue;
      const distanceM = haversineMeters(near, { lat: m.lat, lng: m.lng });
      if (distanceM > VICINITY_M) continue;
      nearby.push(toListEntry(m, Math.round(distanceM)));
    }
  }

  return { mine, nearby };
}

/**
 * getPublicState(id) -> publicState (WITHOUT id) or null if not found.
 * adminKey is never part of publicState.
 */
export async function getPublicState(id: unknown): Promise<PublicState | null> {
  const m = await getMatch(id);
  if (!m) return null;
  return publicState(m.state);
}

/**
 * postEvent(id, auth, event) -> publicState after the event.
 * auth = {adminKey?, token?}: authorized when the admin key matches OR the
 * session token holds a grant (in-memory token set per match; DB fallback on
 * a cache miss — no DB roundtrip on the per-ball hot path).
 * Throws StoreError: 404 unknown match, 403 not authorized, 400 invalid
 * event / engine rejection / nothing to undo, 500 persistence or replay
 * failure. Notifies subscribers after every accepted (committed) event.
 *
 * Every accepted non-undo event is stamped with `at: Date.now()` (epoch ms)
 * BEFORE it is applied and persisted, so the stored event log reproduces the
 * same timestamps on replay (engine timer fields survive restarts and undo).
 */
export async function postEvent(id: unknown, auth: EventAuth, event: unknown): Promise<PublicState> {
  const m = await getMatch(id);
  if (!m) throw new StoreError(404, 'match not found');

  const { adminKey, token } = auth ?? {};
  let authorized = typeof adminKey === 'string' && adminKey === m.adminKey;
  if (!authorized && typeof token === 'string' && TOKEN_RE.test(token)) {
    authorized = m.grantTokens.has(token) || (await grantInDb(m, token));
  }
  if (!authorized) throw new StoreError(403, 'not authorized to score this match');
  if (typeof event !== 'object' || event === null || typeof (event as { type?: unknown }).type !== 'string') {
    throw new StoreError(400, 'event must be an object with a type');
  }

  // Compute the new event log + state first; only commit to memory once the
  // DB write succeeds so cache and database never diverge.
  let newEvents: MatchEvent[];
  let newState: MatchState;
  let dbWrite: () => Promise<void>; // runs inside the per-match write chain
  if ((event as MatchEvent | UndoEvent).type === 'undo') {
    if (m.events.length === 0) throw new StoreError(400, 'nothing to undo');
    newEvents = m.events.slice(0, -1);
    try {
      newState = replay(m.config, newEvents);
    } catch (err) {
      throw new StoreError(500, `replay failed: ${(err as Error).message}`);
    }
    const seq = m.events.length; // 1-based seq of the popped (highest) event
    dbWrite = async () => {
      // Idempotent (deleteMany, not delete): if the popped event's own insert
      // had failed, the row is simply absent already — the desired end state
      // either way.
      await prisma().event.deleteMany({ where: { matchId: m.id, seq } });
      m._dbSeq = Math.min(m._dbSeq, seq - 1);
    };
  } else {
    // Server-authoritative timestamp; overrides anything the client sent.
    const stamped = { ...(event as MatchEvent), at: Date.now() };
    try {
      newState = applyEvent(m.state, stamped);
    } catch (err) {
      throw new StoreError(400, (err as Error).message);
    }
    newEvents = [...m.events, stamped];
    const seq = newEvents.length; // 1-based
    dbWrite = async () => {
      // Also re-insert any earlier acknowledged-in-memory events whose own
      // write failed while this request was already stacked on the chain
      // (the old whole-file rewrite healed such gaps implicitly; skipDuplicates
      // = ON CONFLICT DO NOTHING makes the retry idempotent).
      for (let s = m._dbSeq + 1; s <= seq; s++) {
        await prisma().event.createMany({
          data: [{ matchId: m.id, seq: s, event: newEvents[s - 1] as unknown as Prisma.InputJsonValue }],
          skipDuplicates: true,
        });
      }
      m._dbSeq = Math.max(m._dbSeq, seq);
    };
  }

  const prevEvents = m.events;
  const prevState = m.state;
  m.events = newEvents;
  m.state = newState;
  try {
    await enqueueWrite(m, dbWrite); // serialized per match; see enqueueWrite()
  } catch (err) {
    // Queue-aware rollback: only revert if no later request has committed on
    // top of this one (a blind rollback would silently discard
    // already-acknowledged events).
    if (m.events === newEvents) {
      m.events = prevEvents;
      m.state = prevState;
    }
    throw new StoreError(500, `failed to persist event: ${(err as Error).message}`);
  }

  notify(m.id);
  return publicState(m.state);
}
