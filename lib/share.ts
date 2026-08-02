'use client';

// Share / copy link.
// navigator.share and navigator.clipboard are both undefined on plain-HTTP
// origins (the normal LAN deployment), so this degrades: share -> async
// clipboard -> hidden-textarea execCommand -> tell the user what to do.

import { toast } from '@/components/Toasts';
import { track } from '@/lib/analytics';

// Copy arbitrary text (no share sheet): async clipboard -> hidden-textarea
// execCommand -> tell the user it failed. Toasts on success.
export async function copyText(
  text: string,
  failMessage = "Couldn't copy — select and copy it by hand instead."
): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied', 'ok');
      return;
    } catch { /* permission denied — fall through */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) {
      toast('Copied', 'ok');
      return;
    }
  } catch { /* not available either */ }
  toast(failMessage);
}

export async function shareOrCopy(url: string, title = 'Match summary'): Promise<void> {
  // Shares are the app's word-of-mouth loop — the highest-value GTM signal.
  track('share', { method: typeof navigator.share === 'function' ? 'sheet' : 'copy' });
  if (navigator.share) {
    try { await navigator.share({ title, url }); } catch { /* dismissed */ }
    return;
  }
  await copyText(url, "Couldn't copy — copy the address bar URL instead.");
}
