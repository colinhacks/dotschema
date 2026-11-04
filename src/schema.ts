// The module a `.schema.jsonc` file becomes: the TypeScript type the schema describes, and the
// validators dotschema's engine (src/engine) runs on the schema.
//
//   import user, { type output as User } from "./user.schema.jsonc";
//   user.validate(input);       // { value } or { issues }, every issue; never throws
//   user.is(input);             // input is User, stopping at the first failure
//   user["~standard"];          // Standard Schema v1, for any library that accepts one
//
// The types come from dotschema's own emitter (schema-types.ts). The module holds the schema as data,
// the schema resources the engine compiles (the schema and every file it reaches, refs.ts), the
// formats they use, its Standard JSON Schema and the plan of the value `.validate()` gives, and imports
// its run time from `dotschema/runtime` (src/runtime), which compiles the engine the first time a
// validator is needed. The project's `"validators"` setting (settings.ts) picks the run time: `jit`,
// the default, code generated at run time with the interpreter where `new Function` is refused;
// `interpret`, the interpreter alone; `aot`, code generated here, written into the module. Every
// check this build makes of the schema, its validity against its draft's meta-schema, each
// `default` against its own schema, and the rest, the type check makes too (`check`).
import { basename } from "node:path";
import { CODES, type Problem } from "./core/problems.ts";
import type { LoadOptions, TypeOptions } from "./core/universal.ts";
import { literal, toJs, type Value } from "./core/serialize.ts";
import { compile, type Engine, type EngineError, type FormatDefinition } from "./engine/index.ts";
import { generate } from "./engine/generate.ts";
import { checkSchema, metaResources, type MetaDraft } from "./engine/meta/index.ts";
import { parseSchemaFile, placeAt } from "./parse.ts";
import { collect, eachSchema, forEngine, fragmentOf, mapSchemas, pointTo, resolvedSchemas, resolveRef, staticReferences, withoutKeywords, type Files } from "./refs.ts";
import { definitionsOf, INPUT, LITERAL_NAME, OUTPUT, schemaModuleTypes, type Draft } from "./schema-types.ts";
import { jsonSchemas, type Entry, type JsonSchemaResult, type JsonSchemaTarget } from "./json-schema.ts";
import { formatDefinition, formatKind, formatModule } from "./formats/index.ts";
import { keyOf, outputPlan, runtimeParts, type Plan } from "./output.ts";
import { pre } from "./runtime/output.ts";

const FAILED_TYPES = ["declare const schema: any;", `declare namespace schema { export type ${OUTPUT} = any; export type ${INPUT} = any; }`, "export default schema;", `export type ${OUTPUT} = any;`, `export type ${INPUT} = any;`, ""].join("\n");

const problem = (message: string, place: { start: number; length: number } = { start: 0, length: 1 }): Problem => ({ message, ...place, code: CODES.schema });

const isObj = (value: Value | undefined): value is Record<string, Value> => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

/** The `$schema` a schema declares, or undefined. */
const declaredOf = (schema: Value): string | undefined => {
  const declared = isObj(schema) ? schema["$schema"] : undefined;
  return typeof declared === "string" ? declared : undefined;
};

/** The draft a schema declares, as the engine reads it (draft-06 as draft-07), or `$schema` as written for a draft dotschema does not validate; undefined when it declares none. */
function declaredDraft(schema: Value): string | undefined {
  const declared = declaredOf(schema);
  return declared === undefined ? undefined : (draftOf(schema) ?? declared);
}

/** The draft a schema is validated in: its `$schema`'s, draft-06 read as draft-07, and draft-07 for a schema that declares none; undefined for any other `$schema`. */
export const draftOf = (schema: Value): Draft | undefined => {
  const declared = declaredOf(schema);
  if (declared === undefined) return "draft-07";
  if (declared.includes("2020-12")) return "2020-12";
  if (declared.includes("2019-09")) return "2019-09";
  if (/draft-0[67]/.test(declared)) return "draft-07";
  return undefined;
};

/** The problem of a `$schema` dotschema does not validate. */
const draftProblem = (schema: Value): string | undefined => (draftOf(schema) ? undefined : `dotschema validates JSON Schema drafts 06, 07, 2019-09 and 2020-12; this schema declares ${declaredOf(schema)}.`);

