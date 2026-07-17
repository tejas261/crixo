// POST /api/payments/confirm — checkout handoff: Razorpay's checkout.js hands
// the browser {order_id, payment_id, signature}; we verify the HMAC with the
// key secret (proves Razorpay authored it) and credit the ledger idempotently
// (unique key rzp:<payment_id> — replays and webhook overlap cannot
// double-credit). No session required: the verified signature proves the
// payment happened, and the order row says whose credits they are
// (order.accountId), so the hosted /pay/[orderId] page can confirm from any
// browser context. Returns the credited account's new balance.
import { db } from '@/lib/db';
import { StoreError } from '@/lib/store';
import { getBalance } from '@/lib/accounts';
import { creditPaidOrder, verifyHmac } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature,
  } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof orderId !== 'string' || orderId === '' ||
    typeof paymentId !== 'string' || paymentId === '' ||
    typeof signature !== 'string' || signature === ''
  ) {
    return Response.json(
      { error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' },
      { status: 400 }
    );
  }

  try {
    const secret = process.env.RZP_KEY_SECRET;
    if (!secret) return Response.json({ error: 'payments not configured' }, { status: 503 });
    if (!verifyHmac(`${orderId}|${paymentId}`, signature, secret)) {
      return Response.json({ error: 'invalid payment signature' }, { status: 400 });
    }

    const order = await db().paymentOrder.findUnique({ where: { id: orderId } });
    if (!order) return Response.json({ error: 'order not found' }, { status: 404 });
    if (order.status === 'paid') {
      // Refuse a second payment against a paid order — but let the exact
      // payment that credited it replay idempotently (client retries).
      const already = await db().creditLedger.findUnique({
        where: { idempotencyKey: `rzp:${paymentId}` },
      });
      if (!already) return Response.json({ error: 'order already paid' }, { status: 409 });
      return Response.json({ credits: await getBalance(order.accountId) });
    }

    await creditPaidOrder(orderId, paymentId); // no-op if already credited
    return Response.json({ credits: await getBalance(order.accountId) });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
