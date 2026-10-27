import './global.css';
import { DocsDocument } from 'docs-kit/document';
import type { ReactNode } from 'react';
import { isRouteErrorResponse, Outlet } from 'react-router';
import type { Route } from './+types/root';
import caveatLatin from '../assets/fonts/caveat-latin.woff2?url';
import geistLatin from '../assets/fonts/geist-latin.woff2?url';
import monoLatin from '../assets/fonts/geist-mono-latin.woff2?url';
import fontsCss from './fonts.css?url';
import { NotFound } from '@/components/not-found';

// The fonts (app/fonts.css): Geist and Geist Mono, the faces of the README's demo, and Caveat for
// the "Leave a star!" note, the files Reylo's site serves: `font-display: optional` for Geist, so a
// font that arrives after the first paint does not rewrap the text, Geist's size-adjusted fallback,
// and the system's monospace behind Geist Mono. Their Latin files are preloaded, so they make the
// first paint on any ordinary connection. The faces are a stylesheet of their own, linked here
// rather than imported by global.css: under `vite dev`, React Router serves the imported CSS as a
// stylesheet that it removes once the page hydrates, and faces declared again then miss
// `optional`'s window (Motherload's page went from IBM Plex to Arial, 2026-10-21). The icons are the
// mark of lib/mark.ts, drawn at build time (app/routes/icon.ts, app/routes/icon-png.tsx).
export const links: Route.LinksFunction = () => [
  { rel: 'stylesheet', href: fontsCss },
  ...[geistLatin, monoLatin, caveatLatin].map((href) => ({ rel: 'preload', href, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' as const })),
  { rel: 'author', href: 'https://github.com/colinhacks' },
  { rel: 'manifest', href: '/manifest.webmanifest' },
  { rel: 'icon', href: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
  { rel: 'icon', href: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', href: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
];

// docs-kit's document: Fumadocs' provider, and the head scripts that show a saved tab choice from
// the first paint and keep a pressed tab under the pointer.
export function Layout({ children }: { children: ReactNode }) {
  return <DocsDocument>{children}</DocsDocument>;
}

export default function App() {
  return <Outlet />;
}

// What a failed navigation shows: the missing-address page for a 404 (a link to a page the site
// does not have), and the status for anything else, with the error itself in `vite dev`.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) return <NotFound status={error.status} text={error.status === 404 ? undefined : error.statusText || 'This page could not be shown.'} />;
  return <NotFound status={500} text={import.meta.env.DEV ? String(error) : 'This page could not be shown.'} />;
}
