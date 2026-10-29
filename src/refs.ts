// A schema's `$ref`s, to the schema resources of its file and to other files (DESIGN.md, "References
// to other files"). A reference's URI part is resolved against the file that holds it, as a
// relative URL is, so `./tag.schema.jsonc`, `tag.schema.jsonc` and
// `../shared/tag.schema.jsonc#/$defs/tag` each name a file near it, unless an `$id` below the
// file's root gives it another base, or it names a schema by its `$id`; one with a scheme of its own
// (`https:`, `urn:`) that no schema of the files has as its `$id` is a URL and is not followed. The
// files reached, transitively, are read once each: the types import the other files' modules, and
// ajv compiles the validator from all of them.
import { readFileSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CODES, type Problem } from "./core/problems.ts";
import type { Value } from "./core/serialize.ts";
import { carryDocs, parseSchemaFile } from "./parse.ts";

type Obj = { readonly [key: string]: Value };

const isObj = (value: Value | undefined): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** The suffix of the files a `$ref` may name: the schema loader's own. */
export const SCHEMA_SUFFIX = ".schema.jsonc";

// The keywords whose values are schemas, lists of schemas, or maps of them. Every other keyword's
// value (`const`, `enum`, `default`, `examples`, an unknown keyword) is data and is never searched.
const ONE = ["additionalProperties", "unevaluatedProperties", "items", "additionalItems", "unevaluatedItems", "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"];
const LIST = ["allOf", "anyOf", "oneOf", "prefixItems", "items"];
const MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"];

/**
 * A copy of `schema` with `change` applied to it and then to every schema inside it, keyword by
 * keyword, so data (`const`, an unknown keyword) stays as written; `change` is given the schema's
 * place as JSON Pointer segments. The copy keeps the doc comments of the keys it copies (parse.ts).
 */
export function mapSchemas(schema: Value, change: (copy: Record<string, Value>, segments: readonly string[]) => void, segments: readonly string[] = []): Value {
  if (!isObj(schema)) return schema;
  const copy: Record<string, Value> = { ...schema };
  carryDocs(schema, copy);
  change(copy, segments);
  for (const key of ONE) if (isObj(copy[key])) copy[key] = mapSchemas(copy[key], change, [...segments, key]);
  for (const key of LIST) {
    const list = copy[key];
    if (Array.isArray(list)) copy[key] = list.map((item, i) => mapSchemas(item, change, [...segments, key, String(i)]));
  }
  for (const key of MAP) {
    const group = copy[key];
    // A `dependencies` entry that is a list names properties; one that is an object is a schema.
    if (!isObj(group)) continue;
    const mapped = Object.fromEntries(Object.entries(group).map(([name, item]) => [name, Array.isArray(item) ? item : mapSchemas(item, change, [...segments, key, name])]));
    carryDocs(group, mapped);
    copy[key] = mapped;
  }
  return copy;
}

/** A copy of `schema` with `map` applied to every `$ref` in it, so data that holds a `$ref` key stays as written. */
const mapRefs = (schema: Value, map: (ref: string) => string): Value =>
  mapSchemas(schema, (copy) => {
    if (typeof copy["$ref"] === "string") copy["$ref"] = map(copy["$ref"]);
  });

/** Calls `visit` with `schema` and then every schema inside it, keyword by keyword, as `mapSchemas` walks them. */
export const eachSchema = (schema: Value, visit: (schema: Obj) => void): void => void mapSchemas(schema, visit);

/** A copy of `schema` without `keywords`, in it and in every schema inside it. */
export const withoutKeywords = (schema: Value, keywords: readonly string[]): Value =>
  keywords.length
    ? mapSchemas(schema, (copy) => {
        for (const keyword of keywords) delete copy[keyword];
      })
    : schema;

/** The file a reference names and the fragment it points to there; undefined for a reference within its own file (`#/...`) or to a URL. */
export function fileOf(ref: string, from: string): { path: string; fragment: string } | undefined {
  const hash = ref.indexOf("#");
  const uri = hash === -1 ? ref : ref.slice(0, hash);
  if (uri === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) return undefined;
  try {
    return { path: fileURLToPath(new URL(uri, pathToFileURL(from))), fragment: hash === -1 ? "" : ref.slice(hash + 1) };
  } catch {
    return undefined; // not a URL at all, which ajv reports
  }
}

