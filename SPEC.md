# Crixo — Live Cricket Scoring App

> v10: **React Native app** in `mobile/` (Expo SDK 57, TypeScript, expo-router) — a native client for this same backend (REST + SSE; base URL configurable in-app, default the Mac's LAN IP). Mobile auth uses the admin key in the device keychain (expo-secure-store, key `crixo.<matchId>`) sent per event, with the /claim flow for handoff — no cookies on mobile. All five screens (home/create, toss with animated coin, umpire console, live viewer, summary), engine types copied to `mobile/src/types.ts` (keep in sync when the engine's public shape changes), generated app icons from the logo. Run: `cd mobile && npx expo start` with the web server running at the repo root. 
> v11: **credits + accounts + payments.** Every session (web cookie or mobile bearer token via POST /api/session/register) lazily gets an account with a +5 signup grant (degraded to +1 when >3 accounts/day from one IP). Match creation spends 1 credit atomically (serializable TX with the match insert; 402 'out of credits'); matches completed with <6 legal balls auto-refund once. Append-only `credit_ledger` (unique idempotencyKey) is the only source of balance. Sign-in: Google OAuth only (/api/auth/google; phone OTP removed); identities are unique, linking an existing identity repoints the session (credits follow identity; scoring grants stay with the token). Device-link flow for the mobile app: POST /api/auth/link-code (bearer session) mints a single-use 24-hex code (10-min expiry, max 5 pending per account), and the app opens /api/auth/google?link=<code> in a browser — the code rides inside the OAuth state cookie, and the callback burns it, links the Google identity to the code's account (repointing its sessions, bearer token included, if the identity already lives elsewhere), and lands on /linked. Purchases require sign-in: Razorpay order → checkout.js → HMAC-verified /api/payments/confirm credits the ledger idempotently to `order.accountId` (no session needed: the signature proves the payment, the order row says whose credits they are; already-paid orders are refused, unknown 404). Hosted pay page `/pay/[orderId]` (public order info via GET /api/payments/orders/[id]: pack/amount/status/keyId, no account fields) lets the mobile app buy via a browser sheet without native SDKs — store IAP only if store distribution ever happens. /api/payments/webhook dormant until RZP_WEBHOOK_SECRET is set. Packs in lib/payments.ts; checkout.js loader shared in lib/razorpay-client.ts. Env: RZP_KEY_ID/RZP_KEY_SECRET, GOOGLE_CLIENT_ID/SECRET (Google console must whitelist `<origin>/api/auth/google/callback`).
> v12: **ads model + location discovery — credits RETIRED.** Match creation is free and unlimited (the v11 spend/402/refund flow is gone); free accounts see ads, and the single one-time product `adfree` (₹199, lib/payments.ts PACKS — `credits: 0`, but the `packs` field name and order/pay-page shapes are unchanged so /pay keeps working) sets `Account.adFree`; /api/payments/confirm and the webhook flip it idempotently via a delta-0 `credit_ledger` audit row (reason `adfree_purchase`, key `rzp:<payment_id>`). The `credit_ledger`/`accounts` tables are RETAINED as audit trail (signup grants still write rows; balances gate nothing). `GET /api/ads/config` → `{showAds}` (false only for ad-free accounts; read-only, force-dynamic); `/api/me` → `{signedIn, email, adFree}` (no credits). Matches may carry optional creation coordinates (`POST /api/matches` body `location:{lat,lng}`, validated −90..90/−180..180, stored as `Match.lat/lng` — never exposed raw). `GET /api/matches` now returns `{mine, nearby}` (BREAKING): `mine` = the caller's account's matches (any status, newest first, cap 20; [] when no account), `nearby` = with `?lat=&lng=`, non-completed matches with coordinates within `VICINITY_M` (500 m — widened from the original 250 m; lib/geo.ts haversine) of the point, excluding the caller's own, newest first, cap 20, each with rounded `distanceM`. Home-page lists double as the umpire console's re-entry point: "Your matches" rows with status ≠ completed link to `/umpire/<id>` ("Score ›" affordance; web relies on the session grant via /role, mobile on the keychain adminKey with the paste-key fallback), completed rows to `/summary/<id>`, and `nearby` rows always to the viewer `/m/<id>`.
> v16: **first-party analytics.** New table `analytics_events` (Prisma `AnalyticsEvent`; append-only, no PII/raw IPs) + `POST /api/track` (batch ≤ 20, capped names/props; ALWAYS 204 — telemetry never breaks clients; web identity = SHA-256 of the session cookie, mobile sends a keychain device id) + `GET /api/analytics/summary` (gated by env `ANALYTICS_KEY`: 503 unset, 403 mismatch; traffic rollups from analytics_events joined with product funnel/feature depth computed from the existing `matches`/`events` tables). Web: `lib/analytics.ts` `track()` (sendBeacon→keepalive fetch; `/x/:id` path collapsing) + `components/AnalyticsListener.tsx` in the root layout (pageviews with landing UTM capture; env-gated GA4 `NEXT_PUBLIC_GA_ID` and PostHog `NEXT_PUBLIC_POSTHOG_KEY`/`_HOST` loaders, inert without keys) + `/growth` internal dashboard page. Mobile: `src/analytics.ts` twin (screen views + `app_open` in the root layout, same collapsing). Tracked app events: `pageview`/`screen`, `app_open`, `match_created`, `share`, `rematch` — scoring depth is deliberately NOT re-tracked (it lives in `events`). Also: the WEB rematch now carries `boomBoom` forward (mobile already did).

