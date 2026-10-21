// The two dialects a schema is written in, each read with its positions kept so that a syntax error
// is placed in the file: JSON with comments for `.schema.jsonc`, read with Microsoft's
// jsonc-parser, and JSON5 for `.schema.json5`, read with json5, the JSON5 project's own parser.
// Motherload's `.jsonc` and `.json5` loaders read them the same way (`parseJsoncFile` in
// packages/jsonc/src/loader.ts and `parseJson5File` in packages/json5/src/loader.ts at d21b5ac).
import JSON5 from "json5";
import { parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";
import { CODES, fail, offsetOf, type Parsed } from "./core/problems.ts";
import type { Value } from "./core/serialize.ts";

/** jsonc-parser's own `parse` assigns keys, which turns a `"__proto__"` key into a prototype; building from the tree defines them. */
function fromTree(node: Node): Value {
  switch (node.type) {
    case "object": {
      const out: Record<string, Value> = {};
      for (const property of node.children ?? []) {
        const [name, value] = property.children ?? [];
        if (!name || !value) continue;
        Object.defineProperty(out, name.value as string, { value: fromTree(value), enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    case "array":
      return (node.children ?? []).map(fromTree);
    default:
      return node.value as Value;
  }
}

/** JSONC: JSON with comments, and trailing commas allowed. */
export function parseJsoncFile(source: string): Parsed {
  const errors: ParseError[] = [];
  const tree = parseTree(source, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: false });
  if (errors.length) return { ok: false, problems: errors.map((e) => ({ message: printParseErrorCode(e.error).replace(/([a-z])([A-Z])/g, "$1 $2"), start: e.offset, length: Math.max(e.length, 1), code: CODES.syntax })) };
  return { ok: true, value: tree ? fromTree(tree) : null };
}

/** JSON5: also unquoted keys, single quotes, hex numbers and `Infinity`. json5 defines a `"__proto__"` key as a property. */
export function parseJson5File(source: string): Parsed {
  try {
    return { ok: true, value: JSON5.parse(source) as Value };
  } catch (error) {
    const e = error as SyntaxError & { lineNumber?: number; columnNumber?: number };
    if (typeof e.lineNumber === "number") return fail(e.message.replace(/^JSON5: /, ""), offsetOf(source, e.lineNumber, e.columnNumber ?? 1), 1);
    throw error;
  }
}

/** A schema is read in the dialect its suffix names: JSON5 for `.schema.json5`, JSON with comments for `.schema.jsonc`. */
export const parseSchemaFile = (source: string, path: string): Parsed => (path.endsWith(".schema.json5") ? parseJson5File(source) : parseJsoncFile(source));
