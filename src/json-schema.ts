// A schema as one self-contained JSON Schema in a draft of the caller's choosing: draft-07 or
// 2020-12, the two targets Standard JSON Schema v1 asks an implementer to support. Computed when
// the module is built, from the files refs.ts collected (each already without the keywords its
// draft ignores, schema.ts's `IGNORED`).
//
//   jsonSchemas(files, "/app/team.schema.jsonc", "draft-07")["draft-2020-12"]
//   // { schema: { $schema: "https://json-schema.org/draft/2020-12/schema", properties: { lead: { $ref: "#/$defs/user" } }, ..., $defs: { user: { ... } } } }
//
// Every other file the schema reaches is folded in under the root's `$defs` (2020-12) or
// `definitions` (draft-07), keyed by its base name, and every `$ref` becomes a JSON Pointer into the
// one document. Each keyword is converted to the target draft where the two drafts have an exact
// equivalent; where they have none, the target's entry is an error naming the keyword and where it
// is, never a schema that validates otherwise than dotschema's validator does.
import { basename } from "node:path";
import type { Value } from "./core/serialize.ts";
import { fragmentOf, pointer, resolveRef, SCHEMA_SUFFIXES, specifierOf, type Files } from "./refs.ts";
import type { Draft } from "./schema-types.ts";

export type JsonSchemaTarget = "draft-07" | "draft-2020-12";

export type JsonSchemaResult = { schema: Value } | { error: string };

/** The unit of an entry's document that is the entry itself (`jsonSchema`). */
const ENTRY = "\0entry";

/** The `$schema` each target's schema declares. */
export const TARGET_URIS: Record<JsonSchemaTarget, string> = {
  "draft-07": "http://json-schema.org/draft-07/schema#",
  "draft-2020-12": "https://json-schema.org/draft/2020-12/schema",
};

type Obj = { readonly [key: string]: Value };
type Out = Record<string, Value>;

