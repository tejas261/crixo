import { postEvent, StoreError } from '@/lib/store';
import { getSessionToken } from '@/lib/session';

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

  // Body is {event} for cookie-session scorers; {adminKey, event} remains the
  // cross-device (and legacy) fallback. Either credential authorizes.
  const { adminKey, event } = (body ?? {}) as { adminKey?: unknown; event?: unknown };
  try {
    const auth = {
      adminKey: typeof adminKey === 'string' ? adminKey : null,
      token: await getSessionToken(),
    };
    const state = await postEvent(id, auth, event);
    return Response.json(state);
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
