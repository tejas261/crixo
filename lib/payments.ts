// Razorpay payments (server-only) — direct REST, no SDK.
// Auth: HTTP Basic RZP_KEY_ID:RZP_KEY_SECRET. The key id is public by design
// (checkout.js needs it client-side); the secret NEVER leaves the server.
import crypto from 'node:crypto';
import { db } from './db';
import { StoreError } from './errors';

export interface CreditPack {
  id: string;
  credits: number;
  amountPaise: number;
  label: string;
}

// v12: single one-time product — remove ads forever. The CreditPack shape
// (and the `packs` field in /api/payments/config + the orders/[id] response)
// is retained so the hosted /pay page keeps working; `credits` is 0 because
// credits no longer gate anything.
export const PACKS: readonly CreditPack[] = [
  { id: 'adfree', credits: 0, amountPaise: 19900, label: 'Remove ads — one-time' },
];

export function getPack(packId: unknown): CreditPack | null {
  return PACKS.find((p) => p.id === packId) ?? null;
}

function rzpAuthHeader(): string {
  const keyId = process.env.RZP_KEY_ID;
  const secret = process.env.RZP_KEY_SECRET;
  if (!keyId || !secret) throw new StoreError(503, 'payments not configured');
  return 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64');
}

/**
 * Create a Razorpay order for a pack and persist it (status 'created').
 * The PaymentOrder id IS the razorpay order id.
 */
export async function createOrder(
  accountId: string,
  pack: CreditPack
): Promise<{ orderId: string; amountPaise: number; credits: number }> {
  // Razorpay caps receipt at 40 chars; cuid prefix + pack + ts fits.
  const receipt = `${accountId.slice(0, 14)}-${pack.id}-${Date.now().toString(36)}`.slice(0, 40);
  let res: Response;
  try {
    res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: rzpAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: pack.amountPaise,
        currency: 'INR',
        receipt,
        notes: { accountId, packId: pack.id },
      }),
    });
  } catch (err) {
    throw new StoreError(502, `payment provider unreachable: ${(err as Error).message}`);
  }
  const data = (await res.json().catch(() => null)) as { id?: string; error?: { description?: string } } | null;
  if (!res.ok || !data?.id) {
    // Never echo provider internals beyond a short description.
    const desc = data?.error?.description ?? `status ${res.status}`;
    throw new StoreError(502, `payment provider error: ${desc}`);
  }
  await db().paymentOrder.create({
    data: {
      id: data.id,
      accountId,
      packId: pack.id,
      credits: pack.credits,
      amountPaise: pack.amountPaise,
      status: 'created',
    },
  });
  return { orderId: data.id, amountPaise: pack.amountPaise, credits: pack.credits };
}

/** Constant-time HMAC-SHA256 comparison. */
export function verifyHmac(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Idempotently fulfil a paid order. A ledger audit row keyed `rzp:<paymentId>`
 * (duplicate → no-op) is the exactly-once record; for the 'adfree' product it
 * carries delta 0 / reason 'adfree_purchase' and the account is flagged
 * adFree (an idempotent write, so replays are harmless). Used by both the
 * client confirm path and the webhook, so double delivery can never
 * double-fulfil.
 */
export async function creditPaidOrder(orderId: string, paymentId: string): Promise<void> {
  const order = await db().paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) throw new StoreError(404, 'order not found');
  const adFree = order.packId === 'adfree';
  try {
    await db().creditLedger.create({
      data: {
        accountId: order.accountId,
        delta: adFree ? 0 : order.credits,
        reason: adFree ? 'adfree_purchase' : 'purchase',
        refId: paymentId,
        idempotencyKey: `rzp:${paymentId}`,
      },
    });
  } catch (err) {
    const dup =
      err instanceof Error &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002';
    if (!dup) throw err; // duplicate delivery — already fulfilled
  }
  if (adFree) {
    await db().account.update({ where: { id: order.accountId }, data: { adFree: true } });
  }
  if (order.status !== 'paid') {
    await db().paymentOrder.update({ where: { id: orderId }, data: { status: 'paid' } });
  }
}
