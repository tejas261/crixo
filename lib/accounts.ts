// Accounts + credit ledger (server-only).
//
// Model: every session token (browser cookie or mobile bearer) maps to an
// Account via account_sessions. Accounts are created lazily on first use.
//
// v12: credits no longer gate anything — match creation is free and
// unlimited; monetization is the one-time 'adfree' purchase (Account.adFree).
// The append-only credit_ledger is RETAINED as an audit trail (signup grants
// still write a row, and ad-free purchases write a delta-0 row), and its
// unique idempotencyKey remains the exactly-once mechanism for payment
// writes. The v11 spend/refund functions (spendInTx, spendForMatch,
// refundIfAbandoned) were deleted — nothing referenced them anymore.
//
// Signing in (Google) REPOINTS the caller's session row to the account
// owning that identity; admin_grants are keyed by the token value, so scoring
// rights follow the device, while credits follow the identity.
import { Prisma } from '@prisma/client';
import type { Account } from '@prisma/client';
import { db } from './db';
import { StoreError } from './errors';

// Same shape lib/session.ts mints — validate before any query (defense in depth).
const TOKEN_RE = /^[0-9a-f]{48}$/;

const SIGNUP_CREDITS = 5;
const SIGNUP_CREDITS_DEGRADED = 1; // velocity-limited grant (silent)
const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const VELOCITY_MAX_ACCOUNTS_PER_IP = 3;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

function isSerializationFailure(err: unknown): boolean {
  // P2034: transaction failed due to a write conflict or deadlock (Prisma's
  // wrapper for Postgres 40001 serialization failures) — safe to retry.
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
}

/** Run fn in a SERIALIZABLE interactive transaction, retrying up to 3 times
 *  on serialization failure. StoreErrors thrown inside pass through as-is. */
