// useMatch — GET the match once, then follow live updates over SSE
// (react-native-sse). Frames are bare publicState JSON; heartbeat comments
// are ignored by the parser. Reconnects with 1s -> 5s backoff, and refetches
// on screen focus so a backgrounded app catches up instantly.

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useFocusEffect } from 'expo-router';
import EventSource from 'react-native-sse';
import { ApiError, getMatch, sessionAuthHeaders, streamUrl } from './api';
import type { PublicState } from './types';

export interface UseMatchResult {
  state: PublicState | null;
  setState: Dispatch<SetStateAction<PublicState | null>>;
  connected: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMatch(matchId: string | undefined): UseMatchResult {
  const [state, setState] = useState<PublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const streamedRef = useRef(false);

  useEffect(() => {
    if (!matchId) return undefined;
    let cancelled = false;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    // Session Authorization header, resolved before the stream opens. Live
    // streaming is public — this just keeps every call consistently
    // authenticated (react-native-sse supports a headers option).
    let authHeaders: Record<string, string> = {};
    streamedRef.current = false;

    getMatch(matchId)
      .then((s) => {
        // An SSE frame is always at least as fresh as the GET.
        if (!cancelled && !streamedRef.current) {
          setState(s);
          setError(null);
        }
      })
      .catch((err: ApiError) => {
        if (!cancelled && !streamedRef.current) setError(err.message);
      });

    function open() {
      if (cancelled) return;
      es = new EventSource(streamUrl(matchId!), { pollingInterval: 0, headers: authHeaders });
      es.addEventListener('open', () => {
        if (cancelled) return;
        attempts = 0;
        setConnected(true);
      });
      es.addEventListener('message', (event) => {
        if (cancelled || !event.data) return;
        let next: unknown;
        try { next = JSON.parse(event.data); } catch { return; }
        if (!next || typeof next !== 'object') return;
        streamedRef.current = true;
        setState(next as PublicState);
        setError(null);
        setConnected(true);
      });
      es.addEventListener('error', () => {
        if (cancelled) return;
        setConnected(false);
        es?.removeAllEventListeners();
        es?.close();
        es = null;
        // 1s -> 5s backoff.
        attempts += 1;
        const delay = Math.min(5000, 1000 * attempts);
        retryTimer = setTimeout(open, delay);
      });
    }

    // Resolve the session header (best-effort, empty on failure) before the
    // first open so the stream carries the bearer token.
    sessionAuthHeaders().then((auth) => {
      if (cancelled) return;
      authHeaders = auth;
      open();
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.removeAllEventListeners();
      es?.close();
    };
  }, [matchId]);

  const refetch = useCallback(() => {
    if (!matchId) return;
    getMatch(matchId)
      .then((s) => { setState(s); setError(null); })
      .catch(() => { /* the stream (or next focus) will catch up */ });
  }, [matchId]);

  // Refetch on screen focus — SSE may have been dropped while backgrounded.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true; // the mount effect already fetched
        return;
      }
      refetch();
    }, [refetch])
  );

  return { state, setState, connected, error, refetch };
}
