import { docsMdxComponents } from 'docs-kit/components';
import type { MDXComponents } from 'mdx/types';

/**
 * docs-kit's components (headings with the link icon in the margin and the copy-as-Markdown
 * button, accordions, tabs, `<Details>`, the callout, code tabs and Twoslash's popups); dotschema
 * has none of its own.
 */
export function getMDXComponents(components?: MDXComponents) {
  return docsMdxComponents(components);
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
