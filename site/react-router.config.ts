import { copyFileSync } from 'node:fs';
import type { Config } from '@react-router/dev/config';

// The site builds to static files only (build/client): no server renders at run time
// (`ssr: false`), and every path the site has is rendered at build time: the page, the files beside
// it, and the page for a missing address, which Vercel serves from 404.html.
export default {
  ssr: false,
  prerender: ['/', '/404', '/llms.txt', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/opengraph-image.png', '/icon.svg', '/favicon.ico', '/apple-icon.png', '/icon-192.png', '/icon-512.png'],
  buildEnd() {
    copyFileSync('build/client/404/index.html', 'build/client/404.html');
  },
} satisfies Config;
