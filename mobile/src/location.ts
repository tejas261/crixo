// Shared location plumbing for match creation — the create form
// (app/index.tsx) and the Rematch buttons both ride through here.

// expo-location is required lazily for the same reason as the ads module
// (see src/components/AdBanner.tsx): it's a native module that isn't inside
// dev builds made before it was added. Missing module → location features
// quietly report themselves unavailable instead of crashing the screen.
export type LocationModule = typeof import('expo-location');
let locationModule: LocationModule | null | undefined;
export function getLocationModule(): LocationModule | null {
  if (locationModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      locationModule = require('expo-location') as LocationModule;
    } catch {
      locationModule = null;
    }
  }
  return locationModule;
}

export type LocPerm =
  | 'unknown'      // still checking
  | 'undetermined' // never asked — show the soft-ask card
  | 'granted'
  | 'denied'
  | 'unavailable'; // native module missing (older dev build)

export type Coords = { lat: number; lng: number };

// Best-effort creation coordinates. If permission was never granted, ask
// right here — the moment of intent (a deliberate "Start scoring" or
// "Rematch" tap) — then take whatever position arrives quickly: coords
// already in hand, else the cached last-known position, else a fresh fix
// capped at ~4s. Denied, unavailable, or slow → create WITHOUT location.
// Never throws — location must not block or break match creation.
export async function creationLocation(opts: {
  coords?: Coords | null;                              // position already in hand
  granted?: boolean;                                   // permission known-granted (skip the request)
  onPermChange?: (perm: Exclude<LocPerm, 'unknown'>) => void;
} = {}): Promise<Coords | undefined> {
  const Location = getLocationModule();
  if (!Location) return undefined;
  try {
    if (!opts.granted) {
      // Safe even in the 'denied' state: the OS resolves it immediately
      // (granted: false) without re-prompting when it can't ask again.
      const perm = await Location.requestForegroundPermissionsAsync();
      opts.onPermChange?.(perm.granted ? 'granted' : perm.canAskAgain ? 'undetermined' : 'denied');
      if (!perm.granted) return undefined;
    }
    if (opts.coords) return opts.coords;
    const last = await Location.getLastKnownPositionAsync();
    if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), 4000); }),
    ]);
    if (pos) return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch { /* create without location */ }
  return undefined;
}
