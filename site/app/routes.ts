import { route, type RouteConfig } from '@react-router/dev/routes';

// The page, at /, the page a missing address gets, and the files beside them, the icons and the link
// preview among them, each rendered to a file at build time (react-router.config.ts). The four PNG
// icons are one module, which tells them apart by their path.
export default [
  route(':slug?', 'routes/page.tsx'),
  route('404', 'routes/not-found.tsx'),
  route('llms.txt', 'routes/llms.ts'),
  route('robots.txt', 'routes/robots.ts'),
  route('sitemap.xml', 'routes/sitemap.ts'),
  route('manifest.webmanifest', 'routes/manifest.ts'),
  route('opengraph-image.png', 'routes/opengraph-image.tsx'),
  route('icon.svg', 'routes/icon.ts'),
  ...['favicon.ico', 'apple-icon.png', 'icon-192.png', 'icon-512.png'].map((file) => route(file, 'routes/icon-png.tsx', { id: `icon:${file}` })),
] satisfies RouteConfig;
