'use client';

// useAccount — client hook for the signed-in identity + ad-free status.
// GETs /api/me once on mount; refresh() re-fetches after anything that can
// change the account (sign-in, sign-out, an ad-free purchase).

import { useCallback, useEffect, useState } from 'react';
import { fetchJSON } from '@/lib/useMatch';

// Shape of GET /api/me. name/picture come from the Google id_token and are
// null until the first sign-in (and absent claims stay null).
export interface Me {
  signedIn: boolean;
  email: string | null;
  name: string | null;
  picture: string | null;
  adFree: boolean;
}

export interface UseAccountResult {
  me: Me | null; // null while loading or if /api/me failed
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAccount(): UseAccountResult {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await fetchJSON<Me>('/api/me'));
    } catch {
      // Quiet failure: the header simply shows no account area and the app
      // works signed-out — nothing here gates creating or watching a match.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { me, loading, refresh };
}
