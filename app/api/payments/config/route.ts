// GET /api/payments/config — what the checkout UI needs: the public Razorpay
// key id (public by design; it goes into checkout.js on the client) and the
// credit packs. The key SECRET never leaves the server.
import { PACKS } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const keyId = process.env.RZP_KEY_ID;
  if (!keyId) {
    return Response.json({ error: 'payments not configured' }, { status: 503 });
  }
  return Response.json({ keyId, packs: PACKS });
}
