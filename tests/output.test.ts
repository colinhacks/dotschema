// The value `.validate()` gives (src/output.ts): defaults filled in, strings transformed, and, once
// it passes, a property that holds `undefined` and a key no schema of an open object lists dropped,
// copied where it changes and the value given itself where it does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schemaCode, schemaTypes } from "../src/schema.ts";
import { evaluate, ROOT, run, TSC } from "./helpers.ts";

const PATH = join(ROOT, "tests/fixtures/output.schema.jsonc");

const load = async (schema: object) => {
  const { code, problems } = schemaCode(JSON.stringify(schema), PATH);
  assert.deepEqual(problems, []);
  return (await evaluate(code)).default;
};

const DRAFTS = [undefined, "http://json-schema.org/draft-06/schema#", "https://json-schema.org/draft/2019-09/schema", "https://json-schema.org/draft/2020-12/schema"];

test("a property's default is filled in where it is absent or undefined, in every draft, before the value is validated, so a required key with one never fails", async () => {
  for (const $schema of DRAFTS) {
    const s = await load({ ...($schema ? { $schema } : {}), type: "object", properties: { role: { enum: ["admin", "member"], default: "member" }, tags: { type: "array", default: [] }, name: { type: "string" } }, required: ["role", "tags"], additionalProperties: false });
    assert.deepEqual(s.validate({ name: "Ada" }), { value: { name: "Ada", role: "member", tags: [] } }, String($schema));
    assert.deepEqual(s.validate({ role: undefined }).value, { role: "member", tags: [] }, String($schema));
    assert.deepEqual(s.validate({ role: "admin", tags: ["a"] }).value, { role: "admin", tags: ["a"] }, String($schema));
    // A null is a value: it is not filled, and the enum refuses it.
    assert.deepEqual(s.validate({ role: null }).issues?.map((issue: any) => issue.path), [["role"]], String($schema));
    // `.is()` checks the value as `.validate()` does, filled.
    assert.equal(s.is({}), true, String($schema));
    // Each call gets its own copy of an object default.
    assert.notEqual(s.validate({}).value.tags, s.validate({}).value.tags);
  }
});

test("a default is filled where its schema applies: a $ref's target's, allOf's, the member of a oneOf its tag or its validator chooses, then or else as the if passes", async () => {
  const ref = await load({ $defs: { role: { enum: ["admin", "member"], default: "member" } }, type: "object", properties: { role: { $ref: "#/$defs/role" } } });
  assert.deepEqual(ref.validate({}).value, { role: "member" });
  const all = await load({ allOf: [{ type: "object", properties: { a: { default: 1 } } }, { properties: { b: { default: 2 } } }] });
  assert.deepEqual(all.validate({}).value, { a: 1, b: 2 });
  const tagged = await load({
    oneOf: [
      { type: "object", properties: { kind: { const: "click" }, button: { enum: ["left", "right"], default: "left" } }, required: ["kind"], additionalProperties: false },
      { type: "object", properties: { kind: { const: "key" }, code: { type: "string", default: "Enter" } }, required: ["kind"], additionalProperties: false },
    ],
  });
  assert.deepEqual(tagged.validate({ kind: "click" }).value, { kind: "click", button: "left" });
  assert.deepEqual(tagged.validate({ kind: "key" }).value, { kind: "key", code: "Enter" });
  // No tag: the first member that passes once filled.
  const untagged = await load({ anyOf: [{ type: "object", properties: { n: { type: "number" }, unit: { default: "px" } }, required: ["n"] }, { type: "object", properties: { s: { type: "string" }, lang: { default: "en" } }, required: ["s"] }] });
  assert.deepEqual(untagged.validate({ s: "hi" }).value, { s: "hi", lang: "en" });
  assert.deepEqual(untagged.validate({ n: 1 }).value, { n: 1, unit: "px" });
  const conditional = await load({ type: "object", properties: { plan: { enum: ["free", "pro"] } }, if: { properties: { plan: { const: "pro" } } }, then: { properties: { seats: { default: 5 } } }, else: { properties: { seats: { default: 1 } } } });
  assert.deepEqual(conditional.validate({ plan: "pro" }).value, { plan: "pro", seats: 5 });
  assert.deepEqual(conditional.validate({ plan: "free" }).value, { plan: "free", seats: 1 });
  // An `if` of another shape is tested with its validator.
  const tested = await load({ type: "object", if: { properties: { n: { minimum: 10 } } }, then: { properties: { big: { default: true } } }, else: { properties: { big: { default: false } } } });
  assert.deepEqual([tested.validate({ n: 20 }).value, tested.validate({ n: 1 }).value], [{ n: 20, big: true }, { n: 1, big: false }]);
  // A default inside a default, and in each item and each value of a record.
  const nested = await load({ type: "object", properties: { box: { type: "object", properties: { size: { default: 1 } }, default: {} }, items: { type: "array", items: { type: "object", properties: { qty: { default: 1 } } } }, map: { type: "object", additionalProperties: { type: "object", properties: { on: { default: false } } } } } });
  assert.deepEqual(nested.validate({ items: [{}, { qty: 2 }], map: { a: {} } }).value, { box: { size: 1 }, items: [{ qty: 1 }, { qty: 2 }], map: { a: { on: false } } });
});

