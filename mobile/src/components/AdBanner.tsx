// Ad banner — the ONLY place react-native-google-mobile-ads is touched.
//
// Gating: a banner renders only when the backend's /api/ads/config says
// showAds AND the account isn't ad-free (me.adFree === false). Screens that
// already hold `me` pass adFree down so a purchase hides banners instantly;
// otherwise the component fetches /api/me itself.
//
// GRACEFUL DEGRADE (required): react-native-google-mobile-ads is a NATIVE
// module. A dev client built before it was added doesn't contain the native
// code, so a top-level `import` would crash every screen that renders a
// banner. Instead the module is lazy-require()d inside a try/catch on first
// render — if the native module is missing (current dev build, Expo Go),
// the require throws, we remember that, and the banner renders nothing.
// Ads must never break a screen: load failures (onAdFailedToLoad) and any
// render-time throw (error boundary below) also collapse to null.

import { Component, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { getAdsConfig, getMe } from '../api';
import { BANNER_AD_UNIT_ID } from '../ads';

// ---------- lazy native-module loader ----------

type AdsModule = typeof import('react-native-google-mobile-ads');

let adsModule: AdsModule | null = null;
let adsModuleBroken = false;
let sdkInitialized = false;

function loadAdsModule(): AdsModule | null {
  if (adsModule) return adsModule;
  if (adsModuleBroken) return null;
  try {
    // Deliberately require(), not import — see the header comment. If this
    // JS bundle is running inside a binary without the native module, the
    // require throws and we permanently fall back to "no ads".
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    adsModule = require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    adsModuleBroken = true;
    return null;
  }
  if (!sdkInitialized) {
    sdkInitialized = true;
    // Fire-and-forget SDK init; a failure just means banners no-fill.
    try { adsModule.default().initialize().catch(() => {}); } catch { /* no ads */ }
  }
  return adsModule;
}

// ---------- error boundary (ads must never break a screen) ----------

class AdErrorBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() { return { broken: true }; }
  componentDidCatch() { /* swallowed — an ad is never worth a crash */ }
  render() { return this.state.broken ? null : this.props.children; }
}

// ---------- the banner ----------

interface AdBannerProps {
  // Pass when the screen already knows the account's ad-free status (the
  // home screen's `me`); leave undefined to let the banner fetch /api/me.
  adFree?: boolean;
}

export default function AdBanner({ adFree }: AdBannerProps) {
  // null = still deciding (renders nothing, no layout jump on "no").
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { showAds } = await getAdsConfig();
        if (!showAds) { if (!cancelled) setEligible(false); return; }
        const isAdFree = adFree ?? (await getMe()).adFree;
        if (!cancelled) setEligible(isAdFree === false);
      } catch {
        // Config or /api/me unreachable — err on the side of no ad.
        if (!cancelled) setEligible(false);
      }
    })();
    return () => { cancelled = true; };
  }, [adFree]);

  if (!eligible || failed) return null;

  const ads = loadAdsModule();
  if (!ads) return null; // native module absent (older dev build / Expo Go)

  const { BannerAd, BannerAdSize } = ads;
  return (
    <AdErrorBoundary>
      <View style={{ alignItems: 'center', marginBottom: 16 }}>
        <BannerAd
          unitId={BANNER_AD_UNIT_ID}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          onAdFailedToLoad={() => setFailed(true)}
        />
      </View>
    </AdErrorBoundary>
  );
}
