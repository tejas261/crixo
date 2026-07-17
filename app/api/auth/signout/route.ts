// POST /api/auth/signout — delete the Session row and clear the cookie. The
// account itself (and its credits/identity) is untouched; the next request
// from this browser mints a fresh token → fresh anonymous account. Signing
// back in with the same Google/phone identity repoints to the old account.
import { StoreError } from '@/lib/store';
import { clearSessionCookie, getSessionToken } from '@/lib/session';
import { deleteSession } from '@/lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const token = await getSessionToken();
    if (token) await deleteSession(token);
    await clearSessionCookie();
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
