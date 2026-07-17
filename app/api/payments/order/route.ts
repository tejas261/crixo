// POST /api/payments/order {packId} — create a Razorpay order for a credit
// pack. Requires a signed-in account (google or phone linked): anonymous
// trial accounts can play but not pay, and purchased credits must survive
// device loss via the linked identity.
import { StoreError } from '@/lib/store';
import { getOrCreateSessionToken } from '@/lib/session';
import { isSignedIn, requestIp, resolveAccount } from '@/lib/accounts';
import { monetizationEnabled } from '@/lib/monetization';
import { createOrder, getPack } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Kill switch: no NEW orders while monetization is off (before any
  // Razorpay call). /confirm, the webhook and /pay stay up so orders
  // already in flight still credit.
  if (!monetizationEnabled()) {
    return Response.json({ error: 'purchases are disabled' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const token = await getOrCreateSessionToken();
    const account = await resolveAccount(token, requestIp(req));
    if (!isSignedIn(account)) {
      return Response.json({ error: 'sign in to buy credits' }, { status: 403 });
    }
    const pack = getPack((body as { packId?: unknown } | null)?.packId);
    if (!pack) {
      return Response.json({ error: 'unknown pack' }, { status: 400 });
    }
    const { orderId, amountPaise, credits } = await createOrder(account.id, pack);
    return Response.json({ orderId, amountPaise, keyId: process.env.RZP_KEY_ID, credits });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
