// dotschema's formats (src/formats/): the JSON Schema Test Suite's format tests, which assume that
// `format` asserts, as it does here; the copies of ajv-formats' formats against ajv-formats itself;
// and the files a module carries, which are the formats it uses. The suite's files are in
// tests/fixtures/format-suite, copied from json-schema-org/JSON-Schema-Test-Suite at 89e83a7
// (2026-10-22), tests/draft2020-12/optional/format; its tests/draft7/optional/format holds the same
// tests but for duration and uuid, which draft-07 does not name, and each runs under both drafts here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { formatDefinitions } from "../src/formats/index.ts";
import { schemaCode } from "../src/schema.ts";
import { evaluate, ROOT } from "./helpers.ts";

const PATH = join(ROOT, "tests/fixtures/format.schema.jsonc");
const SUITE = join(ROOT, "tests/fixtures/format-suite");
type Group = { description: string; schema: Record<string, unknown>; tests: { description: string; data: unknown; valid: boolean }[] };
const suite: Record<string, Group[]> = Object.fromEntries(readdirSync(SUITE).filter((file) => file.endsWith(".json")).map((file) => [file.slice(0, -".json".length), JSON.parse(readFileSync(join(SUITE, file), "utf8"))]));

/**
 * The suite's tests dotschema fails, by file, each test by its description, with why. Each is a
 * format dotschema keeps as ajv-formats 3.0.1 has it (DESIGN.md, "Formats").
 */
const FAILING: Record<string, string[]> = {
  // ajv-formats' `regex` reads a pattern without the `u` flag, where `\a` is an identity escape.
  "ecmascript-regex": ["when used as a pattern"],
  // ajv-formats' `email` is a regular expression for the common form: no quoted local part, no address literal.
  email: [
    "a quoted string with a space in the local part is valid",
    "a quoted string with a double dot in the local part is valid",
    "a quoted string with a @ in the local part is valid",
    "an IPv4-address-literal after the @ is valid",
    "an IPv6-address-literal after the @ is valid",
    "an empty quoted string in the local part is valid",
    "a quoted string containing only a space in the local part is valid",
    "a single-label domain is valid",
    "a quoted string with no special characters in the local part is valid",
    "a quoted pair in the local part is valid",
    "an escaped double quote in the local part is valid",
    "an escaped backslash in the local part is valid",
    "a lowercase IPv6 tag in an address literal is valid",
  ],
  // ajv-formats' `hostname` reads an A-label as letters, digits and hyphens, and takes a trailing dot.
  hostname: [
    "trailing dot",
    "invalid Punycode",
    "contains illegal char U+302E Hangul single dot tone mark",
    "Begins with a Spacing Combining Mark",
    "Begins with a Nonspacing Mark",
    "Begins with an Enclosing Mark",
    "Exceptions that are DISALLOWED, right-to-left chars",
    "Exceptions that are DISALLOWED, left-to-right chars",
    "MIDDLE DOT with no preceding 'l'",
    "MIDDLE DOT with nothing preceding",
    "MIDDLE DOT with no following 'l'",
    "MIDDLE DOT with nothing following",
    "Greek KERAIA not followed by Greek",
    "Greek KERAIA not followed by anything",
    "Hebrew GERESH not preceded by Hebrew",
    "Hebrew GERESH not preceded by anything",
    "Hebrew GERSHAYIM not preceded by Hebrew",
    "Hebrew GERSHAYIM not preceded by anything",
    "KATAKANA MIDDLE DOT with no Hiragana, Katakana, or Han",
    "KATAKANA MIDDLE DOT with no other characters",
    "Arabic-Indic digits mixed with Extended Arabic-Indic digits",
    "ZERO WIDTH JOINER not preceded by Virama",
    "ZERO WIDTH JOINER not preceded by anything",
    'contains "--" in the 3rd and 4th position',
  ],
  // ajv-formats' `uri`, `uri-reference` and `uri-template` are regular expressions looser than RFC 3986 and RFC 6570 in places.
  uri: [
    "non-numeric port is invalid",
    "leading zero in an embedded IPv4 address is invalid",
    "square brackets are not allowed in a path segment",
    "an IPv6 address without enclosing brackets is invalid",
  ],
  "uri-reference": [
    "a double quote in a path",
    "square brackets outside an authority",
    "a non-numeric port in a network-path reference",
    "more than one at-sign in the authority",
    "a colon in the first segment of a relative-path reference",
    "a leading zero in the IPv4 part of an IPv6 literal",
  ],
  "uri-template": ["a dotted variable name is valid", "a delete character in a literal is invalid", "an apostrophe in a literal is valid"],
};

