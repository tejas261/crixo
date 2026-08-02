'use client';

// First-party analytics (v16) — a tiny fire-and-forget tracker. Events land
// in our own Postgres via POST /api/track (see that route for the caps and
// the no-PII rules). Identity is server-derived from the session cookie, so
// nothing is stored client-side. Telemetry must never break the product:
// every path here swallows failures.

// Match/pay ids are collapsed out of the path so paths aggregate cleanly;
// the raw id travels in props.matchId instead (per-match viewer counts).
const ID_ROUTES = /^\/(m|umpire|summary|toss|pay)\/([^/]+)/;

export function track(name: string, props?: Record<string, unknown>): void {
  try {
    const m = ID_ROUTES.exec(window.location.pathname);
    const path = m ? `/${m[1]}/:id` : window.location.pathname;
    const body = JSON.stringify({
      platform: 'web',
      events: [{
        name,
        props: m ? { matchId: m[2], ...props } : props,
        path,
        referrer: document.referrer || undefined,
      }],
    });
    // sendBeacon survives page unloads (shares, outbound navigations);
    // keepalive fetch is the fallback.
    if (navigator.sendBeacon
        && navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) {
      return;
    }
    void fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch { /* never let telemetry throw into the app */ }
}