/** A fragment's JSON Pointer segments, unescaped (RFC 6901, percent-decoded as a URI fragment is); undefined when it is not a pointer (an `$anchor` name) or is malformed. */
export function pointer(fragment: string): string[] | undefined {
  if (fragment === "") return [];
  if (!fragment.startsWith("/")) return undefined;
  try {
    return fragment.slice(1).split("/").map((raw) => decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return undefined;
  }
}

/** A JSON Pointer as a URI fragment, without its `#`: RFC 6901's escapes, then percent-encoding for what a fragment may not hold. */
export const fragmentOf = (segments: readonly string[]): string =>
  segments.map((segment) => "/" + segment.replace(/~/g, "~0").replace(/\//g, "~1").replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@?]/gu, (c) => encodeURIComponent(c))).join("");

// The keywords json-schema-traverse 1.0.0, which ajv walks a schema with, treats as holding a list of
// schemas, a map of them, or data; with `allKeys`, as ajv calls it, every other keyword's value is
// walked as a schema.
const TRAVERSE_LIST = new Set(["items", "allOf", "anyOf", "oneOf"]);
const TRAVERSE_MAP = new Set(["$defs", "definitions", "properties", "patternProperties", "dependencies"]);
const TRAVERSE_SKIP = new Set(["default", "enum", "const", "required", "maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf", "maxLength", "minLength", "pattern", "format", "maxItems", "minItems", "uniqueItems", "maxProperties", "minProperties"]);

/** The plain names a schema declares for itself: `$anchor`, `$dynamicAnchor`, and a plain-name `$id` (`"#name"`, draft-07's spelling of an anchor). */
function anchorNames(schema: Obj): string[] {
  const id = schema["$id"];
  return [schema["$anchor"], schema["$dynamicAnchor"], typeof id === "string" && id.startsWith("#") ? id.slice(1) : undefined].filter((name): name is string => typeof name === "string" && name !== "");
}

/**
 * Each anchor in a file's schema and where it is, as JSON Pointer segments, where ajv 8.20.0
 * resolves one (`getSchemaRefs` in its dist/compile/resolve.js): an `$anchor`, a `$dynamicAnchor` or
 * a plain-name `$id`, in any draft, in each schema json-schema-traverse reaches, which leaves out the
 * file's root and the items of `prefixItems` (measured on 2026-10-26: ajv refused a `$ref` to an
 * anchor in either, "can't resolve reference #top", and resolved one under a keyword no draft
 * defines). A name's first place is kept; ajv refuses a second that differs. The anchors of the
 * whole file, for a schema read without its files (`schemaDeclarations`); `fileIndex` keeps each
 * within the schema resource that declares it.
 */
function anchorsIn(schema: Value): Map<string, string[]> {
  const anchors = new Map<string, string[]>();
  const walk = (node: Value, segments: string[]) => {
    if (!isObj(node)) return;
    if (segments.length) for (const name of anchorNames(node)) if (!anchors.has(name)) anchors.set(name, segments);
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        if (TRAVERSE_LIST.has(key)) value.forEach((item, i) => walk(item, [...segments, key, String(i)]));
      } else if (TRAVERSE_MAP.has(key)) {
        if (isObj(value)) for (const [name, item] of Object.entries(value)) walk(item, [...segments, key, name]);
      } else if (!TRAVERSE_SKIP.has(key)) walk(value, [...segments, key]);
    }
  };
  walk(schema, []);
  return anchors;
}

const ajvAnchors = new WeakMap<object, Map<string, string[]>>();

/**
 * Where a `$ref`'s fragment points in a file's schema, as JSON Pointer segments: a pointer's own,
 * or the place of the anchor it names, where ajv resolves one (`anchorsIn`). Undefined for a
 * malformed pointer and for an anchor ajv does not find.
 */
export function fragmentPath(schema: Value, fragment: string): string[] | undefined {
  if (fragment === "" || fragment.startsWith("/")) return pointer(fragment);
  if (!isObj(schema)) return undefined;
  let anchors = ajvAnchors.get(schema);
  if (!anchors) ajvAnchors.set(schema, (anchors = anchorsIn(schema)));
  return anchors.get(fragment);
}

/** The value a pointer leads to in `schema`, or undefined when nothing is there. */
export function pointTo(schema: Value, segments: string[]): Value | undefined {
  let target: Value | undefined = schema;
  for (const segment of segments) target = Array.isArray(target) ? target[Number(segment)] : isObj(target) && Object.hasOwn(target, segment) ? target[segment] : undefined;
  return target;
}

// ---- base URIs and schema resources ------------------------------------------------------------
//
// A `$ref` is resolved against the base URI of the schema that holds it (2020-12 core 8.2.1 and 9.2;
// draft-07 core 8.2): the nearest `$id` above it, or its own, each resolved against the one above,
// up to the file's root, whose base is the file itself, or the root's own `$id` when that has a
// scheme. A schema below the root with an `$id` is a schema resource of its own, embedded in the
// file (2020-12 core 9.2.1), which a `$ref` names by that `$id`, with a pointer or an anchor inside
// it. So `{ "$id": "https://example.com/inner", "$defs": { "x": ... }, "allOf": [{ "$ref":
// "#/$defs/x" }] }` below a file's root points to its own `x`, as ajv resolves it. Resolved here once
// for the types, the validator and Standard JSON Schema, each `$ref` is then written as a pointer
// from its file's root (`resolvedSchemas`), so none of them resolves an `$id` again.

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** A URI reference's parts (RFC 3986 appendix B), each undefined when absent. */
const URI_PARTS = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s;

/** A path without its `.` and `..` segments (RFC 3986 5.2.4). */
function withoutDots(path: string): string {
  const out: string[] = [];
  let input = path;
  while (input) {
    if (input.startsWith("../")) input = input.slice(3);
    else if (input.startsWith("./")) input = input.slice(2);
    else if (input.startsWith("/./")) input = input.slice(2);
    else if (input === "/.") input = "/";
    else if (input.startsWith("/../") || input === "/..") {
      input = input === "/.." ? "/" : input.slice(3);
      out.pop();
    } else if (input === "." || input === "..") input = "";
    else {
      const end = input.indexOf("/", input.startsWith("/") ? 1 : 0);
      out.push(end === -1 ? input : input.slice(0, end));
      input = end === -1 ? "" : input.slice(end);
    }
  }
  return out.join("");
}

/**
 * `ref` resolved against the absolute URI `base`, as RFC 3986 5.2.2 resolves a reference, which a URN
 * or an opaque base allows as well as a URL (`new URL` refuses a relative reference against
 * `urn:example:root`).
 */
export function resolveUri(base: string, ref: string): string {
  const r = URI_PARTS.exec(ref)!;
  const b = URI_PARTS.exec(base)!;
  let [scheme, authority, path, query] = [r[1], r[2], r[3]!, r[4]];
  if (scheme === undefined) {
    scheme = b[1];
    if (authority === undefined) {
      authority = b[2];
      if (path === "") {
        path = b[3]!;
        query ??= b[4];
      } else if (!path.startsWith("/")) {
        const basePath = b[3]!;
        path = b[2] !== undefined && basePath === "" ? `/${path}` : basePath.slice(0, basePath.lastIndexOf("/") + 1) + path;
      }
    }
  }
  return `${scheme === undefined ? "" : `${scheme.toLowerCase()}:`}${authority === undefined ? "" : `//${authority}`}${withoutDots(path)}${query === undefined ? "" : `?${query}`}${r[5] === undefined ? "" : `#${r[5]}`}`;
}

/** A URI without its fragment, and its fragment, `""` when it has none. */
function splitFragment(uri: string): [string, string] {
  const hash = uri.indexOf("#");
  return hash === -1 ? [uri, ""] : [uri.slice(0, hash), uri.slice(hash + 1)];
}

/**
 * Whether the files are compiled in draft-06 or draft-07, whose `$ref` makes every keyword beside it
 * ignored (draft-07 core 8.3), an `$id` among them: that `$id` neither moves the base of the `$ref`
 * nor names the schema. ajv applies it, and the Test Suite's draft-07 ref.json [6] ("$ref prevents a
 * sibling $id from changing the base uri") holds the spec's reading, which dotschema follows.
 */
const refHidesId = (root: Value): boolean => {
  const declared = isObj(root) ? root["$schema"] : undefined;
  return !(typeof declared === "string" && (declared.includes("2019-09") || declared.includes("2020-12")));
};

/** The `$id` that makes a schema a resource of its own, below a file's root: not a plain name (`"#name"`), and not one a draft-07 `$ref` beside it hides. */
function resourceId(schema: Obj, hideBesideRef: boolean): string | undefined {
  const id = schema["$id"];
  if (typeof id !== "string" || id.startsWith("#")) return undefined;
  return hideBesideRef && typeof schema["$ref"] === "string" ? undefined : id;
}

/** A `$ref` in a file, with what its place tells about how it resolves. */
type Site = {
  ref: string;
  /** The base URI it resolves against. */
  base: string;
  /** Whether an `$id` below the file's root sets that base. */
  moved: boolean;
  /** Whether that base is still the file's own location, moved only by `$id`s without a scheme, so that a relative reference names a file. */
  local: boolean;
  /** Whether ajv sees an `$id` below the file's root on the way to it, against which it would resolve a pointer. */
  ajvMoved: boolean;
};

/** A file's schema resources, its anchors, and its `$ref`s, as `fileIndex` finds them. */
type FileIndex = {
  /** The base URI of the file's root: its own `$id` with a scheme, or the file's `file:` URL. */
  base: string;
  /** Each schema resource by its URI without a fragment: where it is, and whether only the file itself may name it, a file's location and an `$id` relative to it naming a place on this disk and not a resource another file shares. */
  resources: Map<string, { segments: string[]; local: boolean }>;
  /** Each anchor where ajv finds one, by its resource's URI and its name (`<uri>#<name>`). */
  anchors: Map<string, string[]>;
  /** Each anchor the spec finds where ajv does not: at the file's root, or inside `prefixItems`. */
  unseen: Map<string, string[]>;
  /** Each `$ref`, by the JSON Pointer of the schema that holds it. */
  sites: Map<string, Site>;
};

const indexes = new WeakMap<object, Map<string, FileIndex>>();

/**
 * A file's schema resources and anchors, where ajv 8.20.0 finds them (`getSchemaRefs` in its
 * dist/compile/resolve.js, walking with json-schema-traverse's `allKeys`, which leaves out the file's
 * root and the items of `prefixItems`), and each of its `$ref`s, keyword by keyword as `mapSchemas`
 * walks them, with the base it resolves against.
 */
function fileIndex(path: string, schema: Value, hideBesideRef: boolean): FileIndex {
  const key = `${hideBesideRef}\0${path}`;
  const cached = isObj(schema) ? indexes.get(schema)?.get(key) : undefined;
  if (cached) return cached;
  const rootId = isObj(schema) && typeof schema["$id"] === "string" && SCHEME.test(schema["$id"]) ? splitFragment(schema["$id"])[0] : undefined;
  const base = rootId ?? pathToFileURL(path).href;
  const index: FileIndex = { base, resources: new Map([[base, { segments: [], local: rootId === undefined }]]), anchors: new Map(), unseen: new Map(), sites: new Map() };

  // Resources and anchors, by the walk ajv's resolve.js makes; `seen` is false where ajv's walk does not reach.
  const register = (node: Value, segments: string[], base: string, local: boolean, seen: boolean) => {
    if (!isObj(node)) return;
    if (segments.length) {
      const id = resourceId(node, hideBesideRef);
      if (id !== undefined) {
        const [uri, fragment] = splitFragment(resolveUri(base, id));
        [base, local] = [uri, local && !SCHEME.test(id)];
        if (seen && !index.resources.has(uri)) index.resources.set(uri, { segments, local });
        if (fragment) (seen ? index.anchors : index.unseen).set(`${uri}#${fragment}`, segments);
      }
    }
    for (const name of anchorNames(node)) {
      const map = seen && segments.length ? index.anchors : index.unseen;
      if (!map.has(`${base}#${name}`)) map.set(`${base}#${name}`, segments);
    }
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        if (TRAVERSE_LIST.has(key) || key === "prefixItems") value.forEach((item, i) => register(item, [...segments, key, String(i)], base, local, seen && key !== "prefixItems"));
      } else if (TRAVERSE_MAP.has(key)) {
        if (isObj(value)) for (const [name, item] of Object.entries(value)) register(item, [...segments, key, name], base, local, seen);
      } else if (!TRAVERSE_SKIP.has(key)) register(value, [...segments, key], base, local, seen);
    }
  };
  register(schema, [], base, rootId === undefined, true);

  // The `$ref`s, each with the base of the schema that holds it, its own `$id` applied.
  const sites = (node: Value, segments: string[], site: Omit<Site, "ref">) => {
    if (!isObj(node)) return;
    if (segments.length) {
      const id = resourceId(node, hideBesideRef);
      if (id !== undefined) site = { base: splitFragment(resolveUri(site.base, id))[0], moved: true, local: site.local && !SCHEME.test(id), ajvMoved: true };
      else if (typeof node["$id"] === "string" && !node["$id"].startsWith("#")) site = { ...site, ajvMoved: true };
    }
    if (typeof node["$ref"] === "string") index.sites.set(JSON.stringify(segments), { ref: node["$ref"], ...site });
    for (const key of ONE) if (isObj(node[key])) sites(node[key], [...segments, key], site);
    for (const key of LIST) {
      const list = node[key];
      if (Array.isArray(list)) list.forEach((item, i) => sites(item, [...segments, key, String(i)], site));
    }
    for (const key of MAP) {
      const group = node[key];
      if (isObj(group)) for (const [name, item] of Object.entries(group)) if (!Array.isArray(item)) sites(item, [...segments, key, name], site);
    }
  };
  sites(schema, [], { base, moved: false, local: rootId === undefined, ajvMoved: false });

  if (isObj(schema)) {
    let byKey = indexes.get(schema);
    if (!byKey) indexes.set(schema, (byKey = new Map()));
    byKey.set(key, index);
  }
  return index;
}

