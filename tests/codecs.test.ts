// Codecs (DESIGN.md, "Codecs" and "The project file"): a dotschema.jsonc beside a package's
// package.json turns a codec on for a format, and the modules of that package's schema files decode
// its strings in `.decode()` and write them back in `.encode()`, while `.validate()` and `.is()`
// keep the value as given. tests/fixtures/codecs is such a package, beside tests/fixtures/codecs-other,
// which has no project file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODES } from "../src/core/problems.ts";
import { toMapperHandlers } from "../src/core/universal.ts";
import { loader } from "../src/loader.ts";
import { schemaCode, schemaTypes } from "../src/schema.ts";
import { evaluate, ROOT, run, TSC } from "./helpers.ts";

const FIXTURE = join(ROOT, "tests/fixtures/codecs");
const EVENT = join(FIXTURE, "event.schema.jsonc");
const LOG = join(FIXTURE, "log.schema.jsonc");

/** The module of a schema file on disk. */
async function load(path: string) {
  const { code, problems } = schemaCode(readFileSync(path, "utf8"), path);
  assert.deepEqual(problems, []);
  return evaluate(code);
}

/** A package of its own in a temporary directory: a package.json, the project file if given, and schema files; the path of each schema file. */
function project(settings: string | undefined, schemas: Record<string, unknown>): { dir: string; paths: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-codecs-"));
  writeFileSync(join(dir, "package.json"), '{ "name": "p", "private": true, "type": "module" }\n');
  if (settings !== undefined) writeFileSync(join(dir, "dotschema.jsonc"), settings);
  const paths: Record<string, string> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    paths[name] = join(dir, name);
    writeFileSync(paths[name], typeof schema === "string" ? schema : JSON.stringify(schema));
  }
  return { dir, paths };
}

const ALL = '{ "codecs": { "date-time": "Temporal.Instant", "date": "Temporal.PlainDate", "duration": "Temporal.Duration", "int64": "bigint" } }';
const VISIT = { kind: "visit", until: "2026-10-21T00:00:00Z", at: "2026-10-20T08:00:00.123456789+02:00", day: "2026-10-20", seen: ["2026-10-19T00:00:00Z"], id: "9223372036854775807", every: "PT36H", note: "n", stamp: { on: "2026-10-01T00:00:00Z" } };

test(".decode() checks the value as given, then decodes each codec's strings in a copy; .validate() and .is() keep the value as given", async () => {
  const { default: event } = await load(EVENT);
  const input = structuredClone(VISIT);
  const decoded = event.decode(input);
  assert.equal(decoded.issues, undefined);
  const value = decoded.value;
  assert.ok(value.at instanceof Temporal.Instant);
  assert.equal(value.at.toString(), "2026-10-20T06:00:00.123456789Z");
  // Through a $ref, an array's items, the tagged variant of a oneOf, and the member of an anyOf.
  assert.ok(value.day instanceof Temporal.PlainDate);
  assert.ok(value.seen[0] instanceof Temporal.Instant);
  assert.ok(value.until instanceof Temporal.Instant);
  assert.ok(value.every instanceof Temporal.Duration);
  assert.equal(value.id, 9223372036854775807n);
  assert.equal(value.note, "n");
  // The other package has no project file, so its date-time stays a string.
  assert.equal(value.stamp.on, "2026-10-01T00:00:00Z");
  // The value passed in is not changed, and what nothing decodes is shared.
  assert.deepEqual(input, VISIT);
  assert.equal(value.stamp, input.stamp);
  // .validate() and .is() are as they were: the same object, unchanged.
  assert.equal(event.validate(input).value, input);
  assert.equal(event.is(input), true);
  // A null where the anyOf allows one stays null, and a click has no until to decode.
  const click = event.decode({ kind: "click", x: 1, at: "2026-10-20T08:00:00Z", every: null });
  assert.equal(click.value.every, null);
  assert.equal(click.value.until, undefined);
  // A value .validate() refuses is refused by .decode() with the same issues.
  assert.deepEqual(event.decode({ kind: "visit", at: "x" }), event.validate({ kind: "visit", at: "x" }));
});

