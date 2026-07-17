// GET /api/auth/google/callback — finish Google OAuth: verify the state
// nonce, exchange the code for an id_token, link the Google identity to the
// caller's account (or repoint the session to the identity's existing
// account), then bounce home. All failures land on '/?auth_error=<msg>'.
//
// Device-link flow: when a link code rode along in the state cookie, the
// identity links to the CODE's account (the mobile app's bearer session)
// instead of the browser's, the code is burned (single-use), and we land on
// /linked so the user knows to return to the app.
//
// The id_token payload is decoded WITHOUT signature verification: it arrives
// over TLS directly from Google's token endpoint in a server-to-server
// exchange authenticated by our client secret, so its provenance is already
// established (this is the documented-safe case; a token from any other
// channel would need full JWT verification).
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { getOrCreateSessionToken } from '@/lib/session';
import { linkGoogle, linkGoogleForAccount } from '@/lib/accounts';
import { decodeStateCookie, requestOrigin, STATE_COOKIE } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(origin: string, msg: string): Response {
  return Response.redirect(`${origin}/?auth_error=${encodeURIComponent(msg)}`, 302);
}

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return fail(origin, 'google auth not configured');

    const url = new URL(req.url);
    if (url.searchParams.get('error')) return fail(origin, 'google sign-in was cancelled');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    const jar = await cookies();
    const stateCookie = jar.get(STATE_COOKIE)?.value;
    jar.delete(STATE_COOKIE);
    if (!code || !state || !stateCookie) {
      return fail(origin, 'sign-in state mismatch, please try again');
    }
    const { nonce, linkCode } = decodeStateCookie(stateCookie);
    if (state !== nonce) {
      return fail(origin, 'sign-in state mismatch, please try again');
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = (await tokenRes.json().catch(() => null)) as { id_token?: string } | null;
    if (!tokenRes.ok || !tokenData?.id_token) return fail(origin, 'google token exchange failed');

    const segments = tokenData.id_token.split('.');
    if (segments.length !== 3) return fail(origin, 'malformed google token');
    let payload: { sub?: unknown; email?: unknown; name?: unknown; picture?: unknown };
    try {
      payload = JSON.parse(Buffer.from(segments[1]!, 'base64url').toString('utf8'));
    } catch {
      return fail(origin, 'malformed google token');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return fail(origin, 'google token missing subject');
    }
    // Profile claims are optional in the id_token; whatever is present is
    // stored fresh on every sign-in (Google photo URLs rotate).
    const profile = {
      email: typeof payload.email === 'string' ? payload.email : null,
      name: typeof payload.name === 'string' ? payload.name : null,
      picture: typeof payload.picture === 'string' ? payload.picture : null,
    };

    if (linkCode) {
      // Burn the code atomically (single-use, unexpired) BEFORE linking, so a
      // replayed callback can never re-link. count === 0 means it was already
      // used, expired, or never existed.
      const claimed = await db().linkCode.updateMany({
        where: { code: linkCode, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        return fail(origin, 'link expired — try again from the app');
      }
      const row = await db().linkCode.findUnique({ where: { code: linkCode } });
      if (!row) return fail(origin, 'link expired — try again from the app');
      await linkGoogleForAccount(row.accountId, payload.sub, profile);
      return Response.redirect(`${origin}/linked`, 302);
    }

    const sessionToken = await getOrCreateSessionToken();
    await linkGoogle(sessionToken, payload.sub, profile);
    return Response.redirect(`${origin}/`, 302);
  } catch (err) {
    console.error('google oauth callback failed:', err);
    return fail(origin, 'sign-in failed, please try again');
  }
}