/** Where a `$ref` resolves, as `resolveSite` finds it. */
type Resolution =
  /** A schema of the files, by its file and its JSON Pointer there; `fragment` is the reference's own, relative to `resource`, the place of the resource it names. */
  | { kind: "schema"; path: string; segments: string[]; fragment: string; resource: string[] }
  /** A file to read, then the fragment within its root's resource. */
  | { kind: "file"; path: string; fragment: string }
  /** An anchor its resource does not declare where ajv finds one; `unseen` is where the spec finds it, if anywhere. */
  | { kind: "anchor"; path: string; name: string; resource: string[]; unseen: string[] | undefined }
  /** A malformed pointer, which ajv reports. */
  | { kind: "malformed" }
  /** A URI that no schema of the files has as its `$id`: a URL, which dotschema does not fetch. */
  | { kind: "url"; uri: string };

/** The resource `uri` names in a file, and the fragment within it. */
function within(path: string, index: FileIndex, uri: string, fragment: string): Resolution {
  const resource = index.resources.get(uri)!.segments;
  if (fragment === "" || fragment.startsWith("/")) {
    const segments = pointer(fragment);
    return segments ? { kind: "schema", path, segments: [...resource, ...segments], fragment, resource } : { kind: "malformed" };
  }
  let name = fragment;
  try {
    name = decodeURIComponent(fragment);
  } catch {}
  const at = index.anchors.get(`${uri}#${name}`);
  return at ? { kind: "schema", path, segments: at, fragment, resource } : { kind: "anchor", path, name, resource, unseen: index.unseen.get(`${uri}#${name}`) };
}

