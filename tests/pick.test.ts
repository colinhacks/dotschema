// A plain object's `.pick()`, `.omit()`, `.partial()`, `.required()` and `.keyof()` (src/schema.ts,
// DESIGN.md "Pick, omit and the other object methods"). The proof: for each set of keys, the schema
// a method gives is the JSON Schema it should be exactly, and its `.validate()` gives the issues ajv
// gives for that schema, compiled here with ajv itself, in ajv's order, and its `.is()` ajv's
// first-failure verdict, on a spread of values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { schemaCode, schemaTypes } from "../src/schema.ts";
import { evaluate, ROOT, run, TSC, withFormats } from "./helpers.ts";

const require = createRequire(import.meta.url);
const PATH = join(ROOT, "tests/fixtures/pick.schema.jsonc");

const load = async (schema: unknown, path = PATH) => {
  const { code, problems } = schemaCode(typeof schema === "string" ? schema : JSON.stringify(schema), path);
  assert.deepEqual(problems, []);
  return evaluate(code);
};

/** ajv, set as dotschema sets it (src/schema.ts, loadAjv), for the draft of a converted schema. */
function ajvFor(schema: { $schema: string }, allErrors: boolean) {
  const mod = require(schema.$schema.includes("2020-12") ? "ajv/dist/2020" : "ajv");
  const Ajv = mod.default ?? mod;
  const ajv = new Ajv({ allErrors, strict: false, logger: false, ownProperties: true, multipleOfPrecision: 7 });
  return withFormats(ajv).compile(schema);
}

/** An ajv error as a dotschema issue: the path read against the value, a missing or unexpected key at its end. */
function issueOf(value: unknown, error: { instancePath: string; keyword: string; message?: string; params: Record<string, unknown> }) {
  const path: (string | number)[] = [];
  let at: any = value;
  for (const segment of error.instancePath ? error.instancePath.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")) : []) {
    path.push(Array.isArray(at) ? Number(segment) : segment);
    at = at?.[segment];
  }
  const key = error.params["missingProperty"] ?? error.params["additionalProperty"];
  if (typeof key === "string") path.push(key);
  return { message: error.message, path, keyword: error.keyword };
}

/** The schema with only the keys `keep` keeps in `properties` and `required`, every other keyword as it was. */
function filtered(schema: any, keep: (key: string) => boolean) {
  const out = { ...schema };
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => keep(key)));
  if (schema.required) out.required = schema.required.filter(keep);
  return out;
}

/** Checks a schema value against ajv on the filtered schema, for both targets and every value. */
function agrees(made: any, expected: Record<string, any>, values: unknown[], label: string) {
  for (const target of ["draft-07", "draft-2020-12"] as const) {
    const document = made["~standard"].jsonSchema.input({ target });
    assert.deepEqual(document, expected[target], `${label}: the ${target} document`);
    const all = ajvFor(document, true);
    const first = ajvFor(document, false);
    for (const value of values) {
      const valid = all(value);
      const issues = valid ? undefined : all.errors.map((error: any) => issueOf(value, error));
      assert.deepEqual(made.validate(value).issues, issues, `${label}, ${target}: .validate(${JSON.stringify(value)})`);
      assert.equal(made.is(value), first(value), `${label}, ${target}: .is(${JSON.stringify(value)})`);
    }
  }
}

const D2020 = "https://json-schema.org/draft/2020-12/schema";
const D07 = "http://json-schema.org/draft-07/schema#";
const node = { type: "object", properties: { v: { type: "number" } }, required: ["v"] };
/** Every property kind: checked, skipped (`true`, `{}`), refused (`false`), annotated only, through a `$ref` twice, a key only `required` names, and keys a JSON Pointer escapes. */
const base = (draft: string, additional?: unknown) => ({
  $schema: draft,
  title: "Everything",
  type: "object",
  properties: {
    a: { type: "string", minLength: 1 },
    b: { type: "integer", minimum: 0 },
    c: { type: "array", items: { type: "string" }, uniqueItems: true },
    d: true,
    e: false,
    f: { description: "only an annotation" },
    g: { $ref: draft === D07 ? "#/definitions/node" : "#/$defs/node" },
    h: { $ref: draft === D07 ? "#/definitions/node" : "#/$defs/node" },
    "a/b": { type: "boolean" },
    "~t": { const: 1 },
    "50%": { type: "null" },
  },
  required: ["a", "b", "x", "a/b"],
  ...(additional === undefined ? {} : { additionalProperties: additional }),
  [draft === D07 ? "definitions" : "$defs"]: { node },
});

