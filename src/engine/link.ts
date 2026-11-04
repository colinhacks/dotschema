// A generated check joined to the compiled tree it was written from. The code generator
// (generate.ts) writes a pass/fail check out of a validator's tree as the source of a function
// expression `(r) => (value) => boolean`; `r` holds what that code reads from the tree and does not
// write out as text: the regular expressions, the formats and their comparisons, the values of a
// `const` or `enum` it does not write as literals, and the comparisons the interpreter makes
// (`equal`, `ucs2length`, `multipleOf`, `uniqueItems`), so both give a value the same verdict.
//
// `link` builds `r` from a validator and calls the factory with it. It builds no code from a string,
// so an interpreter-only program, or one whose checks were written into its modules ahead of time
// (AOT), imports this file and never generate.ts:
//
//   import { link } from "./engine/link.ts";         // an AOT module: the factory is in its text
//   const is = link(validator, (r) => { ... });
//
//   import { jit } from "./engine/generate.ts";      // at run time: generate, new Function, link
//   const is = jit(validator) ?? validator.check;
//
// What goes into `r`, and at which index, is decided by one walk of the tree, `planOf`, which the
// generator runs too: the same resources compiled with the same options give the same tree, so a
// factory written at build time finds its entries in an `r` built from the tree compiled at run
// time. The walk also gives a signature of the tree, every keyword and the values it reads, which the
// generated source checks first: a factory linked to a tree other than its own throws rather than
// give verdicts that are not the tree's.
import { equal, ucs2length } from "./equal.ts";
import type { Validator } from "./index.ts";
import { duplicate, isType, merge, multipleOf, record } from "./interpret.ts";
import type { Resource } from "./resources.ts";
import type { JsonType, KeywordNode, SchemaNode } from "./tree.ts";

/** A value as a JavaScript literal the generated code compares with `===`, or undefined for one it reads from `r`. */
export function literal(value: unknown): string | undefined {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    case "boolean":
      return String(value);
    case "number":
      if (Object.is(value, -0)) return "(-0)";
      if (Number.isFinite(value)) return value < 0 ? `(${value})` : String(value);
      return value > 0 ? "(1/0)" : value < 0 ? "(-1/0)" : "(0/0)";
    case "undefined":
      return "void 0";
    case "object":
      return value === null ? "null" : undefined;
  }
  return undefined;
}

/** How many primitives an `enum` may hold for the generated code to compare each with `===`; past it, or with a value it cannot write, a `Set`. */
export const INLINE_ENUM = 8;

/** How an `enum` is checked: never, each value with `===`, or a `Set` of its primitives and `equal` on its objects, as the interpreter does. */
export type EnumPlan = { kind: "never" } | { kind: "inline"; values: readonly unknown[] } | { kind: "set"; primitives: readonly unknown[]; objects: readonly unknown[] };

export function enumPlan(value: readonly unknown[]): EnumPlan {
  if (!value.length) return { kind: "never" };
  const isObject = (v: unknown) => typeof v == "object" && v !== null;
  const objects = value.filter(isObject);
  const primitives = value.filter((v) => !isObject(v));
  if (!objects.length && primitives.length <= INLINE_ENUM && primitives.every((v) => literal(v) !== undefined)) return { kind: "inline", values: primitives };
  return { kind: "set", primitives, objects };
}

/** How a `const` is checked: `===` on a literal, `equal` on an object, or `===` on a value from `r`. */
export type ConstPlan = { kind: "literal"; text: string } | { kind: "equal" } | { kind: "same" };

export function constPlan(value: unknown): ConstPlan {
  if (value && typeof value == "object") return { kind: "equal" };
  const text = literal(value);
  return text === undefined ? { kind: "same" } : { kind: "literal", text };
}