export async function serializableTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db().$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err) {
      if (!isSerializationFailure(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * resolveAccount(token, ip?) -> Account for this session token, creating
 * Account + Session + signup grant on first sight. The grant degrades to
 * +1 credit (silently) when more than 3 accounts were already created from
 * the same IP in the last 24h — trial-credit farming speed bump.
 */
export async function resolveAccount(token: unknown, ip?: string | null): Promise<Account> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
    throw new StoreError(400, 'invalid session token');
  }
  const existing = await db().session.findUnique({ where: { token }, include: { account: true } });
  if (existing) return existing.account;

  const cleanIp = typeof ip === 'string' && ip.length > 0 && ip.length <= 64 ? ip : null;
  let credits = SIGNUP_CREDITS;
  if (cleanIp) {
    const recent = await db().account.count({
      where: { ip: cleanIp, createdAt: { gt: new Date(Date.now() - VELOCITY_WINDOW_MS) } },
    });
    if (recent > VELOCITY_MAX_ACCOUNTS_PER_IP) credits = SIGNUP_CREDITS_DEGRADED;
  }

  try {
    return await db().$transaction(async (tx) => {
      const account = await tx.account.create({ data: { ip: cleanIp } });
      await tx.session.create({ data: { token, accountId: account.id } });
      await tx.creditLedger.create({
        data: { accountId: account.id, delta: credits, reason: 'signup_grant' },
      });
      return account;
    });
  } catch (err) {
    // Concurrent first requests with the same token: one wins the session
    // insert; the loser re-reads the winner's account.
    if (isUniqueViolation(err)) {
      const raced = await db().session.findUnique({ where: { token }, include: { account: true } });
      if (raced) return raced.account;
    }
    throw new StoreError(500, `failed to create account: ${(err as Error).message}`);
  }
}

/** Balance = SUM(delta) over the ledger. */
export async function getBalance(accountId: string): Promise<number> {
  const agg = await db().creditLedger.aggregate({
    where: { accountId },
    _sum: { delta: true },
  });
  return agg._sum.delta ?? 0;
}

// ---------------------------------------------------------------------------
// Identity linking
// ---------------------------------------------------------------------------
// If an account already owns the identity, the caller's session(s) are
// repointed to it (sign-in on a new device). Otherwise the identity attaches
// to the caller's current account (first sign-in keeps the trial credits).
// The unique constraint on googleSub means each identity exists exactly
// once — re-registering can never mint fresh trial credits.

/** Google id_token profile claims we persist. All optional in the token. */
export interface GoogleProfile {
  email: string | null;
  name: string | null;
  picture: string | null;
}

/** Fields of `profile` worth writing over `existing`: every non-null incoming
 *  value that differs. Always refreshed on sign-in — Google photo URLs rotate,
 *  so the latest non-null value wins; nulls never clobber stored values. */
function profilePatch(
  existing: Pick<Account, 'email' | 'name' | 'picture'>,
  profile: GoogleProfile
): { email?: string; name?: string; picture?: string } {
  const patch: { email?: string; name?: string; picture?: string } = {};
  if (profile.email && profile.email !== existing.email) patch.email = profile.email;
  if (profile.name && profile.name !== existing.name) patch.name = profile.name;
  if (profile.picture && profile.picture !== existing.picture) patch.picture = profile.picture;
  return patch;
}

/**
 * Core linking shared by the browser flow and the device-link flow: attach
 * the Google identity (sub + profile) to `account`, or resolve which existing
 * account owns it. Returns the account id the caller's session row(s) should
 * point at afterwards (== account.id when the identity attached in place).
 */
async function linkGoogleToAccount(
  account: Account,
  sub: string,
  profile: GoogleProfile
): Promise<string> {
  const owner = await db().account.findUnique({ where: { googleSub: sub } });
  if (owner) {
    const patch = profilePatch(owner, profile);
    if (Object.keys(patch).length > 0) {
      await db().account.update({ where: { id: owner.id }, data: patch });
    }
    return owner.id;
  }
  // The account already belongs to a DIFFERENT Google identity (e.g. signed
  // in as A, now signing in as B): don't clobber A — create a fresh account
  // for B and point the session there.
  if (account.googleSub && account.googleSub !== sub) {
    const fresh = await db().account.create({
      data: { googleSub: sub, email: profile.email, name: profile.name, picture: profile.picture },
    });
    return fresh.id;
  }
  try {
    await db().account.update({
      where: { id: account.id },
      data: { googleSub: sub, ...profilePatch(account, profile) },
    });
    return account.id;
  } catch (err) {
    // Race: another request claimed this sub between our lookup and update.
    if (!isUniqueViolation(err)) throw err;
    const raced = await db().account.findUnique({ where: { googleSub: sub } });
    return raced ? raced.id : account.id;
  }
}

/** Browser sign-in: link the identity via the caller's session token; the
 *  single Session row for the token repoints when the identity lives on
 *  another account. */
export async function linkGoogle(token: string, sub: string, profile: GoogleProfile): Promise<void> {
  const current = await resolveAccount(token);
  const target = await linkGoogleToAccount(current, sub, profile);
  if (target !== current.id) {
    await db().session.update({ where: { token }, data: { accountId: target } });
  }
}

/**
 * Device-link sign-in: link the identity to the account behind a link code
 * (minted by the mobile app over its bearer session). When the identity
 * already lives on another account, ALL of the code account's Session rows —
 * including the mobile bearer token — move to the identity's account,
 * mirroring the browser repoint semantics.
 */
export async function linkGoogleForAccount(
  accountId: string,
  sub: string,
  profile: GoogleProfile
): Promise<void> {
  const account = await db().account.findUnique({ where: { id: accountId } });
  if (!account) throw new StoreError(400, 'link code account no longer exists');
  const target = await linkGoogleToAccount(account, sub, profile);
  if (target !== account.id) {
    await db().session.updateMany({ where: { accountId: account.id }, data: { accountId: target } });
  }
}

/** Delete the session row (sign-out): the next request mints a fresh
 *  anonymous account for whatever token it carries. */
export async function deleteSession(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await db().session.deleteMany({ where: { token } });
}

/** True when the account has a linked identity (may buy credits). */
export function isSignedIn(account: Account): boolean {
  return account.googleSub !== null;
}

/** Best-effort client IP for the signup velocity check (first XFF hop). */
export function requestIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]!.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || null;
}