> v15: **scoring corrections + mid-match common player** (engine; mobile types re-synced). Three new events, all undoable via replay:
> - `{type:'swap_strike'}` — swaps striker/non-striker. Valid while live with BOTH batsmen at the crease (including between overs — it's a scorer correction, not a cricket action); rejected while a replacement batsman is owed.
> - `{type:'change_bowler', playerIndex}` — replaces the selected bowler for the over about to start. Valid only while live, a bowler is selected, and NO delivery (legal or illegal) has been bowled in the over (same boundary rule as `boom_over`). Eligibility mirrors `select_bowler` (not removed, not last over's bowler, not already selected). If the outgoing bowler's `bowlers[]` entry was created by the mis-selection (all-zero — necessarily the LAST entry), it is dropped so scorecards never show a phantom 0-ball spell; a bowler with an earlier spell keeps their row.
> - `{type:'add_common_player', name}` — mid-match version of `config.commonPlayer` (setup/live/innings_break). Only when no common player exists yet; the name is validated against BOTH teams under `add_player`'s rules (trim/collapse, active-name clash, 11-active cap per side), then pushed at the end of BOTH rosters and recorded in `config.commonPlayer`. From then on they are the ordinary common player: one independent index per team, removable per side via `remove_player`.
> - UI (web + mobile consoles): "Swap strike" under the batsmen cards; "Change bowler" beside the bowler card at over boundaries (`legalBalls % 6 === 0` heuristic, server authoritative) opening a picker that excludes the current and last-over bowlers; the Squads sheet gains an "Add common player" row when none exists.

> v14: **mid-match squad changes + boom-boom over** (engine `lib/engine.ts`; mobile `mobile/src/types.ts` must be re-synced).
> **Squad changes.** Two new events, valid in `setup`/`live`/`innings_break` (never `completed`), both undoable via replay like everything else:
> - `{type:'add_player', teamIndex:0|1, name}` — name is trimmed and internal whitespace collapsed; rejected if it case-insensitively matches an ACTIVE (non-removed) player of that team (a removed player's name MAY be re-added as a new index), or if the team already has 11 active players. The player is PUSHED at the end of `config.teams[t].players` — existing player indexes never shift — and is immediately selectable.
> - `{type:'remove_player', teamIndex:0|1, playerIndex}` — soft delete: the index is appended to the new top-level `publicState.removed: [number[], number[]]` and the name stays in `config` so historical scorecard rows keep resolving. Rejected when: index invalid; already removed; the team would drop below 2 active players; (live, their team batting) the player has a batsmen entry in the CURRENT innings — out or at the crease — until that innings ends; (live, their team bowling) the player is the current bowler — this covers mid-over AND just-selected-before-the-first-ball, so `currentBowlerIndex` can never reference a removed player (undo the selection instead). Removed players are rejected by `select_batsman`/`select_bowler` with `'player is no longer available'`.
> - **All-out is now active-count based**: `activeCount = players.length − removed[t].length`. A dismissal ends the innings when NO eligible next batsman exists (eligible = not removed and no batsmen entry this innings); removing the last eligible batsman while a replacement is owed closes the innings the same way. Chase result text uses `activeCount − 1 − wickets` wickets in hand (consistent because batsmen of the live innings can't be removed). Common player: just another index per team, no special casing.
> **Boom-boom over.** `config.boomBoom?: boolean` gates the rule (create body accepts optional `boomBoom`; absent = false). `{type:'boom_over', enabled:boolean}` arms/disarms the over about to start: only when live and NO delivery (legal or illegal) has been bowled in the current over; arming when armed / disarming when not are rejected. While armed, every delivery's TEAM-run contributions are DOUBLED — bat runs (batsman credited double too), wide/no-ball penalty + extra runs, byes/legbyes, extras tallies, bowler conceded — but `fours`/`sixes` count the RAW boundary, strike rotation uses the RAW runs, and legal-ball counting / maiden logic (doubled conceded > 0 breaks it) / wicket credit are unchanged. ANY wicket while armed (run_out included): `innings.runs −= 5` and per-innings `penaltyRuns += 5`; the FoW entry records the post-penalty score; the innings total MAY go negative. Clients reconcile with `sum(batsmen.runs) + extras.total − penaltyRuns === runs`. Timeline entries born in an armed over carry `boom: true`. When the over completes it auto-disarms and its 0-based index is appended to per-innings `boomOvers: number[]`; per-innings `boomActive: boolean` is true while armed (an innings that closes mid-boom-over clears `boomActive` and does NOT record the partial over). Target math is generic: innings-1 total ≤ 0 still gives `target = runs + 1` (≤ 0), so the chase can complete on its first delivery. New public per-innings fields: `boomActive`, `boomOvers`, `penaltyRuns`; new top-level `removed`.

> v13: **monetization kill switch.** Env `MONETIZATION_ENABLED` (on unless exactly `'false'` — missing/other values = on, backwards compatible; helper `monetizationEnabled()` in lib/monetization.ts) turns off ads AND ad-free purchases everywhere: `GET /api/ads/config` now returns `{showAds, purchases}` (both false when off; otherwise `purchases:true`, `showAds` = not ad-free as before) and `POST /api/payments/order` returns 503 `{error:'purchases are disabled'}` before any Razorpay call — /confirm, the webhook, /pay/[orderId] and orders/[id] stay functional so in-flight orders still credit. Web (useAds) and mobile (getAdsConfig) clients follow the flags: ad slots/banners key off `showAds`, and every purchase entry point (header "Remove ads", account-sheet ads row + button, mobile "Ad-free" chip, remove-ads sheets) renders only when `purchases` (fetch failure = both off).

> v9: renamed **Howzat → Crixo** — new logo (two crossed cricket bats + leather ball on the gradient roundel; `CrixoMark` in `components/Logo.tsx` + `app/icon.svg`), and the session cookie is now `crixo_session` (reads fall back to the old `howzat_session` and re-set the same token under the new name, so existing grants keep working).

> v8: **toss page** at `/toss/:id` — pick the calling side and their call, animated 3D coin flip (heads = the Howzat finger; reduced-motion gets an instant reveal), winner elects bat/bowl. Recorded as a `toss` event (engine: setup-only, once, consistency-validated; sets `battingFirstIndex`; undoable via replay; `publicState.toss`). Create form's "who bats first" has a third option "Toss decides" → routes to the toss page; the console offers "Hold the toss" during setup; "X won the toss and chose to bat/bowl first" shows on console, live view, and summary. Home page match list split: "Live now" (non-completed; hidden when empty unless there are no matches at all) and "Recent matches" (completed → link to summary; hidden when empty).

> v7: **no client-side storage** — localStorage is gone. Scoring auth is DB-backed: an httpOnly session cookie (`howzat_session`, minted server-side) + Postgres `admin_grants(token, match_id)` rows. Creating a match grants the creator's session automatically; `POST /api/matches/:id/claim {adminKey}` grants another device (the admin key is now only this one-time handoff credential, shown to granted sessions via `GET /api/matches/:id/role → {canScore, adminKey}`); the events endpoint authorizes by cookie grant (in-memory token cache per match, DB fallback) or by adminKey in the body (fallback when cookies are blocked, and for curl/API use).

> v6: renamed **Umpire → Howzat**. Logo = the umpire's raised finger (the answer to the appeal) on the gradient badge — `components/Logo.tsx` (HowzatMark + Wordmark) and `app/icon.svg` favicon. localStorage admin-key namespace is now `howzat:<id>` (reads fall back to the old `umpire:<id>`). URL paths (`/umpire/:id`) are unchanged — that's the role, not the brand. New feature: **common player** (gully-cricket odd-headcount rule) — `config.commonPlayer` names one player who appears in BOTH teams' player lists (engine validates), plays as a full member of each side, and gets a "both sides" badge in rosters, cards, and the summary scorecard; the create form has a dedicated optional field for them.

This file is the contract between the engine, data layer, and UI. Follow it exactly; where it is silent, choose sensibly and note it in code comments only if a constraint isn't obvious.

> v2: ported from Express + vanilla JS to Next.js 15 (App Router, JavaScript, React 19). Realtime moved from WebSocket to Server-Sent Events so `next start` needs no custom server. The engine, scoring rules, and REST API shapes are unchanged from v1.
>
> Deployment assumption: ONE server process at a time. The store keeps a per-process in-memory cache + SSE fan-out on top of Postgres; two processes sharing the DB will serve stale state to each other's clients. Restart the server to re-sync the cache with the DB after any out-of-band DB change.
>
> v5: full **TypeScript** (strict; engine exports the domain types — `PublicState`, `MatchEvent`, etc. — consumed everywhere) and **Prisma** (`prisma/schema.prisma`, hosted Prisma Postgres via `env("DB_URL")` in `.env` — secret, never commit). Tests run via `tsx --test` and REQUIRE Node ≥ 20.1 (20.0.0 has a fatal loader bug; use `nvm use 25`). Home page gained an interactive roster builder (add-on-Enter chips with avatars, drag/arrow-key reordering = batting order, duplicate guard, 2–11 count, validity-gated submit).
>
> v3: persistence moved from JSON files to **Postgres** (`DATABASE_URL`, default `postgres://localhost:5432/umpire`; tables `matches` + `events`, event-sourced, undo = delete highest seq). Events are stamped `at` (epoch ms) on acceptance; the engine derives `startedAt`, `endedAt`, and `inningsBreak {startedAt, endedAt, durationMs}` in publicState — a live break timer renders during `innings_break` (umpire + viewer) and the duration appears in the summary. Display face: Space Grotesk (Anton retired); body Instrument Sans; data Spline Sans Mono.
>
> v4 design system (current; the v1 palette below and v3's dark iris/rose are both OBSOLETE): LIGHT warm theme — base `--bg #FFF9F0` with a soft white→peach→butter page wash, white panels + warm borders `#F0E2CC` + soft warm shadows, text `#3A2E1E`, muted `#7E6A4E`. Hues: apricot (`#FFA94D`, deep `#E8590C`, text-ink `#C2410C`) + butter (`#FFD43B`, pale `#FFF3BF`). Signature gradient `linear-gradient(135deg, #FFB86B, #FFE08A)` (dark ink text on it) for primary actions, LIVE, on-strike, 6-badge, break timer; gradient-clipped TEXT uses the deep run `#C2410C→#A87700`. Danger/wicket `#C63D08` solid. Score plates: cream tiles, dark digits. Avatars: batters hue 28, bowlers hue 45, dark-ink figures.

## Stack & file layout

- Node 20, ESM. Deps: `next@15`, `react`, `react-dom`. Engine tests: built-in `node:test` (`npm test` → `node --test test/`).
- `npm run dev` / `npm run build && npm start` (port via `PORT`, default 3000).

```
package.json  next.config.mjs  jsconfig.json ("@/*" → repo root)
lib/engine.js           — pure scoring engine (no I/O) — UNCHANGED from v1
lib/store.js            — persistence (data/*.json), match cache, SSE fan-out; singletons on globalThis (HMR-safe)
lib/format.js           — pure formatters (overs, SR, econ, score string)
lib/useMatch.js         — client hook: GET state + EventSource subscribe
lib/share.js            — share/copy with clipboard fallbacks
test/engine.test.js  test/engine.adversarial.test.js
app/
  layout.js             — next/font (Anton, Instrument Sans, Spline Sans Mono), globals.css, toast region
  globals.css           — full design system (tokens below)
  page.js               — home: create match + live/recent match list
  umpire/[id]/page.js   — umpire console
  m/[id]/page.js        — live viewer
  summary/[id]/page.js  — match summary / scorecard (shareable)
  api/matches/route.js              — GET list, POST create
  api/matches/[id]/route.js         — GET publicState
  api/matches/[id]/events/route.js  — POST {adminKey, event}
  api/matches/[id]/stream/route.js  — GET SSE (each frame = bare publicState JSON; heartbeat comments)
components/             — Avatar, ScorePlates, BatterCard, BowlerCard, OverStrip, Timeline, Sheet, Toasts, StatusChip
```

## Engine (lib/engine.js) — event-sourced, pure

Exports:

```js
initState(config)              // -> State (status 'setup')
applyEvent(state, event)       // -> new State; throws Error(message) on invalid event
replay(config, events)         // -> State (initState + fold applyEvent)
publicState(state)             // -> JSON view for clients (adds derived fields, `needs`)
```

`applyEvent` must not mutate its input (return a new state; structuredClone is fine).

### Config

```js
{
  teams: [ {name, players: [string, ...]}, {name, players: [...]} ],  // 2–11 players each
  oversPerInnings: int >= 1,
  battingFirstIndex: 0 | 1
}
```

### Events (the only inputs)

```js
{type:'start_innings'}                       // setup -> innings 1; innings_break -> innings 2
{type:'select_batsman', playerIndex}         // opener or replacement after wicket
{type:'select_bowler', playerIndex}          // opening bowler or new over
{type:'ball', extra:'none'|'wide'|'noball'|'bye'|'legbye', runs:0..6,
  wicket: null | {kind:'bowled'|'caught'|'lbw'|'stumped'|'run_out'|'hit_wicket',
                  outEnd:'striker'|'non_striker',   // run_out only; others always striker
                  fielder: string|null}}
{type:'end_innings'}                         // manual close (declaration/abandon of innings)
{type:'end_match'}                           // abandon; still produces summary/result text
{type:'undo'}                                // server implements by popping event log + replay;
                                             // engine may throw 'nothing to undo' if it receives it
```

Validation: reject `ball` while `needs.newBatsman`/`needs.newBowler`/wrong status; reject `select_bowler` equal to previous over's bowler; reject selecting an out or already-batting batsman; reject bowled/caught/lbw/hit_wicket on a wide (only run_out and stumped are legal on a wide; on a noball only run_out).

### Scoring rules (runs = the number the umpire keyed in)

| extra   | team runs | batsman           | bowler conceded | legal ball | counts as ball faced |
|---------|-----------|-------------------|-----------------|------------|----------------------|
| none    | runs      | +runs, 4s/6s tally| +runs           | yes        | yes                  |
| wide    | 1 + runs  | —                 | 1 + runs        | no         | no                   |
| noball  | 1 + runs  | +runs (off bat)   | 1 + runs        | no         | yes                  |
| bye     | runs      | —                 | —               | yes        | yes                  |
| legbye  | runs      | —                 | —               | yes        | yes                  |

- Extras tally: `{wides, noballs, byes, legbyes, total}` (wide/noball entries include the +1).
- **Strike**: swap when `runs` is odd. At the end of an over (6 legal balls) swap again. Both can apply on the same delivery.
- **Over end**: after 6th legal ball → `needs.newBowler = true`, previous bowler ineligible for next over, strike swaps. Maiden = over where the bowler conceded 0 (byes/legbyes don't break a maiden; any wide/noball does).
- **Wicket**: credited to bowler except `run_out`. Runs on the delivery still count per table (e.g. run_out attempting the 2nd run: `runs:1`). The out batsman is replaced at the end given by `outEnd` (striker for all non-run-out kinds); `needs.newBatsman = true` until `select_batsman`. New batsman takes the vacated end; if the wicket fell on the over's last legal ball, apply the over-end strike swap after the replacement is resolved.
- **Innings ends** automatically when wickets = batting side players − 1, overs are done, or (2nd innings) the target is passed. Then `status:'innings_break'` (after 1st) or `'completed'` (after 2nd) with `result`.
- Target for innings 2 = innings 1 runs + 1.
- Result text: chasing side wins → `"<Team> won by <10−wickets... use (players−1−wickets)> wickets (<balls remaining> balls left)"`; defending side → `"<Team> won by <margin> runs"`; equal at close → `"Match tied"`. `end_match` mid-play → same logic if innings 2 reached, else `"Match abandoned"`.
- Out of scope (do NOT implement): free hits, penalty runs, retired hurt, batsmen crossing on a catch, DLS, super overs.

### State / publicState shape (what clients receive)

```js
{
  status: 'setup'|'live'|'innings_break'|'completed',
  config: {...as above},
  currentInningsIndex: 0|1|null,
  result: null | {winnerIndex: 0|1|null, text},
  needs: {openers:bool, newBatsman:bool, newBowler:bool, startInnings:bool},
  innings: [{
    battingTeamIndex, runs, wickets, legalBalls,           // overs display = "12.4"
    target: null|int,
    batsmen: [{playerIndex, name, runs, balls, fours, sixes,
               out: null | {kind, fielder, bowler, text}}], // batting order
    strikerIndex, nonStrikerIndex,                          // index into batsmen[], null if pending
    bowlers: [{playerIndex, name, balls, maidens, runs, wickets}],
    currentBowlerIndex: int|null,
    extras: {wides, noballs, byes, legbyes, total},
    fallOfWickets: [{score, wicket, batsmanName, over: "4.3"}],
    timeline: [{over:"4.3", badge:"1"|"4"|"6"|"W"|"wd"|"nb"|"b1"|"lb2"|"wd+2"|"·",
                text:"human description"}],                 // full innings, newest last
    // derived (publicState): oversDisplay, crr, and for 2nd innings: rrr, ballsRemaining, runsNeeded
  }]
}
```

Dismissal `text` like a scorecard: `"b Kumar"`, `"c Sharma b Kumar"`, `"run out (Sharma)"`, `"st Sharma b Kumar"`, `"lbw b Kumar"`, `"hit wicket b Kumar"`.

## Data layer & API (lib/store.js + app/api/**) — v1 text below; still binding except: WebSocket is replaced by `GET /api/matches/:id/stream` (SSE, first frame immediately, bare publicState per frame), and page routes are Next.js pages, not static HTML.

- Storage: `data/<matchId>.json` = `{id, adminKey, config, events, createdAt}`. Create `data/` on boot. In-memory cache of derived states; rebuild by `replay` on load. Write file after each accepted event (fire-and-forget is NOT ok — await, and surface write errors as 500s).
- `matchId`: 8-char base36 from crypto; `adminKey`: 24-char hex from crypto. adminKey never appears in publicState or WS payloads.
- REST (JSON; errors as `{error: message}` with 400/403/404):
  - `POST /api/matches` `{teams, oversPerInnings, battingFirstIndex}` → `{id, adminKey}` (validate: names non-empty, 2–11 players/team, 1–50 overs)
  - `GET /api/matches` → `[{id, status, teams:[names], score:"87/3 (9.2)", result?}]` newest first, cap 20
  - `GET /api/matches/:id` → publicState (+`{id}`)
  - `POST /api/matches/:id/events` `{adminKey, event}` → publicState on success; engine validation errors → 400 with the engine's message; bad key → 403. `{type:'undo'}` pops the event log (400 if empty) and replays.
- WS at `/ws?match=<id>`: on connect send `{type:'state', state}`; broadcast same to that match's sockets after every accepted event. Heartbeat ping every 30s, drop dead sockets.
- Pages: `/` → index.html, `/umpire/:id` → umpire.html, `/m/:id` → live.html, `/summary/:id` → summary.html (client JS reads the id from the path). Static under `/css /js`.

## UI — design system & pages

**Palette** (CSS custom props in `:root`): `--field:#0E2A1F` (page bg, deep outfield green), `--panel:#16382B`, `--panel-2:#1C4636`, `--line:#2A5240`, `--flannel:#F1E9D7` (primary text), `--muted:#9DB4A5`, `--leather:#B23A2E` (wickets/danger/live-dot), `--brass:#D9A441` (on-strike, accents, focus rings), `--sight:#FFFFFF` (sparingly). Rounded 10–14px panels, 1px `--line` borders, no drop-shadow soup.

**Type** (Google Fonts): `Anton` — display + big score numerals only; `Instrument Sans` — body/UI; `Spline Sans Mono` — over log, stats tables, badges. Tabular feel for all numbers.

**Signature element**: the score block styled as physical scoreboard plates — each digit of `runs/wickets` and the overs counter sits on its own dark plate tile (`--panel-2`, inner 1px line, Anton, cream). When a value changes, the incoming digit rolls in (CSS transform translateY + opacity, ~250ms). Respect `prefers-reduced-motion` (no roll, instant swap).

**Avatars** (`js/common.js`, inline SVG, no images): circle with initials + a role glyph — batsman: simple helmet-with-grille silhouette arc over the circle top; bowler: flat cap brim. Background hue = hash(name) → HSL with fixed 35% saturation / 28% lightness so they harmonise. ~40px in cards, ~28px in tables.

**On-strike indication**: striker card gets a brass left border + small brass bat glyph (SVG) beside the name + a slow 2s pulse on the glyph; non-striker dimmed to 75%.

Quality floor: responsive to 360px, visible `:focus-visible` (brass ring), `prefers-reduced-motion` respected, sentence-case labels, empty/error states with guidance (never blank). All pages share the header: wordmark "Umpire" (Anton, small) + match teams.

### Pages

1. **index.html** — hero: wordmark + one line "Ball-by-ball scoring for your match, live for everyone." Create-match card: team A/B name inputs, players textarea (one per line) each, overs number, "who bats first" toggle, big "Start scoring" → POST, then redirect to `/umpire/:id` and store adminKey in `localStorage['umpire:<id>']`. Below: "Live now" list from GET /api/matches (status chip, score, link to `/m/:id`).
2. **umpire.html** — the console (must be one-thumb usable on a phone):
   - Score header (signature plates) + innings/target line.
   - Batsmen cards (striker treatment above) with live R(B), 4s/6s; bowler card with O-M-R-W.
   - Ball pad: run buttons 0 1 2 3 4 6 (large, 4 and 6 visually distinct), extras row as toggle chips (wide / no-ball / bye / leg-bye — one at a time), "Wicket" (leather red) opens a sheet: kind picker, runs completed (for run outs), who's out (run out only), fielder name (optional), then confirm; the pad composes ONE `ball` event.
   - "Undo last ball" always visible. Current over strip (badges). 
   - Modals/sheets driven by `needs`: pick openers (two batsmen + bowler), new batsman, new bowler (previous over's bowler disabled with a note), start 2nd innings, end-of-match → link to summary + "Share summary".
   - adminKey from localStorage; if missing, show a paste-key prompt (read-only otherwise).
3. **live.html** — viewer: signature score plates BIG, LIVE dot (leather, pulsing) when status live; batsmen + bowler cards (same components), this-over strip, CRR (+ RRR/needed for chase), collapsible full timeline, fall of wickets, extras line. WS updates with auto-reconnect (1s→5s backoff) + "reconnecting…" pill. On `completed`, banner with result + button to `/summary/:id`.
4. **summary.html** — shareable scorecard: result banner (winner in brass), per-innings batting table (R B 4s 6s SR, dismissal text, striker rows none — match over), bowling table (O M R W Econ), extras + total, fall of wickets, "Player highlights" row: top scorer & best bowler cards with avatars. "Copy link" button (navigator.share if available, else clipboard + "Copied" toast). Works for abandoned matches too (shows whatever exists).

## Definition of done

`npm install && npm test` green; `npm start` boots; a full 2-innings match can be scored via the umpire console with wickets, all four extras, undo, bowler changes; live view updates in real time in a second browser; summary link shows the full scorecard.
