'use client';

// Remove-ads sheet — the single ad-free product + Razorpay checkout.
// Purchases require an account, so signed-out users get the sign-in block
// first; once /api/me flips to signedIn the product appears in place.
// checkout.js is loaded on demand exactly once (singleton loader in
// lib/razorpay-client). On a verified payment /api/me flips to adFree:true —
// refresh() picks that up and every ad slot disappears.

import { useEffect, useState } from 'react';
import Sheet from '@/components/Sheet';
import SignInForm from '@/components/SignInForm';
import { toast } from '@/components/Toasts';
import { useAds } from '@/lib/useAds';
import { fetchJSON, type FetchJSONError } from '@/lib/useMatch';
import { loadCheckout, type RazorpaySuccess } from '@/lib/razorpay-client';
import type { Me } from '@/lib/useAccount';

// GET /api/payments/config — one pack now: the one-time ad-free unlock.
interface Pack {
  id: string;
  credits: number; // legacy field, always 0 for the ad-free pack
  amountPaise: number;
  label: string;
}
interface PaymentsConfig {
  keyId: string;
  packs: Pack[];
}

function formatRupees(amountPaise: number): string {
  const rupees = amountPaise / 100;
  return `₹${Number.isInteger(rupees) ? rupees.toLocaleString('en-IN') : rupees.toFixed(2)}`;
}

interface RemoveAdsSheetProps {
  open: boolean;
  me: Me | null;
  onClose: () => void;
  refresh: () => Promise<void>;
}

export default function RemoveAdsSheet({ open, me, onClose, refresh }: RemoveAdsSheetProps) {
  // Internal guard: when the server's monetization switch is off, no
  // product and no checkout — just a quiet empty state (belt and braces;
  // the entry points are hidden too, but a stale tab can still get here).
  const { purchases } = useAds();
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [paying, setPaying] = useState(false);
  const signedIn = Boolean(me?.signedIn);
  const adFree = Boolean(me?.adFree);

  // Fetch the product the first time the sheet opens (and on manual retry).
  useEffect(() => {
    if (!open || !purchases || config) return undefined;
    let cancelled = false;
    fetchJSON<PaymentsConfig>('/api/payments/config')
      .then((c) => { if (!cancelled) setConfig(c); })
      .catch((err: Error) => { if (!cancelled) setConfigError(err.message); });
    return () => { cancelled = true; };
  }, [open, purchases, config, attempt]);

  const pack = config?.packs.find((p) => p.id === 'adfree') ?? config?.packs[0] ?? null;

  async function confirmPayment(response: RazorpaySuccess) {
    try {
      await fetchJSON<{ ok?: boolean }>('/api/payments/confirm', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      toast("You're ad-free", 'ok');
      await refresh(); // /api/me now says adFree:true — the slots vanish
      onClose();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setPaying(false);
    }
  }

  async function pay() {
    if (!pack || paying) return;
    setPaying(true);
    try {
      const order = await fetchJSON<{
        orderId: string; amountPaise: number; keyId: string;
      }>('/api/payments/order', {
        method: 'POST',
        body: JSON.stringify({ packId: pack.id }),
      });
      await loadCheckout();
      const Checkout = window.Razorpay;
      if (!Checkout) throw new Error("Couldn't load the payment window — try again");
      const rzp = new Checkout({
        key: order.keyId,
        amount: order.amountPaise,
        currency: 'INR',
        order_id: order.orderId,
        name: 'Crixo',
        description: pack.label,
        theme: { color: '#E8590C' },
        handler: (response) => { void confirmPayment(response); },
        modal: {
          ondismiss: () => {
            setPaying(false);
            toast('Payment cancelled — nothing was charged');
          },
        },
      });
      rzp.on('payment.failed', () => {
        toast("Payment didn't go through — nothing was charged");
      });
      rzp.open();
    } catch (err) {
      const e = err as FetchJSONError;
      toast(e.status === 403 ? 'Sign in to remove ads' : e.message);
      setPaying(false);
    }
  }

  return (
    <Sheet
      open={open}
      sheetKey={signedIn ? 'ads-product' : 'ads-signin'}
      onDismiss={paying ? undefined : onClose}
    >
      <h2>Remove ads</h2>
      {!purchases ? (
        <div className="empty-state">Purchases are disabled right now.</div>
      ) : !signedIn ? (
        <>
          <p className="sheet-sub">
            Purchases need an account — sign in and your ad-free unlock stays with you.
          </p>
          <SignInForm />
        </>
      ) : adFree ? (
        // Already bought (e.g. the sheet was open while refresh() landed).
        <div className="empty-state">You&apos;re already ad-free on this account.</div>
      ) : configError ? (
        <div className="empty-state">
          Couldn&apos;t load the product — {configError}.
          <div className="sheet-confirm">
            <button
              type="button" className="btn"
              onClick={() => { setConfigError(null); setAttempt((a) => a + 1); }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : config == null ? (
        <div className="empty-state">Loading…</div>
      ) : pack == null ? (
        <div className="empty-state">Not available right now — try again later.</div>
      ) : (
        <>
          <p className="sheet-sub">One purchase, tied to your account.</p>
          <div className="product-card">
            <div className="product-price">{formatRupees(pack.amountPaise)}</div>
            <div className="product-label">{pack.label}</div>
            <p className="product-benefit">No banners, forever, on web and mobile.</p>
          </div>
          <div className="sheet-confirm">
            <button
              type="button" className="btn btn-primary btn-block"
              disabled={paying}
              onClick={() => void pay()}
            >
              {paying ? 'Opening checkout…' : `Remove ads — ${formatRupees(pack.amountPaise)}`}
            </button>
            <p className="form-hint">One-time purchase · secure checkout by Razorpay.</p>
          </div>
        </>
      )}
    </Sheet>
  );
}