/**
 * Where a site's `$ref` points. First a resource of its own file, then, unless the reference has a
 * scheme of its own, a file: resolved against the file's path where no `$id` below the root moves
 * its base (an `$id` at the root does not, as files are the unit, DESIGN.md, "References to other
 * files"), and where only `$id`s without a scheme move it, against the place on disk they name.
 * Last, with `others`, a resource another file declares with an `$id` that has a scheme; otherwise
 * the reference is a URL.
 */
function resolveSite(path: string, index: FileIndex, site: Site, others?: (uri: string) => { path: string; index: FileIndex } | undefined): Resolution {
  const [uri, fragment] = splitFragment(resolveUri(site.base, site.ref));
  if (index.resources.has(uri)) return within(path, index, uri, fragment);
  if (!SCHEME.test(site.ref) && (!site.moved || site.local)) {
    const file = site.moved ? fileAt(uri, fragment) : fileOf(site.ref, path);
    if (file) return { kind: "file", ...file };
  }
  const other = others?.(uri);
  return other ? within(other.path, other.index, uri, fragment) : { kind: "url", uri: fragment ? `${uri}#${fragment}` : uri };
}

/** The file a `file:` URL names, or undefined for one this system cannot name (another host). */
function fileAt(uri: string, fragment: string): { path: string; fragment: string } | undefined {
  try {
    return { path: fileURLToPath(uri), fragment };
  } catch {
    return undefined;
  }
}

