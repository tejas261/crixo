import type { MetadataRoute } from 'next';

// Web app manifest — makes "Add to Home Screen" install Crixo like an app
// (real icon, standalone window, warm splash) on iOS Safari and Android
// browsers alike.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Crixo — live cricket scoring',
    short_name: 'Crixo',
    description: 'Ball-by-ball cricket scoring, live for everyone.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFF9F0',
    theme_color: '#FFF9F0',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // The icon is full-bleed on the gradient, so it doubles as maskable.
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
