// GET /api/auth/google — kick off Google OAuth (scope: openid email).
// CSRF protection: a random state nonce goes into a short-lived httpOnly
// cookie and must round-trip through Google unchanged. redirect_uri is
// derived from the request host so LAN/tunnel deployments work unchanged.
//
// Device-link flow: ?link=<code> (minted by the mobile app via
// POST /api/auth/link-code) rides inside the SAME state cookie as
// '<nonce>.<code>', so the callback can link the Google identity to the
// code's account instead of the browser's.
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { encodeStateCookie, LINK_CODE_RE, requestOrigin, STATE_COOKIE } from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: 'google auth not configured' }, { status: 503 });
  }

  // Device-link: validate the code up front so a stale QR/link fails fast
  // instead of after the whole Google round-trip.
  const link = new URL(req.url).searchParams.get('link');
  let linkCode: string | null = null;
  if (link !== null) {
    const row = LINK_CODE_RE.test(link)
      ? await db().linkCode.findUnique({ where: { code: link } })
      : null;
    if (!row || row.usedAt !== null || row.expiresAt.getTime() < Date.now()) {
      const msg = encodeURIComponent('link expired — try again from the app');
      return Response.redirect(`${origin}/?auth_error=${msg}`, 302);
    }
    linkCode = link;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const jar = await cookies();
  jar.set(STATE_COOKIE, encodeStateCookie(state, linkCode), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes — the OAuth round-trip only
    secure: false, // LAN plain-HTTP deployment (same rationale as the session cookie)
  });

  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.searchParams.set('client_id', clientId);
  auth.searchParams.set('redirect_uri', `${origin}/api/auth/google/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', 'openid email');
  auth.searchParams.set('state', state);

  return Response.redirect(auth.toString(), 302);
}
