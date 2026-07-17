// POST /api/auth/link-code — mint a single-use device-link code for the
// caller's account (bearer or cookie session, resolved exactly like /api/me).
// The mobile app opens /api/auth/google?link=<code> in a browser; when the
// OAuth callback sees the code it links the Google identity to THIS account,
// so the bearer session signs in without native Google SDKs.
//
// Codes expire in 10 minutes and burn on first use. Light rate limit: at
// most 5 unexpired unused codes per account.
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { StoreError } from '@/lib/store';
import { getOrCreateSessionToken } from '@/lib/session';
import { requestIp, resolveAccount } from '@/lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_S = 600;
const MAX_PENDING = 5;

export async function POST(req: Request) {
  try {
    const token = await getOrCreateSessionToken();
    const account = await resolveAccount(token, requestIp(req));

    const pending = await db().linkCode.count({
      where: { accountId: account.id, usedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pending >= MAX_PENDING) {
      return Response.json(
        { error: 'too many link codes — try again in a few minutes' },
        { status: 429 }
      );
    }

    const code = crypto.randomBytes(12).toString('hex'); // 24 hex chars
    await db().linkCode.create({
      data: { code, accountId: account.id, expiresAt: new Date(Date.now() + TTL_S * 1000) },
    });
    return Response.json({ code, expiresIn: TTL_S }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
