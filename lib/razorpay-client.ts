'use client';

// Razorpay checkout.js client glue (browser-only): the window.Razorpay typing
// and the on-demand script loader, shared by the remove-ads sheet and the
// hosted /pay/[orderId] page. The loader is a module-level singleton: one
// <script> per page load, retryable on error.

// The fields Razorpay hands to `handler` on success — POSTed verbatim to
// /api/payments/confirm for signature verification.
export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayOptions {
  key: string;
  amount: number;
  currency?: string;
  order_id: string;
  name: string;
  description?: string;
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}

export interface RazorpayInstance {
  open: () => void;
  on: (
    event: 'payment.failed',
    handler: (response: { error?: { description?: string } }) => void,
  ) => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

// checkout.js script singleton: one <script> per page load, retryable on error.
let checkoutLoader: Promise<void> | null = null;
export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutLoader) {
    checkoutLoader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        checkoutLoader = null; // allow a retry on the next attempt
        script.remove();
        reject(new Error("Couldn't load the payment window — check your connection"));
      };
      document.head.appendChild(script);
    });
  }
  return checkoutLoader;
}
