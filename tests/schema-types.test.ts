// dotschema's JSON Schema to TypeScript emitter: each rule on a small schema, and every emitted
// declaration through tsc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaCode } from "../src/schema.ts";
import { parseJsoncFile } from "../src/parse.ts";
import { schemaDeclarations, type Draft } from "../src/schema-types.ts";
import { evaluate, run, TSC } from "./helpers.ts";

const emit = (schema: unknown) => schemaDeclarations(schema as never);

test("an object root is an interface: required keys, optional keys, and no index signature when closed", () => {
  assert.equal(
    emit({ title: "User", type: "object", properties: { name: { type: "string", minLength: 1 }, "e-mail": { type: "string", format: "email" } }, required: ["name", "id"], additionalProperties: false }),
    'export interface Type {\n  name: string;\n  "e-mail"?: string | undefined;\n  id: never;\n}',
  );
});

test("an optional key is `| undefined` only under exactOptionalPropertyTypes, or where the project's options are not known: without it, the `?` already admits undefined", () => {
  const schema = { type: "object", properties: { a: { type: "number" } }, additionalProperties: { type: "string" } } as never;
  assert.equal(schemaDeclarations(schema, undefined, undefined, { exactOptionalPropertyTypes: false }), "export interface Type {\n  a?: number;\n  [key: string]: string | number | undefined;\n}");
  assert.equal(schemaDeclarations(schema, undefined, undefined, { exactOptionalPropertyTypes: true }), "export interface Type {\n  a?: number | undefined;\n  [key: string]: string | number | undefined;\n}");
  assert.equal(schemaDeclarations(schema), "export interface Type {\n  a?: number | undefined;\n  [key: string]: string | number | undefined;\n}");
});

test("keys outside `properties` are an index signature that covers the named ones", () => {
  assert.equal(emit({ type: "object", properties: { a: { type: "number" } } }), "export interface Type {\n  a?: number | undefined;\n  [key: string]: unknown;\n}");
  assert.equal(emit({ type: "object", properties: { a: { type: "number" } }, additionalProperties: { type: "string" } }), "export interface Type {\n  a?: number | undefined;\n  [key: string]: string | number | undefined;\n}");
  assert.equal(emit({ type: "object", patternProperties: { "^x-": { type: "number" } }, additionalProperties: false }), "export interface Type {\n  [key: string]: number;\n}");
  assert.equal(emit({ type: "object", properties: { a: { type: "null" } }, unevaluatedProperties: false }), "export interface Type {\n  a?: null | undefined;\n}");
  assert.equal(emit({ type: "object", additionalProperties: false }), "export interface Type {\n  [key: string]: never;\n}");
});

test("arrays and tuples, in 2020-12's spelling and draft-07's", () => {
  assert.equal(emit({ type: "array", items: { type: ["string", "number"] } }), "export type Type = (string | number)[];");
  assert.equal(emit({ type: "array" }), "export type Type = unknown[];");
  assert.equal(emit({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }], minItems: 1, items: false }), "export type Type = [string, number?];");
  assert.equal(emit({ type: "array", prefixItems: [{ type: "string" }], minItems: 1, items: { type: "boolean" } }), "export type Type = [string, ...boolean[]];");
  assert.equal(emit({ type: "array", items: [{ type: "string" }, { type: "integer" }], additionalItems: false, minItems: 2 }), "export type Type = [string, number];");
  assert.equal(emit({ type: "array", items: [{ type: "string" }] }), "export type Type = [string?, ...unknown[]];");
  // An optional element of a union is parenthesized, or `?` is a syntax error (TS17019).
  assert.equal(emit({ type: "array", prefixItems: [{ type: "string" }, { type: ["string", "null"] }], minItems: 1, items: false }), "export type Type = [string, (string | null)?];");
  assert.equal(emit({ type: "array", items: [{ enum: ["a", "b"] }] }), 'export type Type = [("a" | "b")?, ...unknown[]];');
});

test("const, enum, combinators, and the keywords that only narrow", () => {
  assert.equal(emit({ enum: ["a", 1, true, null] }), 'export type Type = "a" | 1 | true | null;');
  assert.equal(emit({ const: { a: [1] } }), "export interface Type { readonly a: readonly [1] }");
  assert.equal(emit({ anyOf: [{ type: "string" }, { oneOf: [{ type: "number" }, { type: "null" }] }] }), "export type Type = string | number | null;");
  assert.equal(emit({ type: "object", required: ["a"], allOf: [{ properties: { a: { type: "string" } } }] }), "export type Type = {\n  a: unknown;\n  [key: string]: unknown;\n} & {\n  a?: string | undefined;\n  [key: string]: unknown;\n};");
  assert.equal(emit({ type: "string", not: { const: "" }, if: { minLength: 2 }, then: { pattern: "^a" } }), "export type Type = string;");
  assert.equal(emit({ anyOf: [{ type: "string" }, true] }), "export type Type = unknown;");
  assert.equal(emit({ type: "string", allOf: [false] }), "export type Type = never;");
  assert.equal(emit({}), "export type Type = unknown;");
  // Without `type`, the object keywords constrain an object alone, and every other JSON value passes them.
  assert.equal(emit({ properties: { a: { type: "string" } }, additionalProperties: false }), "export type Type = {\n  a?: string | undefined;\n} | unknown[] | string | number | boolean | null;");
  assert.equal(emit({ items: { type: "string" } }), "export type Type = string[] | {\n  [key: string]: unknown;\n} | string | number | boolean | null;");
  // A member of `allOf`, `anyOf` or `oneOf` is read within its schema's own types, and `$ref`, `const` and `enum` tell them too.
  assert.equal(emit({ type: "object", allOf: [{ properties: { a: { type: "string" } } }] }), "export type Type = {\n  [key: string]: unknown;\n} & {\n  a?: string | undefined;\n  [key: string]: unknown;\n};");
  assert.equal(emit({ $ref: "#/$defs/a", properties: { b: { type: "number" } }, $defs: { a: { type: "object" } } }).split("\n\n")[0], "export type Type = A & {\n  b?: number | undefined;\n  [key: string]: unknown;\n};");
  assert.equal(emit({ anyOf: [{ type: "string" }, { const: 1 }], properties: { a: {} } }), "export type Type = string | 1;");
  assert.equal(emit({ type: "string", allOf: [{ properties: { a: {} } }] }), "export type Type = string;");
  // OpenAPI 3.0's `nullable` is no JSON Schema keyword: not read, and taken out of what ajv compiles.
  assert.equal(emit({ type: "string", nullable: true }), "export type Type = string;");
});

