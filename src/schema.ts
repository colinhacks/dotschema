// The module a `.schema.jsonc` or `.schema.json5` file becomes: the TypeScript type the schema
// describes, and a validator compiled from the schema when the module is built.
//
//   import user, { type Type as User } from "./user.schema.jsonc";
//   user.validate(input);       // { value } or { issues }, every issue; never throws
//   user.is(input);             // input is User, stopping at the first failure
//   user["~standard"];          // Standard Schema v1, for any library that accepts one
//
// The types come from dotschema's own emitter (schema-types.ts), the validator from ajv, a
// dependency of dotschema's, resolved from this module. The generated module imports nothing:
// ajv's standalone code is inlined with the few run-time helpers it requires. It holds two
// validators compiled from the same schema, one with `allErrors` for `.validate()` and one without
// for `.is()`, which share those helpers. A `$ref` to another
// schema file is followed (refs.ts): the types import that file's module, and the validator is
// compiled from every file the schema reaches.
import { readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { CODES, type Problem } from "./core/problems.ts";
import type { TypeOptions } from "./core/universal.ts";
import { literal, toJs, type Value } from "./core/serialize.ts";
import { parseSchemaFile } from "./parse.ts";
import { collect, dynamicRefProblems, eachSchema, forAjv, fragmentOf, mapSchemas, pointTo, resolvedSchemas, resolveRef, withoutKeywords, type Files } from "./refs.ts";
import { definitionsOf, LITERAL_NAME, schemaModuleTypes, type Draft } from "./schema-types.ts";
import { jsonSchemas, type Entry, type JsonSchemaResult, type JsonSchemaTarget } from "./json-schema.ts";
import { formatDefinitions, formatFile } from "./formats/index.ts";

const FAILED_TYPES = ["declare const schema: any;", "declare namespace schema { export type Type = any; }", "export default schema;", "export type Type = any;", ""].join("\n");

const problem = (message: string, place: { start: number; length: number } = { start: 0, length: 1 }): Problem => ({ message, ...place, code: CODES.schema });

/** The draft a schema declares, as the ajv entry point that compiles it (drafts 06 and 07 share one), or undefined when it declares none. */
function declaredDraft(schema: Value): string | undefined {
  const declared = typeof schema === "object" && schema !== null && !Array.isArray(schema) ? (schema as Record<string, Value>)["$schema"] : undefined;
  if (typeof declared !== "string") return undefined;
  const entry = ajvEntry(schema);
  return "error" in entry ? declared : entry.entry;
}

/** The draft a schema declares, as the ajv entry point that validates it. */
function ajvEntry(schema: Value): { entry: string } | { error: string } {
  const declared = typeof schema === "object" && schema !== null && !Array.isArray(schema) ? (schema as Record<string, Value>)["$schema"] : undefined;
  if (declared === undefined || typeof declared !== "string") return { entry: "ajv" };
  if (declared.includes("2020-12")) return { entry: "ajv/dist/2020" };
  if (declared.includes("2019-09")) return { entry: "ajv/dist/2019" };
  if (/draft-0[67]/.test(declared)) return { entry: "ajv" };
  return { error: `ajv validates JSON Schema drafts 06, 07, 2019-09 and 2020-12; this schema declares ${declared}.` };
}

/** The draft ajv compiles a schema in, by the entry point it is compiled with; draft-06 reads as draft-07. */
const DRAFTS: Record<string, Draft> = { ajv: "draft-07", "ajv/dist/2019": "2019-09", "ajv/dist/2020": "2020-12" };

export const draftOf = (schema: Value): Draft | undefined => {
  const entry = ajvEntry(schema);
  return "error" in entry ? undefined : DRAFTS[entry.entry];
};

/**
 * The keywords ajv acts on in each draft that the draft does not define (ajv 8.20.0's vocabulary
 * per class, read and measured on 2026-10-20). The spec ignores a keyword its draft does not
 * define, and so does dotschema: these are taken out of what ajv compiles and what the types read.
 * Left in, `$async: true` made the validator return a promise, which `.is()` read as a pass;
 * `nullable` without `type`, `id`, and 2020-12's `$recursiveAnchor: true` made ajv refuse the
 * schema; in 2019-09, 2020-12's `$dynamicRef` was enforced, and in both, draft-07's `dependencies`.
 * Every other keyword a draft does not define, a later draft's included, ajv ignores already, and
 * so does the emitter.
 */
const IGNORED: Record<Draft, readonly string[]> = {
  "draft-07": ["$async", "nullable", "id"],
  "2019-09": ["$async", "nullable", "id", "$dynamicRef", "$dynamicAnchor", "dependencies"],
  "2020-12": ["$async", "nullable", "id", "$recursiveRef", "$recursiveAnchor", "dependencies"],
};

type Ajv = {
  compile(schema: unknown): unknown;
  getSchema(id: string): unknown;
  /** The schemas ajv has resolved, by id; one set here is what `getSchema` gives for that id. */
  refs: Record<string, unknown>;
  /** Every keyword this instance knows, by name: what makes a schema more than always valid (ajv's `alwaysValidSchema`). */
  RULES: { all: Record<string, unknown> };
  addSchema(schema: unknown, key?: string): unknown;
  addMetaSchema(schema: unknown): unknown;
  addFormat(name: string, format: unknown): unknown;
  addKeyword(definition: object): unknown;
  opts: { code: { formats?: unknown } };
};

/** ajv's code generator (`ajv/dist/compile/codegen`): only code made by the same copy of ajv is code to it. */
type Codegen = { _: (strings: TemplateStringsArray, ...args: unknown[]) => unknown; str: (strings: TemplateStringsArray, ...args: unknown[]) => unknown; operators: Record<"GT" | "GTE" | "LT" | "LTE", unknown>; getProperty(key: string): unknown };

/** ajv compiles every validator with `new Function`, the one it writes out as standalone code too, which a process may disallow. */
const disallowedCodegen = (error: unknown) => error instanceof EvalError || /code generation from strings/i.test(String((error as Error)?.message));
/**
 * What ajv threw for a schema it refuses. With allErrors, ajv checks a schema against its draft's
 * meta-schema along every path that reaches a keyword, and writes a clause, each from `data`, for
 * each: 2020-12's `items` given a list read "data/items must be object,boolean" eight times over
 * (measured 2026-10-27). Each clause is kept once.
 */
function refusal(error: unknown): string {
  const message = String((error as Error)?.message);
  const at = /(?:^|: )data\b/.exec(message);
  if (!at) return message;
  const start = at.index + (at[0].startsWith(":") ? 2 : 0);
  return message.slice(0, start) + [...new Set(message.slice(start).split(/, (?=data\b)/))].join(", ");
}

const codegenProblem = (path: string) =>
  `Building ${basename(path)}'s validator runs ajv, which compiles it with new Function, and this process disallows code generation from strings (--disallow-code-generation-from-strings, on the command line or in NODE_OPTIONS). Build the module in a process without that flag: a program bundled with esbuild then validates where the flag is set, since the bundle's validator needs no new Function.`;

/**
 * ajv-formats' formatMaximum, formatMinimum, formatExclusiveMaximum and formatExclusiveMinimum
 * (its dist/limit.js, MIT), written with this module's ajv, which a plugin's own `require("ajv")`
 * can find another copy of (`loadAjv`). Without `$data`, which dotschema does not enable. Each
 * compares with its format's `compare` (src/formats/), which the standalone code reaches as the
 * format does, through `code.formats`.
 */
function formatLimits({ _, str, operators, getProperty }: Codegen): object {
  const KEYWORDS: Record<string, [string, unknown]> = { formatMaximum: ["<=", operators.GT], formatMinimum: [">=", operators.LT], formatExclusiveMaximum: ["<", operators.GTE], formatExclusiveMinimum: [">", operators.LTE] };
  type Cxt = { gen: { scopeValue(prefix: string, value: object): unknown }; data: unknown; schemaCode: unknown; keyword: string; it: { schema: Record<string, unknown>; opts: { validateFormats?: boolean; code: { formats?: unknown } }; self: { formats: Record<string, unknown> } }; fail$data(condition: unknown): void };
  return {
    keyword: Object.keys(KEYWORDS),
    type: "string",
    schemaType: "string",
    dependencies: ["format"],
    error: {
      message: ({ keyword, schemaCode }: Cxt) => str`should be ${KEYWORDS[keyword]![0]} ${schemaCode}`,
      params: ({ keyword, schemaCode }: Cxt) => _`{comparison: ${KEYWORDS[keyword]![0]}, limit: ${schemaCode}}`,
    },
    code(cxt: Cxt) {
      const { gen, data, schemaCode, keyword, it } = cxt;
      if (it.opts.validateFormats === false) return;
      const format = it.schema["format"];
      const def = typeof format === "string" ? it.self.formats[format] : undefined;
      if (typeof format !== "string" || !def || def === true) return;
      if (typeof def !== "object" || def instanceof RegExp || typeof (def as { compare?: unknown }).compare !== "function") throw new Error(`"${keyword}": format "${format}" does not define "compare" function`);
      const fmt = gen.scopeValue("formats", { key: format, ref: def, code: it.opts.code.formats ? _`${it.opts.code.formats}${getProperty(format)}` : undefined });
      cxt.fail$data(_`${fmt}.compare(${data}, ${schemaCode}) ${KEYWORDS[keyword]![1]} 0`);
    },
  };
}

/**
 * ajv, dotschema's own dependency, looked up from this module: under pnpm a package's dependencies
 * resolve from the package only, not from the project's directory. The formats are dotschema's own
 * (src/formats/), registered with this ajv; a format checked by a function is written into the
 * standalone code as `__formats["date-time"]`, a name the module defines with the files of the
 * formats it uses (`schemaCode`). A plugin's code is written with the copy of ajv its own
 * `require("ajv")` finds, which under npm beside ajv 6 (eslint's) was a second copy of ajv 8, whose
 * code this copy wrote out as JSON, so every format ajv-formats checked by a function threw (measured
 * 2026-10-20); so the limit keywords are `formatLimits`, written with this copy's codegen.
 */
function loadAjv(path: string, schema: Value, standalone: boolean, allErrors = true, discriminator = false): { ajv: Ajv; require: NodeJS.Require } | { error: string } {
  const require = createRequire(import.meta.url);
  const entry = ajvEntry(schema);
  if ("error" in entry) return entry;
  let AjvClass: new (options: object) => Ajv;
  try {
    const mod = require(entry.entry);
    AjvClass = mod.default ?? mod;
  } catch {
    return { error: `Validating ${basename(path)} needs ajv, a dependency of dotschema, which did not load: reinstall dotschema.` };
  }
  // allErrors: `.validate()` lists every issue; `.is()` takes a validator without it, which returns at the
  // first failure. ajv sets allErrors per instance, so each is its own. strict: false and no logger:
  // a schema written for another validator (unknown keywords, formats) still compiles, as the spec
  // allows. No option that changes the value (useDefaults, coerceTypes, removeAdditional): the value
  // `.validate()` returns is the one it was given, as it was given. Two of ajv's defaults check more
  // than the schema says, and are changed so that the validator checks the schema as written:
  // ownProperties, so that a property is the value's own and not Object.prototype's (by default
  // `{}` failed `properties: { toString: { type: "string" } }` and passed `required: ["toString"]`);
  // and multipleOfPrecision, so that `multipleOf` is read in decimals (by default ajv refused 19.99
  // for 0.01 and 0.3 for 0.1, whose quotients a double misses by 1e-13): within 1e-7 of a step is
  // a multiple, which keeps every quotient below 1e8 exact and still refuses 0.015 for 0.01.
  const ajv = new AjvClass({ allErrors, strict: false, logger: false, ownProperties: true, multipleOfPrecision: 7, ...(discriminator ? { discriminator: true } : {}), ...(standalone ? { code: { source: true } } : {}) });
  // ajv's default class knows draft-07's meta-schema alone; draft-06's is added for a schema, or a
  // file it refers to, that declares it (ajv's documentation, "JSON Schema draft-06").
  try {
    if (entry.entry === "ajv") ajv.addMetaSchema(require("ajv/dist/refs/json-schema-draft-06.json"));
  } catch (error) {
    if (disallowedCodegen(error)) return { error: codegenProblem(path) };
    throw error;
  }
  const codegen: Codegen = require("ajv/dist/compile/codegen");
  // A free name in the standalone code, `__formats["date-time"]`, which the module defines (`usedFormats`).
  ajv.opts.code.formats = codegen._`__formats`;
  for (const [name, definition] of formatDefinitions()) ajv.addFormat(name, definition);
  ajv.addKeyword(formatLimits(codegen));
  return { ajv, require };
}

/**
 * The schema and every file it reaches, each without the keywords its draft ignores, with the
 * problems of their references; ajv's default, draft-07, is the draft of a root that declares none.
 */
export function filesOf(source: string, path: string, schema: Value): Files {
  const clean = (value: Value) => withoutKeywords(value, IGNORED[draftOf(schema) ?? "draft-07"]);
  const files = collect(path, clean(schema), source, { of: declaredDraft, none: "ajv" }, clean);
  // ajv resolves some of 2020-12's `$dynamicRef`s and 2019-09's `$recursiveRef`s otherwise than the spec (refs.ts).
  if (draftOf(schema) === "2020-12") files.problems.push(...dynamicRefProblems(files, path, source, "$dynamicRef"));
  if (draftOf(schema) === "2019-09") files.problems.push(...dynamicRefProblems(files, path, source, "$recursiveRef"));
  return files;
}

/** The validator, compiled from the root with every other file added to ajv under its id, and the root's id; a problem when a file is not a valid schema. */
function compile(ajv: Ajv, files: Files, path: string): { validate: unknown; id: string } | { problem: Problem } {
  const { root, others } = forAjv(files, path);
  const id = String((root as Record<string, Value>)["$id"] ?? "").replace(/#$/, "");
  for (const other of others) {
    try {
      ajv.addSchema(other.schema, other.id);
    } catch (error) {
      return { problem: problem(disallowedCodegen(error) ? codegenProblem(path) : `${basename(other.path)} is not a valid schema: ${refusal(error)}`, files.places.get(other.path)) };
    }
  }
  try {
    return { validate: ajv.compile(root), id };
  } catch (error) {
    return { problem: problem(disallowedCodegen(error) ? codegenProblem(path) : `The schema is not valid: ${refusal(error)}`) };
  }
}

// ---- the copy ajv compiles ----------------------------------------------------------------------

const isObj = (value: Value | undefined): value is Record<string, Value> => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Whether some schema the validator is compiled from has `contains` beside a tuple (`prefixItems`,
 * or draft-07's list of `items`). ajv 8.20.0's validator without allErrors accepts `[]` there,
 * which the schema refuses: its `prefixItems` code sets the validity it gates `contains` on only
 * for an array that has items. The validator with allErrors is right, so `.is()` confirms a pass with it.
 */
export function needsConfirmation(files: Files): boolean {
  let found = false;
  for (const schema of files.schemas.values())
    eachSchema(schema, (sub) => {
      if (sub["contains"] !== undefined && (Array.isArray(sub["prefixItems"]) || Array.isArray(sub["items"]))) found = true;
    });
  return found;
}

/** The value the `$ref` of the schema at `segments` in the file `from` points to, among the files the validator is compiled from (`resolveRef`); undefined for a URL or nothing. */
function refTarget(files: Files, from: string, segments: readonly string[]): Value | undefined {
  const target = resolveRef(files, from, segments);
  return target && "segments" in target ? pointTo(files.schemas.get(target.path)!, target.segments) : undefined;
}

/**
 * The property that tells a `oneOf`'s variants apart, where ajv's `discriminator` (8.20.0,
 * dist/vocabularies/discriminator) can stand for the `oneOf` and give the same verdict on every
 * value: the schema is `type: "object"` (ajv skips the `oneOf` beside a discriminator, and the
 * discriminator checks objects alone, so without it a number passed); each variant, or the schema
 * a variant that is only a `$ref` points to, has the property in its own `properties` with a
 * `const` that is a non-empty string or an `enum` of one string, the values distinct; and the
 * property is required beside the `oneOf` or in every variant. Then a value whose tag is one
 * variant's fails every other variant, so the `oneOf` holds exactly when that variant does.
 */
function discriminatorOf(files: Files, schema: Record<string, Value>, from: string, segments: readonly string[]): string | undefined {
  const oneOf = schema["oneOf"];
  if (schema["type"] !== "object" || !Array.isArray(oneOf) || oneOf.length < 2) return undefined;
  const variants = oneOf.map((variant, i) => (isObj(variant) && Object.keys(variant).length === 1 && typeof variant["$ref"] === "string" ? refTarget(files, from, [...segments, "oneOf", String(i)]) : variant));
  if (!variants.every(isObj)) return undefined;
  const tagOf = (variant: Record<string, Value>, name: string): string | undefined => {
    const properties = variant["properties"];
    const property = isObj(properties) && Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!isObj(property)) return undefined;
    if ("const" in property) return typeof property["const"] === "string" && property["const"] !== "" ? property["const"] : undefined;
    const values = property["enum"];
    return Array.isArray(values) && values.length === 1 && typeof values[0] === "string" ? values[0] : undefined;
  };
  const required = (owner: Record<string, Value>, name: string) => Array.isArray(owner["required"]) && owner["required"].includes(name);
  const first = variants[0]!["properties"];
  for (const name of isObj(first) ? Object.keys(first) : []) {
    const tags = variants.map((variant) => tagOf(variant as Record<string, Value>, name));
    if (tags.some((tag) => tag === undefined) || new Set(tags).size !== tags.length) continue;
    if (required(schema, name) || variants.every((variant) => required(variant as Record<string, Value>, name))) return name;
  }
  return undefined;
}

/**
 * The files as ajv compiles them for the module: a `discriminator` on each `oneOf` whose variants a
 * property tells apart (`discriminatorOf`), so that a failing value is reported against its own
 * variant alone, and none that the schema itself holds (OpenAPI's, which ajv ignores without its
 * `discriminator` option and would read with it). Never the module's `schema` or its Standard JSON
 * Schema, which stay as written. `count` is how many were added. None is added where any file uses
 * `unevaluatedProperties` or `unevaluatedItems`: ajv's discriminator does not pass on what its
 * variant evaluated, so `{ "kind": "y" }` failed `unevaluatedProperties: false` beside a oneOf
 * that the same schema passes without it (measured).
 */
export function withDiscriminators(files: Files): { files: Files; count: number } {
  let unevaluated = false;
  for (const schema of files.schemas.values())
    eachSchema(schema, (sub) => {
      if (sub["unevaluatedProperties"] !== undefined || sub["unevaluatedItems"] !== undefined) unevaluated = true;
    });
  if (unevaluated) return { files, count: 0 };
  let count = 0;
  const schemas = new Map(
    [...files.schemas].map(([path, schema]) => [
      path,
      mapSchemas(withoutKeywords(schema, ["discriminator"]), (copy, segments) => {
        const propertyName = discriminatorOf(files, copy, path, segments);
        if (propertyName !== undefined) {
          copy["discriminator"] = { propertyName };
          count++;
        }
      }),
    ]),
  );
  return { files: { ...files, schemas }, count };
}

// ---- entries: the root and each definition ------------------------------------------------------

/**
 * The keywords a plain object schema may hold for `.pick()` and `.omit()` to give, by filtering
 * `properties` and `required`, the schema the filtered JSON Schema is: the object checks the module
 * joins at run time (`__join`), and what checks nothing. A keyword ajv does not know is ignored by
 * it, and by the join; `discriminator` is taken out of the copy ajv compiles (`withDiscriminators`).
 */
const SHAPE_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "$defs", "definitions", "$schema", "$id", "$comment", "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly", "discriminator"]);

