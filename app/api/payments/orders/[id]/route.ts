// GET /api/payments/orders/[id] — public order info for the hosted pay page
// (/pay/[orderId], opened by the mobile app in a browser sheet). Deliberately
// PUBLIC-only fields: pack + amount + status + the public Razorpay key id.
// NO account fields — the order id is an unguessable Razorpay id, and knowing
// it reveals nothing about who it belongs to.
import { db } from '@/lib/db';
import { getPack } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const keyId = process.env.RZP_KEY_ID;
  if (!keyId) {
    return Response.json({ error: 'payments not configured' }, { status: 503 });
  }
  const order = await db().paymentOrder.findUnique({ where: { id } });
  if (!order) return Response.json({ error: 'order not found' }, { status: 404 });
  return Response.json({
    orderId: order.id,
    amountPaise: order.amountPaise,
    credits: order.credits,
    label: getPack(order.packId)?.label ?? `${order.credits} matches`,
    keyId,
    status: order.status === 'paid' ? 'paid' : 'created',
  });
}
