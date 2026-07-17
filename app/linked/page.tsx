'use client';

// /linked — landing page after a device-link Google sign-in: the identity is
// now attached to the app's account, so the browser tab has done its job.

import Link from 'next/link';
import { CrixoMark } from '@/components/Logo';

export default function LinkedPage() {
  return (
    <main className="wrap linked-page">
      <CrixoMark size={52} />
      <h1>Signed in</h1>
      <p className="sheet-sub">You can return to the app.</p>
      <Link className="btn-quiet" href="/">Continue in the browser</Link>
    </main>
  );
}
