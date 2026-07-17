import { createMatch, grantAdmin, listMatches, StoreError } from '@/lib/store';
import { getOrCreateSessionToken, getSessionToken } from '@/lib/session';
import { requestIp, resolveAccount } from '@/lib/accounts';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/matches[?lat=&lng=] -> {mine, nearby} (v12 dashboard shape).
// mine: the caller's account's matches ([] for unknown/no account — this is
// a read path, so no account is lazily created here). nearby: non-completed
// matches within VICINITY_M of the query point, each with distanceM; [] when
// no valid lat/lng pair is supplied. Raw coordinates never appear in the
// response.
export async function GET(req: Request) {
  try {
    // Read-only session lookup: an unknown token simply has no matches yet.
    let accountId: string | null = null;
    const token = await getSessionToken();
    if (token) {
      const session = await db().session.findUnique({
        where: { token },
        select: { accountId: true },
      });
      accountId = session?.accountId ?? null;
    }

    const params = new URL(req.url).searchParams;
    const latRaw = params.get('lat');
    const lngRaw = params.get('lng');
    let near: { lat: number; lng: number } | null = null;
    if (latRaw !== null && lngRaw !== null && latRaw !== '' && lngRaw !== '') {
      const lat = Number(latRaw);
      const lng = Number(lngRaw);
      if (
        Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
        Number.isFinite(lng) && lng >= -180 && lng <= 180
      ) {
        near = { lat, lng };
      }
      // Malformed/out-of-range coords degrade to "no location" (nearby: [])
      // rather than failing the whole dashboard fetch.
    }

    return Response.json(await listMatches(accountId, near));
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    // Creation is free and unlimited (v12). The caller's account (created
    // lazily on first contact) is recorded on the match for the dashboard's
    // "my matches" list; an optional body.location powers nearby discovery.
    const token = await getOrCreateSessionToken();
    const account = await resolveAccount(token, requestIp(req));
    const { id, adminKey } = await createMatch(body, account.id);
    // Grant the creator's browser session scoring rights server-side (the
    // cookie is set on this response). The key is still returned once for
    // cross-device handoff.
    await grantAdmin(token, id);
    return Response.json({ id, adminKey });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