/** A plain object schema's checks, for the run-time join: each property and whether ajv skips it as always valid, the required keys, `additionalProperties` (true when it checks nothing, `"schema"` for a schema), and the keys `.pick()` and `.omit()` take. */
export interface ObjectShape {
  properties: { key: string; alwaysValid: boolean }[];
  required: string[];
  additional: boolean | "schema";
  keys: string[];
}

/** ajv's `alwaysValidSchema` (8.20.0, dist/compile/util.js): `true`, `{}`, or a schema with no keyword ajv knows. A property it holds, ajv neither checks nor reads. */
const alwaysValid = (schema: Value, rules: Record<string, unknown>): boolean => schema === true || (isObj(schema) && Object.keys(schema).every((key) => !rules[key]));

/** Whether a `$ref` in a schema's own document points to the schema itself or into its `properties`, which filtering them would change. */
const refersToItself = (document: Value): boolean => {
  let found = false;
  eachSchema(document, (sub) => {
    const ref = sub["$ref"];
    if (typeof ref === "string" && (ref === "#" || ref === "#/properties" || ref.startsWith("#/properties/"))) found = true;
  });
  return found;
};

/**
 * The shape of a root or a definition whose schema `.pick()` and `.omit()` can filter soundly, or
 * undefined: `type: "object"` with nothing beside `properties`, `required` and `additionalProperties`
 * that ajv acts on; no `$dynamicRef` or `$recursiveRef` in any file, whose dynamic scope may reach
 * it; and in its own self-contained document (`docs`, from json-schema.ts, every `$ref` a pointer by
 * then) no `$ref` to itself or into its `properties`, since the filtered schema's `#` is the
 * filtered schema while each property's validator was compiled against the whole one.
 */
