// The link preview the site shows on X, Slack, Discord, LinkedIn and the rest, written to
// build/client/opengraph-image.png at build time: the page links it as og:image, and as X's image
// too, with a hash of this file's text in its URL (lib/og.server.ts). The card is drawn here rather
// than in a module this file imports, so that a change to the card changes the URL and the caches
// of X and Slack fetch the new card; so its colours are copied here from app/global.css and
// lib/code-theme.ts rather than imported.
//
// Monolith, the site's look, the maintainer's answer of 2026-10-27 to how the card should change
// with the site: "Redraw it in Monolith". The night page's ink ground, #0b0b0c, under its grain;
// the mark of lib/mark.ts and the name in its paper, #f4f4f5, the tagline as the headline on the
// left, its second sentence grey, and the rule of the page's title, 3 pixels of paper, under the
// name. On the right, two of the page's code blocks in its night colours, running off the card's
// right edge: behind, the foot of the hero's user.schema.jsonc running off the top, its keys,
// strings, punctuation and `false` in the site's palette; in front of it the hero's main.ts running
// off the foot, the type of `data` after
// `user.is(data)` in the page's pinned query card under `data;`, the mapper's text for it over four
// lines, then the `}` closing the `if`. The code and the type are one size, 27 pixels ("The font size
// needs to be the same for both the code and the auto completion", and of the `}` the first round
// left out, "It's so easy to include it"); no address, so the card is the same at any domain
// (the first card's "drop the URL ... the code block should take up a lot of space ... The text is
// way too small right now"). It replaces "Graphite, saber", the maintainer's pick of the second
// round, a graphite ground and an editor edged in a blade of Zod's blues.
//
// Drawn by @vercel/og's ImageResponse (Satori) in Geist and Geist Mono (assets/fonts, SIL Open Font
// License), keywords in Geist Mono 500 as the page sets them heavier. Satori lays out flex boxes
// only, so every element with more than one child is a flex box. X lays the domain over the card's
// bottom-left corner, about 380 × 90 of it on a phone, which the layout leaves empty.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { markColor, markSvgIn } from '@/lib/mark';
import { ogSize } from '@/lib/og';

/** The night page's colours (app/global.css's `.dark`) and its code's (lib/code-theme.ts). */
const color = {
  ground: '#0b0b0c',
  paper: '#f4f4f5',
  soft: '#8a8a8a',
  block: '#121213',
  edge: '#2a2a2a',
  query: '#1c1c1e',
  text: '#e9e9e9',
  keyword: '#6f95ff',
  string: '#6fcf97',
  number: '#f0a35a',
  key: '#9db6ff',
  punctuation: '#8a8a8a',
};

/** The night page's grain (app/global.css's `--dotschema-grain`), drawn over the card's width. */
const grain = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .21 -.07"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

type Ink = 'keyword' | 'text' | 'string' | 'number' | 'key' | 'punctuation';
type Token = [text: string, ink: Ink];

// The hero's user.schema.jsonc (content/docs/index.mdx), whose foot the card shows.
const schema: Token[][] = [
  [['{', 'punctuation']],
  [['  ', 'text'], ['"type"', 'key'], [': ', 'punctuation'], ['"object"', 'string'], [',', 'punctuation']],
  [['  ', 'text'], ['"properties"', 'key'], [': {', 'punctuation']],
  [['    ', 'text'], ['"name"', 'key'], [': { ', 'punctuation'], ['"type"', 'key'], [': ', 'punctuation'], ['"string"', 'string'], [', ', 'punctuation'], ['"minLength"', 'key'], [': ', 'punctuation'], ['1', 'number'], [' },', 'punctuation']],
  [['    ', 'text'], ['"role"', 'key'], [': { ', 'punctuation'], ['"enum"', 'key'], [': [', 'punctuation'], ['"admin"', 'string'], [', ', 'punctuation'], ['"member"', 'string'], ['] }', 'punctuation']],
  [['  },', 'punctuation']],
  [['  ', 'text'], ['"required"', 'key'], [': [', 'punctuation'], ['"name"', 'string'], ['],', 'punctuation']],
  [['  ', 'text'], ['"additionalProperties"', 'key'], [': ', 'punctuation'], ['false', 'number']],
  [['}', 'punctuation']],
];

// The hero's main.ts, without its blank lines, to the `}` that closes the `if`.
const code: Token[][] = [
  [['import', 'keyword'], [' user ', 'text'], ['from', 'keyword'], [' "./user.schema.jsonc"', 'string'], [';', 'text']],
  [['const', 'keyword'], [' data ', 'text'], ['=', 'keyword'], [' ', 'text'], ['await', 'keyword'], [' request.json();', 'text']],
  [['if', 'keyword'], [' (user.is(data)) {', 'text']],
  [['  data;', 'text']],
];
const close: Token[][] = [[['}', 'text']]];

