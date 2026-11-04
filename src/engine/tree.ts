// The compiled representation: each schema as a `SchemaNode`, its keywords as `KeywordNode`s in the
// order ajv 8.20.0 runs and reports them, every subschema a node of its own, and every value a
// keyword reads at run time worked out here once (a `RegExp`, a format's function, a property's
// node). The interpreter (interpret.ts) turns a node into closures; a code generator can walk the same
// nodes and write the checks out. Nothing here runs a value.
//
// ajv compiles a schema into functions, and an error's `schemaPath` starts again at `#` in each: at
// the schema it compiles, and at each `$ref` target it does not inline. It inlines a target with no
// `$ref`, `$dynamicRef`, `$recursiveRef`, `$dynamicAnchor` or `$recursiveAnchor` anywhere inside it
// (or a boolean one), and then the target's `schemaPath` starts with the `$ref` as written
// (`inlineRef` and `inlineRefSchema` in ajv's lib/compile/resolve.ts and lib/vocabularies/core/ref.ts).
// ajv-errors finds the errors a message replaces by that path, so the tree keeps it: a target ajv
// inlines is built again below each `$ref` to it, with that path, and every other one is one node,
// shared by every `$ref` to it, as a function root.
import type { Draft, FormatDefinition } from "./index.ts";
import { isObject, locationOf, type Registry, type Resource, type Target } from "./resources.ts";
import { escapeFragment, splitUri } from "./uri.ts";

export type JsonType = "null" | "boolean" | "object" | "array" | "number" | "integer" | "string";

/** ajv's groups of rules: those for any value, those for one type of value each, run only on a value of that type, and those run last (`errorMessage`). */
export type Group = "any" | "number" | "string" | "array" | "object" | "post";

/** A schema, compiled. */
export interface SchemaNode {
  /** The schema: an object or a boolean. */
  readonly schema: unknown;
  /** Its absolute URI: its resource's and a JSON Pointer from that resource's root. */
  readonly location: string;
  /** The schema resource it is in, which a `$dynamicRef` looks for in the dynamic scope. */
  readonly resource: Resource;
  /** ajv's `errSchemaPath` here: `#` at a function root, the path from it below, or the `$ref` as written under an inlined target. */
  readonly path: string;
  /** Whether ajv compiles it as a function of its own: a `schemaPath` starts again here, and `errorMessage` reads the errors since its start. */
  readonly root: boolean;
  /** Whether it is inside a `propertyNames` subschema in its function, so its errors carry `propertyName`. */
  readonly propertyName: boolean;
  /** How many values deep it is in its function, for `errorMessage`'s relative JSON Pointers. */
  readonly level: number;
  /** ajv's `alwaysValidSchema`: `true`, `{}`, or an object with no keyword the draft acts on. */
  readonly alwaysValid: boolean;
  /** The `type` keyword's types, `[]` without one. */
  readonly types: readonly JsonType[];
  /** Where a wrong type is reported: before every keyword, in the place of the type's own group (one type whose group the schema uses, as ajv does), or nowhere. */
  readonly typeCheck: "start" | "group" | "none";
  /** Whether it has `unevaluatedProperties` or `unevaluatedItems`, so it reads what its own keywords evaluated. */
  readonly unevaluated: boolean;
  /** Its keywords in the order they run, each in its group. Filled after the node is made, so a `$ref` back to it can point to it. */
  readonly keywords: KeywordNode[];
}