const isObj = (value: Value | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
const has = (schema: Obj, key: string) => Object.hasOwn(schema, key);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Keywords that annotate and never validate: draft-07 ignores them beside a `$ref` without changing a verdict. */
const ANNOTATIONS = new Set(["title", "description", "$comment", "default", "examples", "readOnly", "writeOnly", "deprecated"]);
/** Keywords whose value is one schema (the array keywords and the unevaluated ones are converted on their own). */
const ONE = ["additionalProperties", "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"];
const LIST = ["allOf", "anyOf", "oneOf"];
const MAP = ["properties", "patternProperties"];
const ITEMS = new Set(["items", "prefixItems", "additionalItems"]);
const DEPENDENCIES = new Set(["dependencies", "dependentRequired", "dependentSchemas"]);

/**
 * The keywords another draft (or ajv alone) defines that a schema's own draft does not. ajv ignores
 * each in that draft, or dotschema takes it out before ajv sees it (schema.ts's `IGNORED`), so the
 * converted schema leaves it out too: kept, the target might act on it (`prefixItems` in a draft-07
 * schema would start checking tuples in 2020-12). A keyword no draft defines (`x-foo`) is kept as
 * written, as data.
 */
const FOREIGN: Record<Draft, ReadonlySet<string>> = {
  "draft-07": new Set(["$async", "nullable", "id", "prefixItems", "unevaluatedProperties", "unevaluatedItems", "dependentRequired", "dependentSchemas", "minContains", "maxContains", "$dynamicRef", "$recursiveRef", "$recursiveAnchor", "$vocabulary"]),
  "2019-09": new Set(["$async", "nullable", "id", "prefixItems", "$dynamicRef", "$dynamicAnchor", "dependencies"]),
  "2020-12": new Set(["$async", "nullable", "id", "additionalItems", "$recursiveRef", "$recursiveAnchor", "dependencies"]),
};

/** The plain names each target allows an anchor (draft-07 core 8.2.3, `$id` "#name"; 2020-12 core 8.2.2, `$anchor`). */
const ANCHOR_NAMES: Record<JsonSchemaTarget, RegExp> = { "draft-07": /^[A-Za-z][-A-Za-z0-9_:.]*$/, "draft-2020-12": /^[A-Za-z_][-A-Za-z0-9._]*$/ };

/** Whether `schema`, or a schema inside it, has `keyword`, searched keyword by keyword so data (`const`, a property's name) is not. */
function uses(schema: Value, keyword: string): boolean {
  if (!isObj(schema)) return false;
  if (has(schema, keyword)) return true;
  for (const [key, value] of Object.entries(schema)) {
    const inside = Array.isArray(value) ? (WALK_LIST.has(key) ? value : []) : WALK_ONE.has(key) ? [value] : WALK_MAP.has(key) && isObj(value) ? Object.values(value) : [];
    if (inside.some((item) => uses(item, keyword))) return true;
  }
  return false;
}
const WALK_ONE = new Set([...ONE, "items", "additionalItems", "unevaluatedItems", "unevaluatedProperties"]);
const WALK_LIST = new Set([...LIST, "prefixItems", "items"]);
const WALK_MAP = new Set([...MAP, "$defs", "definitions", "dependentSchemas", "dependencies"]);

/**
 * The schema as a self-contained JSON Schema in each target draft, or the reason it cannot be one.
 * `draft` is the root's, the draft every file is compiled in. With `entry`, a definition of the root
 * file (`["$defs", "address"]`), that definition is the document's root, and what it refers to is
 * folded in beside it ([DESIGN.md](../DESIGN.md#each-definition-a-validator)).
 */
export function jsonSchemas(files: Files, rootPath: string, draft: Draft, entry?: Entry): Record<JsonSchemaTarget, JsonSchemaResult> {
  return { "draft-07": jsonSchema(files, rootPath, draft, "draft-07", entry), "draft-2020-12": jsonSchema(files, rootPath, draft, "draft-2020-12", entry) };
}

/** A definition of the root file, by its keyword and key, made the root of its own document. */
export type Entry = readonly ["$defs" | "definitions", string];

/**
 * One target's entry of `jsonSchemas`. With `entry`, the definition is converted at the document's
 * root; the root file's other definitions are hoisted into the target's container under their keys,
 * the rest of the root file is folded in under its file's name, as another file is, and each of those
 * is kept only when the definition reaches it, so a reference elsewhere in the file neither bloats
 * nor fails the definition's document.
 */
export function jsonSchema(files: Files, rootPath: string, draft: Draft, target: JsonSchemaTarget, entry?: Entry): JsonSchemaResult {
  if (files.problems.length) return { error: files.problems.map((p) => p.message).join(" ") };
  const root = files.schemas.get(rootPath);
  if (root === undefined) return { error: `${basename(rootPath)} was not read.` };
  const entrySchema = entry && isObj(root) && isObj(root[entry[0]]) && has(root[entry[0]] as Obj, entry[1]) ? (root[entry[0]] as Obj)[entry[1]] : undefined;
  if (entry && entrySchema === undefined) return { error: `${basename(rootPath)} has no ${entry[0]} entry "${entry[1]}".` };
  const to07 = target === "draft-07";
  const container = to07 ? "definitions" : "$defs";
  const foreign = FOREIGN[draft];
  const multiFile = files.schemas.size > 1;
  // Each error with the unit of the document it was found in (`unitOf`), so an unreached unit's are dropped.
  const errors: { unit: string; message: string }[] = [];
  /** Where each schema of each file landed: `[file, ...source segments]` to output segments. */
  const positions = new Map<string, string[]>();
  const sites: { object: Out; key: "$ref" | "$dynamicRef"; ref: string; file: string; at: string[] }[] = [];
  const place = (file: string, segments: readonly string[]) => JSON.stringify([file, ...segments]);
  // The unit of the document a place in it belongs to: a schema in the container, by its name, or the entry.
  const unitOf = (out: readonly string[]) => (entry && out.length >= 2 && out[0] === container && unitNames.has(out[1]!) ? out[1]! : ENTRY);
  // Which unit refers to which, for an entry's document to keep only what it reaches.
  const edges: [string, string][] = [];
  const where = (file: string, segments: readonly string[]) => `${specifierOf(rootPath, file)}#${fragmentOf(segments)}`;

  // 2019-09's `unevaluatedItems` counts the items `items` and `additionalItems` evaluated; 2020-12's
  // counts those `contains` matched too (2020-12 core 11.2; the 2020-12 release notes).
  let usesContains = false;
  if (draft === "2019-09") for (const schema of files.schemas.values()) usesContains ||= uses(schema, "contains");

  // Each other file's key under the root's container: its name without the suffix, de-duplicated
  // against the root's own definitions and the other files, as the emitter names a taken type `Type2`.
  const folded = new Map<string, string>();
  const taken = new Set<string>();
  if (isObj(root)) for (const key of ["$defs", "definitions"]) if (isObj(root[key])) for (const name of Object.keys(root[key])) taken.add(name);
  // With an entry, the rest of the root file is a unit of its own, named for the file, before the others.
  let rootName = "";
  if (entry) {
    const suffix = SCHEMA_SUFFIXES.find((s) => rootPath.endsWith(s)) ?? "";
    const base = basename(rootPath).slice(0, basename(rootPath).length - suffix.length) || "schema";
    rootName = base;
    for (let n = 2; taken.has(rootName); n++) rootName = `${base}${n}`;
    taken.add(rootName);
  }
  for (const path of files.schemas.keys()) {
    if (path === rootPath) continue;
    const suffix = SCHEMA_SUFFIXES.find((s) => path.endsWith(s)) ?? "";
    const base = basename(path).slice(0, basename(path).length - suffix.length) || "schema";
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
    taken.add(name);
    folded.set(path, name);
  }

  // With an entry, the names of the units beside it: the root file's other definitions, the rest of the root file, the other files.
  const unitNames = new Set<string>();
  if (entry) {
    if (isObj(root)) for (const keyword of ["$defs", "definitions"]) if (isObj(root[keyword])) for (const name of Object.keys(root[keyword])) if (keyword !== entry[0] || name !== entry[1]) unitNames.add(name);
    unitNames.add(rootName);
    for (const name of folded.values()) unitNames.add(name);
  }

  // An `$id` below a file's root begins a schema resource of its own (refs.ts), which the dynamic
  // scope of a `$dynamicRef` follows (2020-12 core 7.1): one document without those `$id`s would
  // resolve it otherwise, so 2020-12 refuses such an `$id` in a schema that uses one.
  let dynamic = false;
  for (const schema of files.schemas.values()) dynamic ||= uses(schema, "$dynamicRef") || uses(schema, "$dynamicAnchor");

  let file = rootPath;
  let rootContainer: Out | undefined;
  // Whether the schema being converted is inside a schema resource that an `$id` below its file's root begins.
  let inResource = false;

  const convert = (node: Value, src: string[], out: string[]): Value => {
    positions.set(place(file, src), out);
    if (!isObj(node)) return node;
    const result: Out = {};
    const fileRoot = src.length === 0;
    // The document's root: the root file's, or the entry's.
    const rootOfAll = file === rootPath && (entry ? src.length === 2 && src[0] === entry[0] && src[1] === entry[1] : fileRoot);
    const names: string[] = [];
    const outerResource = inResource;
    inResource ||= !fileRoot && typeof node["$id"] === "string" && !node["$id"].startsWith("#");
    let itemsDone = false;
    let dependenciesDone = false;
    const refuse = (keyword: string, why: string) => errors.push({ unit: unitOf(out), message: `"${keyword}" at ${where(file, [...src, keyword])} ${why}` });
    const sub = (value: Value, from: (string | number)[], to: (string | number)[]) => convert(value, [...src, ...from.map(String)], [...out, ...to.map(String)]);

    for (const [keyword, value] of Object.entries(node)) {
      if (foreign.has(keyword)) continue;
      switch (keyword) {
        case "$schema":
          // The root takes the target's; anywhere else (another file's root) it would name a draft that is no longer the one it is read in.
          break;
        case "$id": {
          if (typeof value !== "string") break;
          if (value.startsWith("#")) {
            // Draft-07's plain-name fragment (core 8.2.3), 2020-12's `$anchor`.
            if (value.length > 1) names.push(value.slice(1));
          } else if (!fileRoot) {
            // Every `$ref` becomes a pointer from the document's root (below), which the `$id` would
            // move to its own schema, so it is left out.
            if (!to07 && dynamic) refuse(keyword, "begins a schema resource of its own, which the dynamic scope of this schema's $dynamicRef follows, and one document without that $id does not keep.");
          } else if (rootOfAll && fileRoot) {
            const hash = value.indexOf("#");
            if (hash !== -1 && hash < value.length - 1) refuse(keyword, "has a fragment.");
            else result["$id"] = to07 || hash === -1 ? value : value.slice(0, hash);
          }
          // Another file's `$id` is left out: its schema is no longer a document of its own, and a
          // reference to the id is rewritten to the pointer where the file now is.
          break;
        }
        case "$anchor":
          if (typeof value === "string") names.push(value);
          break;
        case "$dynamicAnchor":
          if (typeof value !== "string") break;
          if (draft === "draft-07") {
            // ajv reads it as a plain anchor in every draft (its resolve.js), and draft-07 has no dynamic scope.
            names.push(value);
          } else if (to07) refuse(keyword, "has no equivalent in draft-07.");
          else if (multiFile) refuse(keyword, "resolves through the schema files it was written across, which one document does not keep apart.");
          else {
            // Kept as written, and a `$ref` to it becomes a pointer like any other.
            result[keyword] = value;
          }
          break;
        case "$dynamicRef":
          if (typeof value !== "string") break;
          if (to07) refuse(keyword, "has no equivalent in draft-07.");
          else if (multiFile) refuse(keyword, "resolves through the schema files it was written across, which one document does not keep apart.");
          else {
            result[keyword] = value;
            sites.push({ object: result, key: keyword, ref: value, file, at: [...src, keyword] });
          }
          break;
        case "$ref":
          result[keyword] = value;
          break;
        case "$recursiveRef":
        case "$recursiveAnchor":
          refuse(keyword, to07 ? "has no equivalent in draft-07." : `is 2019-09's, and 2020-12's "$dynamicRef" and "$dynamicAnchor", which replaced it, do not resolve the same way.`);
          break;
        case "$defs":
        case "definitions": {
          if (!isObj(value)) break;
          // With an entry, the root file's definitions are hoisted beside it (below).
          if (entry && fileRoot && file === rootPath) break;
          const defs = (result[container] ??= {}) as Out;
          if (rootOfAll) rootContainer = defs;
          for (const [name, schema] of Object.entries(value)) {
            if (has(defs, name)) refuse(keyword, `and "${keyword === "$defs" ? "definitions" : "$defs"}" both define "${name}".`);
            else defs[name] = sub(schema, [keyword, name], [container, name]);
          }
          break;
        }
        case "unevaluatedProperties":
        case "unevaluatedItems":
          if (to07) refuse(keyword, "has no equivalent in draft-07.");
          else if (keyword === "unevaluatedItems" && usesContains) refuse(keyword, `counts the items "contains" matches as evaluated in 2020-12 and not in 2019-09, and this schema uses "contains".`);
          else result[keyword] = sub(value, [keyword], [keyword]);
          break;
        case "minContains":
        case "maxContains":
          // Without `contains` beside it, neither does anything (2020-12 validation 6.4.4, 6.4.5).
          if (!has(node, "contains")) break;
          if (to07) refuse(keyword, "has no equivalent in draft-07.");
          else result[keyword] = value;
          break;
        case "$vocabulary":
          if (!to07) result[keyword] = value;
          break;
        default:
          if (ITEMS.has(keyword)) {
            if (!itemsDone) items(node, result, sub);
            itemsDone = true;
          } else if (DEPENDENCIES.has(keyword)) {
            if (!dependenciesDone) dependencies(node, result, sub);
            dependenciesDone = true;
          } else if (ONE.includes(keyword)) result[keyword] = sub(value, [keyword], [keyword]);
          else if (LIST.includes(keyword) && Array.isArray(value)) result[keyword] = value.map((item, i) => sub(item, [keyword, i], [keyword, i]));
          else if (MAP.includes(keyword) && isObj(value)) result[keyword] = Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sub(item, [keyword, name], [keyword, name])]));
          else result[keyword] = value;
      }
    }

    if (names.length) {
      // The root file keeps its first anchor in the target's spelling; every reference to an anchor
      // becomes a pointer, so another file's anchors, and those of a resource an `$id` below the root
      // begins, which could clash in one document, are left out.
      const name = names.find((n) => ANCHOR_NAMES[target].test(n));
      if (file === rootPath && !inResource && name !== undefined) {
        if (!to07) result["$anchor"] = name;
        else if (!has(result, "$id")) result["$id"] = `#${name}`;
      }
    }
    if (!entry && rootOfAll && folded.size && !rootContainer) rootContainer = result[container] = {};

    if (typeof result["$ref"] === "string") {
      const ref = result["$ref"];
      // Draft-07 ignores every keyword beside a `$ref` (core 8.3); 2019-09 and 2020-12 apply them,
      // and so does ajv in draft-07 (dotschema's validator). The draft-07 schema moves the `$ref`
      // into `allOf`, beside the other keywords, so a draft-07 reader applies them all too.
      const others = Object.keys(result).filter((key) => key !== "$ref" && !ANNOTATIONS.has(key));
      if (to07 && (others.length || rootOfAll)) {
        const alone: Out = { $ref: ref };
        delete result["$ref"];
        result["allOf"] = Array.isArray(result["allOf"]) ? [...result["allOf"], alone] : [alone];
        sites.push({ object: alone, key: "$ref", ref, file, at: [...src, "$ref"] });
      } else sites.push({ object: result, key: "$ref", ref, file, at: [...src, "$ref"] });
    }
    inResource = outerResource;
    return result;
  };

  type Sub = (value: Value, from: (string | number)[], to: (string | number)[]) => Value;

  /**
   * The array keywords. Draft-07 and 2019-09 write a tuple as a list of `items` and the rest as
   * `additionalItems` (draft-07 validation 6.4.1, 6.4.2), 2020-12 as `prefixItems` and `items`
   * (2020-12 core 10.3.1.1, 10.3.1.2). `additionalItems` beside a single `items` schema, or none, is
   * ignored (draft-07 validation 6.4.2), and is left out of both targets.
   */
  const items = (node: Obj, result: Out, sub: Sub) => {
    const list = node["items"];
    if (draft !== "2020-12") {
      if (Array.isArray(list)) {
        result[to07 ? "items" : "prefixItems"] = list.map((item, i) => sub(item, ["items", i], [to07 ? "items" : "prefixItems", i]));
        if (has(node, "additionalItems")) result[to07 ? "additionalItems" : "items"] = sub(node["additionalItems"]!, ["additionalItems"], [to07 ? "additionalItems" : "items"]);
      } else {
        if (has(node, "items")) result["items"] = sub(list!, ["items"], ["items"]);
      }
      return;
    }
    const prefix = node["prefixItems"];
    if (!to07) {
      if (has(node, "prefixItems")) result["prefixItems"] = Array.isArray(prefix) ? prefix.map((item, i) => sub(item, ["prefixItems", i], ["prefixItems", i])) : prefix!;
      if (has(node, "items")) result["items"] = sub(list!, ["items"], ["items"]);
    } else if (Array.isArray(prefix)) {
      result["items"] = prefix.map((item, i) => sub(item, ["prefixItems", i], ["items", i]));
      if (has(node, "items")) result["additionalItems"] = sub(list!, ["items"], ["additionalItems"]);
    } else if (has(node, "items")) result["items"] = sub(list!, ["items"], ["items"]);
  };

  /**
   * Draft-07's `dependencies`, whose entries are lists of property names or schemas (validation
   * 6.5.7), split in 2019-09 into `dependentRequired` (2020-12 validation 6.5.4) and
   * `dependentSchemas` (2020-12 core 10.2.2.4). Going to draft-07, a property with both is a schema
   * that requires the names and applies the schema: `{ allOf: [{ required }, schema] }`.
   */
  const dependencies = (node: Obj, result: Out, sub: Sub) => {
    if (draft === "draft-07") {
      const deps = node["dependencies"];
      if (!isObj(deps)) return void (result["dependencies"] = deps!);
      if (to07) return void (result["dependencies"] = Object.fromEntries(Object.entries(deps).map(([name, d]) => [name, Array.isArray(d) ? d : sub(d, ["dependencies", name], ["dependencies", name])])));
      const required: Out = {};
      const schemas: Out = {};
      for (const [name, d] of Object.entries(deps)) {
        if (Array.isArray(d)) required[name] = d;
        else schemas[name] = sub(d, ["dependencies", name], ["dependentSchemas", name]);
      }
      if (Object.keys(required).length) result["dependentRequired"] = required;
      if (Object.keys(schemas).length) result["dependentSchemas"] = schemas;
      return;
    }
    const required = isObj(node["dependentRequired"]) ? node["dependentRequired"] : {};
    const schemas = isObj(node["dependentSchemas"]) ? node["dependentSchemas"] : {};
    if (!to07) {
      if (has(node, "dependentRequired")) result["dependentRequired"] = node["dependentRequired"]!;
      if (has(node, "dependentSchemas")) result["dependentSchemas"] = Object.fromEntries(Object.entries(schemas).map(([name, s]) => [name, sub(s, ["dependentSchemas", name], ["dependentSchemas", name])]));
      return;
    }
    const deps: Out = {};
    for (const name of new Set([...Object.keys(required), ...Object.keys(schemas)])) {
      const names = required[name];
      if (!has(schemas, name)) deps[name] = names!;
      else if (!Array.isArray(names)) deps[name] = sub(schemas[name]!, ["dependentSchemas", name], ["dependencies", name]);
      else deps[name] = { allOf: [{ required: names }, sub(schemas[name]!, ["dependentSchemas", name], ["dependencies", name, "allOf", 1])] };
    }
    result["dependencies"] = deps;
  };

  // With an entry, the units the document may hold beside it, in order: the root file's other
  // definitions, the rest of the root file, then the other files; each kept only if reached.
  const units = new Map<string, Value>();
  let converted: Value;
  if (entry) {
    converted = convert(entrySchema!, [...entry], []);
    if (isObj(root)) {
      for (const keyword of ["$defs", "definitions"] as const) {
        const group = root[keyword];
        if (!isObj(group)) continue;
        for (const [name, schema] of Object.entries(group)) {
          if (keyword === entry[0] && name === entry[1]) continue;
          if (units.has(name)) errors.push({ unit: name, message: `"${keyword}" at ${where(rootPath, [keyword])} and "${keyword === "$defs" ? "definitions" : "$defs"}" both define "${name}".` });
          else units.set(name, convert(schema, [keyword, name], [container, name]));
        }
      }
    }
    units.set(rootName, convert(root, [], [container, rootName]));
  } else converted = convert(root, [], []);
  for (const [path, name] of folded) {
    file = path;
    const schema = convert(files.schemas.get(path)!, [], [container, name]);
    if (entry) units.set(name, schema);
    else if (rootContainer) rootContainer[name] = schema;
  }

  // Every reference becomes a pointer into the one document, resolved as the module resolves it
  // (refs.ts): against the `$id`s above it, to a file, a resource an `$id` names, or an anchor; a
  // URL no schema of the files declares is left as written, or written as the absolute URL an `$id`
  // above it resolves it to.
  for (const site of sites) {
    const { ref } = site;
    const from = unitOf(positions.get(place(site.file, site.at.slice(0, -1))) ?? []);
    const fail = (why: string) => errors.push({ unit: from, message: `"${site.key}" at ${where(site.file, site.at)}: "${ref}" ${why}` });
    let target: { path: string; segments: string[] } | undefined;
    if (site.key === "$dynamicRef") {
      // Kept only within one file (above). An anchor stays one, resolved again as the schema is
      // applied, and a URL is left as written, which ajv refuses itself.
      const segments = ref.startsWith("#") ? pointer(ref.slice(1)) : undefined;
      if (segments === undefined) {
        if (!ref.startsWith("#") && !SCHEME.test(ref)) fail("names a file that was not read.");
        continue;
      }
      target = { path: site.file, segments };
    } else {
      const resolved = resolveRef(files, site.file, site.at.slice(0, -1));
      if (resolved === undefined) {
        fail("points to nothing the files hold.");
        continue;
      }
      if ("url" in resolved) {
        if (!SCHEME.test(ref)) site.object[site.key] = resolved.url;
        continue;
      }
      target = resolved;
    }
    const at = target.segments;
    const out = positions.get(place(target.path, at));
    if (!out) {
      fail("points to something that is not a schema, or to a schema the conversion leaves out.");
      continue;
    }
    site.object[site.key] = `#${fragmentOf(out)}`;
    edges.push([from, unitOf(out)]);
  }

  if (entry) {
    // The units the entry reaches, transitively; the others, and their errors, are left out.
    const reached = new Set([ENTRY]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [from, to] of edges)
        if (reached.has(from) && !reached.has(to)) {
          reached.add(to);
          grew = true;
        }
    }
    for (let i = errors.length - 1; i >= 0; i--) if (units.has(errors[i]!.unit) && !reached.has(errors[i]!.unit)) errors.splice(i, 1);
    const kept = [...units].filter(([name]) => reached.has(name));
    if (kept.length && isObj(converted)) {
      const out = converted as Out;
      const defs = ((out[container] as Out | undefined) ??= {});
      for (const [name, schema] of kept) {
        if (has(defs, name)) errors.push({ unit: ENTRY, message: `"${container}" at ${where(rootPath, [...entry, container])} defines "${name}", which the document also gives to a schema the definition refers to.` });
        else defs[name] = schema;
      }
    }
  }

  if (errors.length) return { error: errors.map((e) => e.message).join(" ") };
  if (isObj(converted)) return { schema: { $schema: TARGET_URIS[target], ...converted } };
  // A boolean schema cannot declare its draft; the empty schema accepts every value, and its negation none.
  return { schema: converted === false ? { $schema: TARGET_URIS[target], not: {} } : { $schema: TARGET_URIS[target] } };
}