test("a `not` whose schema accepts every value, and an empty enum, are never; every other `not` leaves the type as it is", async () => {
  // The maintainer, 2026-10-27: "never should include { not: {} }".
  assert.equal(emit({ not: {} }), "export type Type = never;");
  assert.equal(emit({ not: true }), "export type Type = never;");
  assert.equal(emit({ not: { title: "Anything", $comment: "c" } }), "export type Type = never;");
  assert.equal(emit({ type: "object", properties: { a: { not: {} }, b: { type: "string" } } }), "export interface Type {\n  a?: undefined;\n  b?: string | undefined;\n  [key: string]: unknown;\n}");
  assert.equal(emit({ anyOf: [{ type: "string" }, { not: {} }] }), "export type Type = string;");
  assert.equal(emit({ not: { type: "string" } }), "export type Type = unknown;");
  assert.equal(emit({ not: false }), "export type Type = unknown;");
  assert.equal(emit({ type: "string", not: { "x-vendor": 1 } }), "export type Type = string;");
  // 2019-09 and 2020-12 allow an empty enum, which ajv refused until 2026-10-27; it accepts no value.
  assert.equal(schemaDeclarations({ enum: [] } as never, undefined, "2020-12"), "export type Type = never;");
  const S = "https://json-schema.org/draft/2020-12/schema";
  const counts = await agrees([
    { schema: { $schema: S, type: "object", properties: { a: { not: {} }, b: { enum: [] }, c: { not: true } } }, samples: [{}, { a: 1 }, { b: null }, { c: "" }, { d: 1 }] },
    { schema: { not: {} }, samples: [null, 0, "", [], {}] },
    { schema: { $schema: "https://json-schema.org/draft/2019-09/schema", enum: [] }, samples: [null, 0, "", [], {}] },
  ]);
  assert.deepEqual(counts, [2, 0, 0]);
});

test("an optional property named for a member of TypeScript's Object admits that member's type, which a value without its own has", async () => {
  // TypeScript gives `{}` Object's `toString` and `constructor`, so `{}` was not assignable to `toString?: { length?: string }` (TS2322),
  // though the validator, which reads the value's own properties, accepts it (the Test Suite's properties.json [5]).
  const schema = { type: "object", properties: { toString: { type: "object", properties: { length: { type: "string" } } }, constructor: { type: "number" }, valueOf: { type: "string" } }, required: ["valueOf"] };
  assert.equal(
    emit(schema),
    'export interface Type {\n  toString?: {\n    length?: string | undefined;\n    [key: string]: unknown;\n  } | globalThis.Object["toString"] | undefined;\n  constructor?: number | globalThis.Object["constructor"] | undefined;\n  valueOf: string;\n  [key: string]: unknown;\n}',
  );
  const counts = await agrees([
    {
      schema,
      samples: [{ valueOf: "v" }, { valueOf: "v", toString: { length: "x" }, constructor: 1 }, { valueOf: "v", toString: { length: 1 } }, {}],
      // A definition named `object` is `Object`, which the global's members are not read from.
      use: "type Object = { shadow: true };\n// @ts-expect-error: a number is not a toString\nexport const n: Type = { valueOf: \"v\", toString: 1 };",
    },
  ]);
  assert.deepEqual(counts, [2]);
});

test("with a draft, a keyword is read only in the drafts that have it, as ajv reads it", () => {
  const tuple = { type: "array", prefixItems: [{ type: "string" }], items: [{ type: "number" }], additionalItems: false };
  assert.equal(schemaDeclarations(tuple as never, undefined, "2020-12"), "export type Type = [string?, ...unknown[]];");
  assert.equal(schemaDeclarations(tuple as never, undefined, "2019-09"), "export type Type = [number?];");
  assert.equal(schemaDeclarations(tuple as never, undefined, "draft-07"), "export type Type = [number?];");
  const closed = { type: "object", properties: { a: { type: "string" } }, unevaluatedProperties: false };
  assert.equal(schemaDeclarations(closed as never, undefined, "2019-09"), "export interface Type {\n  a?: string | undefined;\n}");
  assert.equal(schemaDeclarations(closed as never, undefined, "draft-07"), "export interface Type {\n  a?: string | undefined;\n  [key: string]: unknown;\n}");
  // Without `type`, only a keyword the draft reads makes an array.
  assert.equal(schemaDeclarations({ type: "array", prefixItems: [{ type: "string" }] }, undefined, "2020-12"), "export type Type = [string?, ...unknown[]];");
  assert.equal(schemaDeclarations({ prefixItems: [{ type: "string" }] }, undefined, "2020-12"), "export type Type = [string?, ...unknown[]] | {\n  [key: string]: unknown;\n} | string | number | boolean | null;");
  assert.equal(schemaDeclarations({ prefixItems: [{ type: "string" }] }, undefined, "2019-09"), "export type Type = unknown;");
  assert.equal(schemaDeclarations({ additionalItems: { type: "string" } }, undefined, "2020-12"), "export type Type = unknown;");
});

