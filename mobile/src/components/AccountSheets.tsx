// Account + Remove ads sheets.
//
// SIGN-IN: Google, completed in the browser. The app mints a short-lived
// link code for its bearer session (POST /api/auth/link-code) and opens
// `${baseUrl}/api/auth/google?link=<code>` in a browser sheet — the backend
// runs Google OAuth there and attaches the identity to this session, landing
// on a "return to the app" page. When the browser closes we poll /api/me for
// ~15s until signedIn flips.
//
// REMOVE ADS: a single one-time product (the 'adfree' pack from
// /api/payments/config). No native Razorpay SDK: POST /api/payments/order
// creates an order against this session's bearer, then the hosted checkout
// page (`${baseUrl}/pay/${orderId}`) opens in a browser sheet
// (expo-web-browser; SFSafariViewController on iOS, a custom tab on Android)
// and marks the account ad-free server-side. When the browser closes we poll
// /api/me for ~10s until adFree flips.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import Svg, { Path } from 'react-native-svg';
import {
  ApiError,
  createLinkCode,
  createPaymentOrder,
  getAdsConfig,
  getMe,
  getPaymentsConfig,
  googleSignInUrl,
  type Me,
  payPageUrl,
  type PaymentPack,
  signOut,
} from '../api';
import Sheet, { SheetSub, SheetTitle } from './Sheet';
import AccountAvatar from './AccountAvatar';
import { toast } from './Toast';
import { Btn, Hint } from './ui';
import { colors, fonts, radius, shadowSm } from '../theme';

interface AccountProps {
  open: boolean;
  onClose: () => void;
  me: Me | null;
  // Re-fetches /api/me, updates the home screen's state, and returns the
  // fresh value (null when the server is unreachable).
  refreshMe: () => Promise<Me | null>;
}

// ---------- browser-return helpers (shared by sign-in and pay) ----------

// Android: openBrowserAsync resolves with {type:'opened'} as soon as the
// custom tab LAUNCHES (unlike iOS, where it resolves on dismiss) — so wait
// for the app to come back to the foreground before declaring the browser
// closed and polling for the outcome.
function waitForReturnToApp(): Promise<void> {
  return new Promise((resolve) => {
    let wentAway = AppState.currentState !== 'active';
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        wentAway = true;
        return;
      }
      if (wentAway) {
        sub.remove();
        resolve();
      }
    });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- shared sign-in (Google via browser) ----------

// The multicolor Google "G", inline so no asset pipeline is involved.
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <Path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </Svg>
  );
}

// "Continue with Google" + caption. Mints a link code for this session,
// opens the browser sign-in page, then polls /api/me (~15s) after the
// browser closes until the backend has attached the Google identity.
// `hint` overrides the caption (the account sheet drops the ads pitch when
// the server's monetization switch is off).
function GoogleSignIn({ refreshMe, hint }: {
  refreshMe: () => Promise<Me | null>;
  hint?: string;
}) {
  const [busy, setBusy] = useState<'idle' | 'browser' | 'confirming'>('idle');

  async function signIn() {
    if (busy !== 'idle') return;
    setBusy('browser');
    try {
      let code: string;
      try {
        ({ code } = await createLinkCode());
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          toast('Try again in a few minutes');
          return;
        }
        throw err;
      }

      // Google OAuth runs in the browser sheet; on success the backend
      // attaches the identity to this session and shows a return page.
      const result = await WebBrowser.openBrowserAsync(googleSignInUrl(code));
      if (result.type === 'opened') await waitForReturnToApp();

      // Browser closed — poll for up to ~15s for signedIn to flip.
      setBusy('confirming');
      for (let i = 0; i < 15; i++) {
        try {
          const now = await getMe();
          if (now.signedIn) {
            await refreshMe();
            toast('Signed in', 'ok');
            return;
          }
        } catch { /* transient — keep polling */ }
        await sleep(1000);
      }
      toast('Sign-in not completed.', 'ok');
      refreshMe();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy('idle');
    }
  }

  return (
    <View style={{ marginTop: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy !== 'idle' }}
        disabled={busy !== 'idle'}
        onPress={signIn}
        style={({ pressed }) => [
          styles.googleBtn,
          busy !== 'idle' && styles.googleBtnBusy,
          pressed && busy === 'idle' && styles.googleBtnPressed,
        ]}
      >
        {busy === 'confirming' ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <>
            <GoogleG />
            <Text style={styles.googleBtnText}>Continue with Google</Text>
          </>
        )}
      </Pressable>
      <Hint center style={{ marginTop: 10 }}>
        {hint ?? 'Sign in to remove ads and keep it across your devices.'}
      </Hint>
    </View>
  );
}

