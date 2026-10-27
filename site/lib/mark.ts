/**
 * dotschema's mark, the one place it is drawn. The brand at the top of the left column
 * (components/brand.tsx), the link preview (app/routes/opengraph-image.tsx) and every icon the site
 * serves, `/icon.svg`, `/favicon.ico`, `/apple-icon.png` and the manifest's tiles (app/routes/icon.ts
 * and app/routes/icon-png.tsx), are drawn from `mark` at build time, so a new mark is a change to
 * this file.
 *
 * Zod's shield upside down, solid in Zod's gradient, with a dot cut through it: the maintainer's pick
 * of 2026-10-27. Of the variants of the shield and the dot drawn for them (`shield.html`, beside the
 * docs thread) they took the solid shield with the dot cut through ("I really just want it to be a
 * dot. Basically, number 14 is good. The Z does not need to be there. Number 14 is good, and I like
 * that it's centered. Let's lock it in."), then asked for it "flipped upside down", and of the four
 * ways up (`flip.html`) picked D, the point up and the dot lowered into the wide part. The shield
 * keeps the proportions of Zod's (`logo.svg` in Zod's repository: a flat edge 60% of the width, the
 * widest point 44% of the way from it), turned over on a 32-unit square, its corners rounded by a
 * 2-unit stroke, and the gradient is Zod's, #3a6aff at the foot to #45a9ff at the top. The same
 * drawing serves the light and the dark page.
 */
export type Mark = {
  name: string;
  /**
   * The drawing's elements, in SVG, on a 32-unit square. `id` names its gradient and must be unique
   * in the document: the brand is drawn twice on a page, one copy hidden at each width, and a
   * browser paints no gradient from inside a hidden SVG.
   */
  svg: (id: string) => string;
};

/**
 * The dot is a hole in the shape, a circle of radius 5.5 under the even-odd rule, which the 2-unit
 * stroke narrows to 4.5, rather than a mask, so the drawing needs one id and no more.
 */
const shieldDot: Mark = {
  name: 'Shield dot',
  svg: (id) =>
    `<defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#3a6aff"/><stop offset="1" stop-color="#45a9ff"/></linearGradient></defs>` +
    `<path d="M8.6 26.5H23.4L28.8 17.4L16 6L3.2 17.4ZM16 13.1A5.5 5.5 0 1 0 16 24.1A5.5 5.5 0 1 0 16 13.1Z" fill="url(#${id})" fill-rule="evenodd" stroke="url(#${id})" stroke-width="2" stroke-linejoin="round"/>`,
};

/** The mark the site shows. */
export const mark: Mark = shieldDot;

/** The dark page's background, the tile of the icons a home screen shows. */
export const markColor = { background: '#0e0e0e' };

/** The mark as an SVG document, the same on a light page and a dark one. */
export function markSvg(drawing: Mark = mark): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${drawing.svg('mark')}</svg>\n`;
}
