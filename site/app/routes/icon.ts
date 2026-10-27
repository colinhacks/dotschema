import { markSvg } from '@/lib/mark';

// The favicon as an SVG, the mark of lib/mark.ts in the light accent, or the dark one where the
// browser's theme is dark. Written to build/client/icon.svg.
export function loader() {
  return new Response(markSvg(), { headers: { 'Content-Type': 'image/svg+xml' } });
}
