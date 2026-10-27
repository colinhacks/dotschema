// Where a schema's codecs apply (DESIGN.md, "Codecs"): the plan `.decode()` and `.encode()` follow
// at run time, made when the module is built. ajv's validator stays as it is and checks the value
// as given; decoding is a second pass of dotschema's own, which copies the value along the places
// that hold a codec and converts the strings there, so the caller's value is never changed.
//
// The pass follows the keywords whose schemas apply to a part of the value, and in place: a
// property's (`properties`, `patternProperties`, `additionalProperties`), an item's (`items`,
// `prefixItems`, `additionalItems`, by the draft), and the schemas that apply to the same value:
// a `$ref`, every `allOf` member, the member of an `anyOf` or `oneOf` the value is told apart by (a
// tag every member pins, or else the first member whose own validator passes, Zod's rule), and the
// `then` or the `else` its `if` picks. It decodes a string when a schema that applies to it there
// names a format with a codec. It never looks under `not`, `contains`, `propertyNames`,
// `dependentSchemas`, the unevaluated keywords or a `$dynamicRef`, whose schemas the types do not
// read either, so a codec there decodes nothing.
//
// The types follow from the same rule (schema-types.ts): a schema whose format has a codec, or one
// of whose `allOf` members' has, is the codec's type where it allows a string. That is exact only
// when every schema that types the same value as a string carries the codec too; where another
// does not (`{ "type": "string" }` beside an `allOf` member with the format), the decoded type
// would hold a string the pass turned into an Instant, so that is a problem when the module is
// built and in the type check, naming both schemas.
import type { Codec } from "./codecs.ts";
import type { Value } from "./core/serialize.ts";
import type { Project } from "./config.ts";
import { fileOf, fragmentOf, fragmentPath, pointTo, specifierOf, type Files } from "./refs.ts";
import type { Draft } from "./schema-types.ts";

type Obj = { readonly [key: string]: Value };
const isObj = (value: Value | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** A place in one of the files: its path and the JSON Pointer to it. */
export type Place = { path: string; segments: readonly string[] };
const keyOf = (place: Place) => JSON.stringify([place.path, ...place.segments]);

/** A schema's plan, as the module's run time reads it (`__codec` in schema.ts); every list holds node indexes, `null` where nothing below decodes. */
export interface PlanNode {
  /** The codec its format names, by its index in the module's `__codecs`. */
  c?: number;
  /** `properties`: each key, with its schema's node. */
  p?: [string, number | null][];
  /** `patternProperties`: each pattern's source, with its schema's node. */
  pp?: [string, number | null][];
  /** `additionalProperties`'s node: for a key `properties` does not list and no pattern matches. */
  ap?: number | null;
  /** A tuple's items, by position (`prefixItems`, or a list of `items` before 2020-12). */
  pi?: (number | null)[];
  /** Every other item's node (`items`, or `additionalItems` beside a list). */
  it?: number | null;
  /** The schemas that apply to the same value: a `$ref`'s target and each `allOf` member. */
  all?: number[];
  /**
   * Each `anyOf` and `oneOf`: `[tag, members]`, where a member is `[how, node]`. With a tag, `how`
   * is the tag's value for the member; without, the index of its validator in the module's
   * `__selectors`, or `true` or `false` for a member that is a boolean schema.
   */
  any?: [string | null, [string | number | boolean, number | null][]][];
  /** Each `if`: its validator's index, and the nodes of its `then` and its `else`. */
  cond?: [number | boolean, number | null, number | null][];
}

export interface Plan {
  /** The nodes the entries reach, renumbered. */
  nodes: PlanNode[];
  /** Each entry's root node, `null` when nothing in it decodes. */
  roots: (number | null)[];
  /** The codecs the nodes name, in the order `c` numbers them. */
  codecs: Codec[];
  /** The places the selectors validate, as ajv ids (`<file's id>#<pointer>`), in the order the nodes number them. */
  selectors: string[];
  /** Where the types and the pass would disagree, each a problem's message. */
  problems: string[];
  /** Whether a codec applies anywhere below a place, through the keywords the pass follows. */
  reaches(place: Place): boolean;
  /** The codec a schema's own format turns on in its file, or undefined. */
  codecOf(path: string, schema: Value): Codec | undefined;
}

/** What `plan` takes: the files, each file's project, the draft the files are compiled in, and each file's id inside ajv. */
export interface PlanInput {
  files: Files;
  rootPath: string;
  draft: Draft;
  projectOf(path: string): Project;
  ajvIds: ReadonlyMap<string, string>;
  /** The places of the module's entries: the root's, then each definition's. */
  entries: Place[];
}

/** The tag that tells a union's members apart where only an object passes them: each pins a distinct string at one property it requires (or the union's schema requires), as `discriminatorOf` in schema.ts reads one. */
function tagOf(owner: Obj, members: (Obj | undefined)[]): { name: string; values: string[] } | undefined {
  if (!members.length || !members.every((m): m is Obj => m !== undefined)) return undefined;
  const objectsOnly = owner["type"] === "object" || members.every((m) => m["type"] === "object");
  if (!objectsOnly) return undefined;
  const required = (schema: Obj, name: string) => Array.isArray(schema["required"]) && schema["required"].includes(name);
  const pinned = (schema: Obj, name: string): string | undefined => {
    const properties = schema["properties"];
    const property = isObj(properties) && Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!isObj(property)) return undefined;
    if ("const" in property) return typeof property["const"] === "string" ? property["const"] : undefined;
    const values = property["enum"];
    return Array.isArray(values) && values.length === 1 && typeof values[0] === "string" ? values[0] : undefined;
  };
  const first = members[0]!["properties"];
  for (const name of isObj(first) ? Object.keys(first) : []) {
    if (name === "__proto__") continue;
    const values = members.map((m) => pinned(m, name));
    if (values.some((v) => v === undefined) || new Set(values).size !== values.length) continue;
    if (required(owner, name) || members.every((m) => required(m, name))) return { name, values: values as string[] };
  }
  return undefined;
}

