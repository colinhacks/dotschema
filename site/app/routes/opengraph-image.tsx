// The link preview the site shows on X, Slack, Discord, LinkedIn and the rest, written to
// build/client/opengraph-image.png at build time: the page links it as og:image, and as X's image
// too, with a hash of this file's text in its URL (lib/og.server.ts). The card is drawn here rather
// than in a module this file imports, so that a change to the card changes the URL and the caches
// of X and Slack fetch the new card.
//
// The README demo's frame: its blue ground (#3d5afe), the wordmark and the headline in white on the
// left, and on the right the hero's main.ts in a dark editor card, with the type of `data` after
// `user.is(data)` in a popup, as the page's hover and the demo show it (the mapper's own text,
// `{ name: string; role?: "admin" | "member" | undefined; }`, set over four lines). Drawn by
// @vercel/og's ImageResponse (Satori) in Geist and Geist Mono (assets/fonts, SIL Open Font License),
// the code in GitHub's dark colours. Satori lays out flex boxes only, so every element with more than
// one child is a flex box. X lays the domain over the card's bottom-left corner, about 380 × 90 of it
// on a phone, which the layout leaves empty.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { mark } from '@/lib/mark';
import { ogSize } from '@/lib/og';
import { siteUrl } from '@/lib/site';

const color = {
  ground: '#3d5afe',
  white: '#ffffff',
  soft: 'rgba(255, 255, 255, 0.78)',
  chip: 'rgba(255, 255, 255, 0.17)',
  card: '#161616',
  bar: '#a1a1a1',
  popup: '#222222',
  popupBorder: '#3a3a3a',
  keyword: '#f97583',
  plain: '#e1e4e8',
  string: '#9ecbff',
  func: '#b392f0',
  property: '#79b8ff',
};

type Ink = 'keyword' | 'plain' | 'string' | 'func' | 'property';
type Token = [text: string, ink: Ink];

// The hero's main.ts (content/docs/index.mdx), without its hint.
const code: Token[][] = [
  [['import', 'keyword'], [' user ', 'plain'], ['from', 'keyword'], [' "./user.schema.jsonc"', 'string'], [';', 'plain']],
  [],
  [['const', 'keyword'], [' data ', 'plain'], ['=', 'keyword'], [' ', 'plain'], ['await', 'keyword'], [' request.', 'plain'], ['json', 'func'], ['();', 'plain']],
  [],
  [['if', 'keyword'], [' (user.', 'plain'], ['is', 'func'], ['(data)) {', 'plain']],
  [['  data;', 'plain']],
  [['}', 'plain']],
];

// The type of `data` there, as the mapper's module gives it.
const popup: Token[][] = [
  [['const', 'keyword'], [' data', 'plain'], [': {', 'plain']],
  [['    name', 'property'], [': ', 'plain'], ['string', 'func'], [';', 'plain']],
  [['    role', 'property'], ['?: ', 'plain'], ['"admin"', 'string'], [' | ', 'plain'], ['"member"', 'string'], [' | ', 'plain'], ['undefined', 'property'], [';', 'plain']],
  [['}', 'plain']],
];

const MONO = 'Geist Mono';
const SANS = 'Geist';
const CODE = 21;
const LINE = Math.round(CODE * 1.6);

function Lines({ lines, size = CODE }: { lines: Token[][]; size?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontFamily: MONO, fontSize: size }}>
      {lines.map((line, i) => (
        <div key={i} style={{ display: 'flex', whiteSpace: 'pre', height: Math.round(size * 1.6) }}>
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

/** The mark of lib/mark.ts, in white. */
function Mark({ size }: { size: number }) {
  const src = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" color="#ffffff">${mark.svg}</svg>`).toString('base64')}`;
  return <img src={src} width={size} height={size} />;
}

function Card(): ReactNode {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '54px 60px', background: color.ground, fontFamily: SANS, color: color.white }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Mark size={46} />
          <div style={{ display: 'flex', marginLeft: 14, fontSize: 40, fontWeight: 600, letterSpacing: -0.6 }}>dotschema</div>
        </div>
        <div style={{ display: 'flex', fontFamily: MONO, fontSize: 23, color: color.soft }}>{new URL(siteUrl).host}</div>
      </div>
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 56, fontWeight: 600, letterSpacing: -1.2, lineHeight: 1.16 }}>
          <div style={{ display: 'flex' }}>Import</div>
          <div style={{ display: 'flex' }}>
            <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: 46, background: color.chip, borderRadius: 10, padding: '0 10px', marginLeft: -4, letterSpacing: -1 }}>.schema.jsonc</span>
          </div>
          <div style={{ display: 'flex' }}>files into</div>
          <div style={{ display: 'flex' }}>TypeScript,</div>
          <div style={{ display: 'flex' }}>fully typed</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', width: 620, background: color.card, borderRadius: 14, boxShadow: '0 18px 44px rgba(10,20,80,.38)', marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, fontSize: 16, color: color.bar, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 16, top: 14, width: 12, height: 12, borderRadius: 6, background: '#ff5f57' }} />
            <div style={{ position: 'absolute', left: 36, top: 14, width: 12, height: 12, borderRadius: 6, background: '#febc2e' }} />
            <div style={{ position: 'absolute', left: 56, top: 14, width: 12, height: 12, borderRadius: 6, background: '#28c840' }} />
            main.ts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '10px 24px 22px', position: 'relative' }}>
            <Lines lines={code} />
            <div style={{ display: 'flex', position: 'absolute', left: 40, top: 10 + LINE * 6 + 4, background: color.popup, border: `1.5px solid ${color.popupBorder}`, borderRadius: 9, padding: '8px 14px', boxShadow: '0 10px 26px rgba(0,0,0,.45)' }}>
              <Lines lines={popup} size={18} />
            </div>
            <div style={{ display: 'flex', height: LINE * 3 + 4 }} />
          </div>
        </div>
      </div>
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
  const fonts = await Promise.all([font('Geist-600.ttf', SANS, 600), font('GeistMono-400.ttf', MONO, 400), font('GeistMono-500.ttf', MONO, 500)]);
  return new ImageResponse(<Card />, { ...ogSize, fonts });
}