/** The module for a group's schema, under its own draft or, without its `$schema`, under draft-07. */
async function moduleOf(schema: Record<string, unknown>, draft: "2020-12" | "draft-07") {
  const { $schema: _, ...rest } = schema;
  const { code, problems } = schemaCode(JSON.stringify(draft === "2020-12" ? schema : rest), PATH);
  assert.deepEqual(problems, []);
  return (await evaluate(code)).default;
}

for (const draft of ["2020-12", "draft-07"] as const) {
  test(`the JSON Schema Test Suite's format tests pass under ${draft}, but for the ones a format kept from ajv-formats fails`, async () => {
    for (const [file, groups] of Object.entries(suite)) {
      const failing: string[] = [];
      for (const group of groups) {
        const module = await moduleOf(group.schema, draft);
        for (const { description, data, valid } of group.tests) {
          // The two validators agree, and give the verdict the suite gives.
          assert.equal(!module.validate(data).issues, module.is(data), `${file}: ${description}`);
          if (module.is(data) !== valid) failing.push(description);
        }
      }
      assert.deepEqual(failing.sort(), [...(FAILING[file] ?? [])].sort(), file);
    }
  });
}

test("dotschema's copies of ajv-formats' formats give its verdicts and its order, but where date-time, time, duration and uuid follow the suite", async () => {
  const require = createRequire(join(ROOT, "src/schema.ts"));
  const theirs: Record<string, any> = require("ajv-formats/dist/formats").fullFormats;
  const ours = Object.fromEntries(formatDefinitions()) as Record<string, any>;
  const verdict = (format: any, value: unknown): boolean | undefined => {
    if (format === true) return true;
    if (format instanceof RegExp) return typeof value === "string" ? format.test(value) : undefined;
    const type = typeof format === "function" ? "string" : (format.type ?? "string");
    if (typeof value !== type) return undefined;
    return (typeof format === "function" ? format : format.validate)(value);
  };
  // Every string of the suite, the samples a format of numbers takes, and strings either side of the changes.
  const strings = new Set<string>(Object.values(suite).flatMap((groups) => groups.flatMap((group) => group.tests.map((t) => t.data)).filter((data): data is string => typeof data === "string")));
  const extra = ["2026-10-20 08:00:00Z", "2026-10-20\t08:00:00Z", "2026-10-20\n08:00:00Z", "08:00:00+01", "08:00:00+0130", "08:00:00-0530", "23:59:60+00:00", "23:59:60.5Z", "PT1H2S", "P1Y2D", "P1Y2M3D", "PT1H2M3S", "urn:uuid:2eb8aa08-aa98-11ea-b4aa-73b441d16380", "2026-10-20", "2026-10-20T08:00:00.123456789012345Z"];
  const values: unknown[] = [...new Set([...strings, ...extra]), 0, 1, -1, 1.5, 2 ** 31 - 1, 2 ** 31, -(2 ** 31), -(2 ** 31) - 1, 2 ** 53, Number.MAX_VALUE];
  // Where the four differ from ajv-formats: each string the suite holds for that format, with the suite's verdict, and the date-time with white space between its date and time, which RFC 3339's grammar does not have.
  const expected: Record<string, string[]> = {
    "date-time": ["1985-04-12T00:59:59.999999999999999Z", "1985-04-12T23:20:50+01", "1985-04-12T23:60:00+00:01", "2016-12-31T24:59:60+01:00", "2020-01-01 00:00:00Z", "2026-10-20 08:00:00Z", "2026-10-20\t08:00:00Z", "2026-10-20\n08:00:00Z"],
    time: ["00:59:59.999999999999999Z", "08:00:00+01", "08:00:00+0130", "08:00:00-0530", "08:30:06+01", "08:30:06+0130", "23:60:00+00:01", "24:59:00+01:00"],
    duration: ["P1Y2D", "PT1H2S"],
    uuid: ["urn:uuid:2eb8aa08-aa98-11ea-b4aa-73b441d16380"],
  };
  assert.deepEqual(Object.keys(ours).sort(), Object.keys(theirs).sort());
  const differ: Record<string, string[]> = {};
  for (const name of Object.keys(theirs))
    for (const value of values) if (verdict(ours[name], value) !== verdict(theirs[name], value)) (differ[name] ??= []).push(String(value));
  assert.deepEqual(Object.fromEntries(Object.entries(differ).map(([name, list]) => [name, list.sort()])), Object.fromEntries(Object.entries(expected).map(([name, list]) => [name, list.sort()])));
  // Where they differ, dotschema has the suite's verdict.
  for (const [name, list] of Object.entries(differ))
    for (const value of list) for (const group of suite[name] ?? []) for (const t of group.tests) if (t.data === value) assert.equal(verdict(ours[name], value), t.valid, `${name}: ${value}`);
  // The order formatMinimum and its kin read, for the five formats that have one.
  const ordered: Record<string, string[]> = {
    date: ["2020-01-01", "2020-01-02", "2019-12-31", "2020-1-1"],
    time: ["08:00:00Z", "09:00:00+01:00", "07:59:59.5Z", "08:00:00"],
    "date-time": ["2026-10-20T08:00:00Z", "2026-10-20T09:00:00+01:00", "2026-10-21T00:00:00Z", "nope"],
    "iso-time": ["08:00:00", "08:00:01Z", "07:00:00+01:00", "x"],
    "iso-date-time": ["2026-10-20T08:00:00", "2026-10-20 08:00:01Z", "2026-10-19T23:00:00", "x"],
  };
  for (const [name, samples] of Object.entries(ordered)) for (const a of samples) for (const b of samples) assert.equal(ours[name].compare(a, b), theirs[name].compare(a, b), `${name}: ${a} ${b}`);
});

