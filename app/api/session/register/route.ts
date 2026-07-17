// POST /api/session/register — mint a session token for cookie-less clients
// (the mobile app stores it in the keychain and sends it as
// `Authorization: Bearer <token>` from then on). The account + Session row +
// signup credit grant are created immediately so the token is valid for
// bearer auth on the very next request.
import { StoreError } from '@/lib/store';
import { mintSessionToken } from '@/lib/session';
import { requestIp, resolveAccount } from '@/lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const token = mintSessionToken();
    await resolveAccount(token, requestIp(req));
    return Response.json({ token });
  } catch (err) {
    if (err instanceof StoreError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return Response.json({ error: 'internal server error' }, { status: 500 });
  }
}
