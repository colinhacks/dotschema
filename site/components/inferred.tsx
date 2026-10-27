import type { ReactNode } from 'react';

/*
 * The Inference section's cards, Reylo's (its components/inferred.tsx) without the dialect switch: a
 * schema and the type dotschema gives it, in one card of labelled rows, Schema and Type, both visible
 * at once. The page writes `<Inferred>` around a schema block; lib/remark-schemas.ts fills the Type
 * row with the declaration the mapper's module holds for the schema, so a card cannot go stale.
 */

/** The card. */
export function Inferred({ children }: { children: ReactNode }) {
  return <div className="dotschema-inferred">{children}</div>;
}

/** One labelled row of the card: its label, then its code. */
export function InferredRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dotschema-inferred-row" data-row={label.toLowerCase()}>
      <div className="dotschema-inferred-label">{label}</div>
      <div className="dotschema-inferred-body">{children}</div>
    </div>
  );
}

/** The Type row's band under the schema. */
export function InferredTypes({ children }: { children: ReactNode }) {
  return <div className="dotschema-inferred-types">{children}</div>;
}