test(".encode() is .decode()'s inverse: each value written back as its string, then checked as .validate() checks", async () => {
  const { default: event } = await load(EVENT);
  const given = { ...structuredClone(VISIT), at: "2026-10-20T06:00:00.123456789Z" };
  const decoded = event.decode(given).value;
  assert.deepEqual(event.encode(decoded), { value: given });
  // An instant comes back in Z, the same instant as the offset it was written with.
  assert.equal(event.encode(event.decode(VISIT).value).value.at, "2026-10-20T06:00:00.123456789Z");
  // A string where the codec always applies is the value as given, not the codec's, and an issue.
  assert.deepEqual(event.encode({ ...decoded, at: "2026-10-20T06:00:00Z" }).issues, [{ message: "must be a Temporal.Instant, not a string", path: ["at"], keyword: "encode" }]);
  // A value of the wrong kind is not written, and the check refuses it.
  assert.deepEqual(
    event.encode({ ...decoded, day: Temporal.Instant.from("2026-10-20T00:00:00Z") }).issues.map((issue: any) => [issue.path, issue.keyword]),
    [[["day"], "type"]],
  );
  // A bigint int64 cannot hold, and a date in another calendar, written as its ISO date.
  assert.deepEqual(event.encode({ ...decoded, id: 2n ** 63n }).issues, [{ message: "could not be encoded: a bigint outside int64's range", path: ["id"], keyword: "encode" }]);
  assert.equal(event.encode({ ...decoded, day: Temporal.PlainDate.from("2026-10-20").withCalendar("hebrew") }).value.day, "2026-10-20");
  // A duration is written in Temporal's form, which the format accepts.
  assert.equal(event.encode({ ...decoded, every: Temporal.Duration.from("P0D") }).value.every, "PT0S");
});

