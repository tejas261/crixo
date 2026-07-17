// Session cookie (server-only) — a per-browser anonymous token backing the
// DB scoring grants (admin_grants). The cookie carries no rights by itself;
// authorization lives in the DB rows keyed by this token.
//
// secure:false is deliberate: the normal deployment is plain-HTTP on a LAN,
// where a Secure cookie would never be sent back.

import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';

const COOKIE_NAME = 'crixo_session';
// Pre-rebrand cookie name. Grants are keyed by the token VALUE, so on read we
// fall back to the old cookie and re-set the same token under the new name —
// existing sessions keep their scoring rights across the Howzat→Crixo rename.
const LEGACY_COOKIE_NAME = 'howzat_session';
const ONE_YEAR_S = 31536000;

// 24 bytes of crypto randomness as hex. A cookie that doesn't match was not
// minted by us (tampered / truncated) — treat it as absent.
const TOKEN_RE = /^[0-9a-f]{48}$/;

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: ONE_YEAR_S,
  secure: false,
} as const;

// Mobile clients don't use cookies: they mint a token via
// POST /api/session/register, keep it in the device keychain, and send it as
// `Authorization: Bearer <48hex>` on every request. Same token format, same
// DB-backed rights (admin_grants + account_sessions rows keyed by the value).
async function getBearerToken(): Promise<string | null> {
  const h = await headers();
  const auth = h.get('authorization');
  if (!auth) return null;
  const match = /^Bearer\s+([0-9a-fA-F]{48})$/.exec(auth.trim());
  if (!match) return null;
  const token = match[1].toLowerCase();
  return TOKEN_RE.test(token) ? token : null;
}

/** Mint a fresh session token (used by /api/session/register for mobile). */
export function mintSessionToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Read the session token, minting and setting the cookie if absent.
 * Only callable where cookies may be written (route handlers, server actions).
 * A valid Bearer token takes precedence and never touches the cookie jar.
 */
export async function getOrCreateSessionToken(): Promise<string> {
  const bearer = await getBearerToken();
  if (bearer) return bearer;
  const jar = await cookies();
  const existing = jar.get(COOKIE_NAME)?.value;
  if (existing && TOKEN_RE.test(existing)) return existing;
  // Migrate a pre-rebrand session: carry the token over under the new name.
  const legacy = jar.get(LEGACY_COOKIE_NAME)?.value;
  if (legacy && TOKEN_RE.test(legacy)) {
    jar.set(COOKIE_NAME, legacy, COOKIE_OPTS);
    return legacy;
  }
  const token = crypto.randomBytes(24).toString('hex');
  jar.set(COOKIE_NAME, token, COOKIE_OPTS);
  return token;
}

/** Read-only variant: the session token (Bearer header or cookie), or null. */
export async function getSessionToken(): Promise<string | null> {
  const bearer = await getBearerToken();
  if (bearer) return bearer;
  const jar = await cookies();
  const value = jar.get(COOKIE_NAME)?.value;
  if (value && TOKEN_RE.test(value)) return value;
  // Legacy fallback (read-only contexts can't re-set the cookie; the next call
  // through a route handler / server action migrates it via getOrCreate).
  const legacy = jar.get(LEGACY_COOKIE_NAME)?.value;
  return legacy && TOKEN_RE.test(legacy) ? legacy : null;
}

/** Sign-out: drop the cookie(s) so the next request mints a fresh token. */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(LEGACY_COOKIE_NAME);
}
