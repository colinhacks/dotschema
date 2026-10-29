// The value `.validate()` returns (DESIGN.md, "The value `.validate()` gives"): the value given,
// with each `default` of a property it lacks filled in and each `transform` applied to its strings
// before it is validated, and once it passes, each property that holds `undefined` and each key that
// no schema of an open object lists dropped, so its type is the schema's output type. Nothing is
// changed in place: an object or array is copied where something under it changes, and the value
// given comes back itself where nothing does. The schemas are read here, when the module is built,
// into a plan the module's run time (`outputRuntime`) walks beside the value.
import type { Problem } from "./core/problems.ts";
import type { Value } from "./core/serialize.ts";
import { fileOf, fragmentPath, pointTo, resolvedSchemas, type Files } from "./refs.ts";
import type { Draft } from "./schema-types.ts";

type Obj = { readonly [key: string]: Value };
const isObj = (value: Value | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
const strings = (value: Value | undefined): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

type Primitive = string | number | boolean | null;
const isPrimitive = (value: Value | undefined): value is Primitive => value === null || ["string", "number", "boolean"].includes(typeof value);

/**
 * Which schema is applied where a property's value or an item has to choose: a `const` or `enum`
 * test on one property (`k`, its values `v`, whether the key is required `q`, whether a value that
 * is not an object fails `o`), which the run time reads itself, or the index of a validator the
 * module carries for it (`tests`).
 */
export type Test = { k: string; v: Primitive[]; q: 0 | 1; o: 0 | 1 } | number;

/** An `anyOf` or `oneOf`: its members (`b`), and the property that tells them apart (`k`, each member's values in `v`), or a validator for each member (`t`); `f` when a member fills or transforms something. */
export interface Union {
  b: (number | null)[];
  k?: string;
  v?: Primitive[][];
  t?: number[];
  f?: 1;
}

/**
 * One schema as the run time reads it; a child is another node's index, or null for a schema that
 * neither lists a key nor changes a value (`{ "type": "string" }`):
 *
 * - `p`: `properties`, each key with its schema; `q`: `patternProperties`; `a`: the schema of every
 *   other key (`additionalProperties`, and from 2019-09 `unevaluatedProperties`, read as one).
 * - `o`: `additionalProperties` or `unevaluatedProperties` is there, whatever its value, so the object
 *   says itself what its other keys are and none is dropped.
 * - `r`: the keys it requires (`required`, `dependentRequired`, draft-07's `dependencies` lists).
 * - `t`: a tuple's items; `i`: the items after them, or every item.
 * - `m`: the schemas that apply in place, `allOf`'s members and the `$ref`'s target; `u`: each
 *   `anyOf` and `oneOf`; `c`: `if`, `then`, `else`, and how the `if` is tested; `e`: the schemas
 *   `dependentSchemas` (draft-07's `dependencies`) applies where its key is present.
 * - `d`: each property's `default`; `x`: `transform`, with `y` the enum's values by lower case for `toEnumCase`.
 * - `n`: a reference that is not followed (a URL, `$dynamicRef`), so the keys it lists are not known.
 * - `f`: something here or below fills or transforms a value.
 */
export interface PlanNode {
  p?: [string, number | null][];
  q?: [string, number | null][];
  a?: number;
  o?: 1;
  r?: string[];
  t?: (number | null)[];
  i?: number;
  m?: number[];
  u?: Union[];
  c?: [number | null, number | null, number | null, Test | null];
  e?: [string, number][];
  d?: [string, Value][];
  x?: string[];
  y?: [string, string][];
  n?: 1;
  f?: 1;
}

/** The plan of a module: its nodes, each entry's own (null where nothing is read), the schemas it needs a validator for, by file and pointer, and its problems, each in a file at a keyword. */
export interface Plan {
  nodes: PlanNode[];
  roots: (number | null)[];
  tests: { path: string; segments: string[] }[];
  /** Whether `.validate()` and `.is()` fill or transform anything before they validate. */
  pre: boolean;
  problems: { path: string; segments: string[]; message: string }[];
  /** Each schema's node, by its file and pointer (`keyOf`), where it has one. */
  at: Map<string, number>;
}

/** The keywords of ajv-keywords' `transform`, each a method of a string; `trimLeft` and `trimRight` are its names for `trimStart` and `trimEnd`. */
export const TRANSFORMS = ["trim", "trimStart", "trimEnd", "trimLeft", "trimRight", "toLowerCase", "toUpperCase", "toEnumCase"];

/** A schema at `segments` in a file, as one key: the plan reads each schema once. */
export const keyOf = (path: string, segments: readonly string[]) => JSON.stringify([path, ...segments]);

/**
 * The plan for `entries`, the root (`undefined`) and each definition, each by its pointer, read from
 * `files` with each `$ref` a pointer (`resolvedSchemas`), in `draft`'s keywords: 2020-12's
 * `prefixItems` and the `items` after it, an earlier draft's list of `items` and `additionalItems`;
 * `unevaluatedProperties`, `unevaluatedItems`, `dependentSchemas` and `dependentRequired` from
 * 2019-09, draft-07's `dependencies` before it.
 */
export function outputPlan(files: Files, rootPath: string, draft: Draft, entries: (readonly string[] | undefined)[]): Plan {
  const schemas = resolvedSchemas(files);
  const later = draft !== "draft-07";
  const nodes: PlanNode[] = [];
  const index = new Map<string, number>();
  const problems: Plan["problems"] = [];
  const tests: Plan["tests"] = [];
  // The schemas a validator is needed for, before they are pruned: by node, the file and pointer.
  const places: { path: string; segments: string[] }[] = [];

  /** Where a `$ref` in `path` points: another schema of the files, or undefined for a URL or nothing. */
  const target = (path: string, ref: string): { path: string; segments: string[] } | undefined => {
    if (ref.startsWith("#")) {
      const segments = fragmentPath(schemas.get(path)!, ref.slice(1));
      return segments && { path, segments };
    }
    const file = fileOf(ref, path);
    if (!file || !schemas.has(file.path)) return undefined;
    const segments = fragmentPath(schemas.get(file.path)!, file.fragment);
    return segments && { path: file.path, segments };
  };

  /** The `default` of the schema at `segments`: its own, or, without one, that of its `$ref`'s target, in turn. */
  const defaultOf = (path: string, segments: string[], depth = 0): { value: Value } | undefined => {
    const schema = pointTo(schemas.get(path)!, segments);
    if (!isObj(schema)) return undefined;
    if (Object.hasOwn(schema, "default")) return { value: schema["default"]! };
    if (typeof schema["$ref"] !== "string" || depth > 16) return undefined;
    const to = target(path, schema["$ref"]);
    return to && defaultOf(to.path, to.segments, depth + 1);
  };

  /** The property that tells the members of an `anyOf` or `oneOf` apart: one each member lists with `const` or `enum`, which it, or the schema around it, requires. */
  const tagOf = (path: string, segments: string[], members: Value[], parent: Obj): { k: string; v: Primitive[][] } | undefined => {
    const resolved = members.map((member, i) => {
      let at = { path, segments: [...segments, String(i)] };
      let schema: Value | undefined = member;
      for (let hops = 0; isObj(schema) && typeof schema["$ref"] === "string" && !isObj(schema["properties"]) && hops < 16; hops++) {
        const to = target(at.path, schema["$ref"]);
        if (!to) return undefined;
        at = to;
        schema = pointTo(schemas.get(to.path)!, to.segments);
      }
      return isObj(schema) ? schema : undefined;
    });
    if (!resolved.every((member): member is Obj => member !== undefined)) return undefined;
    const valuesOf = (member: Obj, key: string): Primitive[] | undefined => {
      const properties = member["properties"];
      const property = isObj(properties) && Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (!isObj(property)) return undefined;
      const values = Object.hasOwn(property, "const") ? [property["const"]] : Array.isArray(property["enum"]) ? property["enum"] : undefined;
      return values?.every(isPrimitive) ? (values as Primitive[]) : undefined;
    };
    const requires = (owner: Obj, key: string) => strings(owner["required"]).includes(key);
    const first = resolved[0]?.["properties"];
    for (const key of isObj(first) ? Object.keys(first) : []) {
      const values = resolved.map((member) => valuesOf(member, key));
      if (values.some((value) => value === undefined)) continue;
      if (requires(parent, key) || resolved.every((member) => requires(member, key))) return { k: key, v: values as Primitive[][] };
    }
    return undefined;
  };

  /** An `if` that tests one property with `const` or `enum`, as the run time reads it. */
  const ifTest = (test: Value | undefined): Test | undefined => {
    if (!isObj(test) || !Object.keys(test).every((k) => ["properties", "required", "type", "$comment", "title", "description"].includes(k))) return undefined;
    if (test["type"] !== undefined && test["type"] !== "object") return undefined;
    const properties = isObj(test["properties"]) ? test["properties"] : {};
    const keys = Object.keys(properties);
    if (keys.length !== 1) return undefined;
    const key = keys[0]!;
    const required = strings(test["required"]);
    if (required.some((name) => name !== key)) return undefined;
    const property = properties[key];
    if (!isObj(property) || !Object.keys(property).every((k) => ["const", "enum", "type", "$comment", "title", "description"].includes(k))) return undefined;
    const values = Object.hasOwn(property, "const") ? [property["const"]] : Array.isArray(property["enum"]) ? property["enum"] : undefined;
    if (!values?.every(isPrimitive) || (property["type"] !== undefined && !(Object.hasOwn(property, "const") || Array.isArray(property["enum"])))) return undefined;
    return { k: key, v: values as Primitive[], q: required.length ? 1 : 0, o: test["type"] === "object" ? 1 : 0 };
  };

  const build = (path: string, segments: string[]): number | null => {
    const schema = pointTo(schemas.get(path)!, segments);
    if (!isObj(schema)) return null;
    const key = keyOf(path, segments);
    const known = index.get(key);
    if (known !== undefined) return known;
    const at = nodes.length;
    const node: PlanNode = {};
    nodes.push(node);
    places.push({ path, segments });
    index.set(key, at);
    const child = (...more: string[]) => build(path, [...segments, ...more]);

    const properties = schema["properties"];
    if (isObj(properties)) node.p = Object.keys(properties).map((name) => [name, child("properties", name)]);
    const patterns = schema["patternProperties"];
    if (isObj(patterns)) node.q = Object.keys(patterns).map((source) => [source, child("patternProperties", source)]);
    for (const keyword of ["additionalProperties", ...(later ? ["unevaluatedProperties"] : [])]) {
      if (!Object.hasOwn(schema, keyword)) continue;
      node.o = 1;
      const rest = child(keyword);
      if (rest !== null && node.a === undefined) node.a = rest;
    }
    const required = [...strings(schema["required"])];
    const dependencies = later ? schema["dependentRequired"] : schema["dependencies"];
    if (isObj(dependencies)) for (const value of Object.values(dependencies)) required.push(...strings(value));
    if (required.length) node.r = [...new Set(required)];

    // A tuple and the items after it, in the draft's spelling, and `unevaluatedItems` as the rest where nothing else is.
    const items = schema["items"];
    const tuple = draft === "2020-12" ? (Array.isArray(schema["prefixItems"]) ? "prefixItems" : undefined) : Array.isArray(items) ? "items" : undefined;
    if (tuple) node.t = (schema[tuple] as Value[]).map((_, i) => child(tuple, String(i)));
    const restKeyword = tuple === "items" ? "additionalItems" : !Array.isArray(items) && items !== undefined ? "items" : later && Object.hasOwn(schema, "unevaluatedItems") ? "unevaluatedItems" : undefined;
    const rest = restKeyword ? child(restKeyword) : null;
    if (rest !== null) node.i = rest;

    const inPlace: number[] = [];
    if (Array.isArray(schema["allOf"])) schema["allOf"].forEach((_, i) => {
      const member = child("allOf", String(i));
      if (member !== null) inPlace.push(member);
    });
    if (typeof schema["$ref"] === "string") {
      const to = target(path, schema["$ref"]);
      if (!to) node.n = 1;
      else {
        const member = build(to.path, to.segments);
        if (member !== null) inPlace.push(member);
      }
    }
    if (Object.hasOwn(schema, "$dynamicRef") || Object.hasOwn(schema, "$recursiveRef")) node.n = 1;
    if (inPlace.length) node.m = inPlace;

    for (const keyword of ["anyOf", "oneOf"]) {
      const members = schema[keyword];
      if (!Array.isArray(members)) continue;
      const union: Union & { w?: string } = { b: members.map((_, i) => child(keyword, String(i))), w: keyword };
      const tag = tagOf(path, [...segments, keyword], members, schema);
      if (tag) Object.assign(union, tag);
      (node.u ??= []).push(union);
    }
    if (Object.hasOwn(schema, "if")) node.c = [child("if"), Object.hasOwn(schema, "then") ? child("then") : null, Object.hasOwn(schema, "else") ? child("else") : null, ifTest(schema["if"]) ?? null];
    const dependents = later ? schema["dependentSchemas"] : schema["dependencies"];
    if (isObj(dependents)) {
      const each = Object.keys(dependents).flatMap((name): [string, number][] => {
        if (Array.isArray(dependents[name])) return [];
        const member = child(later ? "dependentSchemas" : "dependencies", name);
        return member === null ? [] : [[name, member]];
      });
      if (each.length) node.e = each;
    }

    if (isObj(properties)) {
      const defaults = Object.keys(properties).flatMap((name): [string, Value][] => {
        const found = defaultOf(path, [...segments, "properties", name]);
        return found ? [[name, found.value]] : [];
      });
      if (defaults.length) node.d = defaults;
    }
    if (Object.hasOwn(schema, "transform")) {
      const transform = schema["transform"];
      const named = strings(transform);
      const problem = (message: string) => problems.push({ path, segments: [...segments, "transform"], message });
      if (!Array.isArray(transform) || named.length !== transform.length || named.some((name) => !TRANSFORMS.includes(name))) problem(`"transform" lists the transforms to apply to a string, each one of ${TRANSFORMS.map((name) => `"${name}"`).join(", ")}.`);
      else if (named.length) {
        node.x = named;
        if (named.includes("toEnumCase")) {
          const values = strings(schema["enum"]);
          const lower = values.map((value) => value.toLowerCase());
          if (!Array.isArray(schema["enum"]) || !values.length) problem(`"toEnumCase" needs an "enum" of strings beside it, whose value it gives a string that matches one but for case.`);
          else if (new Set(lower).size !== lower.length) problem(`"toEnumCase" needs the strings of "enum" to differ other than by case.`);
          else node.y = values.map((value, i) => [lower[i]!, value]);
        }
      }
    }
    return at;
  };

  const roots = entries.map((entry) => build(rootPath, entry ? [...entry] : []));

  // What fills or transforms, and what lists a key or says that its other keys are its own: a node
  // with none of these, and nothing below it that has one, is no node at all.
  const children = (node: PlanNode): (number | null | undefined)[] => [
    ...(node.p ?? []).map(([, c]) => c),
    ...(node.q ?? []).map(([, c]) => c),
    node.a,
    ...(node.t ?? []),
    node.i,
    ...(node.m ?? []),
    ...(node.u ?? []).flatMap((union) => union.b),
    ...(node.c ? node.c.slice(0, 3) : []),
    ...(node.e ?? []).map(([, c]) => c),
  ] as (number | null | undefined)[];
  const fills = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    nodes.forEach((node, n) => {
      if (fills.has(n)) return;
      if (node.d || node.x || children(node).some((c) => typeof c === "number" && fills.has(c))) {
        fills.add(n);
        changed = true;
      }
    });
  }
  const live = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    nodes.forEach((node, n) => {
      if (live.has(n)) return;
      if (node.p || node.q || node.o || node.r || node.n || fills.has(n) || children(node).some((c) => typeof c === "number" && live.has(c))) {
        live.add(n);
        changed = true;
      }
    });
  }
  // Each live node renumbered in order, every other child null.
  const renumber = new Map<number, number>();
  [...live].sort((a, b) => a - b).forEach((n, i) => renumber.set(n, i));
  const to = (c: number | null | undefined): number | null => (typeof c === "number" && renumber.has(c) ? renumber.get(c)! : null);
  const out: PlanNode[] = [];
  for (const n of [...live].sort((a, b) => a - b)) {
    const node = nodes[n]!;
    const copy: PlanNode = {};
    if (node.p) copy.p = node.p.map(([key, c]) => [key, to(c)]);
    if (node.q) copy.q = node.q.map(([source, c]) => [source, to(c)]);
    if (to(node.a) !== null) copy.a = to(node.a)!;
    if (node.o) copy.o = 1;
    if (node.r) copy.r = node.r;
    if (node.t && node.t.some((c) => to(c) !== null)) copy.t = node.t.map(to);
    if (to(node.i) !== null) copy.i = to(node.i)!;
    const inPlace = (node.m ?? []).map(to).filter((c): c is number => c !== null);
    if (inPlace.length) copy.m = inPlace;
    const unions = (node.u ?? []).map((union: Union & { w?: string }): Union => {
      const b = union.b.map(to);
      const filled = union.b.some((c) => typeof c === "number" && fills.has(c));
      const out: Union = { b };
      if (union.k !== undefined) Object.assign(out, { k: union.k, v: union.v });
      else if (filled)
        out.t = union.b.map((_, i) => {
          tests.push({ path: places[n]!.path, segments: [...places[n]!.segments, union.w!, String(i)] });
          return tests.length - 1;
        });
      if (filled) out.f = 1;
      return out;
    });
    if (unions.some((union) => union.b.some((c) => c !== null))) copy.u = unions;
    if (node.c) {
      const [test, then, otherwise] = (node.c.slice(0, 3) as (number | null)[]).map(to) as [number | null, number | null, number | null];
      let how = node.c[3];
      if (how === null && [node.c[1], node.c[2]].some((c) => typeof c === "number" && fills.has(c))) {
        tests.push({ path: places[n]!.path, segments: [...places[n]!.segments, "if"] });
        how = tests.length - 1;
      }
      if (test !== null || then !== null || otherwise !== null) copy.c = [test, then, otherwise, how];
    }
    const dependents = (node.e ?? []).flatMap(([key, c]): [string, number][] => (to(c) === null ? [] : [[key, to(c)!]]));
    if (dependents.length) copy.e = dependents;
    if (node.d) copy.d = node.d;
    if (node.x) copy.x = node.x;
    if (node.y) copy.y = node.y;
    if (node.n) copy.n = 1;
    if (fills.has(n)) copy.f = 1;
    out.push(copy);
  }
  const at = new Map<string, number>();
  for (const [key, n] of index) if (renumber.has(n)) at.set(key, renumber.get(n)!);
  return { nodes: out, roots: roots.map(to), tests, pre: roots.some((root) => root !== null && fills.has(root)), problems, at };
}

