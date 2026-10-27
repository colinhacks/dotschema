import path from 'node:path';
import type { DocsTwoslashOptions } from 'docs-kit/mdx';

// Twoslash runs TypeScript's JavaScript API (6.0, from fumadocs-twoslash), which cannot run a
// content mapper. lib/remark-schemas.ts puts the modules dotschema's mapper returns into each block
// as hidden files, so the hovers show the real type. Those modules import their types from
// `dotschema` (`Schema`, `ObjectSchema`), so the package is mounted into every block from the
// repository's own source, src/index.ts, as `node_modules/dotschema` (docs-kit's mountPackage).
// docs-kit (docs-kit/src/mdx/twoslash.ts) adds the cache on disk, the `// @hover:` directive and
// the trimmed documentation.

export function dotschemaTwoslash(): DocsTwoslashOptions {
  return {
    packages: [{ name: 'dotschema', root: path.resolve('..'), entries: ['src/index.ts'] }],
    compilerOptions: {
      // `./user.schema.jsonc` resolves to the hidden `user.schema.d.jsonc.ts`.
      allowArbitraryExtensions: true,
      // `dotschema` resolves through its package.json's `exports`, as in a project.
      module: 99, // ESNext
      moduleResolution: 100, // Bundler
      target: 99, // ESNext, for the top-level `await` of the opening example
      strict: true,
    },
  };
}
