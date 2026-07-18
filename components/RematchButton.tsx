'use client';

// Rematch — creates a fresh match from a completed match's config (same
// teams and overs, batting order swapped) and lands on the new umpire
// console. Purely client-side: POST /api/matches grants scoring rights to
// whoever tapped it (their session), exactly like creating from the form.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJSON } from '@/lib/useMatch';
import { toast } from '@/components/Toasts';
import type { PublicState } from '@/lib/engine';

// Best-effort creation coordinates: only when the browser has ALREADY
// granted geolocation (checked via the Permissions API — never prompts),
// and capped at ~3s so a rematch never blocks on a GPS fix.
async function grantedLocation(): Promise<{ lat: number; lng: number } | undefined> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
  try {
    const perm = await navigator.permissions.query({ name: 'geolocation' });
    if (perm.state !== 'granted') return undefined;
  } catch {
    return undefined; // no Permissions API → can't know without prompting; skip
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(undefined),
      { timeout: 3000, maximumAge: 60000 },
    );
  });
}

interface RematchButtonProps {
  state: PublicState;
  block?: boolean; // full-width, for the completed sheet's button stack
}

export default function RematchButton({ state, block = false }: RematchButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Rematches only come off a finished match (the summary page renders
  // other states too).
  if (state.status !== 'completed') return null;

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const cfg = state.config;
      const location = await grantedLocation();
      const body = {
        // Teams as-is — the common player is already in both player lists.
        teams: cfg.teams,
        oversPerInnings: cfg.oversPerInnings,
        // A completed state's battingFirstIndex already reflects any toss,
        // so this is a true swap of who bats first.
        battingFirstIndex: (1 - cfg.battingFirstIndex) as 0 | 1,
        commonPlayer: cfg.commonPlayer ?? null,
        ...(location ? { location } : {}),
      };
      // The server grants scoring rights to this browser's session cookie
      // during the POST; the console reads /role, so nothing to store here.
      const { id } = await fetchJSON<{ id: string; adminKey: string }>('/api/matches', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      router.push(`/umpire/${id}`);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false); // on success the navigation takes over; stay inert
    }
  }

  return (
    <div>
      <button
        className={`btn btn-primary${block ? ' btn-block' : ''}`}
        disabled={busy}
        onClick={start}
      >
        {busy ? 'Setting up the rematch…' : 'Rematch'}
      </button>
      <p className="hint" style={{ marginTop: 8, textAlign: 'center' }}>
        Same teams — batting order swapped. Hold a fresh toss from the console if you like.
      </p>
    </div>
  );
}
