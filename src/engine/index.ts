// dotschema's JSON Schema engine: one model of the keywords, compiled once into a tree of nodes
// (tree.ts), which the interpreter here runs, and from which the code generator (generate.ts) writes
// the same verdicts out ahead of time or at run time, joined to the tree by link.ts. It reads drafts
// 06 and 07 (as draft-07), 2019-09 and 2020-12 as dotschema's validators read them today, ajv 8.20.0
// with dotschema's options and fixes (DESIGN.md, "The validator"), and reports ajv's errors, in
// ajv's order. It imports nothing, uses no Node API, and never builds code from a string, so it runs
// in a browser and a Cloudflare Worker.
//
//   const engine = compile([{ id: "dotschema:0", schema }, { id: "dotschema:1", schema: other }], { draft: "2020-12", formats });
//   const user = engine.validator();                              // the first resource's root
//   const address = engine.validator("dotschema:0#/$defs/address"); // any schema, by its URI
//   user.check(value);   // true or false, stopping at the first failure; no error object made
//   user.errors(value);  // null, or every error as ajv's allErrors gives them
//
// `compile` takes the schema resources a validator may reach, each with its absolute URI: the root
// first, then each other file and each remote, as src/refs.ts's `forAjv` gives them. Inside them the
// engine resolves references as the spec does: an `$id` below a root is a resource of its own and a
// base URI (RFC 3986 resolution), a fragment is a JSON Pointer (`~0`, `~1`, percent-encoding) or an
// anchor (`$anchor`, `$dynamicAnchor`, draft-07's `"$id": "#name"`), `$dynamicRef` and
// `$recursiveRef` resolve in the dynamic scope, and a keyword the draft does not define is ignored.
//
// The options:
//
// | Option | Meaning |
// | --- | --- |
// | `draft` | `"draft-07"` (also draft-06), `"2019-09"` or `"2020-12"`: the keywords read and their order |
// | `formats` | each `format` by name, as ajv's `addFormat` takes it: a `RegExp`, `true` (known, checks nothing), a function of the string, or `{ type, validate, compare }`; a name with none is not checked |
// | `discriminator` | read ajv's `discriminator` keyword beside a `oneOf` (dotschema adds it, `withDiscriminators` in src/schema.ts), which then runs alone, in place of the `oneOf` |
//
// An error is ajv's: `{ instancePath, schemaPath, keyword, params, message }`, and `propertyName`
// inside `propertyNames`. `schemaPath` is ajv's own, which starts again at `#` in each schema ajv
// compiles as a function of its own (every `$ref` target it does not inline, tree.ts). `errorMessage`
// is ajv-errors': an error it makes has the keyword `errorMessage` and the errors it replaces in
// `params.errors`, each marked `emUsed`. A schema the engine cannot compile (a `$ref` to nothing, a
// `pattern` that is not a regular expression, a template that reads above its value) throws from
// `validator()`, with ajv's message where ajv has one. The engine takes a schema its meta-schema
// accepts, as ajv checks one before it compiles it: `checkSchema` in ./meta checks that, apart from
// this entry, so that the meta-schemas are no part of a program that only validates. A value the
// keywords cannot read (a getter that throws, a value nested deeper than the stack) throws from
// `check` and `errors`, as ajv's code does.
import { Interpreter, type Check, type Collect, type EngineError, type State } from "./interpret.ts";
import { Registry, type Target } from "./resources.ts";
import { Tree, type SchemaNode } from "./tree.ts";
import { resolveUri } from "./uri.ts";

export type { EngineError } from "./interpret.ts";
export type { Format, Group, JsonType, KeywordNode, MessageConfig, SchemaNode, Template, DataPointer } from "./tree.ts";
export type { Resource as SchemaResource } from "./resources.ts";

/** The draft a schema is compiled in; draft-06 is read as draft-07, as dotschema's `draftOf` does. */
export type Draft = "draft-07" | "2019-09" | "2020-12";

/** A format, as ajv's `addFormat` takes one. */
export type FormatDefinition =
  | RegExp
  | true
  | ((data: string) => boolean)
  | {
      type?: "string" | "number";
      validate: RegExp | ((data: any) => boolean);
      compare?: (a: any, b: any) => number | undefined;
    };

export interface CompileOptions {
  draft: Draft;
  formats?: Readonly<Record<string, FormatDefinition>>;
  discriminator?: boolean;
}

/** A schema resource given to `compile`: its absolute URI and the schema. */
export interface ResourceInput {
  id: string;
  schema: unknown;
}

export interface Validator {
  /** Whether the value is valid, stopping at the first failure. */
  check(value: unknown): boolean;
  /** Every error, as ajv with `allErrors` gives them, in its order; null when the value is valid. */
  errors(value: unknown): EngineError[] | null;
  /** The compiled schema, for a code generator. */
  readonly node: SchemaNode;
  /** The draft it was compiled in, which the code generator reads where the tree leaves it out (2020-12's `contains` marks the items it matched evaluated). */
  readonly draft: Draft;
}

export interface Engine {
  /** The validator of the schema at `uri`, resolved against the first resource's URI; the first resource's root without one. Throws where the schema cannot be compiled. */
  validator(uri?: string): Validator;
  /** The absolute URI of the first resource. */
  readonly root: string;
}

export function compile(resources: readonly ResourceInput[], options: CompileOptions): Engine {
  if (!resources.length) throw new Error("compile needs at least one schema resource");
  const registry = new Registry(options.draft);
  const added = resources.map(({ id, schema }) => registry.add(id, schema));
  const rootResource = added[0]!;
  const dynamic = registry.dynamicRefs && [...registry.resources.values()].some((r) => r.dynamicAnchors.size > 0 || r.recursiveAnchor);
  const tree = new Tree(registry, options.draft, options.formats ?? {}, options.discriminator ?? false);
  const interpreter = new Interpreter({ dynamic, containsEvaluates: options.draft === "2020-12", templates: registry.templates });
  const validators = new Map<string, Validator>();
  return {
    root: rootResource.uri,
    validator(uri?: string): Validator {
      const key = uri === undefined ? rootResource.uri : resolveUri(rootResource.uri, uri);
      const known = validators.get(key);
      if (known) return known;
      const target: Target | undefined = uri === undefined ? { schema: rootResource.schema, resource: rootResource, pointer: "" } : registry.lookup(key);
      if (!target) throw new Error(`no schema at ${key}`);
      const node = tree.root(target);
      const check: Check = interpreter.check(node);
      let collect: Collect | undefined;
      const validator: Validator = {
        node,
        draft: options.draft,
        check: dynamic ? (value) => check(value, undefined, { scope: [] }) : (value) => check(value, undefined, undefined),
        errors(value) {
          collect ??= interpreter.collect(node);
          const st: State = { errors: [], path: [], data: [value], keys: [undefined], base: 0, scope: [], propName: undefined, root: value };
          return collect(value, st, undefined) ? null : st.errors;
        },
      };
      validators.set(key, validator);
      return validator;
    },
  };
}