/**
 * A keyword, compiled. `value` is the keyword's value in the schema, `path` the `schemaPath` of an
 * error it reports. The other fields belong to some keywords:
 *
 * | Field | Keywords |
 * | --- | --- |
 * | `child` | `not`, `if`, `contains`, `propertyNames`, `additionalProperties`, `additionalItems`, `items` (one schema), `unevaluatedProperties`, `unevaluatedItems`, and the target of `$ref`, `$dynamicRef` and `$recursiveRef` |
 * | `children` | `allOf`, `anyOf`, `oneOf`, `prefixItems`, `items` (a list, before 2020-12), and the variants of `discriminator` |
 * | `entries` | `properties`, `patternProperties`, `dependentSchemas`, the schemas of `dependencies` |
 * | `then`, `else` | `if` |
 * | `regexp`, `regexps` | `pattern`; `patternProperties` (one to each entry) and the patterns `additionalProperties` knows |
 * | `known` | `additionalProperties`: the keys of `properties` beside it |
 * | `prefix` | `additionalItems` and 2020-12's `items`: how many items the tuple before it has |
 * | `min`, `max` | `contains`: its `minContains` and `maxContains`, as ajv reads them |
 * | `required` | `required`, and the lists of `dependencies` and `dependentRequired` (`[property, required][]`) |
 * | `format` | `format`, `formatMaximum` and the other limits |
 * | `itemTypes` | `uniqueItems`: the `type` of `items`, which picks ajv's faster loop |
 * | `dynamic` | `$dynamicRef` and `$recursiveRef` that resolve dynamically: the anchor's name (`""` for `$recursiveAnchor`), and the schema a resource that declares it gives, compiled when first asked for, or undefined for one that does not |
 * | `mapping`, `tagName` | `discriminator` |
 * | `message` | `errorMessage` |
 */
export interface KeywordNode {
  readonly keyword: string;
  readonly group: Group;
  readonly value: unknown;
  readonly path: string;
  readonly child?: SchemaNode;
  readonly children?: readonly SchemaNode[];
  readonly entries?: readonly (readonly [key: string, node: SchemaNode])[];
  readonly then?: SchemaNode;
  readonly else?: SchemaNode;
  readonly regexp?: RegExp;
  readonly regexps?: readonly RegExp[];
  readonly known?: ReadonlySet<string>;
  readonly prefix?: number;
  readonly min?: number;
  readonly max?: number | undefined;
  readonly required?: readonly string[] | readonly (readonly [property: string, required: readonly string[]])[];
  readonly format?: Format;
  readonly itemTypes?: readonly JsonType[];
  readonly dynamic?: { readonly anchor: string; candidate(resource: Resource): SchemaNode | undefined };
  readonly mapping?: ReadonlyMap<string, number>;
  readonly tagName?: string;
  readonly message?: MessageConfig;
}

/** A format as the keywords call it. */
export interface Format {
  readonly name: string;
  readonly type: "string" | "number";
  readonly validate: (data: any) => boolean;
  readonly compare?: (a: any, b: any) => number | undefined;
}

/** ajv-errors' `errorMessage`, read: each message a template of text and JSON Pointers. */
export interface MessageConfig {
  /** The message for every error below, a string `errorMessage` or its `_`. */
  readonly all?: Template;
  /** A message for each keyword's errors here. */
  readonly keywords?: readonly (readonly [keyword: string, message: Template])[];
  /** A message for each property a keyword's errors name here: `required`, `dependencies`, `dependentRequired`. */
  readonly keywordProps?: readonly (readonly [keyword: string, messages: readonly (readonly [property: string, message: Template])[]])[];
  /** A message for the errors under each property. */
  readonly properties?: readonly (readonly [property: string, message: Template])[];
  /** A message for the errors under each item. */
  readonly items?: readonly Template[];
}

/** A message: its text, with the value at each `${pointer}` in it written as JSON. */
export type Template = readonly (string | DataPointer)[];

/** A JSON Pointer of ajv's `$data` kind, read: from the root value, or relative, `up` levels above the value, to it or to the key that reaches it (`#`). */
export interface DataPointer {
  readonly up: number | "root";
  readonly key: boolean;
  readonly segments: readonly string[];
}

/** How a node is reached: its `schemaPath`, whether it is a function root, inside `propertyNames`, and how deep in values in its function. */
interface Context {
  readonly path: string;
  readonly root: boolean;
  readonly propertyName: boolean;
  readonly level: number;
}

const ROOT: Context = { path: "#", root: true, propertyName: false, level: 0 };

