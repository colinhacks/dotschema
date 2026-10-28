// The icons as PNG, drawn from the mark of lib/mark.ts at build time, so a new mark redraws them:
// each a tile, the mark in the dark page's ink on its ground, since an ink mark on nothing would
// vanish in a dark tab strip: /favicon.ico (a PNG in an ICO, 48px, for a browser that takes no SVG
// icon), /apple-icon.png (180px) and the manifest's /icon-192.png and /icon-512.png. One module for
// the four routes (app/routes.ts), each telling it apart by its path. Drawn by @vercel/og's
// ImageResponse (Satori), as the link preview is.
import { markColor, markSvgIn } from '@/lib/mark';

const svgImage = `data:image/svg+xml;base64,${Buffer.from(markSvgIn(markColor.paper)).toString('base64')}`;

async function png(size: number, favicon: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const { ImageResponse } = await import('@vercel/og');
  // A home screen's tile keeps its mark to 62% of it, inside the safe zone a launcher's mask keeps;
  // a favicon, which nothing masks, takes 78%, so it reads at 16px.
  const inner = Math.round(size * (favicon ? 0.78 : 0.62));
  const image = new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: markColor.background, borderRadius: favicon ? Math.round(size * 0.18) : 0 }}>
        <img src={svgImage} width={inner} height={inner} />
      </div>
    ),
    { width: size, height: size },
  );
  return new Uint8Array(await image.arrayBuffer());
}

/** One PNG in an ICO file: the directory, its one entry, then the PNG, which an ICO may hold since Windows Vista. */
function ico(image: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
  const header = new DataView(new ArrayBuffer(22));
  header.setUint16(2, 1, true); // an icon
  header.setUint16(4, 1, true); // one image
  header.setUint8(6, size);
  header.setUint8(7, size);
  header.setUint16(10, 1, true); // planes
  header.setUint16(12, 32, true); // bits per pixel
  header.setUint32(14, image.length, true);
  header.setUint32(18, 22, true); // where the image starts
  const out = new Uint8Array(22 + image.length);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(image, 22);
  return out;
}

export async function loader({ request }: { request: Request }) {
  // A prerender asks for the route's data too, at `<path>.data`.
  const name = new URL(request.url).pathname.slice(1).replace(/\.data$/, '');
  if (name === 'favicon.ico') return new Response(ico(await png(48, true), 48), { headers: { 'Content-Type': 'image/x-icon' } });
  const size = { 'apple-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512 }[name];
  if (!size) throw new Response('Not found', { status: 404 });
  return new Response(await png(size, false), { headers: { 'Content-Type': 'image/png' } });
}