/**
 * The keywords ajv 8.20.0 acted on in each draft that the draft does not define (read and measured
 * on 2026-10-20), which the engine, after ajv, does not read either. The spec ignores a keyword its
 * draft does not define, and so does dotschema: these are taken out of the files the types, the
 * engine and Standard JSON Schema read. Left in for ajv, `$async: true` made the validator return a
 * promise, which `.is()` read as a pass; `nullable` without `type`, `id`, and 2020-12's
 * `$recursiveAnchor: true` made ajv refuse the schema; in 2019-09, 2020-12's `$dynamicRef` was
 * enforced, and in both, draft-07's `dependencies`. Every other keyword a draft does not define, a
 * later draft's included, the engine ignores, and so does the emitter.
 */
const IGNORED: Record<Draft, readonly string[]> = {
  "draft-07": ["$async", "nullable", "id"],
  "2019-09": ["$async", "nullable", "id", "$dynamicRef", "$dynamicAnchor", "dependencies"],
  "2020-12": ["$async", "nullable", "id", "$recursiveRef", "$recursiveAnchor", "dependencies"],
};

/**
 * The keywords the engine acts on in each draft (src/engine/tree.ts, ajv 8.20.0's rules), `format`
 * and the format limits among them, and ajv-errors' `errorMessage`: what makes a schema more than
 * one that accepts everything, and what a plain object for `.pick()` may not hold (`objectShape`).
 */
const ACTED_ON: Record<Draft, ReadonlySet<string>> = (() => {
  const any = ["$ref", "type", "const", "enum", "not", "anyOf", "oneOf", "allOf", "if", "then", "else", "$comment"];
  const number = ["maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf", "format"];
  const string = ["maxLength", "minLength", "pattern", "formatMaximum", "formatMinimum", "formatExclusiveMaximum", "formatExclusiveMinimum"];
  const array = ["maxItems", "minItems", "items", "contains", "uniqueItems"];
  const object = ["maxProperties", "minProperties", "required", "propertyNames", "additionalProperties", "properties", "patternProperties"];
  const later = [...any, ...number, ...string, ...array, ...object, "maxContains", "minContains", "unevaluatedItems", "dependentRequired", "dependentSchemas", "unevaluatedProperties", "errorMessage"];
  return {
    "draft-07": new Set([...any, ...number, ...string, ...array, ...object, "additionalItems", "dependencies", "errorMessage"]),
    "2019-09": new Set([...later, "additionalItems", "$recursiveAnchor", "$recursiveRef"]),
    "2020-12": new Set([...later, "prefixItems", "$dynamicAnchor", "$dynamicRef"]),
  };
})();

/**
 * The schema and every file it reaches, each without the keywords its draft ignores, with the
 * problems of their references; draft-07 is the draft of a root that declares none. A `$dynamicRef`
 * or `$recursiveRef` that resolves as a `$ref` would is written as one (refs.ts), and the rest are
 * left to the engine, which resolves them in the dynamic scope.
 */
export function filesOf(source: string, path: string, schema: Value): Files {
  const clean = (value: Value) => withoutKeywords(value, IGNORED[draftOf(schema) ?? "draft-07"]);
  let files = collect(path, clean(schema), source, { of: declaredDraft, none: "draft-07" }, clean);
  if (draftOf(schema) === "2020-12") files = staticReferences(files, path, "$dynamicRef");
  if (draftOf(schema) === "2019-09") files = staticReferences(files, path, "$recursiveRef");
  return files;
}

// ---- the discriminator --------------------------------------------------------------------------

/** The value the `$ref` of the schema at `segments` in the file `from` points to, among the files (`resolveRef`); undefined for a URL or nothing. */
function refTarget(files: Files, from: string, segments: readonly string[]): Value | undefined {
  const target = resolveRef(files, from, segments);
  return target && "segments" in target ? pointTo(files.schemas.get(target.path)!, target.segments) : undefined;
}

/**
 * The property that tells a `oneOf`'s variants apart, where ajv's `discriminator` (8.20.0,
 * dist/vocabularies/discriminator), which the engine reads as ajv does, can stand for the `oneOf` and
 * give the same verdict on every value: the schema is `type: "object"` (the discriminator stands in
 * for the `oneOf`, and checks objects alone, so without it a number passed); each variant, or the
 * schema a variant that is only a `$ref` points to, has the property in its own `properties` with a
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
 * The files as the engine compiles them for the module: a `discriminator` on each `oneOf` whose
 * variants a property tells apart (`discriminatorOf`), so that a failing value is reported against
 * its own variant alone, and none that the schema itself holds (OpenAPI's, which the engine ignores
 * without its `discriminator` option and would read with it). Never the module's `schema` or its
 * Standard JSON Schema, which stay as written. `count` is how many were added. None is added where
 * any file uses `unevaluatedProperties` or `unevaluatedItems`: ajv's discriminator, which the engine
 * follows, does not pass on what its variant evaluated, so `{ "kind": "y" }` failed
 * `unevaluatedProperties: false` beside a oneOf that the same schema passes without it (measured).
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
 * `properties` and `required`, the schema the filtered JSON Schema is, beside the ones that check
 * nothing: `type`, `properties`, `required` and `additionalProperties`, and `errorMessage`, which
 * changes only what an error says and stays in the schema a method gives. A keyword the engine does
 * not act on is ignored by it; `discriminator` is taken out of the copy it compiles (`withDiscriminators`).
 */