// ---------- account sheet ----------

export function AccountSheet({
  open, onClose, me, refreshMe, onRemoveAds,
}: AccountProps & { onRemoveAds: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  // Server monetization switch — fetched when the sheet opens; until it
  // says yes (or when it can't be reached) the sheet shows no ads row and
  // no "Remove ads" button, just identity + sign out.
  const [purchases, setPurchases] = useState(false);

  // Freshen the account + monetization switch whenever the sheet opens
  // (quietly — refreshMe swallows network errors and returns null, and a
  // failed config fetch just keeps purchases off).
  useEffect(() => {
    if (!open) return undefined;
    refreshMe();
    let cancelled = false;
    getAdsConfig()
      .then((c) => { if (!cancelled) setPurchases(c.purchases === true); })
      .catch(() => { if (!cancelled) setPurchases(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      await refreshMe();
      toast('Signed out', 'ok');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <Sheet open={open} onDismiss={onClose}>
      {me?.signedIn ? (
        <View>
          <SheetTitle>Account</SheetTitle>
          <SheetSub>
            {purchases
              ? 'Purchases follow your Google account — sign in anywhere with '
                + 'the same account and ad-free comes with you.'
              : 'Signed in with your Google account.'}
          </SheetSub>
          {/* Identity block: Google photo (initial-letter fallback) + name + email. */}
          <View style={styles.identityRow}>
            <AccountAvatar name={me.name} email={me.email} picture={me.picture} size={44} />
            <View style={styles.identityText}>
              <Text style={styles.identityName} numberOfLines={1}>
                {me.name ?? me.email ?? 'Google account'}
              </Text>
              {me.email != null && (
                <Text style={styles.identityEmail} numberOfLines={1} ellipsizeMode="middle">
                  {me.email}
                </Text>
              )}
            </View>
          </View>
          {purchases && (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Ads</Text>
              <Text style={[styles.rowValue, me.adFree && styles.rowValueGood]}>
                {me.adFree ? 'Ad-free ✓' : 'Ads shown'}
              </Text>
            </View>
          )}
          <View style={{ marginTop: 16, gap: 8 }}>
            {purchases && !me.adFree && (
              <Btn title="Remove ads" variant="primary" onPress={onRemoveAds} />
            )}
            <Btn
              title={signingOut ? 'Signing out…' : 'Sign out'}
              variant="quiet"
              onPress={onSignOut}
            />
          </View>
        </View>
      ) : (
        <View>
          <SheetTitle>Sign in</SheetTitle>
          <GoogleSignIn
            refreshMe={refreshMe}
            hint={purchases ? undefined : 'Sign in to keep your account across your devices.'}
          />
        </View>
      )}
      <View style={{ marginTop: 8 }}>
        <Btn title="Close" variant="quiet" onPress={onClose} />
      </View>
    </Sheet>
  );
}

// ---------- remove ads sheet ----------

function rupees(amountPaise: number): string {
  const r = amountPaise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toFixed(2)}`;
}

export function RemoveAdsSheet({ open, onClose, me, refreshMe }: AccountProps) {
  // The single 'adfree' pack from /api/payments/config (defensively: the
  // first pack if ids ever change). null = loading.
  const [pack, setPack] = useState<PaymentPack | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [paying, setPaying] = useState<'idle' | 'ordering' | 'confirming'>('idle');

  const loadConfig = useCallback(() => {
    setConfigError(null);
    getPaymentsConfig()
      .then(({ packs }) => {
        setPack(packs.find((p) => p.id === 'adfree') ?? packs[0] ?? null);
        if (!packs.length) setConfigError('no products configured on the server');
      })
      .catch((err: Error) => { setPack(null); setConfigError(err.message); });
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshMe(); // a 403 fix-up elsewhere may have signed the user out
    if (pack == null) loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function pay() {
    if (!pack || paying !== 'idle') return;
    setPaying('ordering');
    try {
      let orderId: string;
      try {
        ({ orderId } = await createPaymentOrder(pack.id));
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          // Session isn't signed in after all — flip the sheet to sign-in
          // (refreshMe sets signedIn=false, which re-renders this sheet).
          await refreshMe();
          toast('Sign in to remove ads');
          return;
        }
        if (err instanceof ApiError && err.status === 502) {
          toast('Payment provider error — check the Razorpay keys on the server');
          return;
        }
        throw err;
      }

      // Hosted checkout in a browser sheet; the page marks this session's
      // account ad-free on success (the order was created with our bearer
      // token).
      const result = await WebBrowser.openBrowserAsync(payPageUrl(orderId));
      if (result.type === 'opened') await waitForReturnToApp();

      // Browser closed — poll for up to ~10s for the webhook to land.
      setPaying('confirming');
      for (let i = 0; i < 10; i++) {
        try {
          const now = await getMe();
          if (now.adFree) {
            await refreshMe();
            toast('Ads removed — thank you!', 'ok');
            onClose();
            return;
          }
        } catch { /* transient — keep polling */ }
        await sleep(1000);
      }
      toast('Payment not completed — ads stay on for now.', 'ok');
      refreshMe();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setPaying('idle');
    }
  }

  const signedIn = me?.signedIn === true;

  return (
    <Sheet open={open} onDismiss={onClose}>
      <SheetTitle>Remove ads</SheetTitle>
      {!signedIn ? (
        <View>
          <SheetSub>
            Sign in first so the purchase sticks to your account.
          </SheetSub>
          <GoogleSignIn refreshMe={refreshMe} />
        </View>
      ) : me?.adFree ? (
        <View>
          <SheetSub>You&apos;re ad-free ✓ — Crixo won&apos;t show you ads on any device.</SheetSub>
        </View>
      ) : (
        <View>
          <SheetSub>
            One payment, no ads forever — on every device you sign into.
            Payment opens Razorpay&apos;s secure checkout in a browser sheet.
          </SheetSub>
          {configError ? (
            <View>
              <Text style={styles.error}>Couldn&apos;t load the product — {configError}</Text>
              <View style={{ marginTop: 10 }}>
                <Btn title="Retry" onPress={loadConfig} small />
              </View>
            </View>
          ) : pack == null ? (
            <Hint center style={{ paddingVertical: 16 }}>Loading…</Hint>
          ) : (
            <View>
              <View style={styles.product}>
                <Text style={styles.productLabel}>{pack.label}</Text>
                <Text style={styles.productPrice}>{rupees(pack.amountPaise)}</Text>
              </View>
              <View style={{ marginTop: 16 }}>
                <Btn
                  title={paying === 'confirming' ? 'Confirming payment…' : 'Pay with Razorpay'}
                  variant="primary"
                  busy={paying !== 'idle'}
                  onPress={pay}
                />
              </View>
            </View>
          )}
        </View>
      )}
      <View style={{ marginTop: 8 }}>
        <Btn title="Close" variant="quiet" onPress={onClose} />
      </View>
    </Sheet>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  // White card with the multicolor G and ink text — Google's sign-in button,
  // in this app's clothes.
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 50,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 13,
    paddingHorizontal: 16,
    ...shadowSm,
  },
  googleBtnBusy: { opacity: 0.6 },
  googleBtnPressed: { transform: [{ scale: 0.97 }] },
  googleBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: 10 },

  // Signed-in identity block: avatar + stacked name/email.
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  identityText: { flex: 1, minWidth: 0, gap: 2 },
  identityName: { fontSize: 15, fontWeight: '600', color: colors.text },
  identityEmail: { fontSize: 12.5, color: colors.muted },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLabel: { fontSize: 13, color: colors.muted },
  rowValue: { fontFamily: fonts.mono, fontSize: 14, color: colors.text },
  rowValueGood: { color: colors.apricotInk },

  // The single "Remove ads" product card.
  product: {
    alignItems: 'center',
    backgroundColor: '#FFF3E6', // pre-blended tint (see ui.tsx btnToggled)
    borderWidth: 1,
    borderColor: colors.apricotDeep,
    borderRadius: radius.sm,
    paddingVertical: 18,
    paddingHorizontal: 12,
    marginTop: 6,
    gap: 6,
  },
  productLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  productPrice: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.apricotInk,
  },
});