export function objectShape(files: Files, path: string, entry: Entry | undefined, docs: Record<JsonSchemaTarget, JsonSchemaResult>, rules: Record<string, unknown>): ObjectShape | undefined {
  const root = files.schemas.get(path);
  const schema = entry ? pointTo(root!, [...entry]) : root;
  if (!isObj(schema) || schema["type"] !== "object") return undefined;
  if (Object.keys(schema).some((key) => !SHAPE_KEYWORDS.has(key) && rules[key])) return undefined;
  const properties = schema["properties"] ?? {};
  const required = schema["required"] ?? [];
  const additional = schema["additionalProperties"];
  if (!isObj(properties) || Object.entries(properties).some(([key, value]) => key === "__proto__" || !(isObj(value) || typeof value === "boolean"))) return undefined;
  if (!Array.isArray(required) || !required.every((key): key is string => typeof key === "string")) return undefined;
  if (additional !== undefined && typeof additional !== "boolean" && !isObj(additional)) return undefined;
  let dynamic = false;
  for (const file of files.schemas.values())
    eachSchema(file, (sub) => {
      if (sub["$dynamicRef"] !== undefined || sub["$recursiveRef"] !== undefined) dynamic = true;
    });
  const document = "schema" in docs["draft-2020-12"] ? docs["draft-2020-12"].schema : "schema" in docs["draft-07"] ? docs["draft-07"].schema : undefined;
  if (dynamic || document === undefined || refersToItself(document)) return undefined;
  const keys = Object.keys(properties);
  return {
    properties: keys.map((key) => ({ key, alwaysValid: alwaysValid(properties[key]!, rules) })),
    required: [...required],
    additional: additional === undefined ? true : additional === false ? false : alwaysValid(additional, rules) ? true : "schema",
    keys: [...new Set([...keys, ...required])],
  };
}