test("Standard Schema's validate is .decode() and encode is .encode(); jsonSchema.output throws, and .input is the schema as given", async () => {
  const { default: event } = await load(EVENT);
  assert.deepEqual(Object.keys(event), ["validate", "is", "decode", "encode", "schema", "~standard"]);
  assert.equal(event["~standard"].validate, event.decode);
  assert.equal(event["~standard"].encode, event.encode);
  assert.notEqual(event.decode, event.validate);
  assert.equal(event["~standard"].jsonSchema.input({ target: "draft-2020-12" }).properties.at.format, "date-time");
  assert.throws(() => event["~standard"].jsonSchema.output({ target: "draft-2020-12" }), /decodes strings with a codec of dotschema\.jsonc's/);
});

test("a codec is exact or refuses: a leap second, a tenth digit of a second, and an int64 written otherwise are issues at their places", async () => {
  const { default: event } = await load(EVENT);
  const base = { kind: "click", x: 1, at: "2026-10-20T08:00:00Z" };
  const issues = (value: object) => event.decode({ ...base, ...value }).issues;
  // Each passes the format, so .validate() accepts it.
  for (const value of [{ at: "2016-12-31T23:59:60Z" }, { at: "2026-10-20T08:00:00.1234567891Z" }, { id: "007" }]) assert.equal(event.is({ ...base, ...value }), true);
  assert.deepEqual(issues({ at: "2016-12-31T23:59:60Z" }), [{ message: "could not be decoded: a leap second, which a Temporal.Instant cannot hold", path: ["at"], keyword: "decode" }]);
  assert.deepEqual(issues({ at: "2026-10-20T08:00:00.1234567891Z" }), [{ message: "could not be decoded: more than nine digits of a second, which a Temporal.Instant cannot hold", path: ["at"], keyword: "decode" }]);
  // The int64 format checks numbers alone, so the codec checks the digits.
  for (const id of ["007", "-0", "+1", "1.5", "abc"]) assert.deepEqual(issues({ id }), [{ message: "could not be decoded: not an integer written as int64 is, without a sign of + or a leading zero", path: ["id"], keyword: "decode" }], id);
  assert.deepEqual(issues({ id: "9223372036854775808" }), [{ message: "could not be decoded: an integer outside int64's range", path: ["id"], keyword: "decode" }]);
  assert.equal(event.decode({ ...base, id: "-9223372036854775808" }).value.id, -9223372036854775808n);
  // Every place is reported, not the first alone.
  assert.equal(issues({ at: "2016-12-31T23:59:60Z", seen: ["2016-12-31T23:59:60Z"] }).length, 2);
  // An instant whose year in UTC has no four digits would not be written back in Z as the format takes it.
  const years = "an instant outside the years 0000 to 9999 in UTC, which date-time cannot write";
  for (const at of ["0000-01-01T00:00:00+00:01", "9999-12-31T23:30:00-01:00"]) assert.deepEqual(issues({ at }), [{ message: `could not be decoded: ${years}`, path: ["at"], keyword: "decode" }], at);
  assert.equal(String(event.decode({ ...base, at: "0000-01-01T00:00:00-00:01" }).value.at), "0000-01-01T00:01:00Z");
  const decoded = event.decode(base).value;
  assert.deepEqual(event.encode({ ...decoded, at: Temporal.Instant.from("+010000-01-01T00:00:00Z") }).issues, [{ message: `could not be encoded: ${years}`, path: ["at"], keyword: "encode" }]);
  assert.deepEqual(event.encode({ ...decoded, day: Temporal.PlainDate.from("-000001-01-01") }).issues, [{ message: "could not be encoded: a date outside the years 0000 to 9999, which the date format cannot write", path: ["day"], keyword: "encode" }]);
});

test("where Temporal is missing, .decode() is an issue at each place a Temporal codec decodes, never a throw, and .validate() and .is() still work", async () => {
  const { default: event } = await load(EVENT);
  const temporal = Object.getOwnPropertyDescriptor(globalThis, "Temporal")!;
  delete (globalThis as { Temporal?: unknown }).Temporal;
  try {
    assert.equal(typeof (globalThis as { Temporal?: unknown }).Temporal, "undefined");
    assert.deepEqual(event.decode({ kind: "click", x: 1, at: "2026-10-20T08:00:00Z", day: "2026-10-20", id: "1" }).issues, [
      { message: "could not be decoded: Temporal is not defined in this runtime", path: ["at"], keyword: "decode" },
      { message: "could not be decoded: Temporal is not defined in this runtime", path: ["day"], keyword: "decode" },
    ]);
    assert.equal(event.is({ kind: "click", x: 1, at: "2026-10-20T08:00:00Z" }), true);
    // Nothing is a Temporal value, so a string at a Temporal codec's place is the issue in .encode().
    assert.equal(event.encode({ kind: "click", x: 1, at: "2026-10-20T08:00:00Z" }).issues[0].keyword, "encode");
  } finally {
    Object.defineProperty(globalThis, "Temporal", temporal);
  }
});

test("a union's member is its tag's, or else the first member whose own validator passes; an if picks its branch; a key goes where ajv sends it", async () => {
  const { paths } = project(ALL, {
    "u.schema.jsonc": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        // No tag: the first member that passes decides, Zod's rule.
        when: { anyOf: [{ type: "string", maxLength: 3 }, { type: "string", format: "date-time" }, { type: "string", format: "date" }] },
        // An if that tests the value: a date-time decodes, an "x" stays.
        cond: { if: { type: "string", minLength: 5 }, then: { format: "date-time" }, else: { const: "x" } },
        pair: { type: "array", prefixItems: [{ type: "string" }, { type: "string", format: "date" }], items: { type: "string", format: "duration" } },
        map: { type: "object", patternProperties: { "^d_": { type: "string", format: "date" } }, additionalProperties: { type: "string", format: "duration" }, properties: { plain: { type: "string" } } },
      },
    },
  });
  const { default: u } = await load(paths["u.schema.jsonc"]!);
  const { value } = u.decode(JSON.parse('{ "when": "abc", "cond": "2026-10-20T00:00:00Z", "pair": ["2026-10-20", "2026-10-21", "P1D", "PT1H"], "map": { "plain": "PT9H", "d_x": "2026-10-20", "e": "PT1H", "__proto__": "P2D" } }'));
  assert.equal(value.when, "abc");
  assert.ok(u.decode({ when: "2026-10-20T00:00:00Z" }).value.when instanceof Temporal.Instant);
  assert.ok(u.decode({ when: "2026-10-20" }).value.when instanceof Temporal.PlainDate);
  assert.ok(value.cond instanceof Temporal.Instant);
  assert.equal(u.decode({ cond: "x" }).value.cond, "x");
  assert.equal(value.pair[0], "2026-10-20");
  assert.ok(value.pair[1] instanceof Temporal.PlainDate);
  assert.ok(value.pair[2] instanceof Temporal.Duration && value.pair[3] instanceof Temporal.Duration);
  // A key `properties` names is not additional; one a pattern matches is the pattern's; the rest are additional.
  assert.equal(value.map.plain, "PT9H");
  assert.ok(value.map.d_x instanceof Temporal.PlainDate);
  assert.ok(value.map.e instanceof Temporal.Duration);
  // A `__proto__` key of the value's own is an additional property, decoded as one, and stays the copy's own.
  assert.ok(Object.hasOwn(value.map, "__proto__") && value.map.__proto__ instanceof Temporal.Duration);
  assert.equal(Object.getPrototypeOf(value.map), Object.prototype);
  assert.deepEqual(u.encode(value), { value: JSON.parse('{ "when": "abc", "cond": "2026-10-20T00:00:00Z", "pair": ["2026-10-20", "2026-10-21", "P1D", "PT1H"], "map": { "plain": "PT9H", "d_x": "2026-10-20", "e": "PT1H", "__proto__": "P2D" } }') });
});

