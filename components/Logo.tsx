// Crixo brand mark — two crossed cricket bats forming an X with the leather
// ball above, drawn in the same geometric mini-illustration style as the
// player avatars, on the signature apricot→butter gradient badge.

import { useId } from 'react';
import Link from 'next/link';

export function CrixoMark({ size = 24 }: { size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `cx-grad-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Crixo logo: crossed cricket bats and ball"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB86B" />
          <stop offset="1" stopColor="#FFE08A" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill={`url(#${gradId})`} />
      {/* crossed bats: blade+handle as one rounded rect each, ink */}
      <g fill="#4A2B0F">
        <rect x="21.3" y="12.5" width="5.4" height="27" rx="2.7" transform="rotate(30 24 26)" />
        <rect x="21.3" y="12.5" width="5.4" height="27" rx="2.7" transform="rotate(-30 24 26)" />
      </g>
      {/* leather ball with cream seam */}
      <circle cx="24" cy="11.6" r="4.7" fill="#C63D08" />
      <path
        d="M20.9 10.2 a4.4 4.4 0 0 1 6.2 0"
        stroke="#FFF9F0"
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link className="wordmark" href="/">
      <CrixoMark size={22} />
      Crixo
    </Link>
  );
}