const SHAPE_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "$defs", "definitions", "$schema", "$id", "$comment", "title", "description", "default", "examples", "deprecated", "readOnly", "writeOnly", "discriminator", "errorMessage"]);

/** A plain object schema, which has `.pick()`, `.omit()` and the other object methods: the keys they take, those of `properties` and `required`. */
export interface ObjectShape {
  keys: string[];
}

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
 * that the engine acts on; no `$dynamicRef` or `$recursiveRef` in any file, whose dynamic scope may
 * reach it; and in its own self-contained document (`docs`, from json-schema.ts, every `$ref` a
 * pointer by then) no `$ref` to itself or into its `properties`, since the filtered schema's `#` is
 * the filtered schema, and a pointer into a property it leaves out would point to nothing.
 */
export function objectShape(files: Files, path: string, entry: Entry | undefined, docs: Record<JsonSchemaTarget, JsonSchemaResult>, draft: Draft): ObjectShape | undefined {
  const root = files.schemas.get(path);
  const schema = entry ? pointTo(root!, [...entry]) : root;
  if (!isObj(schema) || schema["type"] !== "object") return undefined;
  if (Object.keys(schema).some((key) => !SHAPE_KEYWORDS.has(key) && ACTED_ON[draft].has(key))) return undefined;
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
  return { keys: [...new Set([...Object.keys(properties), ...required])] };
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
function moduleEntries(files: Files, path: string): ModuleEntry[] {
  const root = files.schemas.get(path)!;
  const draft = draftOf(root) ?? "draft-07";
  const make = (name: string, entry?: Entry): ModuleEntry => {
    const docs = jsonSchemas(files, path, draft, entry);
    return { name, ...(entry ? { entry } : {}), docs, shape: objectShape(files, path, entry, docs, draft) };
  };
  const definitions = definitionsOf(root, path).filter(({ keyword, key }) => {
    const value = pointTo(root, [keyword, key]);
    return isObj(value) || typeof value === "boolean";
  });
  return [make("schema"), ...definitions.map(({ keyword, key, valueName }) => make(valueName, [keyword, key]))];
}

/** An entry's URI from the root resource's: `""` for the root, a JSON Pointer to a definition. */
const entryUri = (entry: ModuleEntry): string => (entry.entry ? `#${fragmentOf(entry.entry)}` : "");

// ---- the engine's resources and checks ----------------------------------------------------------

/** The meta-schemas each draft's validator knows, as ajv's class for it did: a `$ref` to one is followed, as to a file. */
const KNOWN_META: Record<Draft, MetaDraft[]> = { "draft-07": ["draft-07", "draft-06"], "2019-09": ["2019-09"], "2020-12": ["2020-12"] };

/** The schema resources the module's engine compiles, with the paths of the files they are, and the formats they use. */
interface Prepared {
  draft: Draft;
  /** The root's first, then each other file, then each meta-schema a `$ref` names. */
  resources: { id: string; schema: Value; path?: string }[];
  discriminator: boolean;
  /** The id of each file, by path. */
  ids: Map<string, string>;
  formats: string[];
}

/**
 * The files as the engine compiles them: each under an id that holds no path (`forEngine`), with the
 * discriminators dotschema adds, and the meta-schemas a `$ref` names among the drafts' own, which
 * ajv's class knew and a schema may refer to; with the names of the formats any schema of them uses.
 */
function prepare(files: Files, path: string, discriminators: boolean): Prepared {
  const draft = draftOf(files.schemas.get(path)!) ?? "draft-07";
  const tagged = discriminators ? withDiscriminators(files) : { files, count: 0 };
  const prepared = forEngine(tagged.files, path);
  const resources: Prepared["resources"] = [{ id: prepared.rootId, schema: prepared.root, path }, ...prepared.others.map(({ id, schema, path: other }) => ({ id, schema, path: other }))];
  const ids = new Map(resources.map((r) => [r.path!, r.id]));
  const refs = new Set<string>();
  for (const { schema } of resources)
    eachSchema(schema, (s) => {
      if (typeof s["$ref"] === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:/.test(s["$ref"])) refs.add(s["$ref"].replace(/#.*$/, ""));
    });
  for (const meta of KNOWN_META[draft]) {
    const metas = metaResources(meta);
    if (metas.some(({ id }) => refs.has(id))) resources.push(...metas.map(({ id, schema }) => ({ id, schema: schema as Value })));
  }
  const formats = new Set<string>();
  for (const { schema } of resources)
    eachSchema(schema, (s) => {
      if (typeof s["format"] === "string" && formatKind(s["format"]) !== undefined) formats.add(s["format"]);
    });
  return { draft, resources, discriminator: tagged.count > 0, ids, formats: [...formats].sort() };
}

/** The engine for prepared resources, with the formats they use. */
const engineOf = (prepared: Prepared): Engine =>
  compile(
    prepared.resources.map(({ id, schema }) => ({ id, schema })),
    { draft: prepared.draft, formats: Object.fromEntries(prepared.formats.map((name) => [name, formatDefinition(name) as FormatDefinition])), discriminator: prepared.discriminator },
  );

/** ajv's text for a list of errors (`errorsText`), each clause said once: ajv's message named one mistake once for each path its meta-schema reaches it by, eight times for 2020-12's `items` given a list (measured 2026-10-27). */
const errorsText = (errors: readonly EngineError[]): string => [...new Set(errors.map((e) => `data${e.instancePath} ${e.message}`))].join(", ");

/** Where each `errorMessage` of a schema is, as the JSON Pointer of the keyword. */
function messageSites(schema: Value): string[] {
  const sites: string[] = [];
  mapSchemas(schema, (s, segments) => {
    if (s["errorMessage"] !== undefined) sites.push(`${segments.length ? `/${fragmentOf(segments)}` : ""}/errorMessage`);
  });
  return sites;
}

/**
 * A schema file checked against the meta-schema of its draft, as ajv checked each before it compiled
 * it (`checkSchema`, src/engine/meta): ajv's message for a schema it refused, or one for an
 * `errorMessage` that ajv-errors' meta-schema refuses, which ajv reported when it compiled the
 * keyword; undefined where the file is valid. A file that declares no `$schema` is read against the
 * meta-schema of the draft it is compiled in, and one that declares a meta-schema that draft's
 * validator does not know (`KNOWN_META`), another draft's or another document, is refused with ajv's
 * message, as ajv refused it, so that no file is compiled in a draft it was not written for.
 */
function metaProblem(schema: Value, draft: Draft): { schema: string } | { message: string } | undefined {
  const declared = declaredOf(schema);
  if (declared !== undefined && !KNOWN_META[draft].some((meta) => metaResources(meta)[0]!.id === declared.replace(/#$/, ""))) return { schema: `no schema with key or ref "${declared}"` };
  const errors = checkSchema(schema, declared !== undefined ? {} : { meta: draft }) ?? [];
  if (!errors.length) return undefined;
  const sites = messageSites(schema);
  const inMessage = (e: EngineError) => sites.some((site) => e.instancePath === site || e.instancePath.startsWith(`${site}/`));
  const own = errors.filter((e) => !inMessage(e));
  if (own.length) return { schema: `schema is invalid: ${errorsText(own)}` };
  const messages = errors.filter(inMessage);
  const site = sites.find((s) => messages[0]!.instancePath === s || messages[0]!.instancePath.startsWith(`${s}/`))!;
  const at = `#${site.slice(0, -"/errorMessage".length)}`;
  return { message: `keyword "errorMessage" value is invalid at path "${at}": ${errorsText(messages.filter((e) => e.instancePath.startsWith(site)).map((e) => ({ ...e, instancePath: e.instancePath.slice(site.length) })))}` };
}

/** What a module is built from once its files pass every check: its entries, the prepared resources and their engine, and the plan of the value `.validate()` gives. */
interface Checked {
  entries: ModuleEntry[];
  prepared: Prepared;
  engine: Engine;
  plan: Plan;
}

/** Where a problem with the keyword at `segments` in the file `at` is reported: at its key in the root's text, or at the reference that reaches another file. */
const placeOf = (files: Files, path: string, source: string, at: string, segments: readonly string[]) => (at === path ? placeAt(source, segments) : files.places.get(at));

/**
 * Every check the build makes of a schema and the files it reaches, the type check's too, with the
 * module's parts where they all pass, in the order ajv made them until the engine: each other file,
 * then the root, against its draft's meta-schema; each entry's validator compiled, with the
 * discriminators dotschema adds, and without them where the engine refuses one; each `transform`;
 * and each `default` against its own schema. Each problem is placed at what it is about, or at the
 * file's start; the first problem found is the one reported, as ajv threw at its first.
 */
function check(files: Files, path: string, source: string, discriminators: boolean, entries: ModuleEntry[]): { problems: Problem[]; checked?: Checked } {
  const root = files.schemas.get(path)!;
  const fault = draftProblem(root);
  if (fault) return { problems: [problem(fault)] };
  if (files.problems.length) return { problems: files.problems };
  const draft = draftOf(root)!;
  let prepared = prepare(files, path, discriminators);
  for (const { schema, path: other } of prepared.resources.slice(1)) {
    if (other === undefined) continue;
    const found = metaProblem(schema, draft);
    if (found) return { problems: [problem("schema" in found ? `${basename(other)} is not a valid schema: ${found.schema}` : `The schema is not valid: ${found.message}`, files.places.get(other))] };
  }
  const own = metaProblem(prepared.resources[0]!.schema, draft);
  if (own) return { problems: [problem(`The schema is not valid: ${"schema" in own ? own.schema : own.message}`)] };
  const planned = outputPlan(files, path, draft, entries.map((entry) => entry.entry));
  const uris = [...entries.map(entryUri), ...planned.tests.map((test) => testUri(prepared, path, test))];
  // Each validator compiled; were the engine to refuse a discriminator dotschema added, the files are compiled as written.
  const compiled = (from: Prepared): { engine: Engine } | { error: string; at: number } => {
    let engine: Engine;
    // What the engine refuses in the files as a whole, two schemas under one `$id` among them, is the root's problem.
    try {
      engine = engineOf(from);
    } catch (error) {
      return { error: String((error as Error)?.message ?? error), at: 0 };
    }
    for (const [i, uri] of uris.entries()) {
      try {
        engine.validator(uri || undefined);
      } catch (error) {
        return { error: String((error as Error)?.message ?? error), at: i };
      }
    }
    return { engine };
  };
  let result = compiled(prepared);
  if ("error" in result && prepared.discriminator) {
    prepared = prepare(files, path, false);
    result = compiled(prepared);
  }
  if ("error" in result) {
    const entry = entries[result.at];
    return { problems: [problem(entry?.entry ? `The definition "${entry.entry[1]}" is not a valid schema: ${result.error}` : `The schema is not valid: ${result.error}`)] };
  }
  const transforms = planned.problems.map(({ path: at, segments, message }) => problem(message, placeOf(files, path, source, at, segments)));
  if (transforms.length) return { problems: transforms };
  const defaults = defaultProblems(result.engine, prepared, files, path, source, planned);
  if (defaults.length) return { problems: defaults };
  return { problems: [], checked: { entries, prepared, engine: result.engine, plan: planned } };
}

/** The URI of a check the plan chooses by (output.ts), the schema at a file's pointer: from the root resource's within the root, and by the other file's id otherwise. */
const testUri = (prepared: Prepared, path: string, test: { path: string; segments: readonly string[] }): string => `${test.path === path ? "" : prepared.ids.get(test.path)}#${fragmentOf(test.segments)}`;

/**
 * A problem for each `default` that its own schema refuses, read as `.validate()` fills it in: with
 * the transforms and the defaults inside it that the schema applies (the run time's `pre`, run on a
 * copy), and checked by the engine against the schema that holds it, wherever in the files it is,
 * the maintainer's wish of 2026-10-27: "We can also verify that the default value in question
 * actually conforms to the type properly."
 */
function defaultProblems(engine: Engine, prepared: Prepared, files: Files, path: string, source: string, plan: Plan): Problem[] {
  const problems: Problem[] = [];
  let tests: ((value: unknown) => boolean)[] | undefined;
  for (const [file, schema] of files.schemas) {
    const found: string[][] = [];
    mapSchemas(schema, (copy, segments) => {
      if (Object.hasOwn(copy, "default")) found.push([...segments]);
    });
    for (const segments of found) {
      const value = (pointTo(schema, segments) as Record<string, Value>)["default"]!;
      let validator: ReturnType<Engine["validator"]>;
      try {
        validator = engine.validator(`${prepared.ids.get(file)}#${fragmentOf(segments)}`);
      } catch {
        continue;
      }
      const node = plan.at.get(keyOf(file, segments));
      tests ??= plan.tests.map((test) => engine.validator(testUri(prepared, path, test)).check);
      let filled: unknown = value;
      let errors: EngineError[] | null;
      try {
        filled = node === undefined ? value : pre(plan.nodes, tests, plan.nodes[node]!, structuredClone(value));
        if (validator.check(filled)) continue;
        errors = validator.errors(filled);
      } catch (error) {
        problems.push(problem(`The default ${JSON.stringify(value)} could not be checked: ${(error as Error).message}`, placeOf(files, path, source, file, [...segments, "default"])));
        continue;
      }
      const reasons = [...new Set((errors ?? []).map((error) => `${error.instancePath ? `${error.instancePath} ` : ""}${error.message ?? "is not valid"}`))];
      problems.push(problem(`The default ${JSON.stringify(value)} does not pass its own schema: ${reasons.join(", ")}.`, placeOf(files, path, source, file, [...segments, "default"])));
    }
  }
  return problems;
}

// ---- types --------------------------------------------------------------------------------------

/**
 * The types a namespace gives a root or a definition declared as `name`: `output`, a re-export of the
 * declaration, so a hover prints a reference to it inside itself as `Comment.output`, and `input`, the
 * values `.validate()` accepts: the declaration `inputName` where it is typed apart, re-exported, and
 * otherwise an alias of `name`, which a hover does not print for that reference, as a second
 * re-export of `name` could.
 */
const typeMembers = (name: string, inputName?: string): string => (inputName ? `export type { ${name} as ${OUTPUT}, ${inputName} as ${INPUT} };` : `export type { ${name} as ${OUTPUT} }; export type ${INPUT} = ${name};`);

/** A list of keys as a union of string literal types, `never` for none. */
const keyUnion = (keys: readonly string[]): string => (keys.length ? keys.map((key) => JSON.stringify(key)).join(" | ") : "never");

/**
 * The module's types. They import the `Schema` type from `dotschema`, the package the project
 * installed, which the type check resolves from the schema's directory. A `$ref` to another schema
 * file is a type imported from that file's module, which TypeScript sends through the mapper in turn.
 * Each definition is a validator too, exported under its value name with its own `.output` and
 * `.input`; a root or a definition that is a plain object is an `ObjectSchema`, with `.pick()` and
 * `.omit()`. The problems are the build's (`check`), so a schema that would fail to build fails here.
 */
export function schemaTypes(source: string, path: string, options?: TypeOptions): { types: string; problems: Problem[] } {
  const parsed = parseSchemaFile(source);
  if (!parsed.ok) return { types: FAILED_TYPES, problems: parsed.problems };
  const schema = parsed.value;
  const draft = draftOf(schema);
  const files = filesOf(source, path, schema);
  const entries = moduleEntries(files, path);
  const { problems } = check(files, path, source, true, entries);
  // The types read each `$ref` as a pointer from its file's root, resolved against the `$id`s above it (refs.ts).
  const resolved = resolvedSchemas(files);
  const { declarations, rootName, inputRootName, rootType, rootInputType, rootDoc, definitions } = schemaModuleTypes(resolved.get(path)!, { path, read: (other) => resolved.get(other) }, draft, options);
  // The input type after the type, where the two differ (`Schema<T, S, I = T>`), written out as the
  // type is, so a hover over a value `.is()` narrows prints its properties too.
  const typeOf = (entry: ModuleEntry, type: string, literalType: string, input: string | undefined) =>
    entry.shape ? `__DotschemaObjectSchema<${type}, ${literalType}, ${keyUnion(entry.shape.keys)}${input ? `, ${input}` : ""}>` : `__DotschemaSchema<${type}, ${literalType}${input ? `, ${input}` : ""}>`;
  const [rootEntry, ...definitionEntries] = entries;
  const definitionLines = definitionEntries.map((entry) => {
    const definition = definitions.find((d) => d.keyword === entry.entry![0] && d.key === entry.entry![1])!;
    return [
      `${definition.doc}export declare const ${definition.valueName}: ${typeOf(entry, definition.type, `${LITERAL_NAME}[${JSON.stringify(definition.keyword)}][${JSON.stringify(definition.key)}]`, definition.inputType === definition.type ? undefined : definition.inputType)};`,
      `${definition.doc}export declare namespace ${definition.valueName} { ${typeMembers(definition.typeName, definition.inputType === definition.type ? undefined : definition.inputTypeName)} }`,
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
      `${rootDoc}declare const schema: ${typeOf(rootEntry!, rootType, LITERAL_NAME, rootInputType === rootType ? undefined : rootInputType)};`,
      // A namespace of types alone, which merges with the const, so the default import names the
      // types too: `user.output` and `user.input` (the maintainer, on 2026-10-29: "it shoudl be
      // `Comment.output` and `Comment.input` like arktype. seems cleaner.").
      `${rootDoc}declare namespace schema { ${typeMembers(rootName, rootInputType === rootType ? undefined : inputRootName)} }`,
      "export default schema;",
      // Each definition's validator, named for its key in camelCase, with its types as `.output`
      // and `.input` (the maintainer's pick of 2026-10-26: "import { address } from
      // "./user.schema.jsonc", with address.validate() and address.is()").
      ...definitionLines,
      "",
    ].join("\n"),
    problems,
  };
}

// ---- code ---------------------------------------------------------------------------------------

/** The run time a module imports for each way of running its validators (settings.ts): `aot`'s checks are in the module, linked by the interpreter's entry. */
const RUNTIME: Record<NonNullable<LoadOptions["validators"]>, string> = { jit: "dotschema/runtime", interpret: "dotschema/runtime/interpret", aot: "dotschema/runtime/interpret" };

/** A format file's name as the binding a module imports it under: `date-time` is `__dateTime`. */
const formatBinding = (file: string) => `__${file.replace(/-(\w)/g, (_, c: string) => c.toUpperCase()).replace(/[^\w$]/g, "_")}`;

/**
 * An entry's documents for Standard JSON Schema as the function of `s`, the engine's root resource
 * (src/runtime/make.ts), that the module writes: each object or array of them that is one of `root`,
 * the schema `s` holds, or one with a `$schema` put before its keys, is read from `s`, so a module
 * holds the schema once where a conversion leaves it as it was.
 */
function documentsJs(docs: Value, root: Value): string {
  const parts = new Map<string, string>();
  const index = (value: Value, at: string) => {
    if (value === null || typeof value !== "object" || value instanceof Date) return;
    const text = toJs(value);
    if (!parts.has(text)) parts.set(text, at);
    if (Array.isArray(value)) value.forEach((item: Value, i: number) => index(item, `${at}[${i}]`));
    else for (const key of Object.keys(value)) index((value as Record<string, Value>)[key]!, `${at}[${JSON.stringify(key)}]`);
  };
  index(root, "s");
  const js = (value: Value): string => {
    if (value === null || typeof value !== "object" || value instanceof Date) return toJs(value);
    const text = toJs(value);
    const at = parts.get(text);
    if (at !== undefined && at.length < text.length) return at;
    if (Array.isArray(value)) return `[${value.map(js).join(", ")}]`;
    const object = value as Record<string, Value>;
    const [first, ...rest] = Object.keys(object);
    const under = first === "$schema" ? parts.get(toJs(Object.fromEntries(rest.map((key) => [key, object[key]!])))) : undefined;
    if (under !== undefined) return `{"$schema": ${toJs(object["$schema"]!)}, ...${under}}`;
    return `{${Object.keys(object).map((name) => `${name === "__proto__" ? `["__proto__"]` : JSON.stringify(name)}: ${js(object[name]!)}`).join(", ")}}`;
  };
  return `(s) => (${js(docs)})`;
}

/** A check the engine's generator writes for a validator, as the factory expression `link` takes (src/engine/generate.ts). */
const factoryOf = (engine: Engine, uri: string): string => generate(engine.validator(uri || undefined)).source;

/**
 * The module's JavaScript, with problems in place of a validator that cannot be built, which a
 * bundler or the preload reports as a load error. `watchFiles` are the other schema files the
 * module was made from, for a bundler to rebuild the module when one changes. `validators` is how the
 * project being built runs its validators (settings.ts): the run time the module imports, and with
 * `aot` the checks written into it. `discriminators: false` compiles each oneOf as written, for the
 * test that compares the two.
 *
 * The default export is the root's; each definition's validator is a named export, made by a call
 * marked pure, so a bundler leaves out the definitions nothing imports, and the root where only a
 * definition is imported. The module imports only what it uses: the entry of the run time, the parts
 * of the value `.validate()` gives that its plan needs, and the file of each format it checks with a
 * function, which every module of a bundle that uses it shares. It holds no path of the machine that
 * built it: each file is a resource under an id of its own (refs.ts).
 */
export function schemaCode(source: string, path: string, { discriminators = true, validators = "jit" }: LoadOptions & { discriminators?: boolean } = {}): { code: string; problems: Problem[]; watchFiles: string[] } {
  const failed = (problems: Problem[], watchFiles: string[] = []) => ({ code: "export default undefined;\n", problems, watchFiles });
  const parsed = parseSchemaFile(source);
  if (!parsed.ok) return failed(parsed.problems);
  const files = filesOf(source, path, parsed.value);
  const { problems, checked } = check(files, path, source, discriminators, moduleEntries(files, path));
  if (!checked) return failed(problems, files.watched);
  const { entries, prepared, engine, plan } = checked;
  const aot = validators === "aot";
  let body: string[];
  try {
    const [root, ...definitions] = entries as [ModuleEntry, ...ModuleEntry[]];
    // The plan where something fills or transforms, or where a schema lists a key, which `.validate()`
    // drops where it holds `undefined` or, in an open object, where no schema lists it; otherwise the
    // value `.validate()` gives is the value checked, and the module leaves the plan out.
    const drops = plan.nodes.some((node) => node.p?.length || node.r?.length);
    const output = plan.roots.some((node) => node !== null) && (plan.pre || drops);
    const parts = output ? runtimeParts(plan) : undefined;
    // `post` where a schema lists a key or says what the others are; `postOne` where each object stands alone.
    const flat = parts !== undefined && !parts.pre && !parts.m && !parts.u && !parts.c && !parts.e && !parts.q && !parts.a && !parts.items && !parts.nested;
    const imports = ["schemaModule", ...(plan.pre ? ["pre"] : []), ...(output && drops ? [flat ? "postOne" : "post"] : [])];
    // The formats, each a literal or the import of its file, by the names the schemas use.
    const files = new Map<string, string>();
    const formats = prepared.formats.map((name) => {
      const kind = formatKind(name);
      const file = formatModule(name);
      if (file) {
        if (!files.has(file)) files.set(file, formatBinding(file));
        return `${JSON.stringify(name)}: ${files.get(file)}`;
      }
      return `${JSON.stringify(name)}: ${kind instanceof RegExp ? String(kind) : "true"}`;
    });
    // The root resource is the schema as written where the engine reads it unchanged, so the module holds it once.
    const [first, ...rest] = prepared.resources;
    const { $id: _id, ...unnamed } = first!.schema as Record<string, Value>;
    const asWritten = isObj(parsed.value) && JSON.stringify(parsed.value["$id"] === undefined ? unnamed : first!.schema) === JSON.stringify(parsed.value);
    const resources = [`[${JSON.stringify(first!.id)}, ${asWritten ? "__schema" : toJs(first!.schema)}]`, ...rest.map(({ id, schema }) => `[${JSON.stringify(id)}, ${toJs(schema)}]`)];
    // The schema the engine's root resource holds, which the documents read from.
    const held = asWritten ? parsed.value : first!.schema;
    // The checks `pre` chooses a member of a union, or `then` or `else`, with.
    const tests = plan.pre ? plan.tests.map((test) => testUri(prepared, path, test)) : [];
    const options = [
      ...(prepared.discriminator ? ["discriminator: true"] : []),
      ...(output ? [`nodes: ${toJs(plan.nodes as unknown as Value)}`] : []),
      ...(tests.length ? [`tests: ${JSON.stringify(tests)}`] : []),
      ...(aot && tests.length ? [`checks: [${tests.map((uri) => factoryOf(engine, uri)).join(", ")}]`] : []),
      ...(plan.pre ? ["pre"] : []),
      ...(output && drops ? [flat ? "post: postOne" : "post"] : []),
    ];
    /** An entry's call: its URI, its schema as written, its documents and what else it is. */
    const call = (entry: ModuleEntry, i: number, schema: string, docs: string) => {
      const extra = [...(entry.shape ? ["object: true"] : []), ...(output && plan.roots[i] !== null ? [`node: ${plan.roots[i]}`] : []), ...(aot ? [`check: ${factoryOf(engine, entryUri(entry))}`] : [])];
      return `/* @__PURE__ */ __entry(${JSON.stringify(entryUri(entry))}, ${schema}, ${docs}${extra.length ? `, { ${extra.join(", ")} }` : ""})`;
    };
    body = [
      `import { ${imports.join(", ")} } from "${RUNTIME[validators]}";`,
      ...[...files].map(([file, binding]) => `import ${binding} from "dotschema/formats/${file}";`),
      `const __schema = ${toJs(parsed.value)};`,
      `const __entry = /* @__PURE__ */ schemaModule(${JSON.stringify(prepared.draft)}, [${resources.join(", ")}], { ${formats.join(", ")} }${options.length ? `, { ${options.join(", ")} }` : ""});`,
      `const schema = ${call(root, 0, "__schema", documentsJs(root.docs as unknown as Value, held))};`,
      "export default schema;",
      // A definition's schema is read from the root's inside a function, so that the call a bundler
      // sees takes no argument it cannot drop: esbuild keeps a pure call whose arguments read a property.
      ...definitions.map((entry, i) => `export const ${entry.name} = /* @__PURE__ */ (() => ${call(entry, i + 1, `__schema[${JSON.stringify(entry.entry![0])}][${JSON.stringify(entry.entry![1])}]`, documentsJs(entry.docs as unknown as Value, held))})();`),
    ];
  } catch (error) {
    return failed([problem((error as Error).message)], files.watched);
  }
  return { code: [...body, ""].join("\n"), problems: [], watchFiles: files.watched };
}
