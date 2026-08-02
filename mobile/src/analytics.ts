// First-party analytics (v16) — mobile twin of web lib/analytics.ts.
//
// Events post to the backend's /api/track collector, fire-and-forget:
// telemetry must never block a tap or surface an error. Identity is an
// anonymous random device id minted once into the keychain (no PII —
// deliberately NOT tied to the account or any match admin key).
//
// v16.1: every event is ALSO dual-written to PostHog Cloud (free tier,
// same project as the web) for funnels/retention on mobile. PostHog RN is
// pure JS over native modules the Expo core already ships (file-system
// storage), so it is safe to deliver via OTA to existing APKs; every call
// is guarded — analytics never takes the app down.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import PostHog from 'posthog-react-native';
import { getBaseUrl } from './api';

const DEVICE_KEY = 'crixo.analytics.device';

// Public client-side key (same class of secret as the web's
// NEXT_PUBLIC_POSTHOG_KEY — it can only ingest, never read).
const POSTHOG_KEY = 'phc_uN4ywvezpRWksTPNRLduKQS6Gf5pdmQU4umNc5R295pv';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let posthogClient: PostHog | null = null;
let posthogFailed = false;

function getPostHog(): PostHog | null {
  if (posthogClient || posthogFailed) return posthogClient;
  try {
    posthogClient = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // 'Application Opened' / 'Backgrounded' / 'Updated' for free.
      captureAppLifecycleEvents: true,
    });
  } catch {
    posthogFailed = true; // storage/native hiccup — first-party still runs
  }
  return posthogClient;
}

let cachedDeviceId: string | null = null;

async function deviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    let id = await SecureStore.getItemAsync(DEVICE_KEY);
    if (!id) {
      id = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      await SecureStore.setItemAsync(DEVICE_KEY, id);
    }
    cachedDeviceId = id;
    return id;
  } catch {
    // Keychain unavailable (rare) — session-scoped id beats losing the event.
    cachedDeviceId = Crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return cachedDeviceId;
  }
}

/** Fire-and-forget track. `path` groups like web paths ('/umpire/:id'). */
export function track(name: string, props?: Record<string, unknown>, path?: string): void {
  // Dual-write to PostHog (screens use its native $screen event so the
  // mobile analytics views light up).
  try {
    const ph = getPostHog();
    if (ph) {
      // Our props are always JSON-safe (numbers/strings/booleans); PostHog's
      // JsonType index signature just can't see that through `unknown`.
      const phProps = (path ? { ...props, path } : props) as
        Record<string, string | number | boolean> | undefined;
      if (name === 'screen') ph.screen(path ?? 'unknown', phProps);
      else ph.capture(name, phProps);
    }
  } catch { /* never let telemetry throw into the app */ }
  void (async () => {
    try {
      const id = await deviceId();
      await fetch(`${getBaseUrl()}/api/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
          deviceId: id,
          events: [{ name, props, path }],
        }),
      });
    } catch { /* offline / server down — drop silently */ }
  })();
}

/** One per cold start: version + OS for platform/version splits. */
export function trackAppOpen(): void {
  track('app_open', {
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    os: Platform.OS,
    osVersion: String(Platform.Version),
  });
}