/** The resolver of a set of files: each file's index, and the resources other files name by an `$id` with a scheme, the first file's where two declare one. */
function resolverOf(schemas: Map<string, Value>): { index: (path: string) => FileIndex; others: (path: string) => (uri: string) => { path: string; index: FileIndex } | undefined } {
  const root = schemas.values().next().value as Value;
  const hide = refHidesId(root);
  const index = (path: string) => fileIndex(path, schemas.get(path)!, hide);
  return {
    index,
    others: (from) => (uri) => {
      for (const path of schemas.keys()) {
        if (path === from) continue;
        const resource = index(path).resources.get(uri);
        if (resource && !resource.local) return { path, index: index(path) };
      }
      return undefined;
    },
  };
}

/**
 * Where the `$ref` of the schema at `segments` in the file `path` points among `files`: a schema, by
 * its file and its JSON Pointer from that file's root; a URL no schema of the files declares (the
 * reference resolved to an absolute URI); or undefined when it points to nothing the files hold,
 * which `collect` reports.
 */
export function resolveRef(files: Files, path: string, segments: readonly string[]): { path: string; segments: string[] } | { url: string } | undefined {
  const { index, others } = resolverOf(files.schemas);
  const site = index(path).sites.get(JSON.stringify(segments));
  if (!site) return undefined;
  let resolution = resolveSite(path, index(path), site, others(path));
  if (resolution.kind === "file") {
    if (!files.schemas.has(resolution.path)) return undefined;
    const there = index(resolution.path);
    resolution = within(resolution.path, there, there.base, resolution.fragment);
  }
  return resolution.kind === "schema" ? { path: resolution.path, segments: resolution.segments } : resolution.kind === "url" ? { url: resolution.uri } : undefined;
}

const resolved = new WeakMap<Map<string, Value>, Map<string, Value>>();

/**
 * Every file's schema with each `$ref` written as a pointer from its target file's root, so that
 * neither the emitter nor ajv resolves one against an `$id` again: `#/pointer` within the file where
 * ajv's base is the file's own (no `$id` below the root above the reference), and otherwise the
 * file's specifier and the pointer, which `forAjv` turns into the file's id; another file's
 * specifier and the pointer for a schema there. A reference that resolves to a URL is written as
 * that absolute URL where an `$id` moved its base, so that it keeps its meaning; one that points to
 * nothing is left as written, for `collect`'s problem.
 */
export function resolvedSchemas(files: Files): Map<string, Value> {
  const cached = resolved.get(files.schemas);
  if (cached) return cached;
  const out = new Map<string, Value>();
  const { index } = resolverOf(files.schemas);
  for (const [path, schema] of files.schemas) {
    const sites = index(path).sites;
    out.set(
      path,
      mapSchemas(schema, (copy, segments) => {
        const site = sites.get(JSON.stringify(segments));
        if (!site) return;
        const target = resolveRef(files, path, segments);
        if (target === undefined) return;
        if ("url" in target) {
          if (site.moved) copy["$ref"] = target.url;
          return;
        }
        const fragment = `#${fragmentOf(target.segments)}`;
        copy["$ref"] = target.path === path && !site.ajvMoved ? fragment : `${specifierOf(path, target.path)}${fragment === "#" ? "" : fragment}`;
      }),
    );
  }
  resolved.set(files.schemas, out);
  return out;
}

/** A module specifier for `to` from the file `from`: relative, with `/` separators. */
export function specifierOf(from: string, to: string): string {
  const path = relative(dirname(from), to).split(sep).join("/");
  return path.startsWith("../") ? path : `./${path}`;
}

/** Where a reference sits in the text of the file that holds it: the reference inside its quotes, or the file's start if it cannot be found. */
function placeOf(source: string, ref: string): { start: number; length: number } {
  for (const quoted of [JSON.stringify(ref), `'${ref}'`]) {
    const at = source.indexOf(quoted);
    if (at !== -1) return { start: at + 1, length: Math.max(ref.length, 1) };
  }
  return { start: 0, length: 1 };
}

export type Files = {
  /** The schema of every file reached from the root, by path, the root's own included. */
  schemas: Map<string, Value>;
  /** For each other file, where the root's text first refers to it, directly or through another file. */
  places: Map<string, { start: number; length: number }>;
  /** Every file a reference named, read or not, for a bundler to watch. */
  watched: string[];
  /** Problems with references, each placed at a reference in the root's text. */
  problems: Problem[];
};

/**
 * The root schema and every file it reaches. `drafts.of` names the draft a schema declares, or
 * undefined when it declares none, and `drafts.none` the draft a root that declares none is read
 * in: ajv compiles every file in the root's draft, so a file that declares another is a problem,
 * while one that declares none is read in the root's. `clean` is applied to each other file as it
 * is read, as the caller applied it to the root, before its references are followed.
 */
