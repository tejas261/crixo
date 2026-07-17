'use client';

// Account sheet — Google sign-in (via SignInForm) when signed out,
// identity + ad status + sign-out when signed in. The sheetKey flips
// with the auth state so the Sheet re-focuses its first control when
// sign-in completes. When the server's monetization switch is off
// (`purchases` false, from useAds), the ads row and every mention of
// ads/purchases disappear — the signed-in view is just identity + sign out.

import { useState } from 'react';
import Sheet from '@/components/Sheet';
import SignInForm from '@/components/SignInForm';
import AccountAvatar from '@/components/AccountAvatar';
import { toast } from '@/components/Toasts';
import { fetchJSON } from '@/lib/useMatch';
import type { Me } from '@/lib/useAccount';

interface AccountSheetProps {
  open: boolean;
  me: Me | null;
  purchases: boolean; // server monetization switch (useAds().purchases)
  onClose: () => void;
  refresh: () => Promise<void>;
  onRemoveAds: () => void; // swaps this sheet for the remove-ads sheet
}

export default function AccountSheet({
  open, me, purchases, onClose, refresh, onRemoveAds,
}: AccountSheetProps) {
  const [signingOut, setSigningOut] = useState(false);
  const signedIn = Boolean(me?.signedIn);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetchJSON<{ ok: boolean }>('/api/auth/signout', { method: 'POST' });
      await refresh();
      toast('Signed out', 'ok');
      onClose();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Sheet open={open} sheetKey={signedIn ? 'account-in' : 'account-out'} onDismiss={onClose}>
      {signedIn && me ? (
        <>
          <h2>Account</h2>
          {/* Identity row: Google photo (initial-letter fallback) + name + email. */}
          <div className="account-identity">
            <AccountAvatar name={me.name} email={me.email} picture={me.picture} size={40} />
            <div className="account-identity-text">
              <span className="account-identity-name">{me.name ?? me.email ?? 'Signed in'}</span>
              {me.email && <span className="account-identity-email">{me.email}</span>}
            </div>
          </div>
          {purchases && (
            <>
              <div className="account-summary">
                <span className="account-summary-label">Ads</span>
                {me.adFree ? (
                  <strong className="account-status">Ad-free ✓</strong>
                ) : (
                  <button type="button" className="btn" onClick={onRemoveAds}>
                    Remove ads
                  </button>
                )}
              </div>
              <p className="hint">
                {me.adFree
                  ? 'No banners for you, on web and mobile.'
                  : 'One-time purchase — no banners, forever, on web and mobile.'}
              </p>
            </>
          )}
          <div className="account-footer">
            <button
              type="button" className="btn-quiet" disabled={signingOut}
              onClick={() => void signOut()}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      ) : (
        <>
          <h2>Sign in</h2>
          <p className="sheet-sub">
            {purchases
              ? 'Sign in to manage your account and go ad-free.'
              : 'Sign in to manage your account.'}
          </p>
          <SignInForm />
        </>
      )}
    </Sheet>
  );
}
