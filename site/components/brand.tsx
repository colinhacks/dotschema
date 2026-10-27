import { useId } from 'react';
import { mark } from '@/lib/mark';

/**
 * The mark and the name, a link to the top of the page: docs-kit's chrome shows it at the top of the
 * left column, or above the title below xl. The mark (lib/mark.ts), in its own colours, is 24px
 * beside the 18px name, as Motherload's bars are. Each copy names its gradient by its own id, since
 * the other copy may be the hidden one.
 */
export function Brand() {
  const id = `mark-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <a href="/" className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-fd-headings">
      <svg viewBox="0 0 32 32" width={24} height={24} aria-hidden="true" className="size-6 shrink-0" dangerouslySetInnerHTML={{ __html: mark.svg(id) }} />
      dotschema
    </a>
  );
}
