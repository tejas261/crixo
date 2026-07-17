'use client';

// Hosted pay page — /pay/[orderId]. Opened by the mobile app in a browser
// sheet so purchases go through Razorpay checkout.js without native SDKs:
// the app creates the order (POST /api/payments/order with its bearer token)
// and hands this page just the order id. Everything here is public-info only
// (GET /api/payments/orders/[id]); the confirm POST needs no session — the
// verified signature proves the payment and the order row says whose credits
// they are. Kept minimal and fast; responsive at 360px.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Wordmark } from '@/components/Logo';
import { toast } from '@/components/Toasts';
import { fetchJSON, type FetchJSONError } from '@/lib/useMatch';
import { loadCheckout, type RazorpaySuccess } from '@/lib/razorpay-client';

// GET /api/payments/orders/[id]
interface OrderInfo {
  orderId: string;
  amountPaise: number;
  credits: number;
  label: string;
  keyId: string;
  status: 'created' | 'paid';
}

function formatRupees(amountPaise: number): string {
  const rupees = amountPaise / 100;
  return `₹${Number.isInteger(rupees) ? rupees.toLocaleString('en-IN') : rupees.toFixed(2)}`;
}

export default function PayPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params?.orderId;
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!orderId) return undefined;
    let cancelled = false;
    fetchJSON<OrderInfo>(`/api/payments/orders/${encodeURIComponent(orderId)}`)
      .then((o) => {
        if (cancelled) return;
        setOrder(o);
        if (o.status === 'paid') setPaid(true); // already settled → success state
      })
      .catch((err: FetchJSONError) => {
        if (!cancelled) setError({ message: err.message, notFound: err.status === 404 });
      });
    return () => { cancelled = true; };
  }, [orderId, attempt]);

  async function confirmPayment(response: RazorpaySuccess) {
    try {
      await fetchJSON<{ credits: number }>('/api/payments/confirm', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      setPaid(true);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setPaying(false);
    }
  }

  async function pay() {
    if (!order || paying) return;
    setPaying(true);
    try {
      await loadCheckout();
      const Checkout = window.Razorpay;
      if (!Checkout) throw new Error("Couldn't load the payment window — try again");
      const rzp = new Checkout({
        key: order.keyId,
        amount: order.amountPaise,
        currency: 'INR',
        order_id: order.orderId,
        name: 'Crixo',
        description: order.label,
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
      toast((err as Error).message);
      setPaying(false);
    }
  }

  return (
    <div className="wrap pay-wrap">
      <header className="site-header">
        <Wordmark />
      </header>

      {paid ? (
        <div className="result-banner">
          <div className="result-text">Credits added — you can return to the app.</div>
          <p className="hint pay-hint">
            {order ? `${order.credits} credits are on your account.` : 'Your purchase is complete.'}
          </p>
          <Link className="btn-quiet" href="/">Continue on the web instead</Link>
        </div>
      ) : error ? (
        <div className="panel pay-panel">
          <div className="empty-state">
            {error.notFound
              ? "This payment link isn't valid — it may have expired. Go back to the app and start the purchase again."
              : <>Couldn&apos;t load this order — {error.message}.</>}
          </div>
          {!error.notFound && (
            <button
              type="button" className="btn"
              onClick={() => { setError(null); setAttempt((a) => a + 1); }}
            >
              Try again
            </button>
          )}
        </div>
      ) : order == null ? (
        <div className="empty-state">Loading your order…</div>
      ) : (
        <div className="panel pay-panel">
          <div className="pay-credits">{order.credits}</div>
          <div className="pay-label">{order.label}</div>
          <div className="pay-price">{formatRupees(order.amountPaise)}</div>
          <button
            type="button" className="btn btn-primary btn-block"
            disabled={paying}
            onClick={() => void pay()}
          >
            {paying ? 'Opening checkout…' : 'Pay with Razorpay'}
          </button>
          <p className="form-hint">Secure checkout by Razorpay.</p>
        </div>
      )}
    </div>
  );
}