// The type of `data` there, as the mapper's module gives it.
const type: Token[][] = [
  [['const', 'keyword'], [' data', 'text'], [': {', 'text']],
  [['  name', 'text'], [': ', 'keyword'], ['string', 'text'], [';', 'text']],
  [['  role', 'text'], ['?: ', 'keyword'], ['"admin"', 'string'], [' | ', 'keyword'], ['"member"', 'string'], [';', 'text']],
  [['}', 'text']],
];

const MONO = 'Geist Mono';
const SANS = 'Geist';
/** The size of the code and of the type, and Geist Mono's advance, in ems. */
const CODE = 27;
const ADVANCE = 0.6;
const RADIUS = 6;
/** A code line's height, in ems. */
const LINE = 1.4;

function Lines({ lines, height }: { lines: Token[][]; height: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: MONO, fontSize: CODE }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre', height: Math.round(CODE * height) }}>
          {line.map(([text, ink], j) => (
            <span key={j} style={{ color: color[ink], fontWeight: ink === 'keyword' ? 500 : 400 }}>
              {text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The mark of lib/mark.ts, in the night page's ink. */
function Mark({ size }: { size: number }) {
  const src = `data:image/svg+xml;base64,${Buffer.from(markSvgIn(markColor.paper)).toString('base64')}`;
  return <img src={src} width={size} height={size} />;
}

/** A page's code block: a title bar with the file's name over the code, its frame a hairline. */
function Block({ name, left, top, height, shadow, children }: { name?: string; left: number; top: number; height: number; shadow?: boolean; children: ReactNode }) {
  const bar = Math.round(CODE * 1.45);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left, top, width: 1200 - left + 40, height, background: color.block, border: `1.5px solid ${color.edge}`, borderRadius: RADIUS, overflow: 'hidden', boxShadow: shadow ? '0 18px 48px -8px rgba(0,0,0,.85)' : 'none' }}>
      {name && <div style={{ display: 'flex', alignItems: 'center', height: bar, flexShrink: 0, paddingLeft: Math.round(CODE * 1.05), borderBottom: `1.5px solid ${color.edge}`, fontFamily: SANS, fontSize: 19, color: color.soft }}>{name}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', paddingTop: Math.round(CODE * 0.55), paddingLeft: Math.round(CODE * 1.05) }}>{children}</div>
    </div>
  );
}

function Card(): ReactNode {
  const padX = Math.round(CODE * 0.5);
  const padY = Math.round(CODE * 0.3);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: color.ground, fontFamily: SANS, overflow: 'hidden' }}>
      <img src={`data:image/svg+xml;base64,${Buffer.from(grain).toString('base64')}`} width={1200} height={630} style={{ position: 'absolute', left: 0, top: 0 }} />
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: 60, top: 52, width: 330 }}>
        <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 18, borderBottom: `3px solid ${color.paper}` }}>
          <Mark size={44} />
          <div style={{ display: 'flex', marginLeft: 13, fontSize: 40, fontWeight: 600, letterSpacing: -1.6, color: color.paper }}>dotschema</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 34, fontSize: 48, fontWeight: 600, lineHeight: 1.12, letterSpacing: -1.9 }}>
          <div style={{ display: 'flex', color: color.paper }}>Import JSON</div>
          <div style={{ display: 'flex', color: color.paper }}>Schemas into</div>
          <div style={{ display: 'flex', color: color.paper }}>TypeScript.</div>
          <div style={{ display: 'flex', marginTop: 18, color: color.soft }}>Fully typed,</div>
          <div style={{ display: 'flex', color: color.soft }}>scary fast.</div>
        </div>
      </div>
      <Block left={500} top={-168} height={400}>
        <Lines lines={schema} height={LINE} />
      </Block>
      <Block name="main.ts" left={430} top={196} height={460} shadow>
        <Lines lines={code} height={LINE} />
        <div style={{ display: 'flex', alignSelf: 'flex-start', marginLeft: Math.round(2 * CODE * ADVANCE) - padX, marginTop: 4, marginBottom: 6, padding: `${padY}px ${padX}px`, background: color.query, border: `1.5px solid ${color.edge}`, borderRadius: RADIUS }}>
          <Lines lines={type} height={1.3} />
        </div>
        <Lines lines={close} height={LINE} />
      </Block>
    </div>
  );
}

const font = async (file: string, name: string, weight: 400 | 500 | 600) => ({
  name,
  weight,
  style: 'normal' as const,
  data: await readFile(join(process.cwd(), 'assets/fonts', file)),
});

/**
 * The preview as a PNG, built once, with the site. @vercel/og is 0.11.1, as on Motherload's and
 * Reylo's sites (1.0.3 fails under Node 26 with "Dynamic require of fs is not supported"), loaded
 * here so that only the build loads it.
 */
export async function loader() {
  const { ImageResponse } = await import('@vercel/og');
  const fonts = await Promise.all([
    font('Geist-600.ttf', SANS, 600),
    font('GeistMono-400.ttf', MONO, 400),
    font('GeistMono-500.ttf', MONO, 500),
  ]);
  return new ImageResponse(<Card />, { ...ogSize, fonts });
}
