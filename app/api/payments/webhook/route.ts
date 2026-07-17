// POST /api/payments/webhook — Razorpay server-to-server events. SHIPS
// DORMANT: RZP_WEBHOOK_SECRET is not set today, so this responds 503 until
// the user creates a webhook in the Razorpay dashboard and adds its secret.
// Once live, payment.captured runs the same idempotent credit path as
// /confirm (unique rzp:<payment_id> ledger key), so whichever of the two
// lands first wins and the other is a no-op.
import { StoreError } from '@/lib/store';
import { creditPaidOrder, verifyHmac } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CapturedPayload {
  event?: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
}

export async function POST(req: Request) {
  const secret = process.env.RZP_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'webhook not configured' }, { status: 503 });
  }

  // Signature covers the RAW body bytes — read text first, parse after.
  const raw = await req.text();
  const signature = req.headers.get('x-razorpay-signature');
  if (!signature || !verifyHmac(raw, signature, secret)) {
    return Response.json({ error: 'invalid webhook signature' }, { status: 400 });
  }

  let parsed: CapturedPayload;
  try {
    parsed = JSON.parse(raw) as CapturedPayload;
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    if (parsed.event === 'payment.captured') {
      const entity = parsed.payload?.payment?.entity;
      const paymentId = entity?.id;
      const rzpOrderId = entity?.order_id;
      if (typeof paymentId === 'string' && typeof rzpOrderId === 'string') {
        await creditPaidOrder(rzpOrderId, paymentId);
      }
    }
    // Unknown events (and captured payments for orders we don't know) are
    // acknowledged so Razorpay stops retrying.
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof StoreError && err.status === 404) {
      return Response.json({ ok: true }); // not our order — acknowledge
    }
    console.error('webhook processing failed:', err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