test(".encode() takes back what .decode() gave, whichever member of a union or branch of an if the value took", async () => {
  const { paths } = project(ALL, {
    "v.schema.jsonc": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        tagged: { oneOf: [{ properties: { kind: { const: "a" }, at: { type: "string" } }, required: ["kind"] }, { properties: { kind: { const: "b" }, at: { type: "string", format: "date-time" } }, required: ["kind"] }] },
        first: { anyOf: [{ type: "object", properties: { at: { type: "string", maxLength: 3 } } }, { type: "object", properties: { at: { type: "string", format: "date-time" } } }] },
        cond: { type: "object", properties: { k: { enum: ["a", "b"] } }, required: ["k"], if: { properties: { k: { const: "a" } } }, then: { properties: { at: { type: "string", format: "date-time" } } }, else: { properties: { at: { type: "string" } } } },
      },
    },
  });
  const { default: v } = await load(paths["v.schema.jsonc"]!);
  for (const given of [
    { tagged: { kind: "a", at: "hello" }, first: { at: "abc" }, cond: { k: "b", at: "hello" } },
    { tagged: { kind: "a", at: "2026-10-20T00:00:00Z" }, first: { at: "2026-10-20T00:00:00Z" }, cond: { k: "b", at: "2026-10-20T00:00:00Z" } },
    { tagged: { kind: "b", at: "2026-10-20T00:00:00Z" }, cond: { k: "a", at: "2026-10-20T00:00:00Z" } },
  ]) {
    const decoded = v.decode(given).value;
    assert.deepEqual(v.encode(decoded), { value: given }, JSON.stringify(given));
  }
  // The member that decodes gives an Instant, which comes back as its string; the other keeps its string.
  assert.ok(v.decode({ tagged: { kind: "b", at: "2026-10-20T00:00:00Z" } }).value.tagged.at instanceof Temporal.Instant);
  assert.equal(v.decode({ tagged: { kind: "a", at: "2026-10-20T00:00:00Z" } }).value.tagged.at, "2026-10-20T00:00:00Z");
});

test("a picked or omitted schema keeps the codecs of the properties it keeps, and a definition decodes as the root does", async () => {
  const { default: log } = await load(LOG);
  assert.ok(log.pick("at").decode({ at: "2026-10-20T00:00:00Z" }).value.at instanceof Temporal.Instant);
  // Without the property a codec decodes, a picked schema decodes nothing: the value comes back as given.
  const message = log.omit("at");
  const value = { message: "m" };
  assert.equal(message.decode(value).value, value);
  assert.doesNotThrow(() => message["~standard"].jsonSchema.output({ target: "draft-07" }));
  assert.throws(() => log.pick("at")["~standard"].jsonSchema.output({ target: "draft-07" }), /codec/);
  const { day } = await load(EVENT);
  assert.ok(day.decode("2026-10-20").value instanceof Temporal.PlainDate);
});

