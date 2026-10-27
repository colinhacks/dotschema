import { markSvg } from '@/lib/mark';

// The favicon as an SVG, the mark of lib/mark.ts. Written to build/client/icon.svg.
export function loader() {
  return new Response(markSvg(), { headers: { 'Content-Type': 'image/svg+xml' } });
}
