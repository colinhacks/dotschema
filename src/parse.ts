// The two dialects a schema is written in, each read with its positions kept so that a syntax error
// is placed in the file: JSON with comments for `.schema.jsonc`, read with Microsoft's
// jsonc-parser, and JSON5 for `.schema.json5`, read with json5, the JSON5 project's own parser.
// Motherload's `.jsonc` and `.json5` loaders read them the same way (`parseJsoncFile` in
// packages/jsonc/src/loader.ts and `parseJson5File` in packages/json5/src/loader.ts at d21b5ac).
// Each also keeps its `/** */` comments, which the types write as JSDoc (`docOfKey`).
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
  return { ok: true, value: withDocs(tree ? fromTree(tree) : null, source) };
}

/** JSON5: also unquoted keys, single quotes, hex numbers and `Infinity`. json5 defines a `"__proto__"` key as a property. */
export function parseJson5File(source: string): Parsed {
  try {
    return { ok: true, value: withDocs(JSON5.parse(source) as Value, source) };
  } catch (error) {
    const e = error as SyntaxError & { lineNumber?: number; columnNumber?: number };
    if (typeof e.lineNumber === "number") return fail(e.message.replace(/^JSON5: /, ""), offsetOf(source, e.lineNumber, e.columnNumber ?? 1), 1);
    throw error;
  }
}

/**
 * A schema is read in the dialect its suffix names: JSON5 for `.schema.json5`, JSON with comments
 * for `.schema.jsonc`. A byte order mark at the start, which an editor may save, is read past in
 * both: the type check's host strips it before the mapper sees the text, while the preload and the
 * bundlers hand over the file as read, where jsonc-parser refuses it and json5 skips it. A problem's
 * place stays the text's own, the mark counted.
 */
export function parseSchemaFile(source: string, path: string): Parsed {
  const mark = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = mark ? source.slice(1) : source;
  const parsed = path.endsWith(".schema.json5") ? parseJson5File(text) : parseJsoncFile(text);
  return parsed.ok || !mark ? parsed : { ok: false, problems: parsed.problems.map((problem) => ({ ...problem, start: problem.start + mark })) };
}

// ---- doc comments -------------------------------------------------------------------------------

// The `/** */` comments of the files parsed, which the types write as JSDoc where a schema has no
// `description` (DESIGN.md, "The types"): for each object, the text of the one written directly
// before each of its keys, and of one before a file's root. A `//` or `/* */` comment is a note and
// is never read. Kept beside the values rather than in them, so the schema ajv compiles and the
// module exports stays as written; `carryDocs` passes them on to a copy (`mapSchemas` in refs.ts).
const keyDocs = new WeakMap<object, ReadonlyMap<string, string>>();
const rootDocs = new WeakMap<object, string>();

const isObject = (value: Value | undefined): value is { readonly [key: string]: Value } => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** The text of the `/**` comment written directly before `key` in `object`, if there is one. */
export const docOfKey = (object: Value | undefined, key: string): string | undefined => (isObject(object) ? keyDocs.get(object)?.get(key) : undefined);

/** The text of the `/**` comment written directly before a file's root, if there is one. */
export const docOfRoot = (root: Value | undefined): string | undefined => (isObject(root) ? rootDocs.get(root) : undefined);

/** Gives `copy` the doc comments of `original`, of which it is a copy. */
export function carryDocs(original: object, copy: object): void {
  const keys = keyDocs.get(original);
  if (keys) keyDocs.set(copy, keys);
  const root = rootDocs.get(original);
  if (root !== undefined) rootDocs.set(copy, root);
}

/**
 * A `/**` comment's text as TypeScript reads JSDoc: without the delimiters, the leading `*` of
 * each line and the space after it, and blank lines at either end; tags (`@deprecated`,
 * `@example`) stay as written. Undefined when nothing is left.
 */
export function docText(comment: string): string | undefined {
  const lines = comment
    .slice(3, -2)
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .map((line, i) => (i === 0 ? line.trimStart() : line.replace(/^\s*\*? ?/, "")).trimEnd());
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines.at(-1) === "") lines.pop();
  return lines.length ? lines.join("\n") : undefined;
}