test("a schema that types a value as a string beside a codec it does not carry is a problem, in the build and the type check alike", () => {
  const { paths } = project(ALL, {
    "r.schema.jsonc": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { at: { type: "string" } },
      allOf: [{ properties: { at: { format: "date-time" } } }],
    },
    "ref.schema.jsonc": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { at: { $ref: "#/$defs/text", format: "date-time" } },
      $defs: { text: { type: "string" } },
    },
    "all.schema.jsonc": { $schema: "https://json-schema.org/draft/2020-12/schema", allOf: [{ type: "string" }, { format: "date-time" }] },
    "int64.schema.jsonc": { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: { a: { format: "date-time" } }, allOf: [{ properties: { a: { type: "string", format: "int64" } } }] },
    "deep.schema.jsonc": (() => {
      // 70 levels of `c`, ending in a string, beside an allOf of as many ending in the codec's format.
      const nest = (leaf: object): object => Array.from({ length: 70 }).reduce<object>((inner) => ({ type: "object", properties: { c: inner } }), { type: "object", properties: { at: leaf } });
      return { $schema: "https://json-schema.org/draft/2020-12/schema", ...nest({ type: "string" }), allOf: [nest({ format: "date-time" })] };
    })(),
    // A variant of a oneOf beside another that types the same property as a plain string is not a problem: one variant applies.
    "v.schema.jsonc": {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      oneOf: [
        { properties: { kind: { const: "a" }, at: { type: "string", format: "date-time" } }, required: ["kind"] },
        { properties: { kind: { const: "b" }, at: { type: "string" } }, required: ["kind"] },
      ],
    },
  });
  const problems = (file: string) => {
    const source = readFileSync(paths[file]!, "utf8");
    const types = schemaTypes(source, paths[file]!).problems;
    assert.ok(types.every((p) => p.code === CODES.schema));
    assert.deepEqual(types.map((p) => p.message), schemaCode(source, paths[file]!).problems.map((p) => p.message));
    return types.map((p) => p.message);
  };
  assert.deepEqual(problems("r.schema.jsonc"), ['The codec Temporal.Instant decodes the date-time strings of #/allOf/0/properties/at, which #/properties/at types as a string without it: give #/properties/at "format": "date-time" too, or put the format and the type in one schema.']);
  assert.deepEqual(problems("v.schema.jsonc"), []);
  // A string type below a schema with the codec is typed within it, the codec's type in place of the string.
  for (const file of ["ref.schema.jsonc", "all.schema.jsonc"]) assert.deepEqual(problems(file), [], file);
  // The int64 format takes every string, so its codec and another would both decode one.
  assert.deepEqual(problems("int64.schema.jsonc"), ["The codecs bigint of #/allOf/0/properties/a and Temporal.Instant of #/properties/a would both decode one string, since the int64 format checks numbers alone and takes every string: keep one of the two formats."]);
  // However deep the place, the check reaches it.
  assert.equal(problems("deep.schema.jsonc").length, 1);
});

test("the project file's problems are reported in both texts, each naming the file, its line and column", () => {
  const schema = { type: "string", format: "date-time" };
  for (const [settings, expected] of [
    ['{ "codecs": { "date-time": "Date" } }', 'dotschema.jsonc:1:15: the date-time format decodes to "Temporal.Instant"; the codecs are "date-time": "Temporal.Instant", "date": "Temporal.PlainDate", "duration": "Temporal.Duration", "int64": "bigint".'],
    ['{\n  "codecs": { "time": "Temporal.PlainTime" } }', 'dotschema.jsonc:2:15: dotschema has no codec for the time format; the codecs are "date-time": "Temporal.Instant", "date": "Temporal.PlainDate", "duration": "Temporal.Duration", "int64": "bigint".'],
    ['{ "codec": {} }', 'dotschema.jsonc:1:3: dotschema reads "codecs" from its project file, not "codec".'],
    ['{ "codecs": { "date-time": "Temporal.Instant" ', "dotschema.jsonc:1:47: Close Brace Expected"],
  ] as const) {
    const { paths } = project(settings, { "a.schema.jsonc": schema });
    const path = paths["a.schema.jsonc"]!;
    const source = readFileSync(path, "utf8");
    assert.deepEqual(schemaCode(source, path).problems.map((p) => [p.message, p.code]), [[expected, CODES.project]], settings);
    assert.deepEqual(schemaTypes(source, path).problems.map((p) => [p.message, p.code]), [[expected, CODES.project]], settings);
  }
  // A `$schema` key is for an editor, and a project file of no codecs changes nothing.
  const { paths } = project('{ "$schema": "x", "codecs": {} }', { "a.schema.jsonc": schema });
  assert.deepEqual(schemaCode(readFileSync(paths["a.schema.jsonc"]!, "utf8"), paths["a.schema.jsonc"]!).problems, []);
});

test("the project file is the one beside the package's package.json: the module names it to watch, and a package without one decodes nothing", async () => {
  const { watchFiles } = schemaCode(readFileSync(EVENT, "utf8"), EVENT);
  assert.ok(watchFiles.includes(join(FIXTURE, "dotschema.jsonc")));
  // In a directory below the package, the package's file still applies.
  const { dir } = project(ALL, {});
  mkdirSync(join(dir, "nested/deeper"), { recursive: true });
  writeFileSync(join(dir, "nested/deeper/a.schema.jsonc"), '{ "type": "string", "format": "date" }');
  const { default: a } = await load(join(dir, "nested/deeper/a.schema.jsonc"));
  assert.ok(a.decode("2026-10-20").value instanceof Temporal.PlainDate);
  // A package.json between the file and the project file starts another package, which has none.
  writeFileSync(join(dir, "nested/package.json"), "{}");
  const { default: b } = await load(join(dir, "nested/deeper/a.schema.jsonc"));
  assert.equal(b.decode("2026-10-20").value, "2026-10-20");
  assert.equal(b.decode, b.validate);
  const types = schemaTypes(readFileSync(join(dir, "nested/deeper/a.schema.jsonc"), "utf8"), join(dir, "nested/deeper/a.schema.jsonc")).types;
  assert.doesNotMatch(types, /CodecSchema|reference lib|Temporal/);
});

