import { docsMdxComponents } from 'docs-kit/components';
import type { MDXComponents } from 'mdx/types';
import { Inferred, InferredRow, InferredTypes } from './inferred';

/**
 * docs-kit's components (headings with the link icon in the margin and the copy-as-Markdown
 * button, accordions, tabs, `<Details>`, the callout, code tabs and Twoslash's popups), and the
 * Inference section's cards, a schema and its type in labelled rows (components/inferred.tsx;
 * lib/remark-schemas.ts fills them).
 */
export function getMDXComponents(components?: MDXComponents) {
  return docsMdxComponents({ Inferred, InferredRow, InferredTypes, ...components });
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
