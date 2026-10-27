import { markColor } from '@/lib/mark';

// For a browser that saves the site to a home screen: the name and the tile (/icon-192.png and
// /icon-512.png, the mark of lib/mark.ts on the dark page's background, app/routes/icon-png.tsx),
// on the dark page's own background. Written to build/client/manifest.webmanifest.
export function loader() {
  const manifest = {
    name: 'dotschema',
    short_name: 'dotschema',
    description: 'Import JSON Schemas into TypeScript. Fully typed, scary fast.',
    start_url: '/',
    display: 'browser',
    background_color: markColor.background,
    theme_color: markColor.background,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
}