const GROUPS: readonly Group[] = ["any", "number", "string", "array", "object", "post"];

/** The keywords ajv 8.20.0 acts on in each draft, in its order, by group, as dotschema compiles them: `id`, `nullable` and `$async` left out, and 2019-09's `$dynamic*` and `dependencies` and 2020-12's `$recursive*` and `dependencies`, which the draft does not define (src/schema.ts, `IGNORED`). */
function rules(draft: Draft, discriminator: boolean): Record<Group, readonly string[]> {
  const any = ["$comment", "$ref", "type", "const", "enum", "not", "anyOf", "oneOf", "allOf", "if", "then", "else"];
  const number = ["maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf", "format"];
  const string = ["maxLength", "minLength", "pattern", "format", "formatMaximum", "formatMinimum", "formatExclusiveMaximum", "formatExclusiveMinimum"];
  const tail = discriminator ? ["discriminator"] : [];
  if (draft === "draft-07")
    return {
      any,
      number,
      string,
      array: ["maxItems", "minItems", "additionalItems", "items", "contains", "uniqueItems"],
      object: ["maxProperties", "minProperties", "required", "propertyNames", "additionalProperties", "dependencies", "properties", "patternProperties", ...tail],
      post: ["errorMessage"],
    };
  const object = ["maxProperties", "minProperties", "required", "propertyNames", "additionalProperties", "properties", "patternProperties", "dependentRequired", "dependentSchemas", "unevaluatedProperties", ...tail];
  if (draft === "2019-09") return { any: ["$recursiveAnchor", "$recursiveRef", ...any], number, string, array: ["maxItems", "minItems", "additionalItems", "items", "contains", "uniqueItems", "maxContains", "minContains", "unevaluatedItems"], object, post: ["errorMessage"] };
  return { any: ["$dynamicAnchor", "$dynamicRef", ...any], number, string, array: ["maxItems", "minItems", "prefixItems", "items", "contains", "uniqueItems", "maxContains", "minContains", "unevaluatedItems"], object, post: ["errorMessage"] };
}

/** Keywords that only mark a place or are read by another keyword (`then` by `if`, `minContains` by `contains`): rules for ajv, so a schema with one is not always valid, but no node of their own. */
const PASSIVE = new Set(["$comment", "type", "then", "else", "maxContains", "minContains", "$dynamicAnchor", "$recursiveAnchor"]);

const REF_KEYWORDS = new Set(["$ref", "$recursiveRef", "$recursiveAnchor", "$dynamicRef", "$dynamicAnchor"]);

/** ajv's `hasRef`: whether a reference keyword is anywhere in the value, data such as `enum` included, which keeps ajv from inlining it. */
function hasRef(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.some(hasRef);
  if (!isObject(schema)) return false;
  for (const key in schema) {
    if (REF_KEYWORDS.has(key)) return true;
    const value = schema[key];
    if (typeof value == "object" && value !== null && hasRef(value)) return true;
  }
  return false;
}

const JSON_TYPES = new Set(["string", "number", "integer", "boolean", "null", "object", "array"]);

/** A `type` value as a list of types (ajv's `getJSONTypes`), refusing a name that is not one. */
function typesOf(value: unknown): JsonType[] {
  const list: unknown[] = Array.isArray(value) ? value : value ? [value] : [];
  for (const t of list) if (typeof t !== "string" || !JSON_TYPES.has(t)) throw new Error(`type must be JSONType or JSONType[]: ${list.join(",")}`);
  return list as JsonType[];
}

const TYPE_GROUP: Partial<Record<JsonType, Group>> = { number: "number", string: "string", array: "array", object: "object" };