/** A key as written in either dialect, quoted or bare, as the parsed value names it. */
function keyOf(raw: string): string | undefined {
  try {
    if (raw.startsWith('"') || raw.startsWith("'")) return JSON5.parse(raw) as string;
    // A bare JSON5 key may hold escapes (`\u0061`), which json5 decodes.
    return Object.keys(JSON5.parse(`{${raw}:0}`) as object)[0];
  } catch {
    return undefined;
  }
}

/**
 * The `/**` comments of a file that parsed, each with the key it is written directly before (no
 * token between them; another comment may be), as the keys from the root to the object that holds
 * it (an array's items by index), or before the root. When two are, the last is the key's, as
 * TypeScript shows the last; the empty plain comment, `/**` closed at once, is not one. One scanner
 * reads both dialects: JSON with comments is JSON5's syntax less some of its forms, and the source
 * has parsed, so only strings, comments and punctuation need telling apart.
 */
function scanDocs(source: string): { root: string | undefined; keys: { path: (string | number)[]; key: string; doc: string }[] } {
  type Frame = { object: true; key: string | undefined; expectKey: boolean } | { object: false; index: number };
  const stack: Frame[] = [];
  const keys: { path: (string | number)[]; key: string; doc: string }[] = [];
  let root: string | undefined;
  let pending: string | undefined;
  let first = true;
  for (let i = 0; i < source.length; ) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && !"\n\r\u2028\u2029".includes(source[i]!)) i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      const comment = source.slice(i, stop);
      if (/^\/\*\*(?!\/)/.test(comment)) pending = docText(comment);
      i = stop;
      continue;
    }
    let token: string;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) j += source[j] === "\\" ? 2 : 1;
      token = source.slice(i, j + 1);
      i = j + 1;
    } else if ("{}[]:,".includes(c)) {
      token = c;
      i++;
    } else {
      let j = i + 1;
      while (j < source.length && !/[\s{}[\]:,"'/]/.test(source[j]!)) j++;
      token = source.slice(i, j);
      i = j;
    }
    const doc = pending;
    pending = undefined;
    if (first && doc !== undefined) root = doc;
    first = false;
    const top = stack.at(-1);
    if (token === "{") stack.push({ object: true, key: undefined, expectKey: true });
    else if (token === "[") stack.push({ object: false, index: 0 });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === ",") {
      if (top?.object) top.expectKey = true;
      else if (top) top.index++;
    } else if (token === ":") {
      if (top?.object) top.expectKey = false;
    } else if (top?.object && top.expectKey) {
      top.key = token;
      top.expectKey = false;
      if (doc !== undefined) keys.push({ path: stack.slice(0, -1).map((frame) => (frame.object ? frame.key! : frame.index)), key: token, doc });
    }
  }
  return { root, keys };
}

/** `value`, parsed from `source`, with the doc comments of its keys and its root recorded. */
function withDocs(value: Value, source: string): Value {
  if (!source.includes("/**")) return value;
  const { root, keys } = scanDocs(source);
  if (root !== undefined && isObject(value)) rootDocs.set(value, root);
  const found = new Map<object, Map<string, string>>();
  for (const { path, key, doc } of keys) {
    let at: Value | undefined = value;
    for (const slot of path) {
      if (typeof slot === "number") at = Array.isArray(at) ? (at as Value[])[slot] : undefined;
      else {
        const name = keyOf(slot);
        // Own properties only: a `"__proto__"` key is one.
        at = isObject(at) && name !== undefined ? Object.getOwnPropertyDescriptor(at, name)?.value : undefined;
      }
    }
    const name = keyOf(key);
    if (!isObject(at) || name === undefined) continue;
    let docs = found.get(at);
    if (!docs) found.set(at, (docs = new Map()));
    docs.set(name, doc);
  }
  for (const [object, docs] of found) keyDocs.set(object, docs);
  return value;
}
