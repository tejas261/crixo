// First-party analytics (v16) — mobile twin of web lib/analytics.ts.
//
// Events post to the backend's /api/track collector, fire-and-forget:
// telemetry must never block a tap or surface an error. Identity is an
// anonymous random device id minted once into the keychain (no PII —
// deliberately NOT tied to the account or any match admin key).

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getBaseUrl } from './api';

const DEVICE_KEY = 'crixo.analytics.device';

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
