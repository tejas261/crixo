# Crixo mobile

Native (Expo / React Native) client for the Crixo live cricket scoring
backend that lives at the root of this repo. Scoring console, coin toss,
live viewer and match summary — the same product as the web app, one thumb
friendly.

## Run it

1. **Start the backend** (repo root, not this folder):

   ```sh
   cd ..            # repo root
   npm run dev      # Next.js on http://localhost:3000
   ```

2. **Point the app at your Mac's LAN IP.** The default base URL is

   ```
   http://192.168.0.109:3000
   ```

   (`DEFAULT_BASE_URL` in `src/api.ts`). If your machine has a different
   address, either edit that constant or change it at runtime from
   **Settings** on the app's home screen (persisted on the device). Find
   your IP with `ipconfig getifaddr en0`. Phone and Mac must be on the
   same network; the backend listens on plain HTTP, which Expo Go allows.

3. **Start the app:**

   ```sh
   cd mobile
   npx expo start
   ```

   Scan the QR code with **Expo Go** (Android) or the Camera app (iOS).
   Most of the app (secure store, haptics, SVG, fonts) works inside Expo
   Go. Two features need native modules that Expo Go / older dev builds
   don't contain — the app degrades gracefully without them (see below):

   - **Ads** (`react-native-google-mobile-ads`): banners simply don't
     render.
   - **Nearby matches** (`expo-location`): the "Live nearby" panel says
     location support isn't in this build.

   To get both, make a **new development build** (`npx expo prebuild` /
   `eas build --profile development`). Any dev-client APK/IPA built before
   these modules were added lacks their native code — the JS lazy-requires
   both modules inside try/catch precisely so those older builds keep
   working ad-less instead of crashing.

## How scoring auth works on mobile

Cookies are unreliable in React Native, so the app skips the web's
session-cookie flow and uses the admin key directly:

- Creating a match stores the returned `adminKey` in the device keychain
  (expo-secure-store, key `crixo.<matchId>`).
- Every event POST sends `{event, adminKey}` in the body — the backend
  accepts this as the documented cookie fallback.