test("a default its own schema refuses is a problem at the default, in the type check and the build, with what the schema says", () => {
  const source = '{\n  "type": "object",\n  "properties": {\n    "n": { "type": "number", "default": "x" }\n  }\n}';
  for (const { problems } of [schemaTypes(source, PATH), schemaCode(source, PATH)]) {
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.message, 'The default "x" does not pass its own schema: must be number.');
    assert.equal(source.slice(problems[0]!.start, problems[0]!.start + problems[0]!.length), '"default"');
  }
  // Read as `.validate()` fills it in: transformed, and with the defaults inside it.
  assert.deepEqual(schemaCode(JSON.stringify({ enum: ["a"], transform: ["trim"], default: " a " }), PATH).problems, []);
  assert.deepEqual(schemaCode(JSON.stringify({ type: "object", properties: { a: { type: "number", default: 1 } }, required: ["a"], default: {} }), PATH).problems, []);
  assert.match(schemaCode(JSON.stringify({ type: "object", properties: { a: { type: "number", default: "1" } } }), PATH).problems[0]!.message, /The default "1" does not pass its own schema: must be number/);
});

test("a key of an open object that no schema there lists is dropped once the value passes, and an object that lists none, or says what its other keys are, keeps every key", async () => {
  const s = await load({ type: "object", properties: { name: { type: "string" }, meta: { type: "object" }, tags: { type: "object", additionalProperties: { type: "string" } }, closed: { type: "object", properties: { a: {} }, additionalProperties: false } }, required: ["id"] });
  const value = { id: 1, name: "Ada", extra: true, meta: { anything: 1 }, tags: { x: "y" }, closed: { a: 1 } };
  assert.deepEqual(s.validate(value).value, { id: 1, name: "Ada", meta: { anything: 1 }, tags: { x: "y" }, closed: { a: 1 } });
  assert.equal(value.extra, true);
  // A pattern lists the keys it matches.
  const patterned = await load({ type: "object", properties: { a: {} }, patternProperties: { "^x-": {} } });
  assert.deepEqual(patterned.validate({ a: 1, "x-b": 2, c: 3 }).value, { a: 1, "x-b": 2 });
  // allOf's members list keys together; every member of an anyOf is read, and of a tagged oneOf the one its tag names.
  const all = await load({ allOf: [{ type: "object", properties: { a: {} } }, { properties: { b: {} } }] });
  assert.deepEqual(all.validate({ a: 1, b: 2, c: 3 }).value, { a: 1, b: 2 });
  const any = await load({ anyOf: [{ type: "object", properties: { a: { type: "number" } } }, { type: "object", properties: { b: { type: "number" } } }] });
  assert.deepEqual(any.validate({ a: 1, b: "x", c: 3 }).value, { a: 1, b: "x" });
  const tagged = await load({ oneOf: [{ type: "object", properties: { kind: { const: "a" }, x: {} }, required: ["kind"] }, { type: "object", properties: { kind: { const: "b" }, y: {} }, required: ["kind"] }] });
  assert.deepEqual(tagged.validate({ kind: "a", x: 1, y: 2, z: 3 }).value, { kind: "a", x: 1 });
  // A property that holds undefined, which ajv passes as absent, is dropped, open or closed.
  const closed = await load({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false });
  const holes = { a: undefined };
  assert.deepEqual(Object.keys(closed.validate(holes).value), []);
  assert.deepEqual(holes, { a: undefined });
});

