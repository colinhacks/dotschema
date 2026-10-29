import type { applyMdxPreset } from 'fumadocs-mdx/config';

type Environment = Parameters<ReturnType<typeof applyMdxPreset>>[0];

/**
 * The MDX options of the page: docs-kit's (each section's Markdown on its heading, Twoslash with its
 * cache and the `// @hover:` directive, a block's errors pinned under their lines, the hanging
 * indent of wrapped code, each distinct popup built once), with dotschema's own: the modules
 * dotschema's mapper returns for the page's schema files, put into each block that imports them,
 * the errors it gives each error example, and the check of the format tables
 * (lib/remark-schemas.ts); Twoslash's options (lib/twoslash.ts); the languages of the page's
 * other files; and Monolith's code themes (lib/code-theme.ts), which give a schema's keys, strings,
 * numbers and punctuation colours of their own.
 */
export async function mdxOptions(environment: Environment) {
  const { docsMdxOptions } = await import('docs-kit/mdx');
  const { remarkSchemas } = await import('./remark-schemas.ts');
  const { dotschemaTwoslash } = await import('./twoslash.ts');
  const { codeThemes } = await import('./code-theme.ts');
  const options = await docsMdxOptions(environment, {
    remarkPlugins: [remarkSchemas],
    twoslash: dotschemaTwoslash(),
    langs: ['json', 'jsonc', 'sh', 'toml'],
  });
  return withThemes(options, await codeThemes());
}

type MdxOptions = Awaited<ReturnType<typeof import('docs-kit/mdx').docsMdxOptions>>;

/**
 * The options with Monolith's Shiki themes (lib/code-theme.ts) in place of Fumadocs' GitHub ones:
 * docs-kit's options take Shiki's colour replacements but no themes, and a replacement maps one
 * colour to one colour, where GitHub paints a JSON key and a number one colour. So the themes are
 * set on the options of Fumadocs' `rehypeCode`, the one rehype plugin given options with `langs`.
 * Twoslash highlights its popups with the same options, so they take the themes too.
 */
function withThemes(options: MdxOptions, themes: Awaited<ReturnType<typeof import('./code-theme.ts').codeThemes>>): MdxOptions {
  const plugins = options.rehypePlugins;
  if (!Array.isArray(plugins)) throw new Error('mdx-options: expected a list of rehype plugins');
  let found = 0;
  const rehypePlugins = plugins.map((plugin) => {
    if (!Array.isArray(plugin) || typeof plugin[1] !== 'object' || plugin[1] === null || !('langs' in plugin[1])) return plugin;
    found++;
    return [plugin[0], { ...plugin[1], themes, defaultColor: false }];
  });
  if (found !== 1) throw new Error(`mdx-options: expected one rehypeCode plugin, found ${found}`);
  return { ...options, rehypePlugins } as MdxOptions;
}