/** The plan of a module's entries. */
export function plan(input: PlanInput): Plan {
  const { files, draft } = input;
  const prefixItems = draft === "2020-12";
  const projects = new Map<string, Project>();
  const projectOf = (path: string) => {
    let project = projects.get(path);
    if (!project) projects.set(path, (project = input.projectOf(path)));
    return project;
  };
  const codecOf = (path: string, schema: Value): Codec | undefined => (isObj(schema) && typeof schema["format"] === "string" ? projectOf(path).codecs.get(schema["format"]) : undefined);
  const schemaAt = (place: Place): Value | undefined => {
    const file = files.schemas.get(place.path);
    return file === undefined ? undefined : pointTo(file, [...place.segments]);
  };
  const at = (place: Place, ...more: string[]): Place => ({ path: place.path, segments: [...place.segments, ...more] });
  /** Where a `$ref` in the file `from` points, among the files; undefined for a URL or nothing. */
  const target = (ref: string, from: string): Place | undefined => {
    const other = fileOf(ref, from);
    const [path, fragment] = other ? [other.path, other.fragment] : ref === "" || ref.startsWith("#") ? [from, ref.slice(1)] : [undefined, ""];
    const file = path === undefined ? undefined : files.schemas.get(path);
    const segments = file === undefined ? undefined : fragmentPath(file, fragment);
    return path === undefined || !segments || pointTo(file!, segments) === undefined ? undefined : { path, segments };
  };

  // ---- the graph: every schema the pass can reach, by place -------------------------------------

  type Raw = {
    place: Place;
    schema: Value | undefined;
    codec?: Codec;
    properties: [string, string][];
    patterns: [string, string][];
    additional?: string;
    prefix?: string[];
    rest?: string;
    all: string[];
    unions: { owner: Obj; keyword: string; tag?: { name: string; values: string[] }; members: { key: string; constant?: boolean }[] }[];
    conds: { test: string; constant?: boolean; then?: string; else?: string }[];
  };
  const raws = new Map<string, Raw>();
  const node = (place: Place): string => {
    const key = keyOf(place);
    if (raws.has(key)) return key;
    const schema = schemaAt(place);
    const raw: Raw = { place, schema, properties: [], patterns: [], all: [], unions: [], conds: [] };
    raws.set(key, raw);
    if (!isObj(schema)) return key;
    const codec = codecOf(place.path, schema);
    if (codec) raw.codec = codec;
    const properties = schema["properties"];
    // ajv does not read a `__proto__` key in `properties`; a value's own is an additional property.
    if (isObj(properties)) for (const name of Object.keys(properties)) if (name !== "__proto__") raw.properties.push([name, node(at(place, "properties", name))]);
    const patterns = schema["patternProperties"];
    if (isObj(patterns)) for (const source of Object.keys(patterns)) raw.patterns.push([source, node(at(place, "patternProperties", source))]);
    if (schema["additionalProperties"] !== undefined) raw.additional = node(at(place, "additionalProperties"));
    const items = schema["items"];
    if (prefixItems) {
      if (Array.isArray(schema["prefixItems"])) raw.prefix = schema["prefixItems"].map((_, i) => node(at(place, "prefixItems", String(i))));
      if (items !== undefined && !Array.isArray(items)) raw.rest = node(at(place, "items"));
    } else if (Array.isArray(items)) {
      raw.prefix = items.map((_, i) => node(at(place, "items", String(i))));
      if (schema["additionalItems"] !== undefined) raw.rest = node(at(place, "additionalItems"));
    } else if (items !== undefined) raw.rest = node(at(place, "items"));
    if (typeof schema["$ref"] === "string") {
      const to = target(schema["$ref"], place.path);
      if (to) raw.all.push(node(to));
    }
    if (Array.isArray(schema["allOf"])) schema["allOf"].forEach((_, i) => raw.all.push(node(at(place, "allOf", String(i)))));
    for (const keyword of ["anyOf", "oneOf"]) {
      const members = schema[keyword];
      if (!Array.isArray(members) || !members.length) continue;
      // A member that is only a `$ref` is told apart by what it points to, as ajv's discriminator reads it.
      const resolved = members.map((member, i) => {
        if (isObj(member) && Object.keys(member).length === 1 && typeof member["$ref"] === "string") {
          const to = target(member["$ref"], place.path);
          const there = to && schemaAt(to);
          return isObj(there) ? there : undefined;
        }
        return isObj(members[i]) ? (members[i] as Obj) : undefined;
      });
      const tag = tagOf(schema, resolved);
      raw.unions.push({
        owner: schema,
        keyword,
        ...(tag ? { tag } : {}),
        members: members.map((member, i) => ({ key: node(at(place, keyword, String(i))), ...(typeof member === "boolean" ? { constant: member } : {}) })),
      });
    }
    if (schema["if"] !== undefined && (schema["then"] !== undefined || schema["else"] !== undefined)) {
      const test = schema["if"];
      raw.conds.push({
        test: node(at(place, "if")),
        ...(typeof test === "boolean" ? { constant: test } : {}),
        ...(schema["then"] !== undefined ? { then: node(at(place, "then")) } : {}),
        ...(schema["else"] !== undefined ? { else: node(at(place, "else")) } : {}),
      });
    }
    return key;
  };
  const entryKeys = input.entries.map((place) => node(place));

  // Whether a codec is reached from each node: a fixed point over the graph, which may have cycles,
  // made again when a place asked about later added nodes.
  const reaching = new Set<string>();
  let settled = 0;
  const settle = () => {
    if (settled === raws.size) return;
    settled = raws.size;
    for (let changed = true; changed; ) {
      changed = false;
      for (const [key, raw] of raws) {
        if (reaching.has(key)) continue;
        const below = [...raw.properties.map(([, k]) => k), ...raw.patterns.map(([, k]) => k), raw.additional, ...(raw.prefix ?? []), raw.rest, ...raw.all, ...raw.unions.flatMap((u) => u.members.map((m) => m.key)), ...raw.conds.flatMap((c) => [c.then, c.else])];
        if (raw.codec || below.some((k) => k !== undefined && reaching.has(k))) {
          reaching.add(key);
          changed = true;
        }
      }
    }
  };
  settle();

  // ---- the plan the module carries: the nodes that reach a codec, renumbered ----------------------

  const nodes: PlanNode[] = [];
  const index = new Map<string, number>();
  const codecs: Codec[] = [];
  const selectors: string[] = [];
  const selectorIndex = new Map<string, number>();
  const selector = (key: string): number => {
    let i = selectorIndex.get(key);
    if (i === undefined) {
      const { place } = raws.get(key)!;
      const id = input.ajvIds.get(place.path)!;
      selectorIndex.set(key, (i = selectors.length));
      selectors.push(`${id}#${fragmentOf(place.segments)}`);
    }
    return i;
  };
  const emit = (key: string | undefined): number | null => {
    if (key === undefined || !reaching.has(key)) return null;
    const known = index.get(key);
    if (known !== undefined) return known;
    const i = nodes.length;
    index.set(key, i);
    const out: PlanNode = {};
    nodes.push(out);
    const raw = raws.get(key)!;
    if (raw.codec) {
      let c = codecs.indexOf(raw.codec);
      if (c === -1) c = codecs.push(raw.codec) - 1;
      out.c = c;
    }
    const additional = emit(raw.additional);
    // Every key and pattern is kept where `additionalProperties` decodes, since it applies to a key neither names.
    const properties = raw.properties.map(([name, k]): [string, number | null] => [name, emit(k)]).filter(([, n]) => n !== null || additional !== null);
    if (properties.length) out.p = properties;
    const patterns = raw.patterns.map(([source, k]): [string, number | null] => [source, emit(k)]).filter(([, n]) => n !== null || additional !== null);
    if (patterns.length) out.pp = patterns;
    if (additional !== null) out.ap = additional;
    const prefix = raw.prefix?.map((k) => emit(k));
    const rest = emit(raw.rest);
    if (prefix && (prefix.some((n) => n !== null) || rest !== null)) out.pi = prefix;
    if (rest !== null) out.it = rest;
    const all = raw.all.map((k) => emit(k)).filter((n): n is number => n !== null);
    if (all.length) out.all = all;
    for (const union of raw.unions) {
      const members = union.members.map((m) => emit(m.key));
      const last = members.findLastIndex((n) => n !== null);
      if (last === -1) continue;
      // Without a tag, the first member that passes is the one, so each member up to the last that
      // decodes needs its own validator; past it, whichever passes decodes nothing.
      const how = union.members.slice(0, last + 1).map((m, i): string | number | boolean => (union.tag ? union.tag.values[i]! : m.constant ?? selector(m.key)));
      (out.any ??= []).push([union.tag?.name ?? null, how.map((h, i) => [h, members[i]!])]);
    }
    for (const cond of raw.conds) {
      const then = emit(cond.then);
      const otherwise = emit(cond.else);
      if (then === null && otherwise === null) continue;
      (out.cond ??= []).push([cond.constant ?? selector(cond.test), then, otherwise]);
    }
    return i;
  };
  const roots = entryKeys.map((key) => emit(key));

  // ---- the check: every schema that types a value as a string carries the codec that decodes it ---

  const problems: string[] = [];
  const name = (place: Place) => `${place.path === input.rootPath ? "" : `${specifierOf(input.rootPath, place.path)}`}#${fragmentOf(place.segments)}`;
  /** Whether a schema's own `type`, `const` or `enum` gives a string type. */
  const writesString = (schema: Value | undefined): boolean => {
    if (!isObj(schema)) return false;
    if (Object.hasOwn(schema, "const")) return typeof schema["const"] === "string";
    if (Array.isArray(schema["enum"])) return schema["enum"].some((value) => typeof value === "string");
    const type = schema["type"];
    return type === "string" || (Array.isArray(type) && type.includes("string"));
  };
  /** The codecs a schema carries itself or through its `allOf` members, which the types give it (schema-types.ts). */
  const carried = (key: string, seen = new Set<string>()): Set<Codec> => {
    const raw = raws.get(key)!;
    const out = new Set<Codec>(raw.codec ? [raw.codec] : []);
    if (seen.has(key) || !isObj(raw.schema)) return out;
    seen.add(key);
    const allOf = raw.schema["allOf"];
    if (Array.isArray(allOf)) allOf.forEach((_, i) => carried(keyOf(at(raw.place, "allOf", String(i))), seen).forEach((c) => out.add(c)));
    return out;
  };
  /**
   * A schema that applies to a value: the branch each union and conditional on the way to it took,
   * by group, and whether a schema on the way carries a codec, whose type then stands for the
   * value's strings below it, as the types write it (`emit` in schema-types.ts).
   */
  type Item = { key: string; choices: ReadonlyMap<number, number>; covered: boolean };
  const none: ReadonlyMap<number, number> = new Map();
  let groups = 0;
  const compatible = (a: Item, b: Item) => [...a.choices].every(([g, i]) => !b.choices.has(g) || b.choices.get(g) === i);
  /**
   * The schemas that apply to one value, each with the branches it needs taken. Unions nested in
   * place multiply the branches; past a budget the branches are dropped, so every schema is taken to
   * apply beside every other, which can only find more problems, never fewer.
   */
  const expand = (items: Item[], branches = true): Item[] => {
    const out: Item[] = [];
    const seen = new Set<string>();
    let budget = 4000;
    const visit = (key: string | undefined, choices: ReadonlyMap<number, number>, covered: boolean, stack: ReadonlySet<string>) => {
      if (key === undefined || stack.has(key)) return;
      if (branches && --budget < 0) throw expand;
      if (!branches) choices = none;
      const sig = `${key}|${covered}|${[...choices].sort(([a], [b]) => a - b).join(",")}`;
      if (seen.has(sig)) return;
      seen.add(sig);
      out.push({ key, choices, covered });
      const raw = raws.get(key)!;
      const inner = new Set(stack).add(key);
      const below = covered || carried(key).size > 0;
      for (const k of raw.all) visit(k, choices, below, inner);
      for (const union of raw.unions) {
        const g = groups++;
        union.members.forEach((m, i) => visit(m.key, new Map(choices).set(g, i), below, inner));
      }
      for (const cond of raw.conds) {
        const g = groups++;
        visit(cond.then, new Map(choices).set(g, 0), below, inner);
        visit(cond.else, new Map(choices).set(g, 1), below, inner);
      }
    };
    try {
      for (const item of items) visit(item.key, branches ? item.choices : none, item.covered, new Set());
    } catch (error) {
      if (error !== expand) throw error;
      return expand(items, false);
    }
    return out;
  };
  /**
   * The items with one key and coverage made one, keeping the branches all of them took, and the
   * groups in which no two items took different branches left out, as no two items differ by them:
   * the same problems or more, and the same set again when a recursive schema comes back to it.
   */
  const merged = (items: Item[]): Item[] => {
    const byKey = new Map<string, { key: string; covered: boolean; choices: Map<number, number> }>();
    for (const item of items) {
      const id = `${item.key}|${item.covered}`;
      const kept = byKey.get(id);
      if (!kept) byKey.set(id, { key: item.key, covered: item.covered, choices: new Map(item.choices) });
      else for (const [g, i] of kept.choices) if (item.choices.get(g) !== i) kept.choices.delete(g);
    }
    const taken = new Map<number, Set<number>>();
    for (const { choices } of byKey.values()) for (const [g, i] of choices) (taken.get(g) ?? taken.set(g, new Set()).get(g)!).add(i);
    return [...byKey.values()].map((item) => ({ ...item, choices: new Map([...item.choices].filter(([g]) => taken.get(g)!.size > 1)) }));
  };
  /** A set of items as text, its branches renumbered in order of appearance. */
  const canonical = (items: Item[]): string => {
    const rename = new Map<number, number>();
    const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.covered === b.covered ? 0 : a.covered ? 1 : -1));
    return JSON.stringify(sorted.map((item) => [item.key, item.covered, [...item.choices].sort(([a], [b]) => a - b).map(([g, i]) => [rename.get(g) ?? (rename.set(g, rename.size), rename.size - 1), i])]));
  };
  const checked = new Set<string>();
  const reported = new Set<string>();
  const report = (message: string) => {
    if (reported.has(message)) return;
    reported.add(message);
    problems.push(message);
  };
  const check = (items: Item[], depth: number) => {
    // Nothing below decodes, so nothing here can disagree.
    if (!items.some((item) => reaching.has(item.key))) return;
    // Past 64 levels every schema is taken to apply beside every other, as past the budget.
    const deep = depth > 64;
    const all = merged(expand(deep ? items.map((item) => ({ ...item, choices: none })) : items, !deep));
    // Once per set of schemas and the branches they need, whatever the branches are numbered, so a recursive schema ends.
    const signature = canonical(all);
    if (checked.has(signature)) return;
    checked.add(signature);
    for (const typed of all) {
      const raw = raws.get(typed.key)!;
      // A schema below one with a codec is typed within it, its strings the codec's.
      if (typed.covered || !writesString(raw.schema)) continue;
      // A schema that carries a codec itself accepts no string another decodes, the formats but int64 being disjoint (below).
      if (carried(typed.key).size) continue;
      for (const other of all) {
        const codec = raws.get(other.key)!.codec;
        if (!codec || !compatible(typed, other)) continue;
        report(`The codec ${codec.name} decodes the ${codec.format} strings of ${name(raws.get(other.key)!.place)}, which ${name(raw.place)} types as a string without it: give ${name(raw.place)} "format": "${codec.format}" too, or put the format and the type in one schema.`);
      }
    }
    // The int64 format checks numbers alone, so its codec decodes every string, those another codec decodes too.
    for (const one of all) {
      const a = raws.get(one.key)!.codec;
      if (a?.format !== "int64") continue;
      for (const other of all) {
        const b = raws.get(other.key)!.codec;
        if (!b || b === a || !compatible(one, other)) continue;
        report(`The codecs ${a.name} of ${name(raws.get(one.key)!.place)} and ${b.name} of ${name(raws.get(other.key)!.place)} would both decode one string, since the int64 format checks numbers alone and takes every string: keep one of the two formats.`);
      }
    }
    // Each property's value: the schemas every item gives a key, by name, and those of a key none names.
    const keys = new Set<string>();
    for (const item of all) for (const [k] of raws.get(item.key)!.properties) keys.add(k);
    const childOf = (key: string | undefined): Item[] =>
      all.flatMap((item) => {
        const raw = raws.get(item.key)!;
        const listed = key !== undefined && raw.properties.some(([k]) => k === key);
        const out: string[] = [];
        if (listed) out.push(raw.properties.find(([k]) => k === key)![1]);
        let matched = false;
        for (const [source, k] of raw.patterns) {
          let test: boolean;
          try {
            test = key === undefined || new RegExp(source, "u").test(key);
          } catch {
            test = true;
          }
          if (test) {
            matched = true;
            out.push(k);
          }
        }
        if (!listed && (!matched || key === undefined) && raw.additional !== undefined) out.push(raw.additional);
        return out.map((k) => ({ key: k, choices: item.choices, covered: false }));
      });
    for (const key of keys) check(childOf(key), depth + 1);
    check(childOf(undefined), depth + 1);
    // Each item: by position in the longest tuple, then those after.
    const length = Math.max(0, ...all.map((item) => raws.get(item.key)!.prefix?.length ?? 0));
    const itemOf = (i: number | undefined): Item[] =>
      all.flatMap((item) => {
        const raw = raws.get(item.key)!;
        const k = i !== undefined && raw.prefix && i < raw.prefix.length ? raw.prefix[i] : raw.rest;
        return k === undefined ? [] : [{ key: k, choices: item.choices, covered: false }];
      });
    for (let i = 0; i < length; i++) check(itemOf(i), depth + 1);
    check(itemOf(undefined), depth + 1);
  };
  for (const key of entryKeys) check([{ key, choices: none, covered: false }], 0);

  return {
    nodes,
    roots,
    codecs,
    selectors,
    problems,
    reaches: (place) => {
      const key = node(place);
      settle();
      return reaching.has(key);
    },
    codecOf,
  };
}