/** The parts of the run time a module's plan uses (`runtimeParts`), so a module carries no other. */
export interface Parts {
  /** `__pre`: something fills or transforms a value. */
  pre: boolean;
  /** `allOf`'s members and a `$ref`'s target (`m`), each `anyOf` and `oneOf` (`u`), `if` (`c`), `dependentSchemas` (`e`). */
  m: boolean;
  u: boolean;
  c: boolean;
  e: boolean;
  /** An `if` the run time tests itself, by `const` or `enum` (`__passes`). */
  passes: boolean;
  /** `patternProperties` (`q`), the schema of every other key (`a`), a tuple or the items of an array (`t`, `i`). */
  q: boolean;
  a: boolean;
  items: boolean;
  /** `transform` (`x`), and `toEnumCase` among its transforms (`y`). */
  x: boolean;
  y: boolean;
  /** A property's schema that is a node of its own. */
  nested: boolean;
}

/** Every part, for a run time that reads any plan, as the type check's check of each `default` runs it. */
export const EVERY_PART: Parts = { pre: true, m: true, u: true, c: true, e: true, passes: true, q: true, a: true, items: true, x: true, y: true, nested: true };

/** The parts `plan` uses. */
export function runtimeParts(plan: Plan): Parts {
  const has = (test: (node: PlanNode) => unknown) => plan.nodes.some(test);
  return {
    pre: plan.pre,
    m: has((node) => node.m),
    u: has((node) => node.u),
    c: has((node) => node.c),
    e: has((node) => node.e),
    passes: has((node) => node.c && node.c[3] !== null && typeof node.c[3] === "object"),
    q: has((node) => node.q),
    a: has((node) => node.a !== undefined),
    items: has((node) => node.t || node.i !== undefined),
    x: has((node) => node.x),
    y: has((node) => node.y),
    nested: has((node) => node.p?.some(([, child]) => child !== null)),
  };
}

