'use client';

// AccountAvatar — the signed-in user's Google profile photo as a small round
// image, falling back to a warm initial-letter circle when there's no
// picture URL or the image fails to load (googleusercontent URLs rotate and
// expire). referrerPolicy="no-referrer" is required: googleusercontent
// returns 403 when a referrer rides along.

import { useEffect, useState } from 'react';

interface AccountAvatarProps {
  name: string | null;
  email: string | null;
  picture: string | null;
  size: number;
}

export default function AccountAvatar({ name, email, picture, size }: AccountAvatarProps) {
  const [broken, setBroken] = useState(false);
  // A fresh sign-in can swap the URL; give the new one a chance to load.
  useEffect(() => { setBroken(false); }, [picture]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.5) };
  if (picture && !broken) {
    return (
      <img
        className="account-avatar"
        style={style}
        src={picture}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }
  const initial = (name || email || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="account-avatar avatar-fallback" style={style} aria-hidden="true">
      {initial}
    </span>
  );
}
