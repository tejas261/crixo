'use client';

// AdSlot — one responsive ad unit in the page flow.
//
// With NEXT_PUBLIC_ADSENSE_CLIENT set (e.g. "ca-pub-1234567890123456") this
// renders a real AdSense responsive unit: the adsbygoogle.js script is
// injected exactly once per page load and each mounted slot pushes itself
// onto window.adsbygoogle. Without the env var it renders a quiet
// design-language placeholder instead — same box in the layout — so the
// pages are honest about where ads live today, and deploying with the env
// var is all it takes to turn the placeholders into AdSense.
//
// Placement rules live with the callers: home (between create and the
// lists), live viewer (below the score panel), summary (above the innings
// sections). Never on the umpire console — scoring stays clean.

import { useEffect } from 'react';

declare global {
  interface Window {
    adsbygoogle?: object[];
  }
}

// Inlined at build time by Next (NEXT_PUBLIC_*).
const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

// adsbygoogle.js script singleton: one <script> per page load.
let scriptInjected = false;
function loadAdSenseScript(client: string): void {
  if (scriptInjected) return;
  scriptInjected = true;
  const script = document.createElement('script');
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  script.async = true;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
}

interface AdSlotProps {
  // AdSense ad-unit id for this placement (data-ad-slot). Optional — without
  // it the unit still renders as a responsive auto ad.
  slot?: string;
}

export default function AdSlot({ slot }: AdSlotProps) {
  const live = Boolean(ADSENSE_CLIENT);

  useEffect(() => {
    if (!ADSENSE_CLIENT) return;
    loadAdSenseScript(ADSENSE_CLIENT);
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // Blocked or double-pushed — the empty <ins> just stays collapsed.
    }
  }, []);

  return (
    <div className="ad-slot" aria-label="Advertisement">
      <span className="ad-tag" aria-hidden="true">Ad</span>
      {live ? (
        <ins
          className="adsbygoogle"
          style={{ display: 'block' }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      ) : (
        <span className="ad-placeholder">Your ad here — supports free scoring</span>
      )}
    </div>
  );
}
