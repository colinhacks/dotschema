/**
 * dotschema's mark, the one place it is drawn. The brand at the top of the left column
 * (components/brand.tsx), the link preview (app/routes/opengraph-image.tsx) and every icon the site
 * serves, `/icon.svg`, `/favicon.ico`, `/apple-icon.png` and the manifest's tiles (app/routes/icon.ts
 * and app/routes/icon-png.tsx), are drawn from `mark` at build time, so a new mark is a change to
 * the one line that picks it.
 *
 * dotschema had no mark; these are three candidates, drawn on 2026-10-27 for the maintainer to pick
 * from (`marks.html` beside the docs thread, each at favicon size, in the brand spot, light and
 * dark). The site is built with the first.
 *
 * Each is drawn on a 32-unit square in one colour, the accent (`--dk-accent`), with strokes and
 * dots on whole units so that it stays sharp at 16 pixels, where a unit is half a pixel.
 */
export type Mark = {
  name: string;
  /** The drawing's elements, in SVG, filled or stroked with `currentColor`. */
  svg: string;
};

/** A schema's object braces around a dot. */
const bracedDot: Mark = {
  name: 'Braced dot',
  svg:
    '<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11.5 4.5C8.5 4.5 7.5 6 7.5 8.5V12.5C7.5 14.3 6.6 15.5 4.5 16C6.6 16.5 7.5 17.7 7.5 19.5V23.5C7.5 26 8.5 27.5 11.5 27.5"/>' +
    '<path d="M20.5 4.5C23.5 4.5 24.5 6 24.5 8.5V12.5C24.5 14.3 25.4 15.5 27.5 16C25.4 16.5 24.5 17.7 24.5 19.5V23.5C24.5 26 23.5 27.5 20.5 27.5"/>' +
    '</g><circle cx="16" cy="16" r="3.5" fill="currentColor"/>',
};

/** A dot, as in the suffix, and a check, the validator. */
const dotCheck: Mark = {
  name: 'Dot and check',
  svg:
    '<circle cx="6.5" cy="23.5" r="3.5" fill="currentColor"/>' +
    '<path d="M12.5 17.5L17.5 22.5L27.5 9.5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
};

/** A schema's tree: a root and the two properties under it. */
const tree: Mark = {
  name: 'Schema tree',
  svg:
    '<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 11V23.5H16"/><path d="M8.5 15.5H16"/></g>' +
    '<circle cx="8.5" cy="8" r="4" fill="currentColor"/><circle cx="21" cy="15.5" r="3.5" fill="currentColor"/><circle cx="21" cy="23.5" r="3.5" fill="currentColor"/>',
};

export const marks: readonly Mark[] = [bracedDot, dotCheck, tree];

/** The mark the site shows: candidate 1 until the maintainer picks. */
export const mark: Mark = marks[0]!;

/**
 * The light and dark accents of app/global.css, which the mark is drawn in, and the dark page's
 * background, the tile of the icons a home screen shows.
 */
export const markColor = { light: '#3d5afe', dark: '#8c9eff', background: '#0e0e0e' };

/**
 * The mark as an SVG document, in the light accent, or the dark one where the browser's theme is
 * dark and it reads the media query inside an icon.
 */
export function markSvg(drawing: Mark = mark): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>svg{color:${markColor.light}}@media (prefers-color-scheme:dark){svg{color:${markColor.dark}}}</style>${drawing.svg}</svg>\n`;
}