/** The compiled tree as the generator and `link` read it, every list in the order of one walk. */
export interface Plan {
  /** Each schema compiled as a function of its own that the check reaches, the validator's own first. */
  readonly roots: readonly SchemaNode[];
  readonly rootOf: ReadonlyMap<SchemaNode, number>;
  /** Each schema resource a node of the check is in: the dynamic scope's entries, by index. */
  readonly resources: readonly Resource[];
  readonly resourceOf: ReadonlyMap<Resource, number>;
  /** Each `$dynamicRef` and `$recursiveRef` that resolves in the dynamic scope, with the schema each resource that declares its anchor gives it, as `[resource, root]`. */
  readonly dynamics: readonly KeywordNode[];
  readonly candidates: ReadonlyMap<KeywordNode, readonly (readonly [resource: number, root: number])[]>;
  /** Whether some reference reads the dynamic scope, so the check keeps it. */
  readonly dynamicScope: boolean;
  /** `r.re`: each regular expression, one to each source and flags. */
  readonly regexps: readonly RegExp[];
  readonly regexpOf: ReadonlyMap<RegExp, number>;
  /** `r.f` and `r.c`: each format's check and comparison, one to each name. */
  readonly formats: readonly ((data: any) => boolean)[];
  readonly formatOf: ReadonlyMap<string, number>;
  readonly compares: readonly ((a: any, b: any) => number | undefined)[];
  readonly compareOf: ReadonlyMap<string, number>;
  /** `r.v`: the values the code reads rather than writes: a `const` object, an `enum`'s `Set` and its objects, `uniqueItems`' item types; each keyword's first, by the keyword. */
  readonly values: readonly unknown[];
  readonly valueOf: ReadonlyMap<KeywordNode, number>;
  /** The signature of the tree: every node and keyword the walk met, with what each reads, hashed. */
  readonly sig: string;
}

/** The schemas a keyword applies, in the order the walk takes them. */
export function childrenOf(k: KeywordNode): SchemaNode[] {
  const out: SchemaNode[] = [];
  if (k.child) out.push(k.child);
  if (k.then) out.push(k.then);
  if (k.else) out.push(k.else);
  if (k.children) out.push(...k.children);
  if (k.entries) for (const [, node] of k.entries) out.push(node);
  return out;
}

/** What a keyword reads besides its subschemas, as text for the signature. */
function readsOf(k: KeywordNode): string {
  const json = (value: unknown) => {
    try {
      return String(JSON.stringify(value));
    } catch {
      return "?";
    }
  };
  switch (k.keyword) {
    case "properties":
    case "patternProperties":
    case "dependentSchemas":
      return json(k.entries!.map(([key]) => key));
    case "additionalProperties":
      return json([[...k.known!], k.regexps!.map(String)]);
    case "dependencies":
    case "dependentRequired":
      return json([k.required, k.entries!.map(([key]) => key)]);
    case "items":
    case "prefixItems":
    case "additionalItems":
      return json([k.prefix ?? null, k.children ? k.children.length : null]);
    case "contains":
      return json([k.min, k.max ?? null]);
    case "uniqueItems":
      return json(k.itemTypes);
    case "discriminator":
      return json([k.tagName, [...k.mapping!]]);
    case "format":
    case "formatMaximum":
    case "formatMinimum":
    case "formatExclusiveMaximum":
    case "formatExclusiveMinimum":
      return json([k.format!.name, k.format!.type, k.value]);
    case "$ref":
    case "$dynamicRef":
    case "$recursiveRef":
      return k.dynamic ? json(["dynamic", k.dynamic.anchor]) : "";
    case "not":
    case "allOf":
    case "anyOf":
    case "oneOf":
    case "if":
    case "propertyNames":
    case "unevaluatedProperties":
    case "unevaluatedItems":
    case "errorMessage":
      return "";
    case "const":
    case "enum":
      // A value JSON leaves out (`undefined`, `NaN`) is told apart by its literal.
      return Array.isArray(k.value) && k.keyword === "enum" ? `[${k.value.map((v) => literal(v) ?? json(v)).join(",")}]` : (literal(k.value) ?? json(k.value));
    default:
      return json(k.value);
  }
}

