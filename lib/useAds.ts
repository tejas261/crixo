'use client';

// useAds — should this page show ad slots / purchase entry points at all?
// GET /api/ads/config once per page load (module-level cache shared by every
// mount) → { showAds, purchases }. Both default to false, so pages render
// clean and the slots / "Remove ads" affordances appear only after the
// server says so; any fetch failure also means both off (never block content
// on the ads config). `purchases` is the server's monetization kill switch —
// when it's false every "Remove ads" entry point stays hidden.

import { useEffect, useState } from 'react';
import { fetchJSON } from '@/lib/useMatch';

// Shape of GET /api/ads/config.
export interface AdsConfig {
  showAds: boolean;
  purchases: boolean;
}

const OFF: AdsConfig = { showAds: false, purchases: false };

let cached: AdsConfig | null = null;
let inflight: Promise<AdsConfig> | null = null;

function fetchAdsConfig(): Promise<AdsConfig> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetchJSON<AdsConfig>('/api/ads/config')
    .then((c) => {
      cached = { showAds: Boolean(c.showAds), purchases: Boolean(c.purchases) };
      return cached;
    })
    .catch(() => {
      inflight = null; // allow a retry on the next page that asks
      return OFF;
    });
  return inflight;
}

export function useAds(): AdsConfig {
  const [config, setConfig] = useState<AdsConfig>(cached ?? OFF);

  useEffect(() => {
    let cancelled = false;
    void fetchAdsConfig().then((c) => { if (!cancelled) setConfig(c); });
    return () => { cancelled = true; };
  }, []);

  return config;
}
