// Schema resources and how a reference finds a schema among them: each resource given to `compile`,
// each schema below one with an `$id` of its own (a resource embedded in it), the anchors in each,
// and the walk a JSON Pointer takes, which enters an embedded resource where it passes its `$id`.
import type { Draft } from "./index.ts";
import { encodeComponent, pointerSegments, resolveUri, splitUri } from "./uri.ts";

type Obj = Record<string, unknown>;

export const isObject = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);

/** Two schemas that name themselves by one URI, an `$id` or an anchor, which ajv refuses with this message and the spec says a validator should (2020-12 core 8.2.1). */
const ambiguous = (uri: string) => new Error(`reference "${uri}" resolves to more than one schema`);

/** A schema resource: a document given to `compile`, or a schema with an `$id` inside one. */
export interface Resource {
  /** Its absolute URI, without a fragment: the base URI of the `$ref`s inside it. */
  readonly uri: string;
  /** Its root schema. */
  readonly schema: unknown;
  /** Each plain-name fragment it declares: `$anchor`, `$dynamicAnchor`, or draft-07's `"$id": "#name"`. */
  readonly anchors: Map<string, Target>;
  /** Each `$dynamicAnchor` it declares (2020-12), which a `$dynamicRef` may resolve to dynamically. */
  readonly dynamicAnchors: Map<string, Target>;
  /** Whether its root says `"$recursiveAnchor": true` (2019-09). */
  recursiveAnchor: boolean;
}

/** A schema where a reference or a walk found it: the value, its resource, and its JSON Pointer from that resource's root, escaped as a fragment. */
export interface Target {
  readonly schema: unknown;
  readonly resource: Resource;
  readonly pointer: string;
}

/** Where a target is, as an absolute URI: the identity of a compiled function. */
export const locationOf = (target: Target): string => `${target.resource.uri}#${target.pointer}`;

// The keywords whose values are a schema, a list of schemas or a map of them, in every draft the
// engine reads; every other keyword's value (`const`, `enum`, `default`, an unknown keyword) is data.
export const SCHEMA_ONE = new Set(["additionalProperties", "unevaluatedProperties", "items", "additionalItems", "unevaluatedItems", "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"]);
export const SCHEMA_LIST = new Set(["allOf", "anyOf", "oneOf", "prefixItems", "items"]);
export const SCHEMA_MAP = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"]);

/** Whether a schema's `$id` names a resource or an anchor: always from 2019-09; in draft-07, not beside a `$ref`, which makes every keyword beside it ignored (draft-07 core 8.3), as dotschema's refs.ts reads it. */
const idOf = (schema: Obj, draft: Draft): string | undefined => {
  const id = schema["$id"];
  if (typeof id !== "string") return undefined;
  if (draft === "draft-07" && typeof schema["$ref"] === "string") return undefined;
  return id;
};

/** A key as a segment of the pointer in a schema's location: escaped for JSON Pointer, then each character a fragment cannot hold percent-encoded, but a lone surrogate (`encodeComponent`). */
const escapeSegment = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1").replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@?/]/gu, encodeComponent);

/** Every resource, by URI, with the embedded ones by the schema object that declares them. */
export class Registry {
  readonly resources = new Map<string, Resource>();
  readonly embedded = new WeakMap<object, Resource>();
  readonly draft: Draft;
  /** Whether some schema holds the draft's dynamic reference (`$dynamicRef`, or 2019-09's `$recursiveRef`). */
  dynamicRefs = false;
  /** Whether some `errorMessage` holds a `${...}` template. */
  templates = false;

  constructor(draft: Draft) {
    this.draft = draft;
  }

  /** Adds a document under `id`, with its own `$id`, resolved against `id`, as a second name, and indexes what it holds. */
  add(id: string, schema: unknown): Resource {
    const [base] = splitUri(id);
    let uri = base;
    const own = isObject(schema) ? idOf(schema, this.draft) : undefined;
    if (own !== undefined) uri = splitUri(resolveUri(base, own))[0];
    const resource = this.make(uri, schema);
    if (uri !== base) this.resources.set(base, resource);
    if (isObject(schema)) this.embedded.set(schema, resource);
    this.index(schema, resource, "", true);
    return resource;
  }

  private make(uri: string, schema: unknown): Resource {
    const had = this.resources.get(uri);
    if (had) {
      if (had.schema !== schema) throw ambiguous(uri);
      return had;
    }
    const resource: Resource = { uri, schema, anchors: new Map(), dynamicAnchors: new Map(), recursiveAnchor: false };
    this.resources.set(uri, resource);
    return resource;
  }

  /** Declares `name` in `map`, a resource's anchors, for the schema at `target`; a second schema of the same name is refused. */
  private anchor(map: Map<string, Target>, name: string, target: Target): void {
    const had = map.get(name);
    if (had && had.schema !== target.schema) throw ambiguous(`${target.resource.uri}#${name}`);
    map.set(name, target);
  }

