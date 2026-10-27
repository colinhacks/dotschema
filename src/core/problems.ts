// What a parser hands back: a value, or problems placed in the text. Copied from Motherload's
// `@motherload/core` (packages/core/src/problems.ts at d21b5ac), without the pieces only its data
// formats use (DESIGN.md, "The extraction from Motherload").
import type { Value } from "./serialize.ts";

/** A problem in the source. `start` and `length` count UTF-16 code units, as JavaScript strings do; the mapper converts them to the UTF-8 bytes the protocol speaks. */
export type Problem = { message: string; start: number; length: number; code: number };

export type Parsed = { ok: true; value: Value } | { ok: false; problems: Problem[] };

// Diagnostic codes, shown as `dotschema<code>` by the type check: Motherload's numbers, of which 2
// (a value no module can carry) has no case here, since JSONC and JSON5 hold only such values; 6, a
// problem in the project file (dotschema.jsonc), is dotschema's own.
export const CODES = { syntax: 1, unknownFormat: 3, schema: 4, option: 5, project: 6 } as const;

/** The UTF-16 offset of a 1-based line and column. */
export function offsetOf(source: string, line: number, column: number): number {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
  }
  return Math.min(offset + Math.max(column - 1, 0), source.length);
}

export const fail = (message: string, start: number, length: number, code: number = CODES.syntax): Parsed => ({ ok: false, problems: [{ message, start, length: Math.max(length, 1), code }] });