export function collect(rootPath: string, root: Value, rootSource: string, drafts: { of: (schema: Value) => string | undefined; none: string }, clean: (schema: Value) => Value = (schema) => schema): Files {
  const schemas = new Map<string, Value>([[rootPath, root]]);
  const places = new Map<string, { start: number; length: number }>();
  const watched: string[] = [];
  const problems: Problem[] = [];
  const failed = new Set<string>();
  const rootDraft = drafts.of(root) ?? drafts.none;
  const hide = refHidesId(root);
  const queue: { path: string; schema: Value; via?: { start: number; length: number } }[] = [{ path: rootPath, schema: root }];
  // A reference that may name a resource of a file read later, by an `$id` with a scheme, is checked once every file is read.
  const later: { path: string; site: Site; check: (resolution: Resolution) => void }[] = [];
  for (let next = queue.shift(); next; next = queue.shift()) {
    const { path, schema, via } = next;
    const index = fileIndex(path, schema, hide);
    for (const site of index.sites.values()) {
      const { ref } = site;
      const place = via ?? placeOf(rootSource, ref);
      // A problem in a file the root reaches through another is reported at the root's reference, naming that file.
      const where = via ? `${specifierOf(rootPath, path)}: ` : "";
      // A reference written twice is one problem, placed where it is first written.
      const report = (message: string) => {
        if (!problems.some((p) => p.message === `${where}${message}` && p.start === place.start)) problems.push({ message: `${where}${message}`, ...place, code: CODES.schema });
      };
      const check = (resolution: Resolution): void => {
        if (resolution.kind === "file") {
          const target = resolution;
          if (failed.has(target.path)) return;
          let schemaThere = schemas.get(target.path);
          if (schemaThere === undefined) {
            if (!target.path.endsWith(SCHEMA_SUFFIX)) {
              report(`The $ref "${ref}" names a file that is not a schema: a $ref to another file names a .schema.jsonc file.`);
              failed.add(target.path);
              return;
            }
            watched.push(target.path);
            let text: string;
            try {
              text = readFileSync(target.path, "utf8");
            } catch (error) {
              report((error as NodeJS.ErrnoException).code === "ENOENT" ? `The $ref "${ref}" names a file that does not exist.` : `The $ref "${ref}" names a file that cannot be read: ${(error as Error).message}`);
              failed.add(target.path);
              return;
            }
            const parsed = parseSchemaFile(text);
            if (!parsed.ok) {
              report(`The $ref "${ref}" names a file that does not parse: ${parsed.problems[0]!.message}`);
              failed.add(target.path);
              return;
            }
            const declared = drafts.of(parsed.value);
            if (declared !== undefined && declared !== rootDraft) {
              const of = (value: Value) => (isObj(value) && typeof value["$schema"] === "string" ? JSON.stringify(value["$schema"]) : "not declared, so draft-07");
              report(`The $ref "${ref}" names a schema whose $schema is ${of(parsed.value)}, and this schema's is ${of(root)}: a schema and the files it refers to are compiled in one draft.`);
              failed.add(target.path);
              return;
            }
            schemaThere = clean(parsed.value);
            schemas.set(target.path, schemaThere);
            places.set(target.path, place);
            queue.push({ path: target.path, schema: schemaThere, via: place });
          }
          const there = fileIndex(target.path, schemaThere, hide);
          return check(within(target.path, there, there.base, target.fragment));
        }
        // A malformed pointer is ajv's to report, and so is a URL, which ajv cannot resolve: nothing is fetched.
        if (resolution.kind === "malformed" || resolution.kind === "url") return;
        const there = specifierOf(path, resolution.path);
        // The resource the reference resolves to, when it is not a file's root, by its $id as written
        // (one relative to the file's own location would otherwise name a path on this machine) and its place.
        const id = resolution.resource.length ? (pointTo(schemas.get(resolution.path)!, resolution.resource) as Obj)["$id"] : undefined;
        const inside = typeof id === "string" ? `the schema whose $id is "${id}" (${there}#${fragmentOf(resolution.resource)})` : there;
        if (resolution.kind === "anchor") {
          // An anchor the spec finds where ajv does not, at the root or in `prefixItems`, has a pointer that ajv follows.
          const declared = resolution.unseen;
          const uri = ref.includes("#") ? ref.slice(0, ref.indexOf("#")) : ref;
          report(declared ? `The $ref "${ref}" names an anchor that ajv does not resolve where ${there} declares it, ${declared.length > resolution.resource.length ? "inside prefixItems" : "at its root"}: write "${uri}#${fragmentOf(declared.slice(resolution.resource.length))}" in its place.` : `The $ref "${ref}" names no anchor: ${inside} declares no anchor "${resolution.name}".`);
          return;
        }
        const value = pointTo(schemas.get(resolution.path)!, resolution.segments);
        if (value === undefined) report(`The $ref "${ref}" points to nothing: ${inside} has no #${resolution.fragment}.`);
        else if (typeof value !== "boolean" && !isObj(value)) {
          const kind = value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? "a string" : "a number";
          report(`The $ref "${ref}" points to ${kind}, not a schema: a $ref points to an object or a boolean.`);
        }
      };
      const resolution = resolveSite(path, index, site);
      if (resolution.kind === "url") later.push({ path, site, check });
      else check(resolution);
    }
  }
  const { others } = resolverOf(schemas);
  for (const { path, site, check } of later) check(resolveSite(path, fileIndex(path, schemas.get(path)!, hide), site, others(path)));
  return { schemas, places, watched, problems };
}

