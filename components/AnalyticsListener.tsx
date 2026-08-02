'use client';

// Analytics bootstrap (v16), mounted once in the root layout.
//
// Always on: first-party pageviews (with UTM params and viewport width) into
// our own Postgres via lib/analytics.
//
// Env-gated free tools — both no-ops until their key is set, so the app
// ships with zero third-party calls by default:
//   NEXT_PUBLIC_GA_ID        → Google Analytics 4 (gtag), SPA pageviews
//   NEXT_PUBLIC_POSTHOG_KEY  → PostHog Cloud (free tier), loaded from CDN;
//   NEXT_PUBLIC_POSTHOG_HOST   defaults to the US cloud host.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Script from 'next/script';
import { track } from '@/lib/analytics';

const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

interface GtagWindow {
  gtag?: (...args: unknown[]) => void;
}

export default function AnalyticsListener() {
  const pathname = usePathname();
  // UTM params only exist on the landing URL — capture them once and attach
  // to that first pageview (the acquisition event GTM cares about).
  const firstView = useRef(true);

  useEffect(() => {
    if (!pathname) return;
    const props: Record<string, unknown> = { w: window.innerWidth };
    if (firstView.current) {
      firstView.current = false;
      const params = new URLSearchParams(window.location.search);
      for (const k of UTM_KEYS) {
        const v = params.get(k);
        if (v) props[k] = v;
      }
      props.landing = true;
    }
    track('pageview', props);
    // GA4 SPA navigation (initial load is covered by the config call).
    (window as unknown as GtagWindow).gtag?.('event', 'page_view', { page_path: pathname });
  }, [pathname]);

  return (
    <>
      {GA_ID && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('config', '${GA_ID}');`}
          </Script>
        </>
      )}
      {POSTHOG_KEY && (
        <Script id="posthog-init" strategy="afterInteractive">
          {`!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload group identify setPersonProperties alias".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
            posthog.init('${POSTHOG_KEY}', { api_host: '${POSTHOG_HOST}', defaults: '2025-05-24' });`}
        </Script>
      )}
    </>
  );
}