  /** Walks a schema in place: its resource, anchors and the schemas inside it. */
  private index(schema: unknown, resource: Resource, pointer: string, root: boolean): void {
    if (!isObject(schema)) return;
    const draft = this.draft;
    const id = idOf(schema, draft);
    if (id !== undefined && !root) {
      const [uri, fragment] = splitUri(resolveUri(resource.uri, id));
      if (uri !== resource.uri) {
        resource = this.make(uri, schema);
        this.embedded.set(schema, resource);
        pointer = "";
      }
      if (draft === "draft-07" && fragment !== "") this.anchor(resource.anchors, fragment, { schema, resource, pointer });
    } else if (id !== undefined && draft === "draft-07") {
      const fragment = splitUri(resolveUri(resource.uri, id))[1];
      if (fragment !== "") this.anchor(resource.anchors, fragment, { schema, resource, pointer });
    }
    const here: Target = { schema, resource, pointer };
    if (draft !== "draft-07" && typeof schema["$anchor"] === "string") this.anchor(resource.anchors, schema["$anchor"], here);
    if (draft === "2020-12" && typeof schema["$dynamicAnchor"] === "string") {
      this.anchor(resource.anchors, schema["$dynamicAnchor"], here);
      this.anchor(resource.dynamicAnchors, schema["$dynamicAnchor"], here);
    }
    if (draft === "2019-09" && pointer === "" && schema["$recursiveAnchor"] === true) resource.recursiveAnchor = true;
    if ((draft === "2020-12" && typeof schema["$dynamicRef"] === "string") || (draft === "2019-09" && typeof schema["$recursiveRef"] === "string")) this.dynamicRefs = true;
    if (schema["errorMessage"] !== undefined && JSON.stringify(schema["errorMessage"]).includes("${")) this.templates = true;
    for (const key of Object.keys(schema)) {
      const value = schema[key];
      const at = `${pointer}/${escapeSegment(key)}`;
      if (Array.isArray(value)) {
        if (SCHEMA_LIST.has(key)) value.forEach((item, i) => this.index(item, resource, `${at}/${i}`, false));
      } else if (SCHEMA_MAP.has(key)) {
        if (isObject(value)) for (const name of Object.keys(value)) if (!Array.isArray(value[name])) this.index(value[name], resource, `${at}/${escapeSegment(name)}`, false);
      } else if (SCHEMA_ONE.has(key)) this.index(value, resource, at, false);
    }
  }

  /** The schema an absolute URI names: a resource, a JSON Pointer inside one, or an anchor; undefined when nothing is there. */
  lookup(uri: string): Target | undefined {
    const [base, fragment] = splitUri(uri);
    const resource = this.resources.get(base);
    if (!resource) return undefined;
    if (fragment === "") return { schema: resource.schema, resource, pointer: "" };
    if (fragment[0] !== "/") {
      let name: string;
      try {
        name = decodeURIComponent(fragment);
      } catch {
        return undefined;
      }
      return resource.anchors.get(name);
    }
    const segments = pointerSegments(fragment);
    if (!segments) return undefined;
    return this.walk({ schema: resource.schema, resource, pointer: "" }, segments);
  }

  /** The schema `segments` lead to from `from`, entering each embedded resource the walk passes through, as a pointer into it. */
  walk(from: Target, segments: readonly string[]): Target | undefined {
    let value: unknown = from.schema;
    let resource = from.resource;
    let pointer = from.pointer;
    // Whether the value is in a schema's place, where an `$id` makes a resource, or in a map or list of them, or in data.
    let place = "schema" as "schema" | "list" | "map" | "data";
    for (const segment of segments) {
      let next: unknown;
      if (Array.isArray(value)) {
        if (!/^(?:0|[1-9][0-9]*)$/.test(segment)) return undefined;
        next = value[Number(segment)];
      } else if (isObject(value) && Object.hasOwn(value, segment)) next = value[segment];
      else return undefined;
      if (next === undefined) return undefined;
      const nextPlace: "schema" | "list" | "map" | "data" = place === "schema" ? (SCHEMA_MAP.has(segment) && !Array.isArray(next) ? "map" : SCHEMA_LIST.has(segment) && Array.isArray(next) ? "list" : SCHEMA_ONE.has(segment) ? "schema" : "data") : place === "map" || place === "list" ? "schema" : "data";
      pointer = `${pointer}/${escapeSegment(segment)}`;
      value = next;
      place = nextPlace;
      if (place === "schema" && isObject(value)) {
        const inner = this.embedded.get(value);
        if (inner && inner !== resource) {
          resource = inner;
          pointer = "";
        }
      }
    }
    return { schema: value, resource, pointer };
  }

  /** `ref` resolved against the base URI of `from`'s resource, and what it names. */
  resolve(from: Target, ref: string): { uri: string; target: Target | undefined } {
    const uri = resolveUri(from.resource.uri, ref);
    return { uri, target: this.lookup(uri) };
  }
}
