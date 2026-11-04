// A schema checked against its draft's meta-schema with the engine, as dotschema's build checks each
// schema file (ajv checks one against the meta-schema its `$schema` names before it compiles it).
// Only the build reads this module, so the meta-schemas stay out of the run-time entry (../index.ts),
// which never imports it.
//
//   checkSchema(schema);  // null, or the errors ajv's `validateSchema` gives, in the engine's shape
//
// A `format` in a meta-schema checks nothing, as in ajv, which compiles its meta-schemas with
// `validateFormats` off (its constructor sets it so while it adds them, and `_metaOpts` keeps it):
// `{ "pattern": "(" }` passes ajv's draft-07 meta-schema whatever formats it has. `errorMessage`, a
// keyword ajv-errors defines, is checked against ajv-errors' own meta-schema wherever a schema writes
// it, as ajv checks a keyword's `metaSchema` when it compiles the schema.
import { compile, type Draft, type Engine, type EngineError, type ResourceInput } from "../index.ts";
import draft06 from "./draft-06.ts";
import draft07 from "./draft-07.ts";
import draft2019 from "./2019-09.ts";
import draft2020 from "./2020-12.ts";

/** The meta-schema a schema is checked against: draft-06's is its own, though the engine reads a draft-06 schema as draft-07. */
export type MetaDraft = "draft-06" | "draft-07" | "2019-09" | "2020-12";

const META: Record<MetaDraft, { draft: Draft; schemas: Record<string, unknown>[] }> = {
  "draft-06": { draft: "draft-07", schemas: draft06 },
  "draft-07": { draft: "draft-07", schemas: draft07 },
  "2019-09": { draft: "2019-09", schemas: draft2019 },
  "2020-12": { draft: "2020-12", schemas: draft2020 },
};

/** The meta-schema a schema's `$schema` names, as dotschema reads it (src/schema.ts's `ajvEntry`): draft-07 for none, undefined for a draft dotschema does not read. */
export function metaDraftOf(schema: unknown): MetaDraft | undefined {
  const declared = typeof schema === "object" && schema !== null && !Array.isArray(schema) ? (schema as Record<string, unknown>)["$schema"] : undefined;
  if (declared === undefined || typeof declared !== "string") return "draft-07";
  if (declared.includes("2020-12")) return "2020-12";
  if (declared.includes("2019-09")) return "2019-09";
  if (declared.includes("draft-06")) return "draft-06";
  if (declared.includes("draft-07")) return "draft-07";
  return undefined;
}

/** The meta-schema and its vocabularies as resources for `compile`, each under its own `$id`. */
export function metaResources(meta: MetaDraft): ResourceInput[] {
  return META[meta].schemas.map((schema) => ({ id: String(schema["$id"]).replace(/#$/, ""), schema }));
}

/** ajv-errors 3.0.0's meta-schema for the value of `errorMessage` (src/keywords/error-message.cjs). */
const ERROR_MESSAGE: Record<string, unknown> = {
  $id: "dotschema:meta/error-message",
  anyOf: [
    { type: "string" },
    {
      type: "object",
      properties: {
        properties: { $ref: "#/$defs/stringMap" },
        items: { $ref: "#/$defs/stringList" },
        required: { $ref: "#/$defs/stringOrMap" },
        dependencies: { $ref: "#/$defs/stringOrMap" },
      },
      additionalProperties: { type: "string" },
    },
  ],
  $defs: {
    stringMap: { type: "object", additionalProperties: { type: "string" } },
    stringOrMap: { anyOf: [{ type: "string" }, { $ref: "#/$defs/stringMap" }] },
    stringList: { type: "array", items: { type: "string" } },
  },
};

const engines = new Map<MetaDraft, Engine>();

function engineFor(meta: MetaDraft): Engine {
  let engine = engines.get(meta);
  if (!engine) engines.set(meta, (engine = compile([...metaResources(meta), { id: "dotschema:meta/error-message", schema: ERROR_MESSAGE }], { draft: META[meta].draft })));
  return engine;
}

const SUBSCHEMA_ONE = ["additionalProperties", "unevaluatedProperties", "items", "additionalItems", "unevaluatedItems", "contains", "propertyNames", "not", "if", "then", "else", "contentSchema"];
const SUBSCHEMA_LIST = ["allOf", "anyOf", "oneOf", "prefixItems", "items"];
const SUBSCHEMA_MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"];

/** Each `errorMessage` value in a schema and the subschemas it holds, with the JSON Pointer of its schema. */
function errorMessages(schema: unknown, at = ""): [string, unknown][] {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return [];
  const s = schema as Record<string, unknown>;
  const found: [string, unknown][] = s["errorMessage"] !== undefined ? [[at, s["errorMessage"]]] : [];
  const escape = (key: string) => key.replace(/~/g, "~0").replace(/\//g, "~1");
  for (const key of SUBSCHEMA_ONE) if (s[key] !== undefined && !Array.isArray(s[key])) found.push(...errorMessages(s[key], `${at}/${key}`));
  for (const key of SUBSCHEMA_LIST) if (Array.isArray(s[key])) (s[key] as unknown[]).forEach((item, i) => found.push(...errorMessages(item, `${at}/${key}/${i}`)));
  for (const key of SUBSCHEMA_MAP) {
    const map = s[key];
    if (typeof map === "object" && map !== null && !Array.isArray(map)) for (const [name, item] of Object.entries(map)) if (!Array.isArray(item)) found.push(...errorMessages(item, `${at}/${key}/${escape(name)}`));
  }
  return found;
}

/**
 * The errors of `schema` against the meta-schema its `$schema` names (or `meta`), as ajv's
 * `validateSchema` gives them; then those of each `errorMessage` value against ajv-errors'
 * meta-schema, each `instancePath` from the schema's root. Null when the schema is valid. Throws for
 * a `$schema` dotschema does not read.
 */
export function checkSchema(schema: unknown, options: { meta?: MetaDraft } = {}): EngineError[] | null {
  const meta = options.meta ?? metaDraftOf(schema);
  if (!meta) throw new Error(`dotschema reads JSON Schema drafts 06, 07, 2019-09 and 2020-12; this schema declares ${String((schema as Record<string, unknown>)["$schema"])}.`);
  const engine = engineFor(meta);
  const errors = engine.validator().errors(schema) ?? [];
  const messages = engine.validator("dotschema:meta/error-message");
  for (const [at, value] of errorMessages(schema)) {
    const found = messages.errors(value);
    if (found) for (const error of found) errors.push({ ...error, instancePath: `${at}/errorMessage${error.instancePath}` });
  }
  return errors.length ? errors : null;
}
