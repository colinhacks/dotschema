// The link preview the site shows on X, Slack, Discord, LinkedIn and the rest, written to
// build/client/opengraph-image.png at build time: the page links it as og:image, and as X's image
// too, with a hash of this file's text in its URL (lib/og.server.ts). The card is drawn here rather
// than in a module this file imports, so that a change to the card changes the URL and the caches
// of X and Slack fetch the new card.
//
// The maintainer's pick of 2026-10-27, 6 of the second round ("Graphite, saber"): a graphite ground,
// the mark of lib/mark.ts and the name, the tagline as the headline on the left, and on the right
// the hero's main.ts in a dark editor running off the card's right edge and foot, its edge a blade
// of light in Zod's blues, as Reylo's mark blooms: a pale core line, a tight bright light round it
// and a wide far one, and a little of the light inside. The type of `data` after `user.is(data)` sits
// in the flow under `data;`, as the page's Twoslash query shows it, the mapper's own text, `{ name:
// string; role?: "admin" | "member"; }`, over four lines, and the `}` closing the `if`
// follows it; the code and the type are one size ("The font size needs to be the same for both the
// code and the auto completion", and of the `}` the first round left out, "It's so easy to include
// it"). No address: the card is the same at any domain. Drawn by @vercel/og's ImageResponse (Satori)
// in Geist and Geist Mono (assets/fonts, SIL Open Font License), the code in GitHub's dark colours.
// Satori lays out flex boxes only, so every element with more than one child is a flex box. X lays
// the domain over the card's bottom-left corner, about 380 × 90 of it on a phone, which the layout
// leaves empty.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { markSvg } from '@/lib/mark';
import { ogSize } from '@/lib/og';

const color = {
  ground: '#121212',
  ink: '#ffffff',
  soft: '#8c8c8c',
  editor: '#0d1117',
  bar: '#7d8590',
  line: '#30363d',
  type: '#161b22',
  keyword: '#ff7b72',
  plain: '#e6edf3',
  string: '#a5d6ff',
  func: '#d2a8ff',
  property: '#79c0ff',
};

/** The blade round the editor: the core, a rim this wide, the light outside it and the light inside. */
const blade = {
  core: 'linear-gradient(to top, #b9cdff, #eef8ff)',
  rim: 3.5,
  outer: '0 0 4px 2px rgba(200,230,255,1), 0 0 12px 5px rgba(69,169,255,.95), 0 0 34px 12px rgba(58,106,255,.75), 0 0 90px 24px rgba(58,106,255,.45)',
  inner: 'inset 0 0 22px 2px rgba(69,169,255,.45)',
};

type Ink = 'keyword' | 'plain' | 'string' | 'func' | 'property';
type Token = [text: string, ink: Ink];

// The hero's main.ts (content/docs/index.mdx), without its blank lines, to the `}` that closes the `if`.
const code: Token[][] = [
  [['import', 'keyword'], [' user ', 'plain'], ['from', 'keyword'], [' "./user.schema.jsonc"', 'string'], [';', 'plain']],
  [['const', 'keyword'], [' data ', 'plain'], ['=', 'keyword'], [' ', 'plain'], ['await', 'keyword'], [' request.', 'plain'], ['json', 'func'], ['();', 'plain']],
  [['if', 'keyword'], [' (user.', 'plain'], ['is', 'func'], ['(data)) {', 'plain']],
  [['  data;', 'plain']],
];
const close: Token[][] = [[['}', 'plain']]];

// The type of `data` there, as the mapper's module gives it.
const type: Token[][] = [
  [['const', 'keyword'], [' data', 'plain'], [': {', 'plain']],
  [['  name', 'property'], [': ', 'plain'], ['string', 'property'], [';', 'plain']],
  [['  role', 'property'], ['?: ', 'plain'], ['"admin"', 'string'], [' | ', 'plain'], ['"member"', 'string'], [';', 'plain']],
  [['}', 'plain']],
];

const MONO = 'Geist Mono';
const SANS = 'Geist';
/** The size of the code and of the type, and Geist Mono's advance, in ems. */
const CODE = 27;
const ADVANCE = 0.6;

function Lines({ lines, height }: { lines: Token[][]; height: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: MONO, fontSize: CODE }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', whiteSpace: 'pre', height: Math.round(CODE * height) }}>
          {line.map(([text, ink], j) => (
            <span key={j} style={{ color: color[ink] }}>
              {text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The mark of lib/mark.ts. */
function Mark({ size }: { size: number }) {
  const src = `data:image/svg+xml;base64,${Buffer.from(markSvg()).toString('base64')}`;
  return <img src={src} width={size} height={size} />;
}

/** main.ts in an editor, the blade round it, at the card's right, running off its edge and foot. */
function Editor(): ReactNode {
  const radius = 18;
  const bar = Math.round(CODE * 1.6);
  const padX = Math.round(CODE * 0.5);
  const padY = Math.round(CODE * 0.35);
  const { rim } = blade;
  return (
    <div style={{ display: 'flex', position: 'absolute', left: 448 - rim, top: 60 - rim, width: 860 + 2 * rim, height: 620 + 2 * rim, padding: rim, borderRadius: radius + rim, backgroundImage: blade.core, boxShadow: blade.outer }}>
      <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: color.editor, borderRadius: radius, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: bar, borderBottom: `1.5px solid ${color.line}`, position: 'relative', fontFamily: SANS, fontSize: 16, color: color.bar }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((dot, i) => (
              <div key={dot} style={{ position: 'absolute', left: 20 + i * 19, top: Math.round(bar / 2 - 6), width: 12, height: 12, borderRadius: 6, background: dot }} />
            ))}
            main.ts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', paddingTop: Math.round(CODE * 0.7), paddingLeft: Math.round(CODE * 1.05) }}>
            <Lines lines={code} height={1.5} />
            <div style={{ display: 'flex', alignSelf: 'flex-start', marginLeft: Math.round(2 * CODE * ADVANCE) - padX, marginTop: 3, marginBottom: 7, padding: `${padY}px ${padX}px`, background: color.type, border: `1.5px solid ${color.line}`, borderRadius: Math.round(CODE * 0.35) }}>
              <Lines lines={type} height={1.42} />
            </div>
            <Lines lines={close} height={1.5} />
          </div>
        </div>
        <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', borderRadius: radius, boxShadow: blade.inner }} />
      </div>
    </div>
  );
}

function Card(): ReactNode {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: color.ground, fontFamily: SANS, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', position: 'absolute', left: 60, top: 54 }}>
        <Mark size={41} />
        <div style={{ display: 'flex', marginLeft: 12, fontSize: 36, fontWeight: 600, letterSpacing: -0.7, color: color.ink }}>dotschema</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', position: 'absolute', left: 60, top: 150, fontSize: 50, fontWeight: 600, lineHeight: 1.14, letterSpacing: -1.2 }}>
        <div style={{ display: 'flex', color: color.ink }}>Import JSON</div>
        <div style={{ display: 'flex', color: color.ink }}>Schemas into</div>
        <div style={{ display: 'flex', color: color.ink }}>TypeScript.</div>
        <div style={{ display: 'flex', marginTop: 20, color: color.soft }}>Fully typed,</div>
        <div style={{ display: 'flex', color: color.soft }}>scary fast.</div>
      </div>
      <Editor />
    </div>
  );
}

const font = async (file: string, name: string, weight: 400 | 600) => ({
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
  const fonts = await Promise.all([font('Geist-600.ttf', SANS, 600), font('GeistMono-400.ttf', MONO, 400)]);
  return new ImageResponse(<Card />, { ...ogSize, fonts });
}
