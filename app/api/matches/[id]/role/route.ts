// GET /api/matches/:id/role — what this browser session may do with the
// match: {canScore, adminKey}. The admin key is included ONLY when the
// session already holds a grant, so the umpire can hand scoring off to
// another device. Never cached.

import { getAdminKeyIfGranted, getPublicState, StoreError } from '@/lib/store';
import { getSessionToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    if ((await getPublicState(id)) === null) {
      return Response.json({ error: 'match not found' }, { status: 404 });
    }
    const token = await getSessionToken();
    const adminKey = token === null ? null : await getAdminKeyIfGranted(token, id);
    return Response.json(
      { canScore: adminKey !== null, adminKey },
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