/** FNV-1a over the text, twice with different offsets, as 16 hex digits. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The walk: every function root and inline schema the validator's check reaches, the dynamic candidates of each resource the scope can hold, and the tables of `r`. */
export function planOf(validator: Validator): Plan {
  const roots: SchemaNode[] = [];
  const rootOf = new Map<SchemaNode, number>();
  const resources: Resource[] = [];
  const resourceOf = new Map<Resource, number>();
  const dynamics: KeywordNode[] = [];
  const candidates = new Map<KeywordNode, [number, number][]>();
  const regexps: RegExp[] = [];
  const regexpOf = new Map<RegExp, number>();
  const regexpByKey = new Map<string, number>();
  const formats: ((data: any) => boolean)[] = [];
  const formatOf = new Map<string, number>();
  const compares: ((a: any, b: any) => number | undefined)[] = [];
  const compareOf = new Map<string, number>();
  const values: unknown[] = [];
  const valueOf = new Map<KeywordNode, number>();
  let text = "";

  const root = (node: SchemaNode): number => {
    let i = rootOf.get(node);
    if (i === undefined) {
      i = roots.length;
      roots.push(node);
      rootOf.set(node, i);
    }
    return i;
  };
  const resource = (r: Resource): void => {
    if (!resourceOf.has(r)) {
      resourceOf.set(r, resources.length);
      resources.push(r);
    }
  };
  const regexp = (re: RegExp): void => {
    const key = `${re.flags}/${re.source}`;
    let i = regexpByKey.get(key);
    if (i === undefined) {
      i = regexps.length;
      regexps.push(re);
      regexpByKey.set(key, i);
      text += `/${key}`;
    }
    regexpOf.set(re, i);
  };
  const tables = (k: KeywordNode): void => {
    switch (k.keyword) {
      case "pattern":
        regexp(k.regexp!);
        break;
      case "patternProperties":
      case "additionalProperties":
        for (const re of k.regexps!) regexp(re);
        break;
      case "format": {
        const { name, validate } = k.format!;
        if (!formatOf.has(name)) {
          formatOf.set(name, formats.length);
          formats.push(validate);
        }
        break;
      }
      case "formatMaximum":
      case "formatMinimum":
      case "formatExclusiveMaximum":
      case "formatExclusiveMinimum": {
        const { name, compare } = k.format!;
        if (!compareOf.has(name)) {
          compareOf.set(name, compares.length);
          compares.push(compare!);
        }
        break;
      }
      case "const":
        if (constPlan(k.value).kind !== "literal") {
          valueOf.set(k, values.length);
          values.push(k.value);
        }
        break;
      case "enum": {
        const plan = enumPlan(k.value as unknown[]);
        if (plan.kind === "set") {
          valueOf.set(k, values.length);
          values.push(new Set(plan.primitives), plan.objects);
        }
        break;
      }
      case "uniqueItems":
        valueOf.set(k, values.length);
        values.push(k.itemTypes);
        break;
    }
  };
  const visit = (node: SchemaNode): void => {
    resource(node.resource);
    text += `{${node.root ? "R" : ""}${typeof node.schema === "boolean" ? node.schema : ""}${node.typeCheck}${node.types.join("|")}${node.alwaysValid ? "a" : ""}${node.unevaluated ? "u" : ""}`;
    for (const k of node.keywords) {
      text += `;${k.keyword}:${readsOf(k)}`;
      tables(k);
      if (k.dynamic && !candidates.has(k)) {
        dynamics.push(k);
        candidates.set(k, []);
      }
      for (const child of childrenOf(k)) {
        if (child.root) text += `@${root(child)}`;
        else visit(child);
      }
    }
    text += "}";
  };

  root(validator.node);
  let visited = 0;
  const checked = new Map<KeywordNode, number>();
  for (;;) {
    while (visited < roots.length) {
      text += `#${visited}`;
      visit(roots[visited++]!);
    }
    // A dynamic reference resolves, in the scope, to the schema of a resource that declares its
    // anchor: each resource a node of the check is in may be on the scope, and each candidate
    // found adds the nodes and resources of its own, until no resource is left to ask.
    let asked = false;
    for (const k of dynamics) {
      const list = candidates.get(k)!;
      for (let i = checked.get(k) ?? 0; i < resources.length; i++) {
        asked = true;
        const found = k.dynamic!.candidate(resources[i]!);
        if (found) {
          list.push([i, root(found)]);
          text += `~${dynamics.indexOf(k)}:${i}@${rootOf.get(found)}`;
        }
      }
      checked.set(k, resources.length);
    }
    if (!asked && visited === roots.length) break;
  }
  text += `|${resources.length}|${values.length}`;
  return { roots, rootOf, resources, resourceOf, dynamics, candidates, dynamicScope: dynamics.length > 0, regexps, regexpOf, formats, formatOf, compares, compareOf, values, valueOf, sig: hash(text) };
}