const JSON_POINTER = /^\/(?:[^~]|~0|~1)*$/;
const RELATIVE_JSON_POINTER = /^([0-9]+)(#|\/(?:[^~]|~0|~1)*)?$/;

/** A template's JSON Pointer read as ajv's `getData` reads it, with its errors, at a node `level` values deep in its function. */
function dataPointer(pointer: string, level: number): DataPointer {
  const unescape = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");
  if (pointer === "") return { up: "root", key: false, segments: [] };
  if (pointer[0] === "/") {
    if (!JSON_POINTER.test(pointer)) throw new Error(`Invalid JSON-pointer: ${pointer}`);
    return { up: "root", key: false, segments: pointer.split("/").filter(Boolean).map(unescape) };
  }
  const match = RELATIVE_JSON_POINTER.exec(pointer);
  if (!match) throw new Error(`Invalid JSON-pointer: ${pointer}`);
  const up = Number(match[1]);
  const rest = match[2];
  if (rest === "#") {
    if (up >= level) throw new Error(`Cannot access property/index ${up} levels up, current level is ${level}`);
    return { up, key: true, segments: [] };
  }
  if (up > level) throw new Error(`Cannot access data ${up} levels up, current level is ${level}`);
  return { up, key: false, segments: rest ? rest.split("/").filter(Boolean).map(unescape) : [] };
}

const INTERPOLATION = /\$\{([^}]+)\}/g;

function template(message: unknown, level: number): Template {
  const text = String(message);
  const parts: (string | DataPointer)[] = [];
  let at = 0;
  for (const match of text.matchAll(INTERPOLATION)) {
    parts.push(text.slice(at, match.index));
    parts.push(dataPointer(match[1]!, level));
    at = match.index! + match[0].length;
  }
  parts.push(text.slice(at));
  return parts.filter((part) => part !== "");
}

/**
 * ajv-errors' `errorMessage` value read into what its code builds from it (`keywordErrorsConfig`,
 * `childErrorsConfig`). Every template reads its data from the schema's own value, a property's or an
 * item's message too, as ajv-errors' `getData(ptr, it)` does; an empty message for every error is none.
 */
