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
 * 2-unit stroke. It was solid in Zod's gradient, #3a6aff at the foot to #45a9ff at the top, until the
 * site took Monolith the same day (app/global.css): now it is a stamp in the headings' ink, #0b0b0c
 * on the light page and #f4f4f5 on the dark one, so it and every accent are one family.
 */
export type Mark = {
  name: string;
  /** The drawing's elements, in SVG, on a 32-unit square, in one paint: a colour, or `currentColor`. */
  svg: (paint: string) => string;
};

/**
 * The dot is a hole in the shape, a circle of radius 5.5 under the even-odd rule, which the 2-unit
 * stroke narrows to 4.5.
 */
const shieldDot: Mark = {
  name: 'Shield dot',
  svg: (paint) =>
    `<path d="M8.6 26.5H23.4L28.8 17.4L16 6L3.2 17.4ZM16 13.1A5.5 5.5 0 1 0 16 24.1A5.5 5.5 0 1 0 16 13.1Z" fill="${paint}" fill-rule="evenodd" stroke="${paint}" stroke-width="2" stroke-linejoin="round"/>`,
};

/** The mark the site shows. */
export const mark: Mark = shieldDot;

/**
 * Monolith's two inks, the headings' colour of each page (app/global.css), and the tile of the icons
 * a home screen shows, the dark page's ground.
 */
export const markColor = { ink: '#0b0b0c', paper: '#f4f4f5', background: '#0b0b0c' };

/**
 * The mark as an SVG document: the light page's ink, or the dark page's where the reader's system
 * is dark, as a browser tab's favicon.
 */
export function markSvg(drawing: Mark = mark): string {
  const style = `<style>path{fill:${markColor.ink};stroke:${markColor.ink}}@media (prefers-color-scheme:dark){path{fill:${markColor.paper};stroke:${markColor.paper}}}</style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${style}${drawing.svg(markColor.ink)}</svg>\n`;
}

/** The mark in one paint, for a picture whose ground is known: the tiles and the link preview. */
export function markSvgIn(paint: string, drawing: Mark = mark): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${drawing.svg(paint)}</svg>\n`;
}
