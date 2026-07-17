// Shared bits for the Google OAuth pair of routes (start + callback).
// Route files may only export HTTP methods/config, so these live here.

export const STATE_COOKIE = 'crixo_oauth_state';

// Device-link codes are 12 crypto-random bytes as hex (POST /api/auth/link-code).
export const LINK_CODE_RE = /^[0-9a-f]{24}$/;

// The state cookie carries the CSRF nonce, and — for the device-link flow —
// the link code that must survive the OAuth round-trip: '<nonce>' alone, or
// '<nonce>.<linkcode>'. Same single httpOnly 10-minute cookie either way.
export function encodeStateCookie(nonce: string, linkCode: string | null): string {
  return linkCode ? `${nonce}.${linkCode}` : nonce;
}

export function decodeStateCookie(value: string): { nonce: string; linkCode: string | null } {
  const dot = value.indexOf('.');
  if (dot === -1) return { nonce: value, linkCode: null };
  const linkCode = value.slice(dot + 1);
  return { nonce: value.slice(0, dot), linkCode: LINK_CODE_RE.test(linkCode) ? linkCode : null };
}

/** Origin as the client sees it (proxy-aware) — used for redirect_uri. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  return `${proto}://${host}`;
}