- To score a match created elsewhere, open its console and paste the key
  (shown on the creating device's console under "Scoring key"). The app
  verifies it against `POST /api/matches/:id/claim` (204 = valid) before
  storing it.

## Ads + ad-free

Creating, scoring, watching and sharing matches are all free. The app is
ad-supported instead: banner ads (Google AdMob via
`react-native-google-mobile-ads`) appear on the **home screen** (below the
create panel), the **live viewer** (below the score) and the **summary**
(top). Never on the umpire console — nothing may distract scoring.

- A banner renders only when `GET /api/ads/config` says `showAds` **and**
  `GET /api/me` says `adFree: false`. Ad-free accounts, a server-side kill
  switch, load failures, and builds without the native module all collapse
  to "no ad, no gap, no crash" (`src/components/AdBanner.tsx` lazy-requires
  the module in a try/catch and wraps the banner in an error boundary).
- **Test AdMob ids are wired in.** `app.json` carries Google's official
  *test* app ids (`ca-app-pub-3940256099942544~3347511713` Android,
  `…~1458002511` iOS) and `src/ads.ts` the official *test* banner unit ids
  (`…/6300978111` Android, `…/2934735716` iOS) — they always serve "Test
  Ad" creatives and earn nothing. When you create a real AdMob account,
  replace the app ids in `app.json` **and make a new dev/production build**
  (app ids are baked into the binary), then swap the unit ids in
  `src/ads.ts` (JS-only change).
- **New dev build required for real ads:** `react-native-google-mobile-ads`
  is a native module. A development client built before it was added will
  never show ads (by design, instead of crashing) — rebuild the dev client
  to see banners at all.
- **Remove ads** is a single one-time Razorpay purchase (the `adfree` pack
  from `GET /api/payments/config`, ₹199): the Remove ads sheet creates an
  order (`POST /api/payments/order`, tied to this device's bearer token) and
  opens the backend's hosted pay page (`/pay/<orderId>`) in a browser sheet
  (expo-web-browser). The page completes payment and marks the account
  ad-free server-side; when the sheet closes the app polls `GET /api/me` for
  ~10s until `adFree` flips and toasts "Ads removed". Purchasing requires
  being signed in — the sheet shows the sign-in step first if you aren't —
  and ad-free follows your Google account to any device.

## Accounts and sign-in

- On first need the app registers an anonymous device session
  (`POST /api/session/register`) and keeps the returned token in the device
  keychain (expo-secure-store, key `crixo.session`). Every API call — and the
  SSE stream — sends it as `Authorization: Bearer <token>`, so the backend
  knows whose matches and ad-free status to serve.
- **Sign in is Google, completed in the browser.** Tap the account row and
  "Continue with Google": the app mints a short-lived link code for its
  device session (`POST /api/auth/link-code`) and opens the backend's
  `/api/auth/google?link=<code>` page in a browser sheet. Google OAuth runs
  there, the backend attaches the identity to this device's session, and the
  page tells you to return to the app — where the app polls `GET /api/me`
  for ~15s until `signedIn` flips and toasts "Signed in".
- The header shows a quiet account row (your Google email or "Sign in",
  plus an "Ad-free" chip once purchased); the account sheet has the ad
  status row and the Remove ads button.

## Nearby matches (location)

The home screen has two lists from `GET /api/matches?lat=&lng=`:
**Your matches** (`mine` — everything this session created or scored) and
**Live nearby** (`nearby` — other people's live matches around you, each row
showing "~120m away" from `distanceM`; completed and own matches are
excluded server-side).

- Location is a **soft ask**: the "Live nearby" panel shows a small "Find
  matches near you" card, and the OS permission prompt only fires when you
  tap its button — never on launch. Denied? The panel explains how to
  re-enable in system Settings, with a Retry button.
- With permission granted the app fetches a foreground fix (expo-location,
  balanced accuracy) on each visit to the home screen and passes it to the
  list endpoint.
- **Creating a match attaches your coordinates when permission is already
  granted** (current coords or last-known position — creation is never
  blocked waiting on GPS, and never fails because of location). Matches
  created with location on are discoverable by people within **250m**, as
  the hint under the create button says.
- The iOS/Android permission strings live in `app.json` under the
  `expo-location` config plugin (`NSLocationWhenInUseUsageDescription` /
  `ACCESS_FINE_LOCATION` are generated from it at prebuild).

## Layout

```
app/                 expo-router screens
  index.tsx          home: create match, your/nearby lists, ad banner, settings
  toss/[id].tsx      coin toss (animated flip)
  umpire/[id].tsx    scoring console (pad + needs-driven sheets; NO ads)
  m/[id].tsx         live viewer (SSE) + ad banner below the score
  summary/[id].tsx   shareable scorecard + ad banner on top
src/
  api.ts             base URL + REST client + keychain key storage
  ads.ts             AdMob ids (Google TEST ids — replace with real ones)
  useMatch.ts        GET + SSE subscribe with backoff reconnect
  types.ts           domain types (copied from the backend's lib/engine.ts)
  theme.ts           design tokens (ported from app/globals.css)
  components/        ScorePlates, cards, sheets, AdBanner, avatars, logo, …
```

## Local Android builds (dev client)

`npx expo run:android` builds and installs the dev client over USB. Two pins matter:

- **JDK 17 required**: `export JAVA_HOME=$(/usr/libexec/java_home -v 17)` first — JDK 24+ breaks
  the CMake steps ("restricted method in java.lang.System has been called").
- **react-native-google-mobile-ads is pinned to exactly 16.3.0**: 16.4.0 pulls
  `play-services-ads:25.4.0`, which ships Kotlin 2.3 metadata that RN 0.86's Kotlin 2.1
  compiler cannot read (build fails in `:react-native-google-mobile-ads:compileDebugKotlin`).
  Do not bump until React Native's Kotlin is ≥ 2.2.

If banner test ads don't appear but logcat shows the SDK requesting them with
`ERR_CONNECTION_REFUSED`, the network is blocking ad servers (DNS ad-blocker) — try mobile data.

ANDROID_HOME is `~/Library/Android/sdk` (command-line tools install, licenses accepted).
