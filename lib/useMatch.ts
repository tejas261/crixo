'use client';

// useMatch — client hook: GET the match once, then follow live updates over
// SSE. EventSource reconnects on its own; we surface a "reconnecting…" flag
// (connected=false) between onerror and the next onopen.

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { PublicState } from '@/lib/engine';

// Errors thrown by fetchJSON carry the HTTP status so callers can react to
// specific codes (the umpire console drops its admin key on 403).
export interface FetchJSONError extends Error {
  status?: number;
}

export async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body: { error?: string } | null = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const err: FetchJSONError = new Error((body && body.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export interface UseMatchResult {
  state: PublicState | null;
  setState: Dispatch<SetStateAction<PublicState | null>>;
  connected: boolean;
  error: string | null;
}

export function useMatch(matchId: string | undefined): UseMatchResult {
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    let streamed = false; // an SSE frame is always at least as fresh as the GET

    fetchJSON<PublicState>(`/api/matches/${matchId}`)
      .then((s) => {
        if (!cancelled && !streamed) setState(s);
      })
      .catch((err: FetchJSONError) => {
        if (!cancelled) setError(err.message);
      });

    // Each SSE frame is the bare publicState JSON; heartbeats are comment
    // lines, which EventSource ignores for us.
    const es = new EventSource(`/api/matches/${matchId}/stream`);
    es.onmessage = (e: MessageEvent<string>) => {
      if (cancelled) return;
      let next: unknown;
      try { next = JSON.parse(e.data); } catch { return; }
      if (!next || typeof next !== 'object') return;
      streamed = true;
      setState(next as PublicState);
      setError(null);
    };
    es.onopen = () => { if (!cancelled) setConnected(true); };
    es.onerror = () => { if (!cancelled) setConnected(false); };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [matchId]);

  return { state, setState, connected, error };
}
