'use client';

// Bottom sheet dialog. Focus is moved into the sheet when it opens (and when
// its purpose — sheetKey — changes), Tab is trapped inside while open
// (aria-modal promises this), and focus is restored to the opener on close.
// Escape and backdrop click call onDismiss when provided; needs-driven sheets
// pass no onDismiss and instead stay reachable via their own Undo footer.

import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])';

interface SheetProps {
  open: boolean;
  sheetKey: string | null;
  onDismiss?: () => void;
  children: ReactNode;
}

export default function Sheet({ open, sheetKey, onDismiss, children }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const onDismissRef = useRef<(() => void) | undefined>(onDismiss);
  onDismissRef.current = onDismiss;

  // Restore focus to wherever the user was before the sheet opened.
  useEffect(() => {
    if (!open) return undefined;
    const prevFocus = document.activeElement as HTMLElement | null;
    return () => {
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
    };
  }, [open]);

  // Move focus into the dialog when it opens or changes purpose.
  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const first = sheet.querySelector<HTMLElement>('button:not([disabled]), a[href], input');
    (first || sheet).focus();
  }, [open, sheetKey]);

  // Escape mirrors the backdrop click; Tab is trapped inside the sheet.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (e.key === 'Escape') {
        if (onDismissRef.current) onDismissRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = sheet.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusables.length) {
        e.preventDefault();
        sheet.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const inside = sheet.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div
        className="sheet-backdrop"
        onClick={onDismiss ? () => onDismiss() : undefined}
      />
      <div className="sheet" role="dialog" aria-modal="true" tabIndex={-1} ref={sheetRef}>
        {children}
      </div>
    </>
  );
}