function messageConfig(value: unknown, level: number): MessageConfig {
  if (typeof value === "string") return value ? { all: template(value, level) } : {};
  if (!isObject(value)) throw new Error("errorMessage value must be [\"string\",\"object\"]");
  const keywords: [string, Template][] = [];
  const keywordProps: [string, [string, Template][]][] = [];
  for (const key in value) {
    if (key === "properties" || key === "items") continue;
    const entry = value[key];
    if (typeof entry == "object" && entry !== null) keywordProps.push([key, Object.keys(entry).map((p) => [p, template((entry as Record<string, unknown>)[p], level)])]);
    else keywords.push([key, template(entry, level)]);
  }
  const properties = isObject(value["properties"]) ? Object.keys(value["properties"]).map((p): [string, Template] => [p, template((value["properties"] as Record<string, unknown>)[p], level)]) : undefined;
  const items = Array.isArray(value["items"]) ? value["items"].map((m) => template(m, level)) : undefined;
  const all = value["_"];
  return {
    ...(all ? { all: template(all, level) } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(keywordProps.length ? { keywordProps } : {}),
    ...(properties ? { properties } : {}),
    ...(items ? { items } : {}),
  };
}

const number = (keyword: string, value: unknown): number => {
  if (typeof value !== "number") throw new Error(`${keyword} value must be "number"`);
  return value;
};

/** Builds the nodes of every schema a validator reaches, sharing each function root. */
export class Tree {
  readonly registry: Registry;
  readonly draft: Draft;
  readonly formats: Readonly<Record<string, FormatDefinition>>;
  readonly discriminator: boolean;
  private readonly groups: Record<Group, readonly string[]>;
  private readonly rulesAll: ReadonlySet<string>;
  private readonly roots = new Map<string, SchemaNode>();
  private readonly formatCache = new Map<string, Format | null>();

  constructor(registry: Registry, draft: Draft, formats: Readonly<Record<string, FormatDefinition>>, discriminator: boolean) {
    this.registry = registry;
    this.draft = draft;
    this.formats = formats;
    this.discriminator = discriminator;
    this.groups = rules(draft, discriminator);
    this.rulesAll = new Set(GROUPS.flatMap((group) => this.groups[group]));
  }

  /** The node of the schema at `target`, compiled as a function root, as a validator's entry is. */
  root(target: Target): SchemaNode {
    return this.build(target, ROOT);
  }

  /** ajv's `alwaysValidSchema`. */
  alwaysValid(schema: unknown): boolean {
    if (typeof schema === "boolean") return schema;
    if (!isObject(schema)) return false;
    for (const key in schema) if (this.rulesAll.has(key)) return false;
    return true;
  }

  /** Whether a schema holds a `$ref` and no other rule, which ajv runs alone (`schemaHasRulesButRef`). */
  private refOnly(schema: Record<string, unknown>): boolean {
    if (!schema["$ref"]) return false;
    for (const key in schema) if (key !== "$ref" && this.rulesAll.has(key)) return false;
    return true;
  }

  /** A format by name, as the keywords call it; null for a name no format has, or one that checks nothing (`true`). */
  format(name: string): Format | null {
    const known = this.formatCache.get(name);
    if (known !== undefined) return known;
    const def = Object.hasOwn(this.formats, name) ? this.formats[name] : undefined;
    let format: Format | null = null;
    if (def instanceof RegExp) format = { name, type: "string", validate: (s) => def.test(s) };
    else if (typeof def === "function") format = { name, type: "string", validate: def };
    else if (isObject(def)) {
      const validate = def.validate;
      const fn = validate instanceof RegExp ? (s: any) => validate.test(s) : (validate as (s: any) => boolean);
      format = { name, type: def.type === "number" ? "number" : "string", validate: fn, ...(typeof def.compare === "function" ? { compare: def.compare } : {}) };
    }
    this.formatCache.set(name, format);
    return format;
  }

  /** The schema below `target` at `segments`, a step into it. */
  private at(target: Target, ...segments: (string | number)[]): Target {
    const found = this.registry.walk(target, segments.map(String));
    if (!found) throw new Error(`nothing at ${locationOf(target)}/${segments.join("/")}`);
    return found;
  }

  private build(target: Target, ctx: Context): SchemaNode {
    const location = locationOf(target);
    if (ctx.root) {
      const known = this.roots.get(location);
      if (known) return known;
    }
    const schema = target.schema;
    if (typeof schema !== "boolean" && !isObject(schema)) throw new Error(`schema must be object or boolean at ${location}`);
    const types = isObject(schema) ? typesOf(schema["type"]) : [];
    const has = (keyword: string) => isObject(schema) && schema[keyword] !== undefined;
    const groupUsed = (group: Group | undefined) => group !== undefined && this.groups[group].some(has);
    const refOnly = isObject(schema) && this.refOnly(schema);
    const typeGroup = types.length === 1 ? TYPE_GROUP[types[0]!] : undefined;
    const typeCheck = refOnly || !types.length ? "none" : types.length === 1 && groupUsed(typeGroup) ? "group" : "start";
    const node: SchemaNode = {
      schema,
      location,
      resource: target.resource,
      path: ctx.path,
      root: ctx.root,
      propertyName: ctx.propertyName,
      level: ctx.level,
      alwaysValid: this.alwaysValid(schema),
      types: refOnly ? [] : types,
      typeCheck,
      unevaluated: !refOnly && this.draft !== "draft-07" && (has("unevaluatedProperties") || has("unevaluatedItems")),
      keywords: [],
    };
    if (ctx.root) this.roots.set(location, node);
    if (!isObject(schema)) return node;
    if (refOnly) {
      node.keywords.push(this.ref(target, schema, ctx, node, "$ref"));
      return node;
    }
    const discriminated = this.discriminator && schema["discriminator"] !== undefined;
    for (const group of GROUPS)
      for (const keyword of this.groups[group]) {
        if (schema[keyword] === undefined || PASSIVE.has(keyword)) continue;
        if (keyword === "oneOf" && discriminated) continue;
        const built = this.keyword(target, schema, ctx, node, keyword, group);
        if (built) node.keywords.push(built);
      }
    return node;
  }

  /** The context of a subschema of the node at `ctx`: `segments` more on its path, one value deeper where it applies to a part of the value. */
  private sub(ctx: Context, deeper: boolean, ...segments: (string | number)[]): Context {
    return { path: `${ctx.path}/${segments.map(escapeFragment).join("/")}`, root: false, propertyName: ctx.propertyName, level: ctx.level + (deeper ? 1 : 0) };
  }

  private keyword(target: Target, schema: Record<string, unknown>, ctx: Context, node: SchemaNode, keyword: string, group: Group): KeywordNode | undefined {
    const value = schema[keyword];
    const path = `${ctx.path}/${keyword}`;
    const base = { keyword, group, value, path };
    const one = (deeper: boolean, ...segments: (string | number)[]) => this.build(this.at(target, keyword, ...segments), this.sub(ctx, deeper, keyword, ...segments));
    const list = (deeper: boolean): SchemaNode[] => {
      if (!Array.isArray(value)) throw new Error(`${keyword} value must be "array"`);
      return value.map((_, i) => one(deeper, i));
    };
    const map = (deeper: boolean): [string, SchemaNode][] => {
      if (!isObject(value)) throw new Error(`${keyword} value must be "object"`);
      return Object.keys(value).map((key) => [key, one(deeper, key)]);
    };
    switch (keyword) {
      case "$ref":
      case "$dynamicRef":
      case "$recursiveRef":
        return this.ref(target, schema, ctx, node, keyword);
      case "const":
        return base;
      case "enum":
        if (!Array.isArray(value)) throw new Error(`enum value must be "array"`);
        return base;
      case "not":
        return { ...base, child: one(false) };
      case "anyOf":
      case "oneOf":
      case "allOf":
        return { ...base, children: list(false) };
      case "if": {
        const branch = (name: "then" | "else") => (schema[name] === undefined ? undefined : this.build(this.at(target, name), this.sub(ctx, false, name)));
        const thenNode = branch("then");
        const elseNode = branch("else");
        return { ...base, child: one(false), ...(thenNode ? { then: thenNode } : {}), ...(elseNode ? { else: elseNode } : {}) };
      }
      case "maximum":
      case "minimum":
      case "exclusiveMaximum":
      case "exclusiveMinimum":
      case "multipleOf":
      case "maxLength":
      case "minLength":
      case "maxItems":
      case "minItems":
      case "maxProperties":
      case "minProperties":
        number(keyword, value);
        return base;
      case "pattern":
        if (typeof value !== "string") throw new Error(`pattern value must be "string"`);
        return { ...base, regexp: new RegExp(value, "u") };
      case "format": {
        if (typeof value !== "string") throw new Error(`format value must be "string"`);
        const format = this.format(value);
        return format && format.type === group ? { ...base, format } : undefined;
      }
      case "formatMaximum":
      case "formatMinimum":
      case "formatExclusiveMaximum":
      case "formatExclusiveMinimum": {
        if (typeof value !== "string") throw new Error(`${keyword} value must be "string"`);
        const name = schema["format"];
        if (typeof name !== "string") return undefined;
        const format = this.format(name);
        if (!format) return undefined;
        if (!format.compare) throw new Error(`"${keyword}": format "${name}" does not define "compare" function`);
        return { ...base, format };
      }
      case "items":
        if (Array.isArray(value) && this.draft !== "2020-12") return { ...base, children: list(true) };
        return { ...base, child: one(true), ...(this.draft === "2020-12" && Array.isArray(schema["prefixItems"]) ? { prefix: schema["prefixItems"].length } : {}) };
      case "prefixItems":
        return { ...base, children: list(true) };
      case "additionalItems":
        return Array.isArray(schema["items"]) ? { ...base, child: one(true), prefix: schema["items"].length } : undefined;
      case "contains": {
        const next = this.draft !== "draft-07";
        const min = next && schema["minContains"] !== undefined ? number("minContains", schema["minContains"]) : 1;
        const max = next && schema["maxContains"] !== undefined ? number("maxContains", schema["maxContains"]) : undefined;
        return { ...base, child: one(true), min, max };
      }
      case "uniqueItems": {
        if (typeof value !== "boolean") throw new Error(`uniqueItems value must be "boolean"`);
        if (!value) return undefined;
        const items = schema["items"];
        return { ...base, itemTypes: isObject(items) ? typesOf(items["type"]) : [] };
      }
      case "required": {
        if (!Array.isArray(value)) throw new Error(`required value must be "array"`);
        return value.length ? { ...base, required: value.map(String) } : undefined;
      }
      case "propertyNames": {
        const child = this.build(this.at(target, keyword), { path: path, root: false, propertyName: true, level: ctx.level + 1 });
        return { ...base, child };
      }
      case "additionalProperties": {
        const properties = schema["properties"];
        const patterns = schema["patternProperties"];
        return {
          ...base,
          child: one(true),
          known: new Set(isObject(properties) ? Object.keys(properties) : []),
          regexps: isObject(patterns) ? Object.keys(patterns).map((p) => new RegExp(p, "u")) : [],
        };
      }
      case "properties":
        return { ...base, entries: map(true) };
      case "patternProperties": {
        const entries = map(true);
        return { ...base, entries, regexps: entries.map(([p]) => new RegExp(p, "u")) };
      }
      case "dependencies":
      case "dependentRequired":
      case "dependentSchemas": {
        if (!isObject(value)) throw new Error(`${keyword} value must be "object"`);
        const required: [string, string[]][] = [];
        const entries: [string, SchemaNode][] = [];
        for (const key of Object.keys(value)) {
          const entry = value[key];
          if (keyword !== "dependentSchemas" && Array.isArray(entry)) required.push([key, entry.map(String)]);
          else if (keyword !== "dependentRequired") entries.push([key, one(false, key)]);
        }
        return { ...base, required, entries };
      }
      case "unevaluatedProperties":
      case "unevaluatedItems":
        return { ...base, child: one(true) };
      case "discriminator":
        return this.discriminatorOf(target, schema, ctx, base);
      case "errorMessage":
        return { ...base, message: messageConfig(value, ctx.level) };
    }
    return undefined;
  }

  /**
   * A `$ref`, or a `$dynamicRef` or `$recursiveRef`, to its target: inlined, as ajv inlines it, with the
   * `$ref` as written for its path, or a shared function root. A `$ref` that points to a schema holding
   * a `$ref` and nothing else is followed on, as ajv's `getJsonPointer` follows it. A `$dynamicRef`
   * whose target declares the `$dynamicAnchor` its fragment names (2020-12 core 8.2.3.2), or a
   * `$recursiveRef` whose target says `"$recursiveAnchor": true` (2019-09 core 8.2.4.2), resolves in
   * the dynamic scope when it runs, to the schema of the outermost resource that declares the same:
   * every candidate is compiled here. Any other is a `$ref`.
   */
  private ref(target: Target, schema: Record<string, unknown>, ctx: Context, node: SchemaNode, keyword: "$ref" | "$dynamicRef" | "$recursiveRef"): KeywordNode {
    const value = schema[keyword];
    if (typeof value !== "string") throw new Error(`${keyword} value must be "string"`);
    const path = `${ctx.path}/${keyword}`;
    const { uri, target: found } = this.registry.resolve(target, value);
    if (!found) throw new Error(`can't resolve reference ${value} from id ${target.resource.uri}`);
    const fragment = splitUri(uri)[1];
    if (keyword === "$dynamicRef" && fragment !== "" && fragment[0] !== "/") {
      let anchor = fragment;
      try {
        anchor = decodeURIComponent(fragment);
      } catch {}
      if (found.resource.dynamicAnchors.get(anchor)?.schema === found.schema) {
        const child = this.build(found, ROOT);
        const candidate = (resource: Resource) => {
          const at = resource.dynamicAnchors.get(anchor);
          return at && this.build(at, ROOT);
        };
        return { keyword, group: "any", value, path, child, dynamic: { anchor, candidate } };
      }
    }
    if (keyword === "$recursiveRef" && found.pointer === "" && found.resource.recursiveAnchor) {
      const child = this.build(found, ROOT);
      const candidate = (resource: Resource) => (resource.recursiveAnchor ? this.build({ schema: resource.schema, resource, pointer: "" }, ROOT) : undefined);
      return { keyword, group: "any", value, path, child, dynamic: { anchor: "", candidate } };
    }
    // A schema that is a `$ref` alone, reached by a JSON Pointer or as another resource's root, is
    // followed, where the next step stays in its resource: one it leaves would be left out of the
    // dynamic scope (the Test Suite's dynamicRef.json [11] and [20]).
    let final = found;
    let finalFragment = fragment;
    for (let hops = 0; hops < 100; hops++) {
      const next = final.schema;
      if (!(finalFragment[0] === "/" || (finalFragment === "" && final.resource !== target.resource)) || !isObject(next) || typeof next["$ref"] !== "string" || !this.refOnly(next)) break;
      const step = this.registry.resolve(final, next["$ref"]);
      if (!step.target || step.target.resource !== final.resource) break;
      final = step.target;
      finalFragment = splitUri(step.uri)[1];
    }
    const inline = !hasRef(final.schema);
    const child = inline ? this.build(final, { path: value, root: false, propertyName: ctx.propertyName, level: ctx.level }) : this.build(final, ROOT);
    return { keyword, group: "any", value, path, child };
  }

  /** ajv's `discriminator` keyword (its option on): the property that names a `oneOf` variant, each variant by its tag. */
  private discriminatorOf(target: Target, schema: Record<string, unknown>, ctx: Context, base: { keyword: string; group: Group; value: unknown; path: string }): KeywordNode {
    const value = schema["discriminator"];
    if (!isObject(value)) throw new Error(`discriminator value must be "object"`);
    const tagName = value["propertyName"];
    if (typeof tagName != "string") throw new Error("discriminator: requires propertyName");
    if (value["mapping"]) throw new Error("discriminator: mapping is not supported");
    const oneOf = schema["oneOf"];
    if (!Array.isArray(oneOf)) throw new Error("discriminator: requires oneOf keyword");
    const hasRequired = (s: unknown) => isObject(s) && Array.isArray(s["required"]) && s["required"].includes(tagName);
    const topRequired = hasRequired(schema);
    let tagRequired = true;
    const mapping = new Map<string, number>();
    oneOf.forEach((variant, i) => {
      let sch: unknown = variant;
      if (isObject(variant) && variant["$ref"] && this.refOnly(variant)) {
        const resolved = this.registry.resolve(this.at(target, "oneOf", i), String(variant["$ref"]));
        if (!resolved.target) throw new Error(`can't resolve reference ${String(variant["$ref"])} from id ${target.resource.uri}`);
        sch = resolved.target.schema;
      }
      const propSch = isObject(sch) && isObject(sch["properties"]) ? sch["properties"][tagName] : undefined;
      if (typeof propSch != "object" || propSch === null) throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
      tagRequired = tagRequired && (topRequired || hasRequired(sch));
      const add = (tag: unknown) => {
        if (typeof tag != "string" || mapping.has(tag)) throw new Error(`discriminator: "${tagName}" values must be unique strings`);
        mapping.set(tag, i);
      };
      const p = propSch as Record<string, unknown>;
      if (p["const"]) add(p["const"]);
      else if (Array.isArray(p["enum"])) for (const tag of p["enum"]) add(tag);
      else throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
    });
    if (!tagRequired) throw new Error(`discriminator: "${tagName}" must be required`);
    const children = oneOf.map((_, i) => this.build(this.at(target, "oneOf", i), this.sub(ctx, false, "oneOf", i)));
    return { ...base, children, mapping, tagName };
  }
}
