// GET /api/ads/config -> {showAds, purchases}. Free accounts (and anonymous
// callers with no account yet) see ads; an account that bought the one-time
// 'adfree' product does not. Both flags are false when the server-side
// monetization kill switch (MONETIZATION_ENABLED=false) is off — clients key
// every ad slot and purchase entry point off this response. Read-only:
// never creates an account or sets a cookie.
import { db } from '@/lib/db';
import { monetizationEnabled } from '@/lib/monetization';
import { getSessionToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET() {
  try {
    if (!monetizationEnabled()) {
      return Response.json({ showAds: false, purchases: false }, NO_STORE);
    }
    const token = await getSessionToken();
    if (!token) {
      return Response.json({ showAds: true, purchases: true }, NO_STORE);
    }
    const session = await db().session.findUnique({
      where: { token },
      select: { account: { select: { adFree: true } } },
    });
    return Response.json({ showAds: !session?.account.adFree, purchases: true }, NO_STORE);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
