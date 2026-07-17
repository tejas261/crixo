// GET /api/me — who am I, for the caller's session token (cookie or bearer).
// This is the lazy-onboarding entry point: a brand-new browser gets an
// account right here. v12: credits are retired — the response carries the
// ad-free flag instead of a balance. Never exposes ledger rows or any other
// account's data.
import { StoreError } from '@/lib/store';
import { getOrCreateSessionToken } from '@/lib/session';
import { isSignedIn, requestIp, resolveAccount } from '@/lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const token = await getOrCreateSessionToken();
    const account = await resolveAccount(token, requestIp(req));
    return Response.json(
      {
        signedIn: isSignedIn(account),
        email: account.email,
        name: account.name,
        picture: account.picture,
        adFree: account.adFree,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
