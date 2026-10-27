import type { applyMdxPreset } from 'fumadocs-mdx/config';

type Environment = Parameters<ReturnType<typeof applyMdxPreset>>[0];

/**
 * The MDX options of the page: docs-kit's (each section's Markdown on its heading, Twoslash with its
 * cache and the `// @hover:` directive, a block's errors pinned under their lines, the hanging
 * indent of wrapped code, each distinct popup built once), with dotschema's own: the modules
 * dotschema's mapper returns for the page's schema files, put into each block that imports them,
 * the errors it gives each error example, and the check of the format tables
 * (lib/remark-schemas.ts); Twoslash's options (lib/twoslash.ts); and the languages of the page's
 * other files. The code keeps the GitHub themes, whose colours docs-kit holds to WCAG AA.
 */
export async function mdxOptions(environment: Environment) {
  const { docsMdxOptions } = await import('docs-kit/mdx');
  const { remarkSchemas } = await import('./remark-schemas.ts');
  const { dotschemaTwoslash } = await import('./twoslash.ts');
  return docsMdxOptions(environment, {
    remarkPlugins: [remarkSchemas],
    twoslash: dotschemaTwoslash(),
    langs: ['json', 'jsonc', 'json5', 'sh', 'toml'],
  });
}