const VALUES: unknown[] = [
  null,
  5,
  "x",
  [],
  [1],
  {},
  { a: "Ada", b: 1, x: 0, "a/b": true },
  { a: "", b: -1, c: ["x", "x", 1], e: 1, g: {}, h: { v: "1" }, "a/b": 1, "~t": 2, "50%": 0, extra: 1, other: "y" },
  { a: undefined, b: 1.5, x: null, "a/b": false, d: [], f: 1, zzz: 3, "q/r": 4 },
  { x: 1, extra: 2, g: { v: 1 } },
  Object.assign(Object.create({ a: "inherited" }), { b: 0, x: 1, "a/b": true }),
];

const KEY_SETS = [[], ["a"], ["x"], ["e"], ["g", "h"], ["a", "b", "x", "a/b"], ["c", "~t", "50%", "d", "f"], ["a", "nope"]];

for (const [draft, additional] of [[D2020, false], [D07, false], [D2020, undefined], [D07, { type: "number" }], [D2020, { type: "number", minimum: 10 }], [D2020, true]] as const) {
  test(`.pick() and .omit() give ajv's issues for the filtered schema, in ajv's order: ${draft === D07 ? "draft-07" : "2020-12"}, additionalProperties ${JSON.stringify(additional)}`, async () => {
    const { default: s } = await load(base(draft, additional));
    const whole = { "draft-07": s["~standard"].jsonSchema.input({ target: "draft-07" }), "draft-2020-12": s["~standard"].jsonSchema.input({ target: "draft-2020-12" }) };
    const narrowed = (keep: (key: string) => boolean) => ({ "draft-07": filtered(whole["draft-07"], keep), "draft-2020-12": filtered(whole["draft-2020-12"], keep) });
    // The whole schema, which the same join validates, is ajv's too.
    agrees(s, whole, VALUES, "the root");
    for (const keys of KEY_SETS) {
      agrees(s.pick(...keys), narrowed((key) => keys.includes(key)), VALUES, `pick(${keys})`);
      agrees(s.omit(...keys), narrowed((key) => !keys.includes(key)), VALUES, `omit(${keys})`);
    }
    // Chained: each call filters the schema the last one gave.
    agrees(s.omit("b", "c").pick("a", "b", "g", "x"), narrowed((key) => ["a", "g", "x"].includes(key)), VALUES, "omit then pick");
    // The schema as written is filtered the same way, and the module's own is unchanged.
    assert.deepEqual(Object.keys(s.pick("a", "x").schema.properties), ["a"]);
    assert.deepEqual(s.pick("a", "x").schema.required, ["a", "x"]);
    assert.equal(Object.keys(s.schema.properties).length, 11);
  });
}

test("a picked schema has the same surface: Standard Schema, the same function under ~standard, nothing that throws", async () => {
  const { default: s } = await load(base(D2020, false));
  const picked = s.pick("a");
  assert.deepEqual(Object.keys(picked), ["validate", "is", "schema", "~standard", "pick", "omit", "partial", "required", "keyof"]);
  assert.equal(picked.validate, picked["~standard"].validate);
  assert.equal(picked["~standard"].vendor, "dotschema");
  // Each call gives a fresh document.
  assert.notEqual(picked["~standard"].jsonSchema.input({ target: "draft-07" }), picked["~standard"].jsonSchema.input({ target: "draft-07" }));
  // Keys of any kind, or none, never throw.
  for (const keys of [[], [1], [null], [{}], ["__proto__"], ["a", "a"]])
    for (const method of ["pick", "omit", "partial", "required"]) assert.doesNotThrow(() => s[method](...keys).validate({}));
  // A getter that throws is one issue, as for the module itself.
  const hostile = {
    get a() {
      throw new Error("no a");
    },
  };
  assert.deepEqual(picked.validate(hostile).issues, [{ message: "could not be checked: no a", path: [], keyword: "error" }]);
  assert.equal(picked.is(hostile), false);
});