test("a transform applies to the string before it is validated, toEnumCase gives the enum's own spelling, and one that cannot apply is a problem at the transform", async () => {
  const s = await load({ type: "object", properties: { email: { type: "string", transform: ["trim", "toLowerCase"], format: "email" }, role: { enum: ["Admin", "Member"], transform: ["trim", "toEnumCase"] } } });
  assert.deepEqual(s.validate({ email: "  Ada@Example.COM ", role: " admin" }).value, { email: "ada@example.com", role: "Admin" });
  assert.equal(s.is({ email: " ada@example.com", role: "MEMBER" }), true);
  assert.equal(s.validate({ role: "owner" }).issues?.[0]?.keyword, "enum");
  const root = await load({ type: "string", transform: ["trimStart", "toUpperCase"] });
  assert.equal(root.validate("  ok ").value, "OK ");
  for (const [schema, message] of [
    [{ type: "string", transform: ["shout"] }, /"transform" lists the transforms to apply to a string, each one of "trim"/],
    [{ type: "string", transform: ["toEnumCase"] }, /"toEnumCase" needs an "enum" of strings beside it/],
    [{ enum: ["a", "A"], transform: ["toEnumCase"] }, /"toEnumCase" needs the strings of "enum" to differ other than by case/],
  ] as const) {
    for (const { problems } of [schemaTypes(JSON.stringify(schema), PATH), schemaCode(JSON.stringify(schema), PATH)]) assert.match(problems[0]!.message, message);
  }
});

