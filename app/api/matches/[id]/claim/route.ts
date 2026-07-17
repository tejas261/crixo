// POST /api/matches/:id/claim {adminKey} — prove knowledge of the admin key
// and bind a scoring grant to this browser's session cookie. 204 on success.

import { claimAdmin, StoreError } from '@/lib/store';
import { getOrCreateSessionToken } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { adminKey } = (body ?? {}) as { adminKey?: unknown };
  try {
    const token = await getOrCreateSessionToken();
    await claimAdmin(token, id, adminKey);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
