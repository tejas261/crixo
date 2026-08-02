// POST /api/track — first-party analytics collector (v16).
//
// Accepts a small batch of client events and appends them to
// analytics_events. Design rules:
//   - NEVER break the product: any failure (bad body, DB down) still
//     returns 204 — the client fired-and-forgot anyway. Failures are
//     logged server-side.
//   - No PII, no raw IPs. Web identity = SHA-256 of the existing session
//     cookie (no new client storage, rotates with the cookie); mobile
//     sends its own generated device id.
//   - Hard caps on batch size / name / prop payloads so the endpoint
//     can't be used to dump garbage into the table.

import { createHash } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const MAX_EVENTS = 20;
const MAX_NAME = 64;
const MAX_STR = 256;
const MAX_PROPS_JSON = 2048;
const PLATFORMS = new Set(['web', 'android', 'ios']);

interface TrackEventBody {
  name?: unknown;
  props?: unknown;
  path?: unknown;
  referrer?: unknown;
}

function clip(v: unknown, max: number): string | null {
  return typeof v === 'string' && v !== '' ? v.slice(0, max) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      platform?: unknown;
      deviceId?: unknown;
      events?: unknown;
    };
    const platform = typeof body.platform === 'string' && PLATFORMS.has(body.platform)
      ? body.platform
      : 'web';

    // Web: anonymous id = hash of the session cookie this app already sets
    // (crixo_session, with the legacy fallback) — nothing new stored
    // client-side. Mobile: the app's generated id rides in the body.
    let deviceId = clip(body.deviceId, 64);
    if (!deviceId) {
      const jar = await cookies();
      const token = jar.get('crixo_session')?.value ?? jar.get('howzat_session')?.value;
      if (token) deviceId = createHash('sha256').update(token).digest('hex').slice(0, 16);
    }

    const h = await headers();
    const ua = clip(h.get('user-agent'), MAX_STR);

    const raw = Array.isArray(body.events) ? (body.events as TrackEventBody[]) : [];
    const rows = raw.slice(0, MAX_EVENTS).flatMap((e) => {
      const name = clip(e.name, MAX_NAME);
      if (!name) return [];
      let props: object | undefined;
      if (e.props != null && typeof e.props === 'object') {
        // Cap the payload; oversized props are dropped, not truncated
        // mid-JSON (a clipped string wouldn't parse back).
        props = JSON.stringify(e.props).length <= MAX_PROPS_JSON
          ? (e.props as object)
          : { _dropped: 'props too large' };
      }
      return [{
        name,
        props,
        deviceId,
        platform,
        path: clip(e.path, MAX_STR),
        referrer: clip(e.referrer, MAX_STR),
        ua,
      }];
    });

    if (rows.length > 0) await db().analyticsEvent.createMany({ data: rows });
  } catch (err) {
    // Telemetry must never surface errors to the product; log and move on.
    console.error('track: dropped batch —', (err as Error).message);
  }
  return new NextResponse(null, { status: 204 });
}