/** The schema resource a schema at `segments` is in: the deepest whose root is it or above it, the file's root's when no `$id` below the root begins one. */
function resourceAt(index: FileIndex, segments: readonly string[]): { uri: string; segments: string[] } {
  let found = { uri: index.base, segments: [] as string[] };
  for (const [uri, resource] of index.resources) {
    const at = resource.segments;
    if (at.length > found.segments.length && at.length <= segments.length && at.every((segment, i) => segment === segments[i])) found = { uri, segments: at };
  }
  return found;
}

/** Where an `$id` of `value` sits in a file's text: the value inside its quotes, after its key, or wherever the value is first quoted. */
function idPlaceOf(source: string, value: string): { start: number; length: number } {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quoted = new RegExp(`(["']?)\\$id\\1\\s*:\\s*(["'])${escape(value)}\\2`).exec(source);
  if (quoted) return { start: quoted.index + quoted[0].length - value.length - 1, length: Math.max(value.length, 1) };
  return placeOf(source, value);
}

/**
 * Each 2020-12 `$dynamicRef` and 2019-09 `$recursiveRef` that ajv resolves otherwise than the spec,
 * as a problem placed as `collect`'s are. ajv 8.20.0 (`dist/vocabularies/dynamic/dynamicRef.js`)
 * resolves `"#name"` to the `$dynamicAnchor` of that name only when it has compiled one already, and
 * otherwise, as for a JSON Pointer or `"#"`, to the root of the function it compiles, which is the
 * file's root unless a `$ref` reached the schema: measured on 2026-10-20, with the anchor in `$defs`
 * the validator checked the root's rules in its place, and with the reference at the root it
 * recursed until the stack ran out. The spec resolves each against the schema resource that holds
 * it (2020-12 core 8.2.3.2; 2019-09 core 8.2.4.2), so a reference passes where that resource's root
 * declares the anchor, `"$dynamicAnchor": "name"` or `"$recursiveAnchor": true`, and `"#"` passes
 * at the file's own root resource alone. Measured on 2026-10-27 with the Test Suite's 2019-09
 * recursiveRef.json [5], whose `$recursiveRef` inside an `$id` without `$recursiveAnchor` ajv sent
 * to the root's anchor: refused, as every such reference inside an `$id` is.
 */
export function dynamicRefProblems(files: Files, rootPath: string, rootSource: string, keyword: "$dynamicRef" | "$recursiveRef"): Problem[] {
  const problems: Problem[] = [];
  const hide = refHidesId(files.schemas.get(rootPath)!);
  for (const [path, schema] of files.schemas) {
    const index = fileIndex(path, schema, hide);
    mapSchemas(schema, (s, segments) => {
      const ref = s[keyword];
      // A reference to another document ajv refuses itself.
      if (typeof ref !== "string" || !ref.startsWith("#")) return;
      const resource = resourceAt(index, segments);
      const root = pointTo(schema, resource.segments) as Obj;
      const name = keyword === "$recursiveRef" ? (ref === "#" ? "" : undefined) : ref.includes("/") ? undefined : ref.slice(1);
      const anchored = keyword === "$recursiveRef" ? root["$recursiveAnchor"] === true : name !== undefined && name !== "" && root["$dynamicAnchor"] === name;
      if (anchored || (ref === "#" && keyword === "$dynamicRef" && !resource.segments.length) || (keyword === "$recursiveRef" && !resource.segments.length)) return;
      const id = resource.segments.length ? (root["$id"] as string) : undefined;
      const at = id === undefined ? "the root of the schema" : `the schema whose $id is "${id}"`;
      const fix = keyword === "$recursiveRef" ? `declare "$recursiveAnchor": true beside that $id, or write a $ref to it` : name ? `declare "$dynamicAnchor": "${name}" at ${at}, or write it as a $ref` : "write it as a $ref";
      const where = path === rootPath ? "" : `${specifierOf(rootPath, path)}: `;
      const place = path !== rootPath ? files.places.get(path)! : id === undefined ? placeOf(rootSource, ref) : idPlaceOf(rootSource, id);
      const message = id === undefined ? `${where}ajv resolves the $dynamicRef "${ref}" to the root of its schema, not where it points: ${fix}.` : `${where}ajv resolves the ${keyword} "${ref}" inside the schema whose $id is "${id}" by where it compiles that schema, not against the $id: ${fix}.`;
      if (!problems.some((p) => p.message === message && p.start === place.start)) problems.push({ message, ...place, code: CODES.schema });
    });
  }
  return problems;
}

/**
 * The files with each 2020-12 `$dynamicRef` and 2019-09 `$recursiveRef` that resolves as a `$ref`
 * would written as that `$ref`, for the types, ajv and Standard JSON Schema alike. A `$dynamicRef`
 * is a `$ref` (2020-12 core 8.2.3.2) when its fragment is a JSON Pointer, when the schema it first
 * resolves to declares no `$dynamicAnchor` of its name (the "bookending" the Test Suite's
 * dynamicRef.json holds), and, where that schema does, when no other schema of the files declares
 * one of that name, so that no dynamic scope can hold another. A `$recursiveRef` (`"#"` alone,
 * 2019-09 core 8.2.4.2) is a `$ref` to the root of its schema resource unless that root says
 * `"$recursiveAnchor": true`, and, where it does, when no other schema of the files says so. Each is
 * written as a pointer from the resource it names (an anchor ajv does not see, at a file's root, by
 * where it is), and beside a `$ref` already there, in `allOf`. A reference that resolves to nothing
 * the files hold is left as written, for ajv or `dynamicRefProblems` to report.
 */