test(".is() of a picked schema stops at the first failure, and .validate() reads each property as ajv does", async () => {
  const { default: s } = await load({ type: "object", properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" } } });
  const read: string[] = [];
  const value = Object.defineProperties({}, Object.fromEntries(["a", "b", "c"].map((key) => [key, { enumerable: true, get: () => (read.push(key), 1) }])));
  assert.equal(s.omit("a").is(value), false);
  assert.deepEqual([...new Set(read)], ["b"]);
  read.length = 0;
  assert.equal(s.omit("a").validate(value).issues.length, 2);
  assert.deepEqual([...new Set(read)], ["b", "c"]);
});

test("where filtering properties is not the filtered schema, or another keyword acts on the object, there is no pick or omit, at run time or in the types", async () => {
  const plain = { type: "object", properties: { a: { type: "string" } } };
  const without = [
    // A keyword beside the properties that the join does not make.
    { ...plain, minProperties: 1 },
    { ...plain, patternProperties: { "^x": { type: "number" } } },
    { ...plain, oneOf: [{ required: ["a"] }, { required: ["b"] }] },
    { ...plain, $ref: "#/$defs/x", $defs: { x: {} } },
    { type: ["object"], properties: plain.properties },
    { properties: plain.properties },
    // A $ref back to the schema itself, or into its properties, which the filtered schema would change.
    { type: "object", properties: { a: { type: "string" }, kids: { type: "array", items: { $ref: "#" } } } },
    { type: "object", properties: { a: { type: "string" }, b: { $ref: "#/properties/a" } } },
    // A 2019-09 recursive reference, whose scope may reach it.
    { $schema: "https://json-schema.org/draft/2019-09/schema", type: "object", properties: { a: { type: "string" }, kids: { type: "array", items: { $recursiveRef: "#" } } } },
  ];
  for (const schema of without) {
    const { default: s } = await load(schema);
    assert.equal(s.pick, undefined, JSON.stringify(schema));
    assert.equal(s.omit, undefined, JSON.stringify(schema));
    assert.match(schemaTypes(JSON.stringify(schema), PATH).types, /\ndeclare const schema: __DotschemaSchema</, JSON.stringify(schema));
  }
  // An unknown keyword ajv ignores is ignored by the join too; and a definition the properties refer to is fine.
  for (const schema of [{ ...plain, "x-vendor": { $ref: "#" } }, { ...plain, required: ["a", "z"], additionalProperties: { $ref: "#/$defs/n" }, $defs: { n: { type: "number" } } }]) {
    const { default: s } = await load(schema);
    assert.equal(typeof s.pick, "function", JSON.stringify(schema));
    assert.match(schemaTypes(JSON.stringify(schema), PATH).types, /\ndeclare const schema: __DotschemaObjectSchema</);
  }
});

test("a definition that is a plain object picks and omits too, unless its own document refers back to it", async () => {
  const source = JSON.stringify({
    $schema: D2020,
    type: "object",
    properties: { owner: { $ref: "#/$defs/owner" } },
    $defs: {
      address: { type: "object", properties: { city: { type: "string", minLength: 1 } }, required: ["city"], additionalProperties: false },
      // `boss` refers back to the owner, which filtering its properties would change.
      owner: { type: "object", properties: { boss: { $ref: "#/$defs/owner" }, home: { $ref: "#/$defs/address" } } },
      // A $ref to the file's root is to another schema in the definition's own document.
      lonely: { type: "object", properties: { back: { $ref: "#" } } },
    },
  });
  const module = await load(source);
  assert.deepEqual(module.address.pick().validate({ city: 1 }).issues, [{ message: "must NOT have additional properties", path: ["city"], keyword: "additionalProperties" }]);
  assert.equal(module.owner.pick, undefined);
  assert.equal(typeof module.lonely.pick, "function");
  const { types } = schemaTypes(source, PATH);
  assert.match(types, /\nexport declare const address: __DotschemaObjectSchema<\{\n  city: string;\n\}, Json\["\$defs"\]\["address"\], "city">;\n/);
  assert.match(types, /\nexport declare const owner: __DotschemaSchema</);
  assert.match(types, /\nexport declare const lonely: __DotschemaObjectSchema</);
});

test("the types of .pick() and .omit() keep each property's optionality and the index signature, take only the schema's keys, and admit every value the validator accepts", () => {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-pick-types-"));
  const schema = { type: "object", properties: { a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" } }, required: ["a", "z"], additionalProperties: { type: ["string", "number", "boolean"] } };
  writeFileSync(join(dir, "s.schema.jsonc"), JSON.stringify(schema));
  writeFileSync(join(dir, "closed.schema.jsonc"), JSON.stringify({ ...schema, additionalProperties: false }));
  writeFileSync(
    join(dir, "main.ts"),
    [
      'import type { StandardSchemaV1 } from "dotschema";',
      'import s from "./s.schema.jsonc";',
      'import closed from "./closed.schema.jsonc";',
      "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;",
      "const expect = <T extends true>() => {};",
      "type Out<T extends StandardSchemaV1> = StandardSchemaV1.InferOutput<T>;",
      "type In<T extends StandardSchemaV1> = StandardSchemaV1.InferInput<T>;",
      "// The output never holds undefined; the input may, under exactOptionalPropertyTypes.",
      'const ab = closed.pick("a", "b");',
      'expect<Equal<Out<typeof ab>, { a: string; b?: number }>>();',
      'expect<Equal<In<typeof ab>, { a: string; b?: number | undefined }>>();',
      'const notA = closed.omit("a", "z");',
      'expect<Equal<Out<typeof notA>, { b?: number; c?: boolean }>>();',
      'expect<Equal<In<typeof notA>, { b?: number | undefined; c?: boolean | undefined }>>();',
      'const z = closed.pick("z");',
      "expect<Equal<Out<typeof z>, { z: never }>>();",
      "// The index signature stays: a key left out is an additional property, which the schema still allows.",
      'const open = s.pick("a");',
      "expect<Equal<Out<typeof open>, { [key: string]: string | number | boolean | undefined; a: string }>>();",
      "// Every value the validator accepts, a key left out among them, is of the type.",
      'const value: unknown = { a: "x", b: "now additional", z: 1 };',
      "if (open.is(value)) { const typed: In<typeof open> = value; void typed; }",
      'const chained = closed.omit("c").pick("b");',
      "expect<Equal<Out<typeof chained>, { b?: number }>>();",
      "expect<Equal<In<typeof chained>, { b?: number | undefined }>>();",
      "// @ts-expect-error a key the schema does not name",
      'closed.pick("nope");',
      "// @ts-expect-error a key an earlier pick left out",
      'ab.pick("c");',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { target: "esnext", module: "nodenext", strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true, types: [] }, contentMappers: [{ package: "dotschema", extensions: [".schema.jsonc"] }], include: ["main.ts"] }),
  );
  // dotschema resolves from the repository, which links itself.
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules/dotschema"));
  const { status, out } = run(TSC, ["-p", join(dir, "tsconfig.json"), "--runExternalCode"]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

test("a file two properties refer to is compiled once for each validator, as the root's own validator compiles it", () => {
  // team.schema.jsonc's `lead` is a $ref to user.schema.jsonc and its `members` an array of them: one function for both.
  const path = join(ROOT, "lab/basic/team.schema.jsonc");
  const { code } = schemaCode(readFileSync(path, "utf8"), path);
  assert.equal(code.match(/schemaPath:"#\/properties\/name\/minLength"/g)?.length, 2);
});

for (const [draft, additional] of [[D2020, false], [D07, { type: "number" }], [D2020, undefined]] as const) {
  test(`.partial() and .required() give ajv's issues for the schema with \`required\` changed: ${draft === D07 ? "draft-07" : "2020-12"}, additionalProperties ${JSON.stringify(additional)}`, async () => {
    const { default: s } = await load(base(draft, additional));
    const whole = { "draft-07": s["~standard"].jsonSchema.input({ target: "draft-07" }), "draft-2020-12": s["~standard"].jsonSchema.input({ target: "draft-2020-12" }) };
    const requiring = (required: string[]) => ({ "draft-07": { ...whole["draft-07"], required }, "draft-2020-12": { ...whole["draft-2020-12"], required } });
    agrees(s.partial(), requiring([]), VALUES, "partial()");
    agrees(s.partial("a", "x", "c"), requiring(["b", "a/b"]), VALUES, "partial(a, x, c)");
    agrees(s.required(), requiring(["a", "b", "x", "a/b", "c", "d", "e", "f", "g", "h", "~t", "50%"]), VALUES, "required()");
    // A key already required, or one the schema does not name, changes nothing.
    agrees(s.required("c", "a", "nope"), requiring(["a", "b", "x", "a/b", "c"]), VALUES, "required(c, a, nope)");
    agrees(s.partial().required("g"), requiring(["g"]), VALUES, "partial() then required(g)");
    agrees(
      s.pick("a", "b", "c").partial("a"),
      { "draft-07": filtered({ ...whole["draft-07"], required: ["b"] }, (key) => ["a", "b", "c"].includes(key)), "draft-2020-12": filtered({ ...whole["draft-2020-12"], required: ["b"] }, (key) => ["a", "b", "c"].includes(key)) },
      VALUES,
      "pick(a, b, c) then partial(a)",
    );
    assert.deepEqual(s.partial().schema.required, []);
    assert.deepEqual(s.schema.required, ["a", "b", "x", "a/b"]);
  });
}

test(".keyof() is the keys properties and required name, as a schema of their own", async () => {
  const { default: s } = await load(base(D2020, false));
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "a/b", "~t", "50%", "x"];
  agrees(s.keyof(), { "draft-07": { $schema: D07, enum: keys }, "draft-2020-12": { $schema: D2020, enum: keys } }, [...keys, "nope", "__proto__", 1, null, {}, ["a"]], "keyof()");
  assert.deepEqual(s.keyof().schema, { enum: keys });
  assert.deepEqual(s.pick("a", "x").keyof().schema, { enum: ["a", "x"] });
  assert.equal(s.keyof().pick, undefined);
  const keyof = s.keyof();
  assert.equal(keyof.validate, keyof["~standard"].validate);
});

test("the types of .partial(), .required() and .keyof() follow the schema each gives, with exactOptionalPropertyTypes and without", () => {
  for (const exact of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "dotschema-derive-types-"));
    const schema = { type: "object", properties: { a: { type: "string" }, b: { type: "number" }, c: { type: "boolean" } }, required: ["a", "z"], additionalProperties: { type: ["string", "number", "boolean"] } };
    writeFileSync(join(dir, "s.schema.jsonc"), JSON.stringify(schema));
    writeFileSync(join(dir, "closed.schema.jsonc"), JSON.stringify({ ...schema, additionalProperties: false }));
    // An optional property is `| undefined` only under the option, as the emitter writes one.
    const u = exact ? " | undefined" : "";
    writeFileSync(
      join(dir, "main.ts"),
      [
        'import type { StandardSchemaV1 } from "dotschema";',
        'import s from "./s.schema.jsonc";',
        'import closed from "./closed.schema.jsonc";',
        "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;",
        "const expect = <T extends true>() => {};",
        "type Out<T extends StandardSchemaV1> = StandardSchemaV1.InferOutput<T>;",
        "type In<T extends StandardSchemaV1> = StandardSchemaV1.InferInput<T>;",
        "// The output never holds undefined, so an optional property of it is never | undefined.",
        "const all = closed.partial();",
        "expect<Equal<Out<typeof all>, { a?: string; b?: number; c?: boolean; z?: never }>>();",
        `expect<Equal<In<typeof all>, { a?: string${u}; b?: number${u}; c?: boolean${u}; z?: ${exact ? "undefined" : "never"} }>>();`,
        'const someOptional = closed.partial("a");',
        "expect<Equal<Out<typeof someOptional>, { a?: string; b?: number; c?: boolean; z: never }>>();",
        `expect<Equal<In<typeof someOptional>, { a?: string${u}; b?: number${u}; c?: boolean${u}; z: never }>>();`,
        "const allRequired = closed.required();",
        "expect<Equal<Out<typeof allRequired>, { a: string; b: number; c: boolean; z: never }>>();",
        "expect<Equal<In<typeof allRequired>, { a: string; b: number; c: boolean; z: never }>>();",
        'const someRequired = closed.required("b");',
        "expect<Equal<Out<typeof someRequired>, { a: string; b: number; c?: boolean; z: never }>>();",
        `expect<Equal<In<typeof someRequired>, { a: string; b: number; c?: boolean${u}; z: never }>>();`,
        "// The index signature stays, as for .pick().",
        "const open = s.partial();",
        "expect<Equal<Out<typeof open>, { [key: string]: string | number | boolean | undefined; a?: string; b?: number; c?: boolean; z?: string | number | boolean }>>();",
        `expect<Equal<In<typeof open>, { [key: string]: string | number | boolean | undefined; a?: string${u}; b?: number${u}; c?: boolean${u}; z?: string | number | boolean${u} }>>();`,
        "const keys = closed.keyof();",
        'expect<Equal<Out<typeof keys>, "a" | "b" | "c" | "z">>();',
        "// Every value the validator accepts is of the type.",
        'const value: unknown = { b: 1, extra: "x" };',
        "if (open.is(value)) { const typed: In<typeof open> = value; void typed; }",
        "// @ts-expect-error a key the schema does not name",
        'closed.partial("nope");',
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { target: "esnext", module: "nodenext", strict: true, exactOptionalPropertyTypes: exact, noEmit: true, skipLibCheck: true, types: [] }, contentMappers: [{ package: "dotschema", extensions: [".schema.jsonc"] }], include: ["main.ts"] }),
    );
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(ROOT, join(dir, "node_modules/dotschema"));
    const { status, out } = run(TSC, ["-p", join(dir, "tsconfig.json"), "--runExternalCode"]);
    assert.equal(out, "", `exactOptionalPropertyTypes: ${exact}`);
    assert.equal(status, 0);
  }
});