/** The module's default export and each definition's validator, with its document for Standard JSON Schema and its shape when it is a plain object. */
interface ModuleEntry {
  /** `schema` for the root; the definition's value name otherwise. */
  name: string;
  entry?: Entry;
  docs: Record<JsonSchemaTarget, JsonSchemaResult>;
  shape?: ObjectShape | undefined;
}

/** The root and each definition whose value is a schema, an object or a boolean, as the module exports them. */
function moduleEntries(files: Files, path: string, rules: Record<string, unknown> | undefined): ModuleEntry[] {
  const root = files.schemas.get(path)!;
  const draft = draftOf(root) ?? "draft-07";
  const make = (name: string, entry?: Entry): ModuleEntry => {
    const docs = jsonSchemas(files, path, draft, entry);
    return { name, ...(entry ? { entry } : {}), docs, ...(rules ? { shape: objectShape(files, path, entry, docs, rules) } : {}) };
  };
  const definitions = definitionsOf(root, path).filter(({ keyword, key }) => {
    const value = pointTo(root, [keyword, key]);
    return isObj(value) || typeof value === "boolean";
  });
  return [make("schema"), ...definitions.map(({ keyword, key, valueName }) => make(valueName, [keyword, key]))];
}

/**
 * Each entry's validators from a compiled root, as ajv standalone code: the root's own function, or
 * a definition's, found by its pointer (`getSchema`); for a plain object, a function per property
 * ajv does not skip and one for a schema in `additionalProperties`, which the run-time join calls
 * in ajv's order. Functions the same schema gives are written once (two properties that `$ref` one
 * definition). `returns` is what the module's wrapper returns: the function, or a list with one
 * function per property, then `additionalProperties`'.
 */
function entryCode(ajv: Ajv, standalone: (ajv: Ajv, refs: unknown) => string, compiled: { validate: unknown; id: string }, entry: ModuleEntry, wrappers: { n: number }): { source: string; returns: string } {
  const at = (segments: string[]) => `${compiled.id}#${fragmentOf(segments)}`;
  const segments = entry.entry ? [...entry.entry] : [];
  const ids = new Map<unknown, string>();
  const exported: Record<string, string> = {};
  const exportOf = (id: string, segments?: string[]): string => {
    if (segments) shareRef(ajv, compiled, segments, id);
    let fn = ajv.getSchema(id);
    if (fn === undefined) {
      // A pointer ajv resolves to the root itself (a definition that is only `{ "$ref": "#" }`) is no new
      // function to it; one that refers to it by its id is.
      const wrapper = `dotschema-entry:${wrappers.n++}`;
      ajv.addSchema({ $id: wrapper, $ref: id });
      fn = ajv.getSchema(wrapper);
      id = wrapper;
    }
    let name = ids.get(fn);
    if (name === undefined) {
      name = `f${ids.size}`;
      ids.set(fn, name);
      exported[name] = id;
    }
    return name;
  };
  if (!entry.shape) {
    if (!entry.entry) return { source: standalone(ajv, compiled.validate), returns: "module.exports.default ?? module.exports" };
    const name = exportOf(at(segments));
    return { source: standalone(ajv, exported), returns: `module.exports.${name}` };
  }
  // As `shapeCode` numbers them: the properties ajv checks, then `additionalProperties`.
  const names = entry.shape.properties.filter(({ alwaysValid }) => !alwaysValid).map(({ key }) => `module.exports.${exportOf(at([...segments, "properties", key]), [...segments, "properties", key])}`);
  if (entry.shape.additional === "schema") names.push(`module.exports.${exportOf(at([...segments, "additionalProperties"]), [...segments, "additionalProperties"])}`);
  return { source: standalone(ajv, exported), returns: `[${names.join(", ")}]` };
}