test("a oneOf of objects told apart by a `const` is a union TypeScript narrows", () => {
  assert.equal(
    emit({ oneOf: [{ type: "object", properties: { kind: { const: "circle" }, r: { type: "number" } }, required: ["kind", "r"], additionalProperties: false }, { type: "object", properties: { kind: { const: "square" }, side: { type: "number" } }, required: ["kind", "side"], additionalProperties: false }] }),
    'export type Type = {\n  kind: "circle";\n  r: number;\n} | {\n  kind: "square";\n  side: number;\n};',
  );
});

test("each definition is a named type, and a reference to it is its name", () => {
  const schema = {
    $ref: "#/$defs/node",
    $defs: { node: { type: "object", properties: { value: { type: "number" }, children: { type: "array", items: { $ref: "#/$defs/node" } }, tag: { $ref: "#/definitions/my-tag" }, slash: { $ref: "#/$defs/a~1b" } }, additionalProperties: false }, "a/b": { type: "string" }, Type: { type: "boolean" }, "1st": { type: "null" } },
    definitions: { "my-tag": { type: "string" } },
  };
  assert.equal(
    emit(schema),
    [
      "export type Type = Node;",
      "export interface Node {\n  value?: number | undefined;\n  children?: Node[] | undefined;\n  tag?: MyTag | undefined;\n  slash?: AB | undefined;\n}",
      "export type AB = string;",
      "export type Type2 = boolean;",
      "export type _1st = null;",
      "export type MyTag = string;",
    ].join("\n\n"),
  );
});

test("`#` is the root; another pointer is inlined, unless it leads back into itself; another file is unknown", () => {
  assert.equal(emit({ type: "object", properties: { next: { $ref: "#" } }, additionalProperties: false }), "export interface Type {\n  next?: Type | undefined;\n}");
  assert.equal(emit({ type: "object", properties: { a: { type: "string" }, b: { $ref: "#/properties/a" }, c: { $ref: "#/properties/c" }, d: { $ref: "./other.schema.jsonc" } }, additionalProperties: false }), "export interface Type {\n  a?: string | undefined;\n  b?: string | undefined;\n  c?: unknown;\n  d?: unknown;\n}");
});

test("an anchor is the schema that declares it: a definition by its name, anything else inlined, and finite when it recurses", () => {
  assert.equal(
    emit({ type: "object", properties: { a: { $ref: "#tag" }, b: { $ref: "#inner" }, c: { type: "object", properties: { d: { $anchor: "inner", type: "number" } } }, e: { $anchor: "self", type: "array", items: { $ref: "#self" } } }, additionalProperties: false, $defs: { tag: { $anchor: "tag", type: "string" } } }),
    "export interface Type {\n  a?: Tag | undefined;\n  b?: number | undefined;\n  c?: {\n    d?: number | undefined;\n    [key: string]: unknown;\n  } | undefined;\n  e?: unknown[][] | undefined;\n}\n\nexport type Tag = string;",
  );
});

test("a description is a doc comment", () => {
  assert.equal(emit({ type: "object", properties: { a: { type: "string", description: "One line." } }, additionalProperties: false }), "export interface Type {\n  /** One line. */\n  a?: string | undefined;\n}");
  assert.equal(emit({ type: "string", description: "Ends */ early.\nTwo lines." }), "/**\n * Ends *\\/ early.\n * Two lines.\n */\nexport type Type = string;");
});

/** The declarations of a schema parsed from its text, so its comments are read. */
function emitText(source: string): string {
  const parsed = parseJsoncFile(source);
  assert.ok(parsed.ok);
  return schemaDeclarations(parsed.value);
}

test("a /** */ comment before a property's key is its doc comment", () => {
  const jsonc = '{\n  "type": "object",\n  "properties": {\n    /** The user\'s name. */\n    "name": { "type": "string" },\n    "age": { "type": "integer" }\n  },\n  "additionalProperties": false\n}';
  assert.equal(emitText(jsonc), "export interface Type {\n  /** The user's name. */\n  name?: string | undefined;\n  age?: number | undefined;\n}");
  // A key that is no identifier, an escaped key, and strings that hold what reads like a comment or a key.
  const keys = '{\n  "type": "object",\n  "properties": {\n    /** Plain. */\n    "name": { "type": "string", "pattern": "/** no */" },\n    /** Dashed. */\n    "e-mail": { "type": "string" },\n    /** Escaped. */\n    "\\u0061ge": { "const": "a,{\\"}:" },\n  },\n  "additionalProperties": false,\n}';
  assert.equal(emitText(keys), 'export interface Type {\n  /** Plain. */\n  name?: string | undefined;\n  /** Dashed. */\n  "e-mail"?: string | undefined;\n  /** Escaped. */\n  age?: "a,{\\"}:" | undefined;\n}');
});