/** The names of the format files a module carries, by the first line of each, "// The format `name`". */
const formatFiles = (code: string) => [...code.matchAll(/^\/\/ The format `([^`]+)`/gm)].map((m) => m[1]).sort();

test("a module carries the file of each format it checks with a function, and the files that file requires, and no other", async () => {
  const build = async (properties: Record<string, unknown>) => {
    const { code, problems } = schemaCode(JSON.stringify({ type: "object", properties }), PATH);
    assert.deepEqual(problems, []);
    return { code, module: (await evaluate(code)).default };
  };
  // No format, and a format ajv writes as a regular expression: no file and no table of formats.
  for (const properties of [{ a: { type: "string" } }, { a: { type: "string", format: "email" } }]) {
    const { code } = await build(properties);
    assert.deepEqual(formatFiles(code), []);
    assert.doesNotMatch(code, /__formats/);
  }
  // date-time requires date and time; nothing of the other date and time formats comes with it.
  const { code, module } = await build({ at: { type: "string", format: "date-time" } });
  assert.deepEqual(formatFiles(code), ["date", "date-time", "time"]);
  assert.match(code, /^const __formats = \{ "date-time": __require\(\d+\) \};$/m);
  assert.deepEqual([module.is({ at: "2026-10-20T08:00:00Z" }), module.is({ at: "2026-10-20T08:00:00+01" })], [true, false]);
  // Each file once, for both validators and for each property that uses it.
  const several = await build({ a: { format: "date-time" }, b: { format: "date-time", formatMinimum: "2026-01-01T00:00:00Z" }, c: { format: "date" }, d: { format: "uri" } });
  assert.deepEqual(formatFiles(several.code), ["date", "date-time", "time", "uri"]);
  assert.deepEqual([several.module.is({ b: "2026-02-01T00:00:00Z", c: "2026-01-01", d: "https://x.dev" }), several.module.is({ b: "2025-12-31T23:59:59Z" })], [true, false]);
});

test("a string in the schema that reads like the module's table of formats stays the schema's", async () => {
  // usedFormats reads ajv's declarations of the formats it uses, and never rewrites the code; a string that holds one adds at most a file.
  const text = "const formats0 = __formats.uri;";
  const { code, problems } = schemaCode(JSON.stringify({ type: "object", properties: { note: { const: text }, at: { format: "date" } } }), PATH);
  assert.deepEqual(problems, []);
  const { default: s } = await evaluate(code);
  assert.deepEqual([s.is({ note: text, at: "2026-10-20" }), s.is({ note: "other" }), s.is({ at: "2026-02-30" })], [true, false, false]);
});
