# Crixo 🏏

Ball-by-ball cricket scoring, live for everyone. Create a match, flip the toss,
score from your phone; friends watch live from a link or discover matches
happening within 500m of them.

**Live**: https://crixo.duckdns.org · Android APK built from `mobile/`

## Stack

- **Web + API**: Next.js 15 (App Router, strict TypeScript), Server-Sent Events
  for live scores, Prisma → hosted Postgres. Single-process design (in-memory
  match cache + SSE fan-out) — run exactly one instance.
- **Mobile**: Expo SDK 57 / React Native (`mobile/`), same backend. Auth via a
  bearer session token in the device keychain; Google sign-in through a
  browser device-link flow (no native Google SDK).
- **Engine**: `lib/engine.ts` — pure, event-sourced scoring (undo = pop the
  event log and replay). The rules and API contract live in `SPEC.md`.

## Develop

```bash
npm install && npm run dev        # web + API on :3000 (needs .env)
npm test                          # engine tests (needs Node ≥ 20.1; `nvm use 25`)

cd mobile && npm install
npx expo run:android              # dev build to a USB device (JDK 17 — see mobile/README.md)
```

`.env` (never committed) needs: `DB_URL` (Postgres), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `RZP_KEY_ID`, `RZP_KEY_SECRET`,
`MONETIZATION_ENABLED` (master switch for ads + purchases; currently `false`).

## Deploy (Oracle Always Free VM + Caddy + DuckDNS)

```bash
rsync -az --exclude node_modules --exclude .next --exclude mobile \
  --exclude data --exclude "*.log" --exclude .claude \
  ./ ubuntu@<vm-ip>:/home/ubuntu/crixo/
ssh ubuntu@<vm-ip> 'cd crixo && npm ci && npx next build && sudo systemctl restart crixo'
```

The VM runs `crixo.service` (systemd) behind Caddy (auto-HTTPS for
`crixo.duckdns.org`). Server env lives in `/home/ubuntu/crixo/.env`.

## Release APK

```bash
cd mobile/android
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew :app:assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

⚠️ Signing uses `mobile/crixo-release.keystore` (git-ignored). **Back it up** —
updates must be signed with the same key or installed apps can't upgrade.

## Analytics (GTM)

First-party, in our own Postgres — free, and works identically on web and in
the APK. Clients fire-and-forget to `POST /api/track` (anonymous ids: hashed
session cookie on web, a keychain-minted device id on mobile; no PII, no raw
IPs). Captured: pageviews/screens with UTM params + referrers + viewport,
`app_open` (app version/OS), `match_created` (overs/players/boom/toss/
location), `share`, `rematch`. Scoring depth (balls, boom overs, squad
changes, corrections) is NOT double-tracked — the summary endpoint computes
it from the event-sourced `events` table.

- **Dashboard**: `/growth` — paste `ANALYTICS_KEY` (server `.env`), pick a
  window. Funnel (created → tossed → scored → 12+ balls), feature usage,
  daily devices/views, platform split, top screens, referrers, UTM sources.
  API: `GET /api/analytics/summary?days=30` with `x-analytics-key`.
- **Free external tools** (web, env-gated — inert until a key is set):
  - `NEXT_PUBLIC_GA_ID` → Google Analytics 4 (acquisition/geo/demographics).
  - `NEXT_PUBLIC_POSTHOG_KEY` (+ optional `NEXT_PUBLIC_POSTHOG_HOST`) →
    PostHog Cloud free tier (funnels, retention, session replay).
  Set either in `.env`, rebuild, done — no code changes.

## Docs

`SPEC.md` is the living contract: scoring rules, API shapes, and a v1→v13
changelog of every architectural turn this project has taken.