test("a doc comment is read as TypeScript reads JSDoc: each line's leading `*` dropped, tags kept", () => {
  const source = '{ "type": "object", "properties": {\n  /**\n   * When the user joined.\n   *\n   * @deprecated Use `created`.\n   * @example\n   *   "2026-10-26"\n   */\n  "joined": { "type": "string" } }, "additionalProperties": false }';
  assert.equal(emitText(source), 'export interface Type {\n  /**\n   * When the user joined.\n   *\n   * @deprecated Use `created`.\n   * @example\n   *   "2026-10-26"\n   */\n  joined?: string | undefined;\n}');
});

test("a description wins over a doc comment, and // and /* */ comments are never read", () => {
  const source = '{ "type": "object", "properties": {\n  /** Loses. */\n  "a": { "type": "string", "description": "Wins." },\n  // A note.\n  "b": { "type": "string" },\n  /* A note too. */\n  "c": { "type": "string" },\n  /**/ "d": { "type": "string" },\n  "e": /** Not before a key. */ { "type": "string" },\n  /** Before a comma, so not before "g". */ "f": {} /** Nor this. */, "g": {}\n}, "additionalProperties": false }';
  assert.equal(emitText(source), 'export interface Type {\n  /** Wins. */\n  a?: string | undefined;\n  b?: string | undefined;\n  c?: string | undefined;\n  d?: string | undefined;\n  e?: string | undefined;\n  /** Before a comma, so not before "g". */\n  f?: unknown;\n  g?: unknown;\n}');
});

test("a doc comment before a definition's key is the definition's, and one before the root is the root's", () => {
  const source = '/** A team. */\n{ "type": "object", "properties": { "lead": { "$ref": "#/$defs/person" }, "tags": { "type": "array", "items": { "type": "object", "properties": { /** In an array. */ "x": { "type": "string" } }, "additionalProperties": false } } }, "additionalProperties": false,\n  "$defs": {\n    /** A member of the team. */\n    "person": { "type": "string" }\n  }\n}';
  assert.equal(emitText(source), "/** A team. */\nexport interface Type {\n  lead?: Person | undefined;\n  tags?: {\n    /** In an array. */\n    x?: string | undefined;\n  }[] | undefined;\n}\n\n/** A member of the team. */\nexport type Person = string;");
  // Draft-07's `definitions`.
  assert.equal(emitText('{ "definitions": { /** An id. */ "id": { "type": "string" } }, "$ref": "#/definitions/id" }'), "export type Type = Id;\n\n/** An id. */\nexport type Id = string;");
});

test("readOnly is readonly, and deprecated, default and examples are tags of the doc comment, as JSON, after its text", () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "string", readOnly: true },
      email: { type: "string", description: "Where */ we write.", deprecated: true },
      role: { enum: ["admin", "member"], default: "member", examples: ["admin", "member"] },
      tags: { type: "array", items: { type: "string" }, default: [], examples: [["a", "*/"], { x: 1 }] },
      // `title` and `writeOnly` leave no trace.
      n: { type: "number", title: "N", writeOnly: true },
    },
    required: ["id"],
    additionalProperties: false,
  };
  assert.equal(
    emit(schema),
    'export interface Type {\n  readonly id: string;\n  /**\n   * Where *\\/ we write.\n   * @deprecated\n   */\n  email?: string | undefined;\n  /**\n   * @default "member"\n   * @example "admin"\n   * @example "member"\n   */\n  role?: "admin" | "member" | undefined;\n  /**\n   * @default []\n   * @example ["a", "*\\/"]\n   * @example { "x": 1 }\n   */\n  tags?: string[] | undefined;\n  n?: number | undefined;\n}',
  );
  // A comment that has the tag already keeps it once; a definition and the root take the tags too.
  assert.equal(emitText('{ "type": "object", "properties": { /** Old.\n * @deprecated Use b. */ "a": { "deprecated": true } }, "additionalProperties": false }'), "export interface Type {\n  /**\n   * Old.\n   * @deprecated Use b.\n   */\n  a?: unknown;\n}");
  assert.equal(emit({ $ref: "#/$defs/old", deprecated: true, $defs: { old: { type: "string", deprecated: true, default: "x" } } }), '/** @deprecated */\nexport type Type = Old;\n\n/**\n * @deprecated\n * @default "x"\n */\nexport type Old = string;');
});

