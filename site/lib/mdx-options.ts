import type { applyMdxPreset } from 'fumadocs-mdx/config';

type Environment = Parameters<ReturnType<typeof applyMdxPreset>>[0];

/**
 * The MDX options of the page: docs-kit's (each section's Markdown on its heading, Twoslash with its
 * cache and the `// @hover:` directive, a block's errors pinned under their lines, the hanging
 * indent of wrapped code, each distinct popup built once), with dotschema's own: the modules
 * dotschema's mapper returns for the page's schema files, put into each block that imports them,
 * the errors it gives each error example, and the check of the format tables
 * (lib/remark-schemas.ts); Twoslash's options (lib/twoslash.ts); the languages of the page's
 * other files; and Monolith's palette (app/global.css).
 */
export async function mdxOptions(environment: Environment) {
  const { docsMdxOptions } = await import('docs-kit/mdx');
  const { remarkSchemas } = await import('./remark-schemas.ts');
  const { dotschemaTwoslash } = await import('./twoslash.ts');
  return docsMdxOptions(environment, {
    remarkPlugins: [remarkSchemas],
    twoslash: dotschemaTwoslash(),
    langs: ['json', 'jsonc', 'json5', 'sh', 'toml'],
    // Monolith's code: each GitHub theme colour, by role, as ink, a grey for strings and comments,
    // and Zod's blue for keywords, which app/global.css sets a weight heavier. Measured as WCAG
    // contrast on the code blocks: the blue #3060ff 4.76:1 by day (Zod's own #3a6aff is 4.31:1)
    // and #6f95ff 6.6:1 by night; the comments #707070 4.76:1 and #8a8a8a 5.4:1. A Twoslash popup
    // is the other theme's card, so it paints its code in the other theme's colours.
    colorReplacements: {
      'github-light': {
        '#d73a49': '#3060ff', // keyword
        '#24292e': '#1a1a1a', // text
        '#032f62': '#4a4a4a', // string
        '#005cc5': '#1a1a1a', // constant, property, a JSON key
        '#6f42c1': '#1a1a1a', // function, type
        '#6a737d': '#707070', // comment
        '#e36209': '#1a1a1a', // variable
        '#22863a': '#1a1a1a', // tag
      },
      'github-dark': {
        '#f97583': '#6f95ff',
        '#e1e4e8': '#e9e9e9',
        '#9ecbff': '#b5b5b5',
        '#dbedff': '#b5b5b5',
        '#79b8ff': '#e9e9e9',
        '#b392f0': '#e9e9e9',
        '#6a737d': '#8a8a8a',
        '#ffab70': '#e9e9e9',
        '#85e89d': '#e9e9e9',
      },
    },
  });
}