test("a value with nothing to fill, transform, drop or strip comes back itself, and one with something, as a copy that shares every part it left alone", async () => {
  const s = await load({ type: "object", properties: { a: { type: "object", properties: { b: { type: "string" } } }, c: { type: "object", properties: { d: { default: 1 } } } } });
  const same = { a: { b: "x" }, c: { d: 2 } };
  assert.equal(s.validate(same).value, same);
  const value = { a: { b: "x" }, c: {} };
  const out = s.validate(value).value;
  assert.deepEqual(out, { a: { b: "x" }, c: { d: 1 } });
  assert.equal(out.a, value.a);
  assert.deepEqual(value, { a: { b: "x" }, c: {} });
  // A key named __proto__ is filled and kept as the value's own property.
  const proto = await load({ type: "object", properties: { ["__proto__"]: { default: 1 }, a: {} } });
  const filled = proto.validate(JSON.parse('{ "a": 1 }')).value;
  assert.equal(Object.hasOwn(filled, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(filled), Object.prototype);
});

test("a module carries the parts of the run time its schemas use, and where each object stands alone, a __post of one node that gives what the whole one gives", async () => {
  const open = { type: "object", properties: { a: {}, b: { type: "string" } }, required: ["c"] };
  const closed = { type: "object", properties: { a: {}, b: { type: "string" } }, additionalProperties: false };
  // The same object beside a property whose schema is a node of its own, which no value below holds.
  const nest = (schema: { properties: object }) => ({ ...schema, properties: { ...schema.properties, z: { type: "object", properties: { w: {} } } } });
  for (const [schema, values] of [
    [open, [{ c: 1 }, { a: undefined, b: "x", c: 1, d: 2 }, JSON.parse('{ "c": 1, "__proto__": 1 }'), "a string"]],
    [closed, [{}, { a: undefined }, { a: 1, b: undefined }]],
  ] as const) {
    const one = schemaCode(JSON.stringify(schema), PATH).code;
    const whole = schemaCode(JSON.stringify(nest(schema)), PATH).code;
    assert.doesNotMatch(one, /__pre|__keyed/);
    assert.match(whole, /__keyed/);
    assert.doesNotMatch(whole, /__pre/);
    const [s, t] = [(await evaluate(one)).default, (await evaluate(whole)).default];
    for (const value of values) {
      assert.deepEqual(s.validate(value), t.validate(value), JSON.stringify(value));
      if (s.validate(value).value === value) assert.equal(t.validate(value).value, value);
    }
  }
  assert.match(schemaCode(JSON.stringify({ type: "object", properties: { a: { default: 1 } } }), PATH).code, /__pre/);
});

test(".pick(), .omit(), .partial() and .required() keep the defaults of the keys they keep, and strip the keys they leave out of an open object", async () => {
  const s = await load({ type: "object", properties: { a: { type: "string", default: "x" }, b: { type: "number", default: 1 }, c: {} }, required: ["a"] });
  assert.deepEqual(s.pick("a").validate({ b: 2, c: 3 }).value, { a: "x" });
  assert.deepEqual(s.omit("a").validate({ a: "y" }).value, { b: 1 });
  assert.deepEqual(s.partial().validate({}).value, { a: "x", b: 1 });
  assert.deepEqual(s.required().validate({ c: 1 }).value, { a: "x", b: 1, c: 1 });
});

test("Standard JSON Schema's output document requires each property .validate() fills in, and its input is the schema as written", async () => {
  const s = await load({ $defs: { role: { enum: ["a", "b"], default: "a" } }, type: "object", properties: { role: { $ref: "#/$defs/role" }, n: { type: "number", default: 1 }, x: {} }, required: ["x"] });
  for (const target of ["draft-07", "draft-2020-12"]) {
    assert.deepEqual(s["~standard"].jsonSchema.input({ target }).required, ["x"], target);
    assert.deepEqual(s["~standard"].jsonSchema.output({ target }).required, ["x", "role", "n"], target);
  }
  assert.deepEqual(s.pick("n", "x")["~standard"].jsonSchema.output({ target: "draft-2020-12" }).required, ["x", "n"]);
  assert.deepEqual(s.partial()["~standard"].jsonSchema.output({ target: "draft-2020-12" }).required, ["role", "n"]);
  assert.deepEqual(s.partial()["~standard"].jsonSchema.input({ target: "draft-2020-12" }).required, []);
  // Without a default, the two are one document.
  const plain = await load({ type: "object", properties: { a: {} } });
  assert.deepEqual(plain["~standard"].jsonSchema.output({ target: "draft-07" }), plain["~standard"].jsonSchema.input({ target: "draft-07" }));
});

test("the module's output type is the value .validate() gives and its input the values it accepts, which .is() narrows to, under exactOptionalPropertyTypes and without", () => {
  for (const exact of [true, false]) {
    const dir = mkdtempSync(join(tmpdir(), "dotschema-output-types-"));
    const schema = {
      type: "object",
      properties: { name: { type: "string" }, role: { enum: ["admin", "member"], default: "member" }, email: { type: "string", transform: ["trim", "toLowerCase"] }, kind: { enum: ["A", "B"], transform: ["toEnumCase"] }, meta: { type: "object" } },
      required: ["name"],
    };
    writeFileSync(join(dir, "user.schema.jsonc"), JSON.stringify(schema));
    const u = exact ? " | undefined" : "";
    writeFileSync(
      join(dir, "main.ts"),
      [
        'import type { StandardSchemaV1 } from "dotschema";',
        'import user, { type output as Output, type input as Input } from "./user.schema.jsonc";',
        "type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;",
        "const expect = <T extends true>() => {};",
        "// The output: a default filled in, no key the object does not list, and no undefined.",
        'expect<Equal<Output, { name: string; role: "admin" | "member"; email?: string; kind?: "A" | "B"; meta?: { [key: string]: unknown } }>>();',
        "// The input: a default's key optional, any other key, and any string a transform reads.",
        `expect<Equal<Input, { name: string; role?: "admin" | "member"${u}; email?: string${u}; kind?: string${u}; meta?: { [key: string]: unknown }${u}; [key: string]: unknown }>>();`,
        "expect<Equal<user.output, Output>>();",
        "expect<Equal<user.input, Input>>();",
        "expect<Equal<StandardSchemaV1.InferOutput<typeof user>, Output>>();",
        "expect<Equal<StandardSchemaV1.InferInput<typeof user>, Input>>();",
        "const result = user.validate({});",
        "if (!result.issues) { const typed: Output = result.value; void typed; }",
        "const value: unknown = {};",
        "if (user.is(value)) { const typed: Input = value; void typed; }",
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
