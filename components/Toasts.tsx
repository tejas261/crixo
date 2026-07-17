'use client';

// Toasts — a single fixed region rendered once from the root layout, plus a
// module-level toast() any client code can call (pages, share helper, …).
// The empty region has zero height, so it never intercepts taps.

import { useEffect, useState } from 'react';

export type ToastKind = 'error' | 'ok';

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const listeners = new Set<(t: ToastItem) => void>();
let idCounter = 0;

export function toast(message: string, kind: ToastKind = 'error'): void {
  const t: ToastItem = { id: ++idCounter, message, kind };
  for (const l of listeners) l(t);
}

export default function Toasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const onToast = (t: ToastItem) => {
      setToasts((cur) => [...cur, t]);
      const timer = setTimeout(() => {
        timers.delete(timer);
        setToasts((cur) => cur.filter((x) => x.id !== t.id));
      }, 3500);
      timers.add(timer);
    };
    listeners.add(onToast);
    return () => {
      listeners.delete(onToast);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'ok' ? ' ok' : ''}`}>{t.message}</div>
      ))}
    </div>
  );
}