test("the content mapper watches the project file of the tsconfig's package, existing or not, and its identity changes with the file", () => {
  const handlers = toMapperHandlers(loader);
  const dir = mkdtempSync(join(tmpdir(), "dotschema-codecs-mapper-"));
  writeFileSync(join(dir, "package.json"), "{}");
  const open = () => handlers.openProject!({ configFileName: join(dir, "tsconfig.json"), projectHandle: "p", options: { codecs: {} } }) as { configIdentity: string; watchedFiles: string[]; optionDiagnostics: { messageText: string }[] };
  const none = open();
  assert.deepEqual(none.watchedFiles, [join(dir, "dotschema.jsonc")]);
  assert.deepEqual(none.optionDiagnostics.map((d) => d.messageText), ['dotschema takes no options: its settings go in dotschema.jsonc, beside package.json. Remove "codecs" here.']);
  writeFileSync(join(dir, "dotschema.jsonc"), ALL);
  const some = open();
  assert.notEqual(some.configIdentity, none.configIdentity);
  assert.equal(open().configIdentity, some.configIdentity);
  rmSync(dir, { recursive: true, force: true });
  // The package declares it, so TypeScript asks for the identity.
  assert.equal(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).typescript.contentMapper.dynamicConfig, true);
});

test("the types: Type is the decoded value and Input the value as given, and a module with a Temporal codec brings Temporal's lib in", () => {
  const types = schemaTypes(readFileSync(LOG, "utf8"), LOG).types;
  assert.match(types, /^\/\/\/ <reference lib="esnext\.temporal" \/>\n/);
  assert.match(types, /\ninterface Log \{\n  at: Temporal\.Instant;\n  message: string;\n\}\ninterface LogInput \{\n  at: string;\n  message: string;\n\}\nexport type \{ Log as Type, LogInput as Input \};\n/);
  assert.match(types, /\ndeclare const schema: __DotschemaObjectCodecSchema<\{\n  at: Temporal\.Instant;\n  message: string;\n\}, Json, "at" \| "message", \{\n  at: string;\n  message: string;\n\}>;\n/);
  // A bigint codec alone names no Temporal.
  const { paths } = project(ALL, { "n.schema.jsonc": { type: "string", format: "int64" } });
  assert.doesNotMatch(schemaTypes(readFileSync(paths["n.schema.jsonc"]!, "utf8"), paths["n.schema.jsonc"]!).types, /reference lib/);
  // The fixture's exact types, on lib es2022, which declares no Temporal.
  const checked = run(TSC, ["-p", "tests/fixtures/codecs/tsconfig.json", "--runExternalCode"]);
  assert.equal(checked.out, "");
  assert.equal(checked.status, 0);
});

test("the preload and the esbuild plugin find the same project file, from the schema file's path", async () => {
  const { dir } = project(ALL, { "e.schema.jsonc": { type: "object", properties: { at: { type: "string", format: "date-time" } } } });
  writeFileSync(join(dir, "main.ts"), 'import e from "./e.schema.jsonc";\nconst { value } = e.decode({ at: "2026-10-20T08:00:00+02:00" });\nconsole.log(JSON.stringify([value.at instanceof Temporal.Instant, String(value.at), e.encode(value).value.at]));\n');
  const expected = '[true,"2026-10-20T06:00:00Z","2026-10-20T06:00:00Z"]';
  const preloaded = run(process.execPath, ["--import", join(ROOT, "src/register.ts"), "main.ts"], dir);
  assert.equal(preloaded.out.trim(), expected, preloaded.out);
  const { build } = await import("esbuild");
  const { default: dotschema } = await import("../src/esbuild.ts");
  const bundled = await build({ entryPoints: [join(dir, "main.ts")], outfile: join(dir, "main.mjs"), bundle: true, format: "esm", platform: "node", plugins: [dotschema()], logLevel: "silent", metafile: true });
  assert.deepEqual(bundled.errors, []);
  assert.equal(run(process.execPath, ["main.mjs"], dir).out.trim(), expected);
  rmSync(dir, { recursive: true, force: true });
});