const typed = (types: readonly JsonType[], d: unknown): boolean => {
  for (let i = 0; i < types.length; i++) if (isType(types[i]!, d)) return true;
  return false;
};

/** How many items `unique` compares pairwise before it leaves an array to the interpreter's `duplicate`. */
const PAIRWISE = 16;

/**
 * `uniqueItems`' verdict, the interpreter's (`duplicate`): for a short array, every pair compared
 * with no object made. Items of primitive `items` types are compared by the key ajv's loop gives
 * each (`String(item)`, a string with `_` after it beside other types), skipping a wrong-typed item,
 * and a key `__proto__` never matches, since ajv's loop keeps its keys in a plain object; others with
 * `equal`.
 */
export function unique(d: any[], itemTypes: readonly JsonType[]): boolean {
  const n = d.length;
  if (n <= 1) return true;
  if (n > PAIRWISE) return duplicate(d, itemTypes) === undefined;
  let keyed = itemTypes.length > 0;
  for (let t = 0; t < itemTypes.length; t++) if (itemTypes[t] === "object" || itemTypes[t] === "array") keyed = false;
  if (keyed) {
    const proto = itemTypes.length > 1 ? "__proto_" : "__proto__";
    for (let i = n; i--; ) {
      const a = d[i];
      if (!typed(itemTypes, a)) continue;
      for (let j = i; j--; ) {
        const b = d[j];
        if (!typed(itemTypes, b)) continue;
        if (typeof a == "string" ? typeof b == "string" && a === b && a !== proto : typeof b != "string" && (a === b || (a !== a && b !== b))) return false;
      }
    }
    return true;
  }
  for (let i = n; i--; ) for (let j = i; j--; ) if (equal(d[i], d[j])) return false;
  return true;
}

/** Whether a value equals one of an `enum`'s objects. */
const oneEqual = (d: unknown, objects: readonly unknown[]): boolean => {
  for (let i = 0; i < objects.length; i++) if (equal(d, objects[i])) return true;
  return false;
};

/** `r`, built from a plan: the comparisons and the interpreter's record of what was evaluated (`merge`, `record`), shared with the interpreter so both give the same verdict, then the tables. */
export function tablesOf(plan: Plan): Record<string, unknown> {
  return { sig: plan.sig, eq: equal, len: ucs2length, mul: multipleOf, uq: unique, oe: oneEqual, M: merge, R: record, re: plan.regexps, f: plan.formats, c: plan.compares, v: plan.values };
}

/** The check a generated source gives once its `r` is supplied from `validator`'s compiled tree. Builds no code from a string: an AOT module calls it with the factory written into the module. Throws where the factory was written from another tree. */
export function link(validator: Validator, factory: (r: any) => (value: unknown) => boolean): (value: unknown) => boolean {
  return factory(tablesOf(planOf(validator)));
}