export function staticReferences(files: Files, rootPath: string, keyword: "$dynamicRef" | "$recursiveRef"): Files {
  const hide = refHidesId(files.schemas.get(rootPath)!);
  const { others } = resolverOf(files.schemas);
  // How many schemas of the files declare each dynamic anchor, or `"$recursiveAnchor": true`.
  const declared = new Map<string, number>();
  for (const schema of files.schemas.values())
    eachSchema(schema, (s) => {
      const name = keyword === "$dynamicRef" ? (typeof s["$dynamicAnchor"] === "string" ? s["$dynamicAnchor"] : undefined) : s["$recursiveAnchor"] === true ? "" : undefined;
      if (name !== undefined) declared.set(name, (declared.get(name) ?? 0) + 1);
    });
  const rewritten = (path: string, schema: Value, segments: readonly string[], ref: string): string | undefined => {
    const index = fileIndex(path, schema, hide);
    const resource = resourceAt(index, segments);
    if (keyword === "$recursiveRef") {
      if (ref !== "#") return undefined;
      const root = pointTo(schema, resource.segments) as Obj;
      return root["$recursiveAnchor"] !== true || declared.get("") === 1 ? "#" : undefined;
    }
    const at = index.resources.get(resource.uri);
    const site: Site = { ref, base: resource.uri, moved: resource.segments.length > 0, local: at?.local ?? false, ajvMoved: resource.segments.length > 0 };
    let resolution = resolveSite(path, index, site, others(path));
    if (resolution.kind === "file") {
      const there = files.schemas.get(resolution.path);
      if (there === undefined) return undefined;
      const thereIndex = fileIndex(resolution.path, there, hide);
      resolution = within(resolution.path, thereIndex, thereIndex.base, resolution.fragment);
    }
    const target = resolution.kind === "schema" ? resolution : resolution.kind === "anchor" && resolution.unseen ? { ...resolution, segments: resolution.unseen } : undefined;
    if (!target) return undefined;
    const fragment = ref.includes("#") ? ref.slice(ref.indexOf("#") + 1) : "";
    if (fragment !== "" && !fragment.startsWith("/")) {
      let name = fragment;
      try {
        name = decodeURIComponent(fragment);
      } catch {}
      const schemaThere = pointTo(files.schemas.get(target.path)!, target.segments);
      if (isObj(schemaThere) && schemaThere["$dynamicAnchor"] === name && declared.get(name) !== 1) return undefined;
    }
    const uri = ref.includes("#") ? ref.slice(0, ref.indexOf("#")) : ref;
    const rest = target.segments.slice(target.resource.length);
    return `${uri}${rest.length || !uri ? `#${fragmentOf(rest)}` : ""}`;
  };
  let changed = false;
  const schemas = new Map(
    [...files.schemas].map(([path, schema]) => [
      path,
      mapSchemas(schema, (copy, segments) => {
        const ref = copy[keyword];
        if (typeof ref !== "string") return;
        const to = rewritten(path, schema, segments, ref);
        if (to === undefined) return;
        changed = true;
        delete copy[keyword];
        if (typeof copy["$ref"] !== "string") copy["$ref"] = to;
        else copy["allOf"] = [...(Array.isArray(copy["allOf"]) ? copy["allOf"] : []), { $ref: to }];
      }),
    ]),
  );
  return changed ? { ...files, schemas } : files;
}

/**
 * Every file of `files` for ajv, each under an id that holds no path, because ajv's standalone code
 * embeds ids: a file's own absolute `$id` (one with a scheme), or `dotschema:<n>`. Each reference
 * to another of the files is rewritten to that file's id, so ajv never resolves a file path.
 */
export function forAjv(files: Files, rootPath: string): { root: Value; others: { path: string; id: string; schema: Value }[] } {
  const ids = new Map<string, string>();
  let n = 0;
  for (const [path, schema] of files.schemas) {
    const own = isObj(schema) && typeof schema["$id"] === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(schema["$id"]) ? schema["$id"] : undefined;
    ids.set(path, own ?? `dotschema:${n++}`);
  }
  // Each `$ref` already a pointer from its target file's root (resolvedSchemas), named here by that file's id.
  const schemas = resolvedSchemas(files);
  const prepare = (path: string, schema: Value): Value => {
    const rewritten = mapRefs(schema, (ref) => {
      const target = fileOf(ref, path);
      const id = target && ids.get(target.path);
      return id ? `${id}${target.fragment ? `#${target.fragment}` : ""}` : ref;
    });
    return isObj(rewritten) ? { ...rewritten, $id: ids.get(path)! } : rewritten;
  };
  return {
    root: prepare(rootPath, schemas.get(rootPath)!),
    others: [...schemas].filter(([path]) => path !== rootPath).map(([path, schema]) => ({ path, id: ids.get(path)!, schema: prepare(path, schema) })),
  };
}