test("every emitted declaration type-checks", () => {
  const schemas = [
    { type: "object", properties: { a: { type: "string" }, b: { type: "array", items: { $ref: "#/$defs/x" } } }, additionalProperties: { type: "number" }, $defs: { x: { anyOf: [{ type: "object", properties: { k: { const: "x" } }, required: ["k"] }, { enum: [1, 2] }] } } },
    // Parsed, so `__proto__` is a property, as it is in a schema file.
    JSON.parse('{"type": "object", "properties": {"0": {"type": "string"}, "a b": {"type": "number"}, "__proto__": {"type": "boolean"}}, "patternProperties": {"^x": {"type": "array", "prefixItems": [{"type": "string"}], "items": false}}}'),
    { type: ["object", "array", "null"], properties: { a: { type: "string" } }, items: { const: [1, 2] }, description: "*/ /*" },
    { $schema: "http://json-schema.org/draft-07/schema#", allOf: [{ $ref: "#/definitions/a" }, { properties: { b: { type: "integer" } } }], definitions: { a: { type: "object", properties: { a: { type: "string" } } } } },
  ];
  const dir = mkdtempSync(join(tmpdir(), "dotschema-schema-types-"));
  schemas.forEach((schema, i) => writeFileSync(join(dir, `s${i}.ts`), `${emit(JSON.parse(JSON.stringify(schema)))}\n`));
  // Doc comments, from a parsed file's `/**` comments.
  writeFileSync(join(dir, "docs.ts"), `${emitText('/** Root. */ { "type": "object", "properties": { /**\n * Two lines,\n * @deprecated and a tag. */ "a": { "type": "string" } }, "$defs": { /** A definition. */ "d": {} } }')}\n`);
  writeFileSync(join(dir, "annotations.ts"), `${emit({ type: "object", properties: { a: { readOnly: true, deprecated: true, default: { "*/": "*/" }, examples: [[1, "@x"], null] } } })}\nexport const t: Type = { a: 1 };\n`);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "nodenext" }, include: ["*.ts"] }));
  const { status, out } = run(TSC, ["-p", join(dir, "tsconfig.json")]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

/**
 * Each sample the validator accepts is assigned to the schema's type, and `use`, TypeScript run
 * against `Type`, must type-check: the type admits every value the validator accepts. A sample is
 * JSON, or JavaScript source text in `sources` for a value JSON cannot write (`undefined`).
 * `compilerOptions` are added to tsc's. Returns how many samples of each schema were accepted, so a
 * test can tell its samples are not all refused.
 */
async function agrees(cases: { schema: Record<string, unknown>; samples: unknown[]; sources?: string[]; use?: string }[], compilerOptions: Record<string, unknown> = {}): Promise<number[]> {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-agrees-"));
  const drafts: Record<string, Draft> = { "https://json-schema.org/draft/2020-12/schema": "2020-12", "https://json-schema.org/draft/2019-09/schema": "2019-09" };
  const counts: number[] = [];
  for (const [i, { schema, samples, sources, use = "" }] of cases.entries()) {
    const { code, problems } = schemaCode(JSON.stringify(schema), join(dir, `s${i}.schema.jsonc`));
    assert.deepEqual(problems, []);
    const { default: validator } = await evaluate(code);
    const texts = [...samples.map((sample) => JSON.stringify(sample)), ...(sources ?? [])];
    const accepted = texts.filter((text) => validator.is(new Function(`return (${text});`)()));
    counts.push(accepted.length);
    const types = schemaDeclarations(schema as never, undefined, drafts[schema["$schema"] as string] ?? "draft-07");
    writeFileSync(join(dir, `s${i}.ts`), [types, ...accepted.map((text, j) => `export const accepted${j}: Type = ${text};`), use, ""].join("\n"));
  }
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "esnext", module: "nodenext", types: [], ...compilerOptions }, include: ["*.ts"] }));
  const { status, out } = run(TSC, ["-p", join(dir, "tsconfig.json")]);
  assert.equal(out, "");
  assert.equal(status, 0);
  return counts;
}

test("if/then/else on a required property's listed values is a union TypeScript narrows", () => {
  const schema = {
    type: "object",
    properties: { kind: { enum: ["click", "visit"] }, at: { type: "string" } },
    required: ["kind", "at"],
    if: { properties: { kind: { const: "click" } } },
    then: { properties: { x: { type: "number" } }, required: ["x"] },
    else: { properties: { url: { type: "string" } }, required: ["url"] },
  };
  assert.equal(
    emit(schema),
    'export type Type = {\n  kind: "click" | "visit";\n  at: string;\n  [key: string]: unknown;\n} & (({ kind: "click" } & {\n  x: number;\n  [key: string]: unknown;\n}) | ({ kind: "visit" } & {\n  url: string;\n  [key: string]: unknown;\n}));',
  );
  // `allOf` members that hold a conditional each, an `enum` test, a `$ref` to the values, and a value no test names.
  const chain = {
    type: "object",
    properties: { kind: { $ref: "#/$defs/kind" } },
    required: ["kind"],
    allOf: [
      { if: { properties: { kind: { const: "click" } } }, then: { properties: { x: { type: "number" } }, required: ["x"] } },
      { if: { properties: { kind: { enum: ["visit", "leave"] } }, required: ["kind"] }, then: { properties: { url: { type: "string" } }, required: ["url"] } },
    ],
    $defs: { kind: { enum: ["click", "visit", "leave", "idle"] } },
  };
  assert.match(emit(chain), /\| \(\{ kind: "leave" \} & \{\n  url: string;\n  \[key: string\]: unknown;\n\}\) \| \{ kind: "idle" \}\);/);
  // A `then: false` leaves its value out; a test with `type` beside its values passes only those of that type.
  assert.equal(
    emit({ type: "object", properties: { n: { enum: [1, "1", 2] } }, required: ["n"], if: { properties: { n: { type: "string", enum: ["1", 2] } } }, then: false }),
    'export type Type = {\n  n: 1 | "1" | 2;\n  [key: string]: unknown;\n} & ({ n: 1 } | { n: 2 });',
  );
});

test("a conditional of another shape is not read: the type is as wide as without it", () => {
  const base = { type: "object", properties: { kind: { type: "string" } }, required: ["kind"] };
  const wide = emit(base);
  const then = { properties: { x: { type: "number" } }, required: ["x"] };
  // The property's values are not listed; it is not required; the `if` tests more than one value; another keyword sits in the test.
  assert.equal(emit({ ...base, if: { properties: { kind: { const: "click" } } }, then }), wide);
  assert.equal(emit({ type: "object", properties: { kind: { enum: ["a", "b"] } }, if: { properties: { kind: { const: "a" } } }, then }), emit({ type: "object", properties: { kind: { enum: ["a", "b"] } } }));
  const listed = { type: "object", properties: { kind: { enum: ["a", "b"] }, y: {} }, required: ["kind"] };
  assert.equal(emit({ ...listed, if: { properties: { kind: { const: "a" }, y: { const: 1 } } }, then }), emit(listed));
  assert.equal(emit({ ...listed, if: { properties: { kind: { const: "a", minLength: 1 } } }, then }), emit(listed));
  assert.equal(emit({ ...listed, if: { required: ["y"] }, then }), emit(listed));
});

