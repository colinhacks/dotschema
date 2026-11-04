// dotschema's engine (src/engine/) itself: its run-time entry bundles for any platform with nothing
// imported and no code built from a string; its validators are reached by URI and its compiled
// schema can be read; and the meta-schema check (src/engine/meta/) gives the errors ajv's
// `validateSchema` gives; and a key holding a lone surrogate compiles and checks everywhere a key
// goes, by the interpreter and by the generated check. The suite's verdicts are
// tests/engine-suite.test.ts's, and the module's errors tests/engine-parity.test.ts's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { generate, jit } from "../src/engine/generate.ts";
import { compile, type Validator } from "../src/engine/index.ts";
import { link } from "../src/engine/link.ts";
import { checkSchema, metaDraftOf, type MetaDraft } from "../src/engine/meta/index.ts";
import { sameErrors, suiteGroups, type SuiteDraft } from "./engine-support.ts";
import { ROOT, withFormats } from "./helpers.ts";

test("the engine's entry bundles for a neutral platform, importing nothing, building no code from a string, and leaving the meta-schemas out", async () => {
  const result = await build({ entryPoints: [join(ROOT, "src/engine/index.ts")], bundle: true, write: false, platform: "neutral", format: "esm", metafile: true, logLevel: "silent" });
  const code = result.outputFiles[0]!.text;
  assert.deepEqual(
    Object.keys(result.metafile.inputs).map((input) => input.replace(/^.*src\/engine\//, "")).sort(),
    ["equal.ts", "index.ts", "interpret.ts", "resources.ts", "tree.ts", "uri.ts"],
  );
  assert.deepEqual(Object.values(result.metafile.outputs)[0]!.imports, []);
  assert.doesNotMatch(code, /\bnew Function\b|\bFunction\(|\beval\(/);
  assert.doesNotMatch(code, /json-schema\.org\/draft/);
});

test("a validator is reached by any URI the resources give, and its compiled schema reads as keywords with their values", () => {
  const engine = compile(
    [
      { id: "https://example.com/user", schema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { name: { type: "string", minLength: 1 }, home: { $ref: "place#/$defs/address" } }, required: ["name"] } },
      { id: "https://example.com/place", schema: { $defs: { address: { $anchor: "address", type: "object", properties: { city: { type: "string" } }, required: ["city"] } } } },
    ],
    { draft: "2020-12" },
  );
  const user = engine.validator();
  assert.equal(engine.root, "https://example.com/user");
  assert.equal(user.check({ name: "Ada", home: { city: "London" } }), true);
  assert.equal(user.errors({ name: "Ada", home: { city: "London" } }), null);
  assert.deepEqual(user.errors({ name: "", home: {} }), [
    { instancePath: "/name", schemaPath: "#/properties/name/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" },
    // ajv inlines a `$ref` target without references, and its schemaPath starts with the `$ref` as written.
    { instancePath: "/home", schemaPath: "place#/$defs/address/required", keyword: "required", params: { missingProperty: "city" }, message: "must have required property 'city'" },
  ]);
  for (const uri of ["place#address", "https://example.com/place#/$defs/address", "/place#address"]) assert.equal(engine.validator(uri).check({ city: 1 }), false, uri);
  assert.equal(engine.validator("place#address"), engine.validator("https://example.com/place#address"));
  assert.throws(() => engine.validator("#/$defs/none"), /no schema at https:\/\/example\.com\/user#\/\$defs\/none/);
  assert.deepEqual(
    user.node.keywords.map((k) => [k.keyword, k.value]),
    [
      ["required", ["name"]],
      ["properties", { name: { type: "string", minLength: 1 }, home: { $ref: "place#/$defs/address" } }],
    ],
  );
  assert.deepEqual(user.node.types, ["object"]);
});

const require = createRequire(join(ROOT, "package.json"));
const OPTIONS = { allErrors: true, strict: false, logger: false, ownProperties: true, multipleOfPrecision: 7 };

/** ajv's validator of each meta-schema, as dotschema's ajv has them: draft-06's beside draft-07's in the default class. */
function ajvMeta(): Record<MetaDraft, (schema: unknown) => boolean> & Record<string, any> {
  const draft07 = withFormats(new (require("ajv").default)(OPTIONS));
  draft07.addMetaSchema(require("ajv/dist/refs/json-schema-draft-06.json"));
  const draft2019 = withFormats(new (require("ajv/dist/2019").default)(OPTIONS));
  const draft2020 = withFormats(new (require("ajv/dist/2020").default)(OPTIONS));
  return {
    "draft-06": draft07.getSchema("http://json-schema.org/draft-06/schema"),
    "draft-07": draft07.getSchema("http://json-schema.org/draft-07/schema"),
    "2019-09": draft2019.getSchema("https://json-schema.org/draft/2019-09/schema"),
    "2020-12": draft2020.getSchema("https://json-schema.org/draft/2020-12/schema"),
  };
}

/** Schemas each meta-schema refuses, one mistake or a few to each, under every draft. */
const INVALID: Record<string, unknown>[] = [
  { type: 5 }, { type: ["string", "string"] }, { type: "strin" }, { properties: [] }, { properties: { a: 5 } }, { required: [1, 1] }, { required: ["a", "a"] }, { minLength: -1 }, { minLength: 1.5 }, { maxItems: "3" },
  { pattern: 5 }, { pattern: "(" }, { items: [{ type: "x" }] }, { items: 5 }, { $ref: 5 }, { enum: [] }, { enum: 5 }, { format: 1 }, { $id: "#foo" }, { $id: 5 }, { $anchor: "1bad" }, { $anchor: 5 },
  { $defs: { a: 5 } }, { definitions: { a: 5 } }, { dependencies: { a: 5 } }, { dependencies: { a: [1] } }, { dependentRequired: { a: [1] } }, { dependentSchemas: { a: 5 } }, { allOf: [] }, { anyOf: {} }, { oneOf: [5] }, { not: 5 },
  { if: 5, then: 5, else: 5 }, { contains: 5 }, { minContains: -1 }, { multipleOf: 0 }, { multipleOf: -1 }, { exclusiveMinimum: true }, { const: 1, default: 2, examples: 5 }, { readOnly: 1 }, { $comment: 1 }, { title: 1, description: 2 },
  { propertyNames: 5 }, { patternProperties: { "(": {} } }, { patternProperties: { a: 5 } }, { additionalProperties: 5 }, { unevaluatedItems: 5 }, { unevaluatedProperties: 5 }, { prefixItems: [] }, { prefixItems: 5 },
  { $dynamicRef: 5 }, { $dynamicAnchor: "1x" }, { $recursiveRef: 5 }, { $recursiveAnchor: 5 }, { $vocabulary: { a: 1 } }, { contentMediaType: 5, contentEncoding: 6, contentSchema: 7 }, { uniqueItems: "yes" },
  { minProperties: -2, maxProperties: 1.1 }, { deprecated: "x" }, { items: { properties: { a: { type: "nope", minimum: "1" } } } },
];

test("checkSchema gives the errors ajv's meta-schema validation gives, schemaPath too, on the suite's schemas, the 205 of the keyword measurement and schemas each draft refuses", (t) => {
  const ajv = ajvMeta();
  const schemas: { label: string; schema: unknown }[] = [];
  for (const draft of ["draft6", "draft7", "draft2019-09", "draft2020-12"] as SuiteDraft[]) for (const kind of ["required", "format"] as const) for (const group of suiteGroups(draft, kind)) schemas.push({ label: group.id, schema: group.schema });
  const { cases, draftUris } = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/engine/cases.json"), "utf8")) as { draftUris: Record<string, string>; cases: { id: string; draft: string; schema?: Record<string, unknown> }[] };
  for (const c of cases) if (c.schema) schemas.push({ label: `case ${c.id}`, schema: draftUris[c.draft] && !("$schema" in c.schema) ? { $schema: draftUris[c.draft], ...c.schema } : c.schema });
  for (const uri of ["http://json-schema.org/draft-06/schema#", "http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft/2019-09/schema", "https://json-schema.org/draft/2020-12/schema"]) INVALID.forEach((schema, i) => schemas.push({ label: `invalid ${uri} [${i}]`, schema: { $schema: uri, ...schema } }));
  let refused = 0;
  const differences: string[] = [];
  for (const { label, schema } of schemas) {
    const meta = metaDraftOf(schema);
    if (!meta || typeof schema !== "object" || schema === null) continue;
    const validate = ajv[meta];
    const theirs = validate(schema) ? null : (validate as unknown as { errors: never[] }).errors;
    // ajv checks `errorMessage` when it compiles a schema, not in validateSchema.
    const ours = checkSchema(schema, { meta })?.filter((error) => !/\/errorMessage(\/|$)/.test(error.instancePath)) ?? [];
    if (theirs) refused++;
    if (!sameErrors(ours, theirs ?? [], true)) differences.push(`${label}: ${JSON.stringify(ours)} where ajv gives ${JSON.stringify(theirs)}`);
  }
  t.diagnostic(`${schemas.length} schemas compared, ${refused} of them refused`);
  assert.ok(refused > INVALID.length * 2);
  assert.deepEqual(differences, []);
});

test("checkSchema checks an errorMessage against ajv-errors' meta-schema wherever a schema writes it", () => {
  assert.equal(checkSchema({ type: "string", errorMessage: { type: "a string, please" } }), null);
  assert.deepEqual(
    checkSchema({ properties: { a: { type: "string", errorMessage: 5 } } })?.map((e) => [e.instancePath, e.keyword]),
    [
      ["/properties/a/errorMessage", "type"],
      ["/properties/a/errorMessage", "type"],
      ["/properties/a/errorMessage", "anyOf"],
    ],
  );
});

const D2020 = "https://json-schema.org/draft/2020-12/schema";

/** Keys a JSON string can hold and UTF-8 cannot: a lone high surrogate, a lone low one, and both out of order between letters. */
const LONE = ["\ud800", "\udc00", "a\udc00\ud800b"];

/** Schemas with `key` as a property name, a pattern and a definition's name, each with its values: the verdict, and the instancePath and schemaPath of each error. */
const surrogateCases = (key: string): { schema: Record<string, unknown>; values: [unknown, boolean, [string, string][]][] }[] => [
  {
    schema: { properties: { [key]: { type: "string" } }, required: [key], additionalProperties: false },
    values: [
      [{ [key]: "x" }, true, []],
      [{ [key]: 1 }, false, [[`/${key}`, `#/properties/${key}/type`]]],
      [{ [key]: "x", b: 1 }, false, [["", "#/additionalProperties"]]],
      [{}, false, [["", "#/required"]]],
    ],
  },
  {
    schema: { patternProperties: { [key]: { type: "string" } } },
    values: [
      [{ [`z${key}`]: "x" }, true, []],
      [{ [`z${key}`]: 1 }, false, [[`/z${key}`, `#/patternProperties/${key}/type`]]],
      [{ z: 1 }, true, []],
    ],
  },
  {
    // The definition is inlined where `a` refers to it, and a function of its own where it refers to itself.
    schema: { $schema: D2020, $defs: { [key]: { type: "object", properties: { [key]: { $ref: `#/$defs/${key}` }, v: { type: "number" } } }, s: { type: "string" } }, properties: { a: { $ref: `#/$defs/${key}` }, b: { $ref: "#/$defs/s" } } },
    values: [
      [{ a: { v: 1, [key]: { v: 2 } } }, true, []],
      [{ a: { [key]: { v: "x" } } }, false, [[`/a/${key}/v`, "#/properties/v/type"]]],
      [{ a: 1 }, false, [["/a", "#/type"]]],
    ],
  },
  {
    schema: { $schema: D2020, $defs: { [key]: { type: "string" } }, items: { $ref: `#/$defs/${key}` }, dependentSchemas: { [key]: { required: ["b"] } } },
    values: [
      [["x"], true, []],
      [[1], false, [["/0", `#/$defs/${key}/type`]]],
      [{ [key]: 1 }, false, [["", `#/dependentSchemas/${key}/required`]]],
    ],
  },
];

test("a key holding a lone surrogate works as a property name, a pattern and a definition's name, in check, errors, jit and a check built ahead of time, the surrogate kept as it is in schemaPath", async () => {
  const cases = LONE.flatMap((key) => surrogateCases(key).map((c) => ({ key, ...c })));
  const make = (schema: Record<string, unknown>): Validator => compile([{ id: "dotschema:0", schema }], { draft: schema["$schema"] ? "2020-12" : "draft-07" }).validator();
  // Ahead of time: every source written into one module, each linked to a validator compiled again.
  const file = join(mkdtempSync(join(tmpdir(), "dotschema-engine-surrogates-")), "checks.mjs");
  writeFileSync(file, `export default [\n${cases.map((c) => generate(make(c.schema)).source).join(",\n")}\n];\n`);
  const factories = (await import(pathToFileURL(file).href)).default as ((r: any) => (value: unknown) => boolean)[];
  cases.forEach(({ key, schema, values }, i) => {
    const validator = make(schema);
    const fast = jit(validator)!;
    const ahead = link(make(schema), factories[i]!);
    for (const [value, valid, errors] of values) {
      const label = `${JSON.stringify(key)} ${JSON.stringify(schema)} ${JSON.stringify(value)}`;
      assert.equal(validator.check(value), valid, label);
      assert.equal(fast(value), valid, label);
      assert.equal(ahead(value), valid, label);
      assert.deepEqual(validator.errors(value)?.map((e) => [e.instancePath, e.schemaPath]) ?? [], errors, label);
    }
  });
  const engine = compile([{ id: "dotschema:0", schema: { $defs: { [LONE[0]!]: { type: "string" } } } }], { draft: "2020-12" });
  assert.equal(engine.validator(`#/$defs/${LONE[0]}`).check(1), false);
});

test("where ajv gives a path for a key, the engine gives the same: a surrogate pair percent-encoded, a lone surrogate where ajv compiles it", () => {
  const ajv = new (require("ajv/dist/2020").default)(OPTIONS);
  for (const key of ["\ud83d\ude00", ...LONE]) {
    // ajv throws a URIError for a lone surrogate in properties, patternProperties and dependentSchemas, and resolves no $ref to one; these it compiles.
    const schemas: Record<string, unknown>[] = [
      { required: [key], additionalProperties: { type: "string" }, propertyNames: { maxLength: 1 }, dependentRequired: { [key]: ["b"] } },
      ...(key.length === 2 && key.codePointAt(0)! > 0xffff ? [{ properties: { [key]: { type: "string" } }, patternProperties: { [key]: { minLength: 9 } }, dependentSchemas: { [key]: { required: ["c"] } } }] : []),
    ];
    for (const schema of schemas) {
      const theirs = ajv.compile(schema);
      const ours = compile([{ id: "dotschema:0", schema }], { draft: "2020-12" }).validator();
      for (const value of [{}, { [key]: 1 }, { [key]: "x", bb: 2 }]) {
        const expected = theirs(value) ? null : theirs.errors;
        assert.deepEqual(ours.errors(value), expected, `${JSON.stringify(key)} ${JSON.stringify(schema)} ${JSON.stringify(value)}`);
      }
    }
  }
});