/**
 * Registers, under the pointer `id`, the function the root's own validator calls for a schema that
 * is only a `$ref` (ajv's `getJsonPointer` follows one), for `getSchema` and the standalone code. ajv
 * resolves such a pointer to a new compile of its target, while every `$ref` the root's validator
 * compiled is cached on the root (`schemaEnv.refs`), so taking it from there writes the target once:
 * team.schema.jsonc's `lead` and the items of its `members` are one function for user.schema.jsonc,
 * and were two. Nothing is registered where the root inlined the target, or the schema is anything else.
 */
function shareRef(ajv: Ajv, compiled: { validate: unknown; id: string }, segments: string[], id: string): void {
  const env = (compiled.validate as { schemaEnv?: { schema: Value; refs: Record<string, unknown> } }).schemaEnv;
  const schema = env && pointTo(env.schema, segments);
  const ref = isObj(schema) ? schema["$ref"] : undefined;
  if (typeof ref !== "string" || Object.keys(schema as object).some((key) => key !== "$ref" && ajv.RULES.all[key])) return;
  const target = env!.refs[ref.startsWith("#") ? `${compiled.id}${ref}` : ref] as { validate?: unknown } | undefined;
  if (typeof target?.validate === "function") ajv.refs[id] = target;
}

/** The shape as the run-time join reads it: each property's key, its JSON Pointer in an issue's instancePath and its function's index (null where ajv skips it), the required keys, and `additionalProperties` (true, false, or its function's index). */
const shapeCode = (shape: ObjectShape): string => {
  let index = 0;
  const properties = shape.properties.map(({ key, alwaysValid }) => [key, `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, alwaysValid ? null : index++]);
  return toJs({ properties, required: shape.required, additional: shape.additional === "schema" ? index : shape.additional } as Value);
};

// ---- types --------------------------------------------------------------------------------------

/** A list of keys as a union of string literal types, `never` for none. */
const keyUnion = (keys: readonly string[]): string => (keys.length ? keys.map((key) => JSON.stringify(key)).join(" | ") : "never");

/**
 * The module's types. They import the `Schema` type from `dotschema`, the package the project
 * installed, which the type check resolves from the schema's directory. A `$ref` to another schema
 * file is a type imported from that file's module, which TypeScript sends through the mapper in turn.
 * Each definition is a validator too, exported under its value name with its own `.Type`; a root or
 * a definition that is a plain object is an `ObjectSchema`, with `.pick()` and `.omit()`.
 */
export function schemaTypes(source: string, path: string, options?: TypeOptions): { types: string; problems: Problem[] } {
  const parsed = parseSchemaFile(source, path);
  if (!parsed.ok) return { types: FAILED_TYPES, problems: parsed.problems };
  const schema = parsed.value;
  const draft = draftOf(schema);
  const files = filesOf(source, path, schema);
  const problems: Problem[] = [...files.problems];
  const loaded = loadAjv(path, schema, false);
  const entries = moduleEntries(files, path, "error" in loaded ? undefined : loaded.ajv.RULES.all);
  // A reference that cannot be followed is the problem; ajv would only add that it cannot resolve it.
  // A draft ajv does not validate is reported here too, where it was found only when the module was built.
  if ("error" in loaded) problems.push(problem(loaded.error));
  else if (!files.problems.length) {
    const compiled = compile(loaded.ajv, files, path);
    if ("problem" in compiled) problems.push(compiled.problem);
    else {
      // Each definition's validator, as the build compiles it, so a definition ajv refuses fails here too.
      const failed = definitionProblem(loaded.ajv, compiled, entries);
      if (failed) problems.push(failed);
    }
  }
  // The types read each `$ref` as a pointer from its file's root, resolved against the `$id`s above it (refs.ts).
  const resolved = resolvedSchemas(files);
  const { declarations, rootName, rootType, rootDoc, definitions } = schemaModuleTypes(resolved.get(path)!, { path, read: (other) => resolved.get(other) }, draft, options);
  const typeOf = (entry: ModuleEntry, type: string, literalType: string) =>
    entry.shape ? `__DotschemaObjectSchema<${type}, ${literalType}, ${keyUnion(entry.shape.keys)}>` : `__DotschemaSchema<${type}, ${literalType}>`;
  const [rootEntry, ...definitionEntries] = entries;
  const definitionLines = definitionEntries.map((entry) => {
    const definition = definitions.find((d) => d.keyword === entry.entry![0] && d.key === entry.entry![1])!;
    return [
      `${definition.doc}export declare const ${definition.valueName}: ${typeOf(entry, definition.type, `${LITERAL_NAME}[${JSON.stringify(definition.keyword)}][${JSON.stringify(definition.key)}]`)};`,
      `${definition.doc}export declare namespace ${definition.valueName} { export type { ${definition.typeName} as Type }; }`,
    ].join("\n");
  });
  return {
    types: [
      `import type { Schema as __DotschemaSchema } from "dotschema";`,
      ...(entries.some((entry) => entry.shape) ? [`import type { ObjectSchema as __DotschemaObjectSchema } from "dotschema";`] : []),
      declarations,
      // The schema as written, under a name of its own, so an error or a hover prints `Json` in its place.
      `/** The JSON Schema as written in ${basename(path).replace(/\*\//g, "*\\/")}. */`,
      // Its arrays mutable, so `.schema` passes where a JSON Schema type's are (`required?: string[]` in
      // @types/json-schema and the Anthropic SDK; the maintainer's choice of 2026-10-27).
      `type ${LITERAL_NAME} = ${literal(schema, false)};`,
      // The root's type written out rather than named, so a hover over a value `.validate()` or `.is()`
      // gives prints the schema's properties, and a `$ref` within them by its name (the maintainer, on
      // 2026-10-26: "People want to see the actual properties for visibility").
      `${rootDoc}declare const schema: ${typeOf(rootEntry!, rootType, LITERAL_NAME)};`,
      // A namespace of types alone, which merges with the const, so the default import names the
      // type too: `user.Type` (the maintainer, on 2026-10-26: "I think the default import should have
      // a `.Type` property on it. That should be the recommended way to access it.").
      `${rootDoc}declare namespace schema { export type { ${rootName} as Type }; }`,
      "export default schema;",
      // Each definition's validator, named for its key in camelCase, with its type as `.Type` (the
      // maintainer's pick of 2026-10-26: "import { address } from "./user.schema.jsonc", with
      // address.validate() and address.is()").
      ...definitionLines,
      "",
    ].join("\n"),
    problems,
  };
}

/** The problem with the first definition ajv cannot compile on its own, as the build would report it. */
function definitionProblem(ajv: Ajv, compiled: { validate: unknown; id: string }, entries: ModuleEntry[]): Problem | undefined {
  const wrappers = { n: 0 };
  for (const entry of entries.slice(1)) {
    try {
      entryCode(ajv, () => "", compiled, entry, wrappers);
    } catch (error) {
      return problem(`The definition "${entry.entry![1]}" is not a valid schema: ${refusal(error)}`);
    }
  }
  return undefined;
}

// ---- code ---------------------------------------------------------------------------------------

/** `require("x")` calls in CommonJS source, not inside a string (ajv keeps `'require("…")'` strings for its own code generation). */
const REQUIRE = /(?<!['"\w.$])require\(\s*(["'])([^"']+)\1\s*\)/g;

/**
 * The requires in ajv's standalone code, which ajv writes with double quotes (each helper's `.code`,
 * `require("ajv/dist/runtime/equal").default`). That code holds the schema's own strings, written
 * with JSON.stringify, which escapes `"` and not `'`: REQUIRE took `"load require('ajv') now"` in a
 * `const` for a call, rewrote the string the validator compares, and inlined ajv (measured
 * 2026-10-20). A `"` in such a string is always `\"`, so a double-quoted require is code.
 */
const STANDALONE_REQUIRE = /(?<![\w.$\\])require\((")([^"\\]+)"\)/g;

/**
 * Inlines CommonJS modules: each standalone validator and every module they require, transitively,
 * as functions in one ES module, so the generated module imports nothing at run time. The
 * validators share one table of modules, so a helper several require (ucs2length, fast-deep-equal,
 * a format's file) is there once; `wrap` gives a validator as an expression, a function that runs
 * ajv's code in a scope of its own, `module` the id of a file added to the table, with what it
 * requires, and `table` the modules, which go before every validator.
 */
function inliner(entryFile: string): { wrap(source: string, returns: string): string; module(file: string): number; table(): string } {
  const ids = new Map<string, number>();
  const bodies: string[] = [];
  // In a helper's own source (fast-uri writes `require('./lib/utils')`), a require that does not
  // resolve is left as written, for a guarded optional one; in the standalone code it is a problem,
  // thrown to `schemaCode`, never a bare `require` the module would fail on when it runs.
  const rewrite = (source: string, from: string, standalone = false) =>
    source.replace(standalone ? STANDALONE_REQUIRE : REQUIRE, (call, _quote, specifier: string) => {
      let file: string | undefined;
      try {
        file = createRequire(from).resolve(specifier);
      } catch {
        if (!standalone) return call;
      }
      if (!file || isBuiltin(file)) throw new Error(`${standalone ? "ajv's standalone code" : basename(from)} requires ${specifier}, which ${file ? "is a Node.js built-in" : `does not resolve from ${basename(from)}`}, so it cannot be inlined.`);
      return `__require(${add(file)})`;
    });
  const add = (file: string): number => {
    const known = ids.get(file);
    if (known !== undefined) return known;
    const id = bodies.length;
    ids.set(file, id);
    bodies.push("");
    const text = readFileSync(file, "utf8");
    bodies[id] = file.endsWith(".json") ? `module.exports = ${text};` : rewrite(text, file);
    return id;
  };
  return {
    wrap: (source, returns) => ["(() => {", "  const module = { exports: {} }, exports = module.exports;", rewrite(source, entryFile, true), `  return ${returns};`, "})()"].join("\n"),
    module: add,
    table: () =>
      [
        "const __modules = [",
        ...bodies.map((body) => `function (module, exports) {\n${body}\n},`),
        "];",
        "const __cache = [];",
        "function __require(id) {",
        "  if (!__cache[id]) { const module = { exports: {} }; __cache[id] = module; __modules[id](module, module.exports); }",
        "  return __cache[id].exports;",
        "}",
      ].join("\n"),
  };
}

/**
 * A format the standalone code uses through `code.formats` (`loadAjv`): ajv declares each in the scope
 * code before the function that uses it, as `const formats0 = __formats["date-time"];` or
 * `const formats2 = __formats.jwt;`. Matched at that declaration and never rewritten, so a string in
 * the schema that holds the same text can only add a file the module does not need.
 */
const FORMAT_USE = /\bconst formats\d+ = __formats(?:\["((?:[^"\\]|\\.)*)"\]|\.([A-Za-z_$][\w$]*));/g;

/**
 * The definition of `__formats`, the formats the standalone codes use, each the `module.exports` of
 * its file in src/formats/, inlined with what it requires; undefined when they use none, so a module
 * that checks no format with a function carries none.
 */
function usedFormats(inline: ReturnType<typeof inliner>, sources: string[]): string | undefined {
  const names = new Set<string>();
  for (const source of sources) for (const [, quoted, bare] of source.matchAll(FORMAT_USE)) names.add(bare ?? (JSON.parse(`"${quoted}"`) as string));
  if (!names.size) return undefined;
  const entries = [...names].sort().map((name) => {
    const file = formatFile(name);
    if (!file) throw new Error(`ajv's standalone code checks the format "${name}" with a function, and dotschema has no file for it, so it cannot be inlined.`);
    return `${JSON.stringify(name)}: __require(${inline.module(file)})`;
  });
  return `const __formats = { ${entries.join(", ")} };`;
}

/** The join, for a plain object's checks (`objectShape`), and the filter `.pick()` and `.omit()` apply to its schema. */
const OBJECTS = `
const __hasOwn = Object.prototype.hasOwnProperty;
// A plain object schema's own checks, joined at run time around ajv's function for each property
// (objectShape and entryCode in schema.ts), so that .pick() and .omit() reuse them: the code ajv
// writes for \`type: "object"\` with \`required\`, \`additionalProperties\` and \`properties\`, in its
// order, with its errors and its reads (ownProperties: a property is the value's own). With \`all\`,
// every error, as ajv's allErrors; without, it stops at the first.
const __join = (fns, shape, all) => {
  const known = new Set(shape.properties.map((property) => property[0]));
  const check = (data) => {
    const errors = [];
    const add = (more) => {
      for (const error of more) errors.push(error);
    };
    const at = (key, instancePath) => ({ instancePath, parentData: data, parentDataProperty: key, rootData: data });
    if (!(data && typeof data == "object" && !Array.isArray(data))) errors.push({ instancePath: "", keyword: "type", params: { type: "object" }, message: "must be object" });
    else
      checks: {
        for (const key of shape.required)
          if (data[key] === undefined || !__hasOwn.call(data, key)) {
            errors.push({ instancePath: "", keyword: "required", params: { missingProperty: key }, message: "must have required property '" + key + "'" });
            if (!all) break checks;
          }
        if (shape.additional !== true)
          for (const key of Object.keys(data)) {
            if (known.has(key)) continue;
            if (shape.additional === false) errors.push({ instancePath: "", keyword: "additionalProperties", params: { additionalProperty: key }, message: "must NOT have additional properties" });
            else if (!fns[shape.additional](data[key], at(key, "/" + key.replace(/~/g, "~0").replace(/\\//g, "~1")))) add(fns[shape.additional].errors);
            else continue;
            if (!all) break checks;
          }
        for (const [key, instancePath, index] of shape.properties)
          if (index !== null && data[key] !== undefined && __hasOwn.call(data, key) && !fns[index](data[key], at(key, instancePath))) {
            add(fns[index].errors);
            if (!all) break checks;
          }
      }
    check.errors = errors.length ? errors : null;
    return !errors.length;
  };
  return check;
};
// The schema with only the properties \`keep\` keeps, in \`properties\` and \`required\`; every other keyword as it was.
const __filtered = (schema, keep) => {
  const out = { ...schema };
  if (typeof schema.properties === "object" && schema.properties !== null) out.properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => keep(key)));
  if (Array.isArray(schema.required)) out.required = schema.required.filter(keep);
  return out;
};
// The schema with \`required\` in place of its own; every other keyword as it was.
const __requiring = (schema, required) => {
  const out = { ...schema };
  if (Array.isArray(schema.required) || required.length) out.required = required;
  return out;
};
`;

/** `.pick()`, `.omit()`, `.partial()`, `.required()` and `.keyof()`, on a plain object's value. */
const PICK = `
  if (shape) {
    const documents = (edit) => Object.fromEntries(Object.entries(jsonSchemas).map(([target, entry]) => [target, entry.schema ? { schema: edit(entry.schema) } : entry]));
    const narrow = (keep) =>
      __make(allFns, firstFns, __filtered(schema, keep), documents((document) => __filtered(document, keep)), { properties: shape.properties.filter(([key]) => keep(key)), required: shape.required.filter(keep), additional: shape.additional }, confirm);
    const requiring = (required) => __make(allFns, firstFns, __requiring(schema, required), documents((document) => __requiring(document, required)), { ...shape, required }, confirm);
    const properties = shape.properties.map(([key]) => key);
    made.pick = (...keys) => narrow((key) => keys.includes(key));
    made.omit = (...keys) => narrow((key) => !keys.includes(key));
    made.partial = (...keys) => requiring(keys.length ? shape.required.filter((key) => !keys.includes(key)) : []);
    made.required = (...keys) => requiring([...shape.required, ...properties.filter((key) => (!keys.length || keys.includes(key)) && !shape.required.includes(key))]);
    // The keys \`properties\` and \`required\` name, as a schema of its own: \`{ "enum": [...] }\`.
    made.keyof = () => {
      const keys = [...new Set([...properties, ...shape.required])];
      const check = (data) => {
        const valid = typeof data === "string" && keys.includes(data);
        check.errors = valid ? null : [{ instancePath: "", schemaPath: "#/enum", keyword: "enum", params: { allowedValues: keys }, message: "must be equal to one of the allowed values" }];
        return valid;
      };
      const document = (uri) => ({ schema: { $schema: uri, enum: [...keys] } });
      return __make(check, check, { enum: [...keys] }, { "draft-07": document("http://json-schema.org/draft-07/schema#"), "draft-2020-12": document("https://json-schema.org/draft/2020-12/schema") }, undefined, false);
    };
  }
`;

/**
 * The module's run time, beside its validators. `objects` adds the join and `.pick()` and `.omit()`,
 * which only a module whose root or a definition is a plain object uses, so another module carries neither.
 */
const runtime = (objects: boolean) => `
// Standard Schema's path for an ajv error. ajv's instancePath is a JSON Pointer, which writes an
// array index as it writes an object key, so each segment is read against the value it names: in
// an array, a number. The key of a property that is missing, unexpected or misnamed, which ajv
// gives in the error's params (for the discriminator, the tag's), ends the path; so does the key whose name an error inside
// propertyNames is about, which ajv gives on the error itself.
const __KEYS = { required: "missingProperty", dependentRequired: "missingProperty", dependencies: "missingProperty", additionalProperties: "additionalProperty", unevaluatedProperties: "unevaluatedProperty", propertyNames: "propertyName", discriminator: "tag" };
const __path = (value, error) => {
  const path = [];
  const segments = error.instancePath ? error.instancePath.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")) : [];
  let at = value;
  for (const segment of segments) {
    let index = false;
    // Reading the value again runs its getters again; one that throws now leaves the rest as keys.
    try {
      index = Array.isArray(at);
      at = typeof at === "object" && at !== null ? at[segment] : undefined;
    } catch {
      at = undefined;
    }
    path.push(index ? Number(segment) : segment);
  }
  const key = Object.hasOwn(__KEYS, error.keyword) ? error.params?.[__KEYS[error.keyword]] : undefined;
  if (typeof key === "string") path.push(key);
  else if (typeof error.propertyName === "string") path.push(error.propertyName);
  return path;
};
// The discriminator dotschema adds for a oneOf whose variants a property tells apart (withDiscriminators
// in schema.ts) is not in the schema as written, so its failure is reported as the oneOf's.
const __issue = (value, error) => ({ message: error.message ?? "is not valid", path: __path(value, error), keyword: error.keyword === "discriminator" ? "oneOf" : error.keyword });
// What ajv threw, as text, for a value it could not check: a value nested deeper than the stack, one
// that refers to itself where the schema recurses, a getter or proxy that throws.
const __thrown = (error) => {
  try {
    return typeof error?.message === "string" ? error.message : String(error);
  } catch {
    return "a value that cannot be read";
  }
};
${objects ? OBJECTS : ""}
// A schema module's value, or one of its definitions': \`.validate()\` with ajv's allErrors validator,
// \`.is()\` with the one that stops at the first failure, Standard Schema, and for a plain object
// (a \`shape\`), \`.pick()\`, \`.omit()\`, \`.partial()\`, \`.required()\` and \`.keyof()\`, which give the
// same for another schema made from the same functions. \`confirm\` is whether a pass of \`.is()\` is
// confirmed (\`__confirm\`), which \`.keyof()\`'s check never needs. Nothing on it throws but Standard
// JSON Schema's conversion to a target it has no schema for, as that spec asks.
const __make = (allFns, firstFns, schema, jsonSchemas, shape, confirm = __confirm) => {
  const all = ${objects ? "shape ? __join(allFns, shape, true) : " : ""}allFns;
  const first = ${objects ? "shape ? __join(firstFns, shape, false) : " : ""}firstFns;
  // Every issue, from the validator compiled with allErrors; the value itself on success. Nothing
  // throws: what ajv throws is one issue at the root, with its message.
  const validate = (value) => {
    try {
      if (all(value)) return { value };
    } catch (error) {
      return { issues: [{ message: "could not be checked: " + __thrown(error), path: [], keyword: "error" }] };
    }
    return { issues: all.errors.map((error) => __issue(value, error)) };
  };
  // The validator compiled without allErrors, which returns at the first failure; a value it
  // cannot check is not known to be valid. Where ajv's first-failure code can pass a value the schema
  // refuses (\`contains\` beside a tuple, needsConfirmation in schema.ts), a pass is confirmed.
  const is = (value) => {
    try {
      return first(value) && (!confirm || all(value));
    } catch {
      return false;
    }
  };
  // Standard JSON Schema v1: the schema in the target's draft, self-contained, computed when the module
  // was built (json-schema.ts); a fresh copy each call, so a caller may change it.
  const jsonSchema = (options) => {
    const target = options?.target;
    const entry = Object.hasOwn(jsonSchemas, target) ? jsonSchemas[target] : undefined;
    if (!entry) throw new TypeError(\`dotschema converts a schema to the "draft-07" and "draft-2020-12" targets, not \${JSON.stringify(target)}.\`);
    if (entry.error) throw new TypeError(entry.error);
    return structuredClone(entry.schema);
  };
  const made = { validate, is, schema, "~standard": { version: 1, vendor: "dotschema", validate, jsonSchema: { input: jsonSchema, output: jsonSchema } } };
${objects ? PICK : ""}
  return made;
};
`;

/**
 * The module's JavaScript, with problems in place of a validator that cannot be built, which a
 * bundler or the preload reports as a load error. `watchFiles` are the other schema files the
 * validator was compiled from, for a bundler to rebuild the module when one changes.
 * `discriminators: false` compiles each oneOf as written, for the test that compares the two.
 *
 * The default export is the root's; each definition's validator is a named export, built inside a
 * function marked pure, so a bundler leaves out the definitions nothing imports.
 */
export function schemaCode(source: string, path: string, { discriminators = true } = {}): { code: string; problems: Problem[]; watchFiles: string[] } {
  const failed = (problems: Problem[], watchFiles: string[] = []) => ({ code: "export default undefined;\n", problems, watchFiles });
  const parsed = parseSchemaFile(source, path);
  if (!parsed.ok) return failed(parsed.problems);
  const files = filesOf(source, path, parsed.value);
  if (files.problems.length) return failed(files.problems, files.watched);
  // Two validators from the same files, formats and meta-schemas: every error for `.validate()`, the first for `.is()`.
  const standalones: { source: string; returns: string }[][] = [];
  let entries: ModuleEntry[] | undefined;
  // Each oneOf a property tells apart gets ajv's discriminator, so that its issues are the matching
  // variant's; were ajv to refuse one, the validator is compiled as the schema is written.
  const tagged = discriminators ? withDiscriminators(files) : { files, count: 0 };
  for (const allErrors of [true, false]) {
    let loaded = loadAjv(path, parsed.value, true, allErrors, tagged.count > 0);
    if ("error" in loaded) return failed([problem(loaded.error)], files.watched);
    let compiled = tagged.count > 0 ? compile(loaded.ajv, tagged.files, path) : compile(loaded.ajv, files, path);
    if ("problem" in compiled && tagged.count > 0) {
      loaded = loadAjv(path, parsed.value, true, allErrors);
      if ("error" in loaded) return failed([problem(loaded.error)], files.watched);
      compiled = compile(loaded.ajv, files, path);
    }
    if ("problem" in compiled) return failed([compiled.problem], files.watched);
    entries ??= moduleEntries(files, path, loaded.ajv.RULES.all);
    const standaloneModule = loaded.require("ajv/dist/standalone");
    const standalone = standaloneModule.default ?? standaloneModule;
    const wrappers = { n: 0 };
    const codes: { source: string; returns: string }[] = [];
    for (const entry of entries) {
      try {
        codes.push(entryCode(loaded.ajv, standalone, compiled, entry, wrappers));
      } catch (error) {
        return failed([problem(entry.entry ? `The definition "${entry.entry[1]}" is not a valid schema: ${refusal(error)}` : `The schema is not valid: ${refusal(error)}`)], files.watched);
      }
    }
    standalones.push(codes);
  }
  // The standalone code requires ajv's run-time helpers, which resolve from this module, a dependent
  // of ajv's, and reaches each format checked by a function through `__formats` (`usedFormats`).
  const inline = inliner(fileURLToPath(import.meta.url));
  const [all, first] = standalones as [{ source: string; returns: string }[], { source: string; returns: string }[]];
  let body: string[];
  try {
    const shapeOf = (entry: ModuleEntry) => (entry.shape ? shapeCode(entry.shape) : "undefined");
    const [root, ...definitions] = entries!;
    const formats = usedFormats(inline, [...all, ...first].map((code) => code.source));
    body = [
      ...(formats ? [formats] : []),
      `const __validateAll = /* @__PURE__ */ ${inline.wrap(all[0]!.source, all[0]!.returns)};`,
      `const __validateFirst = /* @__PURE__ */ ${inline.wrap(first[0]!.source, first[0]!.returns)};`,
      `const __schema = ${toJs(parsed.value)};`,
      `const __jsonSchemas = ${toJs(root!.docs as unknown as Value)};`,
      `const __confirm = ${needsConfirmation(files)};`,
      runtime(entries!.some((entry) => entry.shape)),
      `const schema = /* @__PURE__ */ __make(__validateAll, __validateFirst, __schema, __jsonSchemas, ${shapeOf(root!)});`,
      "export default schema;",
      ...definitions.map((entry, i) =>
        [
          `export const ${entry.name} = /* @__PURE__ */ (() => {`,
          `const all = ${inline.wrap(all[i + 1]!.source, all[i + 1]!.returns)};`,
          `const first = ${inline.wrap(first[i + 1]!.source, first[i + 1]!.returns)};`,
          `return __make(all, first, __schema[${JSON.stringify(entry.entry![0])}][${JSON.stringify(entry.entry![1])}], ${toJs(entry.docs as unknown as Value)}, ${shapeOf(entry)});`,
          "})();",
        ].join("\n"),
      ),
    ];
  } catch (error) {
    return failed([problem((error as Error).message)], files.watched);
  }
  return { code: [inline.table(), ...body, ""].join("\n"), problems: [], watchFiles: files.watched };
}