test("the type admits every value the validator accepts, and narrows: conditionals, unevaluatedProperties, and schemas without type", async () => {
  const counts = await agrees([
    {
      schema: { type: "object", properties: { kind: { enum: ["click", "visit"] }, at: { type: "string" } }, required: ["kind", "at"], if: { properties: { kind: { const: "click" } } }, then: { properties: { x: { type: "number" } }, required: ["x"] }, else: { properties: { url: { type: "string" } }, required: ["url"] } },
      samples: [{ kind: "click", at: "t", x: 1 }, { kind: "visit", at: "t", url: "u" }, { kind: "click", at: "t", x: 1, url: "u" }, { kind: "visit", at: "t", url: "u", x: "any" }, { kind: "click", at: "t" }, { kind: "visit", at: "t", x: 1 }],
      use: [
        "declare const v: Type;",
        "if (v.kind === \"click\") v.x.toFixed(); else v.url.toUpperCase();",
        "// @ts-expect-error: `x` is a number only on a click",
        "v.x.toFixed();",
      ].join("\n"),
    },
    {
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { kind: { $ref: "#/$defs/kind" } },
        required: ["kind"],
        unevaluatedProperties: false,
        allOf: [
          { if: { properties: { kind: { const: "click" } } }, then: { properties: { x: { type: "number" } }, required: ["x"] } },
          { if: { properties: { kind: { enum: ["visit", "leave"] } }, required: ["kind"] }, then: { properties: { url: { type: "string" } }, required: ["url"] } },
        ],
        $defs: { kind: { enum: ["click", "visit", "leave", "idle"] } },
      },
      samples: [{ kind: "idle" }, { kind: "idle", x: 1 }, { kind: "click", x: 1 }, { kind: "leave", url: "u" }, { kind: "click", x: 1, url: "u" }, { kind: "visit" }],
      use: [
        "export function describe(v: Type): string {",
        "  switch (v.kind) {",
        "    case \"click\": return v.x.toFixed();",
        "    case \"visit\": case \"leave\": return v.url;",
        "    case \"idle\": return \"idle\";",
        "    default: { const none: never = v; return none; }",
        "  }",
        "}",
      ].join("\n"),
    },
    // `unevaluatedProperties: false` refuses no key that `allOf` allows, so the type has no `[key: string]: never`.
    { schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", allOf: [{ properties: { a: { type: "string" } } }], unevaluatedProperties: false }, samples: [{ a: "x" }, {}, { b: 1 }] },
    { schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", $ref: "#/$defs/a", unevaluatedProperties: false, $defs: { a: { properties: { a: { type: "string" } } } } }, samples: [{ a: "x" }, { b: 1 }] },
    // Without `type`, every value of another type than the keywords constrain passes them.
    { schema: { properties: { a: { type: "string" } }, required: ["a"] }, samples: [5, "x", null, [], { a: "s" }, {}, { a: 1 }] },
    { schema: { type: "object", properties: { address: { properties: { city: { type: "string" } } } } }, samples: [{ address: 5 }, { address: { city: "c" } }, { address: { city: 1 } }] },
    { schema: { type: ["object", "string"], allOf: [{ properties: { a: { type: "number" } } }] }, samples: ["s", { a: 1 }, { a: "x" }, 5] },
    {
      schema: { properties: { kind: { enum: ["a", "b"] } }, required: ["kind"], if: { properties: { kind: { const: "a" } } }, then: { properties: { x: { type: "number" } }, required: ["x"] } },
      samples: [5, { kind: "a", x: 1 }, { kind: "b" }, { kind: "a" }],
      use: ["declare const v: Type;", "if (typeof v === \"object\" && v !== null && !Array.isArray(v) && v.kind === \"a\") v.x.toFixed();"].join("\n"),
    },
    { schema: { items: { type: "string" } }, samples: [["a"], [1], 5, {}] },
  ]);
  assert.deepEqual(counts, [4, 3, 2, 1, 5, 2, 2, 3, 3]);
});

test("unevaluatedProperties closes an object whose keys allOf, a $ref, oneOf and a conditional evaluate, each part declaring its own", () => {
  // A `$ref` in place is inlined, without the index signature its name would bring.
  assert.equal(
    emit({ type: "object", properties: { at: { type: "string" } }, allOf: [{ $ref: "#/$defs/base" }], oneOf: [{ properties: { kind: { const: "a" }, x: { type: "number" } }, required: ["kind"] }, { properties: { kind: { const: "b" } }, required: ["kind"] }], unevaluatedProperties: false, $defs: { base: { properties: { id: { type: "string" } }, required: ["id"] } } }).split("\n\n")[0],
    'export type Type = {\n  at?: string | undefined;\n} & {\n  id: string;\n} & ({\n  kind: "a";\n  x?: number | undefined;\n} | {\n  kind: "b";\n});',
  );
  // A conditional the type reads closes each of its members to its own branch.
  assert.equal(
    emit({ type: "object", properties: { kind: { enum: ["a", "b"] } }, required: ["kind"], if: { properties: { kind: { const: "a" } } }, then: { properties: { x: { type: "number" } } }, else: { properties: { y: { type: "string" } } }, unevaluatedProperties: false }),
    'export type Type = {\n  kind: "a" | "b";\n} & (({ kind: "a" } & {\n  x?: number | undefined;\n}) | ({ kind: "b" } & {\n  y?: string | undefined;\n}));',
  );
  // As a schema, unevaluatedProperties is an index signature that holds every key, so every key's type is in it.
  assert.equal(emit({ type: "object", properties: { a: { type: "string" } }, allOf: [{ properties: { b: { type: "number" } } }], unevaluatedProperties: { type: "boolean" } }), "export type Type = {\n  a?: string | undefined;\n  [key: string]: boolean | string | number | undefined;\n} & {\n  b?: number | undefined;\n};");
  // With nothing beside it that evaluates a key, it is additionalProperties.
  assert.equal(emit({ type: "object", properties: { a: { type: "string" } }, unevaluatedProperties: { type: "boolean" } }), "export interface Type {\n  a?: string | undefined;\n  [key: string]: boolean | string | undefined;\n}");
});

test("the keys of anyOf's members and of the parts the type does not read are optional and unknown, since a value may hold them", () => {
  // A value can pass both members of `anyOf`, and hold `a` and `b`; `c` is evaluated where `a` is present.
  assert.equal(
    emit({ type: "object", anyOf: [{ properties: { a: { type: "string" } }, required: ["a"] }, { properties: { b: { type: "number" } }, required: ["b"] }], dependentSchemas: { a: { properties: { c: {} } } }, unevaluatedProperties: false }),
    "export type Type = {\n  a?: unknown;\n  b?: unknown;\n  c?: unknown;\n} & ({\n  a: string;\n} | {\n  b: number;\n});",
  );
  // ajv counts an `if`'s keys as evaluated beside an `else` alone, also where the `if` failed.
  assert.equal(emit({ type: "object", if: { properties: { foo: { const: "then" } }, required: ["foo"] }, else: { properties: { baz: { type: "string" } }, required: ["baz"] }, unevaluatedProperties: false }), "export interface Type {\n  foo?: unknown;\n  baz?: unknown;\n}");
});

test("where a part could let any key through, or a $ref is not followed, unevaluatedProperties leaves the object open", () => {
  const open = (schema: Record<string, unknown>) => assert.match(emit({ type: "object", ...schema, unevaluatedProperties: false }), /\[key: string\]: unknown;/, JSON.stringify(schema));
  // A member of anyOf that evaluates every key, when it passes; patternProperties in a part, whose index signature would hold every key; a URL and a dynamic reference.
  open({ anyOf: [{ properties: { a: {} }, additionalProperties: true }] });
  open({ allOf: [{ patternProperties: { "^x": { type: "number" } } }] });
  open({ allOf: [{ $ref: "https://example.com/a" }] });
  open({ $dynamicAnchor: "a", allOf: [{ $dynamicRef: "#a" }] });
  // An index signature of the object's own beside a key typed unknown, and a part that sets unevaluatedProperties to true.
  open({ patternProperties: { "^x": { type: "number" } }, dependentSchemas: { a: { properties: { c: {} } } } });
  open({ allOf: [{ unevaluatedProperties: true }] });
  // Draft-07 has no unevaluatedProperties.
  assert.match(schemaDeclarations({ type: "object", allOf: [{ properties: { a: {} } }], unevaluatedProperties: false }, undefined, "draft-07"), /\[key: string\]: unknown;/);
});

test("the type of an object closed under unevaluatedProperties admits every value the validator accepts, and refuses a key nothing evaluates", async () => {
  const D = "https://json-schema.org/draft/2020-12/schema";
  const refused = (key: string) => ["declare const v: Type;", "// @ts-expect-error: no part evaluates the key", `export const no: Type = { ...v, ${key}: 1 };`].join("\n");
  const counts = await agrees([
    { schema: { $schema: D, type: "object", properties: { a: { type: "string" } }, allOf: [{ properties: { b: { type: "number" } } }, { required: ["c"] }, { properties: { c: true } }], unevaluatedProperties: false }, samples: [{ c: 1 }, { a: "x", b: 1, c: 1 }, { c: 1, z: 1 }, {}], use: refused("z") },
    { schema: { $schema: D, $ref: "#/$defs/base", properties: { extra: { type: "number" } }, unevaluatedProperties: false, $defs: { base: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } } }, samples: [{ a: "x" }, { a: "x", extra: 1 }, { a: "x", z: 1 }], use: refused("z") },
    { schema: { $schema: D, type: "object", anyOf: [{ properties: { kind: { const: "a" }, x: { type: "number" } }, required: ["kind"] }, { properties: { y: { type: "number" } } }], unevaluatedProperties: false }, samples: [{ kind: "a", x: 1, y: 2 }, { y: 1 }, { kind: "b", x: 1 }, { kind: "a", z: 1 }], use: refused("z") },
    { schema: { $schema: D, type: "object", oneOf: [{ properties: { kind: { const: "a" }, x: { type: "number" } }, required: ["kind"] }, { properties: { kind: { const: "b" } }, required: ["kind"], additionalProperties: true }], unevaluatedProperties: false }, samples: [{ kind: "a", x: 1 }, { kind: "b", z: 1 }, { kind: "a", z: 1 }], use: ["declare const v: Type & { kind: \"a\" };", "// @ts-expect-error: only the member that passed evaluates its keys", "export const no: Type = { ...v, z: 1 };"].join("\n") },
    {
      schema: { $schema: D, type: "object", properties: { kind: { enum: ["a", "b"] } }, required: ["kind"], if: { properties: { kind: { const: "a" } } }, then: { properties: { x: { type: "number" } } }, unevaluatedProperties: false },
      samples: [{ kind: "a", x: 1 }, { kind: "b" }, { kind: "b", x: 1 }],
      use: ["declare const v: Type & { kind: \"b\" };", "// @ts-expect-error: `x` is evaluated only where the `if` passed", "export const no: Type = { ...v, x: 1 };"].join("\n"),
    },
    { schema: { $schema: D, if: { properties: { foo: { const: "then" } }, required: ["foo"] }, else: { properties: { baz: { type: "string" } }, required: ["baz"] }, unevaluatedProperties: false }, samples: [{ baz: "b" }, { foo: "else", baz: "b" }, { foo: "then" }, { foo: "then", bar: 1 }] },
    { schema: { $schema: D, type: "object", properties: { a: { type: "string" } }, dependentSchemas: { a: { properties: { b: { type: "number" } } } }, unevaluatedProperties: false }, samples: [{ a: "s", b: 1 }, { b: 1 }, { a: "s", z: 1 }], use: refused("z") },
    { schema: { $schema: D, type: "object", patternProperties: { "^x": { type: "number" } }, allOf: [{ properties: { b: { type: "boolean" } } }], unevaluatedProperties: { type: "string" } }, samples: [{ x1: 1, b: true, s: "s" }, { s: 1 }, { x1: "s" }] },
    { schema: { $schema: D, properties: { a: { type: "string" } }, allOf: [{ unevaluatedProperties: true }], unevaluatedProperties: false }, samples: [{ a: "s", z: 1 }, 5] },
  ]);
  assert.deepEqual(counts, [2, 2, 2, 2, 2, 2, 1, 1, 2]);
});