/**
 * The run time that walks a plan beside a value, which a module carries where a schema lists a key
 * or changes a value, with only the `parts` its plan uses: `__pre`, before the value is validated,
 * fills each property's `default` it lacks (or holds `undefined`) and applies each `transform`, where
 * the schema applies (`allOf`, a `$ref`, the member of an `anyOf` or `oneOf` its tag names or that
 * passes its validator once filled, `then` or `else` as `if` passes, a present key's
 * `dependentSchemas`); `__post`, once it passed, drops each property that holds `undefined`, which
 * ajv passed as absent, and each key of an open object that no schema there lists (every member of
 * an `anyOf` or `oneOf` read, but for the one its tag names). Each copies an object or array before
 * it changes it, once, and returns the value it was given where nothing changed. `N` is the module's
 * nodes, `T` its validators.
 */
export function outputRuntime(parts: Parts): string {
  const { pre, m, u, c, e, passes, q, a, items, x, y, nested } = parts;
  const when = (condition: boolean, code: string) => (condition ? code : "");
  // Where each node stands alone, an object whose properties hold nothing the plan reads, `__post`
  // reads one node, as the whole one reads that plan.
  if (!pre && !m && !u && !c && !e && !q && !a && !items && !nested)
    return `
const __isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const __post = (N, s, v) => {
  if (!__isObject(v)) return v;
  const open = !s.n && !s.o && ((s.p && s.p.length) || (s.r && s.r.length));
  let c;
  for (const k of Object.keys(v))
    if (s.p && s.p.some((p) => p[0] === k) ? v[k] === undefined : open && !(s.r && s.r.includes(k))) {
      c = c || { ...v };
      delete c[k];
    }
  return c || v;
};
`;
  return `
const __own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const __isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);${when(
    q,
    `
const __patterns = new Map();
const __matches = (source, key) => {
  let re = __patterns.get(source);
  if (!re) __patterns.set(source, (re = new RegExp(source, "u")));
  return re.test(key);
};`,
  )}
// Copy on write: \`v\` with \`k\` set to \`x\`, copied first unless this pass made it (\`fresh\`).
const __write = (v, k, x, fresh) => {
  if (__own(v, k) && Object.is(v[k], x)) return v;
  const c = fresh.has(v) ? v : Array.isArray(v) ? v.slice() : { ...v };
  fresh.add(c);
  Object.defineProperty(c, k, { value: x, writable: true, enumerable: true, configurable: true });
  return c;
};
const __without = (v, k, fresh) => {
  const c = fresh.has(v) ? v : { ...v };
  fresh.add(c);
  delete c[k];
  return c;
};${when(
    passes,
    `
// Whether a value passes an \`if\` that tests one property with \`const\` or \`enum\`.
const __passes = (test, v) => (__isObject(v) ? (__own(v, test.k) ? test.v.includes(v[test.k]) : !test.q) : !test.o);`,
  )}${when(
    u,
    `
// The members of an \`anyOf\` or \`oneOf\` its tag names, or every member.
const __members = (u, v) => (u.k === undefined ? u.b : u.b.filter((b, i) => __isObject(v) && __own(v, u.k) && u.v[i].includes(v[u.k])));`,
  )}
// The schemas of a key's value, in each node of \`all\`, as JSON Schema applies them.
const __keyed = (all, k, out) => {
  for (const s of all) {
    const own = s.p && s.p.find((p) => p[0] === k);
    if (own && own[1] !== null) out.push(own[1]);${when(
      q,
      `
    let matched = false;
    for (const [source, c] of s.q || [])
      if (__matches(source, k)) {
        matched = true;
        if (c !== null) out.push(c);
      }`,
    )}${when(
      a,
      `
    if (!own${q ? " && !matched" : ""} && s.a !== undefined) out.push(s.a);`,
    )}
  }
  return out;
};${when(
    items,
    `
const __indexed = (all, i, out) => {
  for (const s of all) {
    const c = s.t && i < s.t.length ? s.t[i] : s.i;
    if (c !== null && c !== undefined) out.push(c);
  }
  return out;
};`,
  )}${when(
    pre && x,
    `
const __transformed = (n, s) => {
  for (const t of n.x) {${
    y
      ? `
    if (t === "toEnumCase") {
      const lower = s.toLowerCase();
      const found = n.y.find((y) => y[0] === lower);
      if (found) s = found[1];
    } else `
      : `
    `
  }s = t === "trimLeft" ? s.trimStart() : t === "trimRight" ? s.trimEnd() : s[t]();
  }
  return s;
};`,
  )}${when(
    pre,
    `
const __pre = (N, T, root, value) => {
  const visit = (n, v, seen, fresh) => {${when(
    x,
    `
    if (n.x && typeof v === "string") v = __transformed(n, v);`,
  )}
    if (__isObject(v)) {
      for (const [k, d] of n.d || []) if (!__own(v, k) || v[k] === undefined) v = __write(v, k, d !== null && typeof d === "object" ? structuredClone(d) : d, fresh);
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (x === undefined) continue;
        let y = x;
        for (const c of __keyed([n], k, [])) if (N[c].f) y = visit(N[c], y, new Set(), fresh);
        if (y !== x) v = __write(v, k, y, fresh);
      }
    }${when(
      items,
      ` else if (Array.isArray(v))
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        let y = x;
        for (const c of __indexed([n], i, [])) if (N[c].f) y = visit(N[c], y, new Set(), fresh);
        if (y !== x) v = __write(v, i, y, fresh);
      }`,
    )}
    // In place, once each where it applies to this value.
    if (seen.has(n)) return v;
    seen.add(n);${when(
      m,
      `
    for (const m of n.m || []) if (N[m].f) v = visit(N[m], v, seen, fresh);`,
    )}${when(
      u,
      `
    for (const u of n.u || []) {
      if (!u.f) continue;
      if (u.k !== undefined) {
        const b = __members(u, v)[0];
        if (b !== undefined && b !== null && N[b].f) v = visit(N[b], v, seen, fresh);
        continue;
      }
      // The first member that passes once filled, its filling kept.
      for (let i = 0; i < u.b.length; i++) {
        const b = u.b[i];
        const tried = new Set();
        const candidate = b !== null && N[b].f ? visit(N[b], v, new Set(seen), tried) : v;
        if (T[u.t[i]](candidate)) {
          for (const made of tried) fresh.add(made);
          v = candidate;
          break;
        }
      }
    }`,
    )}${when(
      c,
      `
    if (n.c) {
      const [, then, otherwise, test] = n.c;
      const branch = test === null ? null : (typeof test === "number" ? T[test](v) : ${passes ? "__passes(test, v)" : "false"}) ? then : otherwise;
      if (branch !== null && N[branch].f) v = visit(N[branch], v, seen, fresh);
    }`,
    )}${when(
      e,
      `
    for (const [k, b] of n.e || []) if (N[b].f && __isObject(v) && __own(v, k)) v = visit(N[b], v, seen, fresh);`,
    )}
    return v;
  };
  return visit(root, value, new Set(), new Set());
};`,
  )}
const __post = (N, root, value) => {
  const fresh = new Set();
  const visit = (nodes, v) => {
    // Every schema that applies here: those given, and in place, what each applies.
    const all = [];
    const add = (n) => {
      if (n === null || n === undefined) return;
      const s = typeof n === "number" ? N[n] : n;
      if (all.includes(s)) return;
      all.push(s);${when(
        m,
        `
      for (const m of s.m || []) add(m);`,
      )}${when(
        u,
        `
      for (const u of s.u || []) for (const b of __members(u, v)) add(b);`,
      )}${when(
        c,
        `
      if (s.c) {
        const [test, then, otherwise, how] = s.c;
        add(test);${
          passes
            ? `
        if (how !== null && typeof how === "object") add(__passes(how, v) ? then : otherwise);
        else {
          add(then);
          add(otherwise);
        }`
            : `
        add(then);
        add(otherwise);`
        }
      }`,
      )}${when(
        e,
        `
      for (const [k, b] of s.e || []) if (__isObject(v) && __own(v, k)) add(b);`,
      )}
    };
    for (const n of nodes) add(n);
    if (__isObject(v)) {
      const open = !all.some((s) => s.n || s.o) && all.some((s) => (s.p && s.p.length) || (s.r && s.r.length));
      for (const k of Object.keys(v)) {
        const x = v[k];
        const declared = all.some((s) => s.p && s.p.some((p) => p[0] === k));
        if (x === undefined && declared) {
          v = __without(v, k, fresh);
          continue;
        }
        if (open && !declared && !all.some((s) => (s.r && s.r.includes(k))${q ? " || (s.q && s.q.some((q) => __matches(q[0], k)))" : ""})) {
          v = __without(v, k, fresh);
          continue;
        }
        const children = __keyed(all, k, []);
        if (!children.length) continue;
        const y = visit(children, x);
        if (y !== x) v = __write(v, k, y, fresh);
      }
    }${when(
      items,
      ` else if (Array.isArray(v))
      for (let i = 0; i < v.length; i++) {
        const children = __indexed(all, i, []);
        if (!children.length) continue;
        const y = visit(children, v[i]);
        if (y !== v[i]) v = __write(v, i, y, fresh);
      }`,
    )}
    return v;
  };
  return visit([root], value);
};
`;
}