test("a required key that `properties` does not list takes the type of the patterns that match it, or of additionalProperties", async () => {
  // A key matching a pattern is not an additional property; one matching several takes each pattern's type.
  assert.equal(
    emit({ type: "object", required: ["total", "x-max", "xy"], patternProperties: { "^x-": { type: "integer" }, "^x": { type: "string" } }, additionalProperties: { type: "boolean" } }),
    "export interface Type {\n  total: boolean;\n  \"x-max\": number | string;\n  xy: string;\n  [key: string]: number | string | boolean;\n}",
  );
  // Closed, the key is allowed only by a pattern; with none, nothing passes, and the key is never.
  assert.equal(emit({ type: "object", required: ["a", "x1"], patternProperties: { "^x": { type: "number" } }, additionalProperties: false }), "export interface Type {\n  a: never;\n  x1: number;\n  [key: string]: number;\n}");
  assert.equal(emit({ type: "object", required: ["a"], unevaluatedProperties: false }), "export interface Type {\n  a: never;\n}");
  // Without additionalProperties, any value.
  assert.equal(emit({ type: "object", required: ["a"] }), "export interface Type {\n  a: unknown;\n  [key: string]: unknown;\n}");
  // A pattern this runtime cannot read may or may not match: both types.
  assert.equal(emit({ type: "object", required: ["a"], patternProperties: { "(?<": { type: "number" } }, additionalProperties: { type: "string" } }), "export interface Type {\n  a: number | string;\n  [key: string]: number | string;\n}");
  const counts = await agrees([
    { schema: { type: "object", required: ["a"], additionalProperties: { type: "number" } }, samples: [{ a: 1 }, { a: 1, b: 2 }, { a: "x" }, {}] },
    { schema: { type: "object", required: ["xa"], patternProperties: { "^x": { type: "number" } }, additionalProperties: false }, samples: [{ xa: 1 }, { xa: 1, xb: 2 }, { xa: "s" }, { xa: 1, b: 1 }] },
    {
      schema: { type: "object", properties: { name: { type: "string" } }, required: ["name", "total", "x-max"], patternProperties: { "^x-": { type: "integer" } }, additionalProperties: { type: "number" } },
      samples: [{ name: "n", total: 1.5, "x-max": 2 }, { name: "n", total: 1, "x-max": 2.5 }, { name: "n", total: 1, "x-max": 2, other: 3 }],
      use: ["declare const v: Type;", 'export const sum: number = v.total + v["x-max"];'].join("\n"),
    },
  ]);
  assert.deepEqual(counts, [2, 2, 2]);
});

test("an optional property may hold undefined, which the validator passes as absent, under exactOptionalPropertyTypes too", async () => {
  assert.equal(emit({ type: "object", properties: { a: { type: "string" }, b: {}, c: false }, additionalProperties: false }), "export interface Type {\n  a?: string | undefined;\n  b?: unknown;\n  c?: undefined;\n}");
  const counts = await agrees(
    [
      { schema: { type: "object", properties: { a: { type: "string" } } }, samples: [{ a: "x" }, {}], sources: ["{ a: undefined }"] },
      { schema: { type: "object", properties: { a: { type: "string" }, c: false }, additionalProperties: false }, samples: [], sources: ["{ a: undefined }", "{ c: undefined }"] },
      { schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] }, samples: [{ a: "x" }], sources: ["{ a: undefined }"] },
    ],
    { exactOptionalPropertyTypes: true },
  );
  // A required property that holds undefined is missing, for ajv as for the type.
  assert.deepEqual(counts, [3, 2, 1]);
});
