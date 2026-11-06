// dotschema's formats (src/formats/): the JSON Schema Test Suite's format tests, which assume that
// `format` asserts, as it does here, and which all pass; the copies of ajv-formats' formats against
// ajv-formats itself; Zod's formats against Zod itself, by dotschema's names and by Zod's where they
// differ; and the files a module carries, which are the formats it uses. The suite's files are in tests/fixtures/format-suite, copied from
// json-schema-org/JSON-Schema-Test-Suite at 89e83a7 (2026-10-22), tests/draft2020-12/optional/format;
// its tests/draft7/optional/format holds the same tests but for duration and uuid, which draft-07 does
// not name, and each runs under both drafts here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import * as z from "zod";
import { ALIASES, FORMATS, formatDefinitions } from "../src/formats/index.ts";
import { schemaCode } from "../src/schema.ts";
import { evaluate, ROOT } from "./helpers.ts";

const PATH = join(ROOT, "tests/fixtures/format.schema.jsonc");
const SUITE = join(ROOT, "tests/fixtures/format-suite");
type Group = { description: string; schema: Record<string, unknown>; tests: { description: string; data: unknown; valid: boolean }[] };
const suite: Record<string, Group[]> = Object.fromEntries(readdirSync(SUITE).filter((file) => file.endsWith(".json")).map((file) => [file.slice(0, -".json".length), JSON.parse(readFileSync(join(SUITE, file), "utf8"))]));

/** Zod's formats, each by dotschema's name, kebab case, with the Zod schema that checks it. */
const ZOD: Record<string, z.ZodType> = {
  jwt: z.jwt(),
  "credit-card": z.creditCard(),
  iban: z.iban(),
  base64: z.base64(),
  base64url: z.base64url(),
  cidrv4: z.cidrv4(),
  cidrv6: z.cidrv6(),
  mac: z.mac(),
  e164: z.e164(),
  emoji: z.emoji(),
  nanoid: z.nanoid(),
  cuid: z.cuid(),
  cuid2: z.cuid2(),
  ulid: z.ulid(),
  xid: z.xid(),
  ksuid: z.ksuid(),
  hex: z.hex(),
  "currency-code": z.currencyCode(),
  lowercase: z.string().lowercase(),
  uppercase: z.string().uppercase(),
  ...Object.fromEntries((["md5", "sha1", "sha256", "sha384", "sha512"] as const).flatMap((alg) => (["hex", "base64", "base64url"] as const).map((enc) => [`${alg}-${enc}`, z.hash(alg, { enc })]))),
};

/** Strings each of Zod's formats takes and strings either side of it, every one checked against every format. */
const ZOD_SAMPLES: string[] = [
  ...["", " ", "a", "abc", "ABC", "aBc", "123", "Hello World", "é", "É", "ß"],
  // jwt: a signed token; one with `alg` "none" and no `typ`; a `typ` other than JWT; no `alg`; a header that is a number, or no JSON; two parts, four; a header in base64url's own alphabet, which atob refuses.
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.",
  `${btoa('{"alg":"HS256","typ":"JOSE"}')}.e30.sig`,
  `${btoa('{"typ":"JWT"}')}.e30.sig`,
  `${btoa("1")}.e30.sig`,
  "a.b.c",
  ".e30.sig",
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0",
  "eyJhbGciOiJub25lIn0.e30.sig.extra",
  `${btoa('{"alg":"HS256","kid":"??>"}').replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.e30.sig`,
  // credit-card: valid numbers bare, spaced and hyphenated; a wrong check digit; doubled separators; too short and too long.
  ...["4111111111111111", "4111 1111 1111 1111", "4111-1111-1111-1111", "5555555555554444", "378282246310005", "6011111111111117", "4111111111111112", "4111  1111 1111 1111", "4111 1111 1111 1111 ", "411111111111", "41111111111", "41111111111111111111", "4111-1111 1111-1111"],
  // iban: valid ones; a wrong checksum; lowercase; the check digits 00, 01 and 99 the shape refuses; too short.
  ...["DE89370400440532013000", "GB82WEST12345698765432", "NL91ABNA0417164300", "DE89370400440532013001", "de89370400440532013000", "DE00370400440532013000", "DE99370400440532013000", "DE8937040044"],
  // base64 and base64url: padded and unpadded, a padding in the middle, white space, bits past the last byte, a length of one more than a multiple of four.
  ...["SGVsbG8=", "SGVsbA==", "SGVs", "SGVsbG8", "SGV=bG8=", "SG Vs", "SGVs\n", "YR==", "YQ", "====", "aGk_-w", "aGk/+w==", "-_8", "abcde", "a"],
  // cidrv4 and cidrv6: in range and out; a prefix with a leading zero; no prefix; a zone; what the URL parser would read past.
  ...["192.168.0.0/16", "10.0.0.0/33", "10.0.0.0", "1.2.3.4/0", "01.2.3.4/8", "2001:db8::/32", "2001:db8::/129", "::/0", "::1/128", "2001:db8::/032", "::ffff:192.168.1.1/96", "2001:db8::", "fe80::1%eth0/64", "::@1\\/8", "::1\n/64", "2001:DB8::/+32", "1:2:3:4:5:6:7:8:9/64"],
  // mac, e164, emoji.
  ...["00:1A:2B:3C:4D:5E", "00:1a:2b:3c:4d:5e", "00-1A-2B-3C-4D-5E", "00:1A:2b:3C:4D:5E", "+14155552671", "+1415555", "14155552671", "+0123456789", "+1234567890123456", "😀", "👍🏽", "🇺🇸", "1️⃣", "a😀", "☺", "♥", "#", "\u200d"],
  // nanoid, cuid, cuid2, ulid, xid, ksuid.
  ...["V1StGXR8_Z5jdHi6B-myT", "V1StGXR8_Z5jdHi6B-my", "cjld2cjxh0000qzrmn831i7rn", "c123456", "C1", "tz4a98xxat96iws9zmbrgj3a", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "8ARZ3NDEKTSV4RRFFQ69G5FAV0", "01ARZ3NDEKTSV4RRFFQ69G5FAI", "9m4e2mr0ui3e8a215n4g", "9m4e2mr0ui3e8a215n4w", "0ujtsYcgvSTl8PAuAdqWYSMnLOv", "0ujtsYcgvSTl8PAuAdqWYSMnLO_"],
  // hex, currency-code.
  ...["48656c6c6f", "DEADBEEF", "0xdead", "USD", "usd", "XYZ", "EUR", "EURO"],
  // Each digest of "dotschema" in each encoding, and one character short.
  ...(["md5", "sha1", "sha256", "sha384", "sha512"] as const).flatMap((alg) => (["hex", "base64", "base64url"] as const).flatMap((enc) => { const digest = createHash(alg).update("dotschema").digest(enc); return [digest, digest.slice(1)]; })),
];

/** The module for a group's schema, under its own draft or, without its `$schema`, under draft-07. */
async function moduleOf(schema: Record<string, unknown>, draft: "2020-12" | "draft-07") {
  const { $schema: _, ...rest } = schema;
  const { code, problems } = schemaCode(JSON.stringify(draft === "2020-12" ? schema : rest), PATH);
  assert.deepEqual(problems, []);
  return (await evaluate(code)).default;
}

for (const draft of ["2020-12", "draft-07"] as const) {
  test(`every format test of the JSON Schema Test Suite passes under ${draft}`, async () => {
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
      assert.deepEqual(failing, [], file);
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
  // Every format ajv-formats has, and no other but Zod's and the internationalized ones.
  assert.deepEqual(Object.keys(FORMATS).filter((name) => !(name in ZOD) && !["idn-hostname", "idn-email", "iri", "iri-reference"].includes(name)).sort(), Object.keys(theirs).sort());
  const differ: Record<string, string[]> = {};
  // ajv-formats' email, hostname, uri, uri-reference, uri-template and regex are replaced, not copied; the suite tests them.
  const replaced = ["email", "hostname", "uri", "uri-reference", "uri-template", "regex"];
  for (const name of Object.keys(theirs).filter((name) => !replaced.includes(name)))
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

/** Zod's own name for each of its formats that dotschema names otherwise, by dotschema's name. */
const ZOD_NAME: Record<string, string> = Object.fromEntries(Object.entries(ALIASES).map(([alias, name]) => [name, alias]));

test("Zod's formats are named in kebab case, each name z.toJSONSchema writes either that name or an alias of it", () => {
  // Every format by its own name in kebab case or one word, as JSON Schema names its own; the aliases apart, each the name of a format and none a format of its own.
  for (const name of Object.keys(FORMATS)) assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, name);
  for (const [alias, name] of Object.entries(ALIASES)) {
    assert.ok(name in FORMATS, alias);
    assert.ok(!(alias in FORMATS), alias);
  }
  const written: string[] = [];
  for (const [name, schema] of Object.entries(ZOD)) {
    const format = (z.toJSONSchema(schema) as { format?: string }).format!;
    assert.equal(ALIASES[format] ?? format, name);
    if (format !== name) written.push(format);
  }
  // The aliases are exactly the names Zod writes that are not dotschema's: credit_card, currency_code and the fifteen digests.
  assert.deepEqual(written.sort(), Object.keys(ALIASES).sort());
  assert.equal(written.length, 17);
});

test("each of Zod's formats gives Zod's verdict, alone by its name and by Zod's alias and, but for one, in the schema z.toJSONSchema writes", async () => {
  const moduleOfSchema = async (schema: object) => {
    const { code, problems } = schemaCode(JSON.stringify(schema), PATH);
    assert.deepEqual(problems, []);
    return (await evaluate(code)).default;
  };
  const differ: Record<string, string[]> = {};
  for (const [name, schema] of Object.entries(ZOD)) {
    const modules: Record<string, any> = { alone: await moduleOfSchema({ type: "string", format: name }), zod: await moduleOfSchema(z.toJSONSchema(schema)) };
    if (ZOD_NAME[name]) modules.alias = await moduleOfSchema({ type: "string", format: ZOD_NAME[name] });
    const accepted = ZOD_SAMPLES.filter((value) => schema.safeParse(value).success);
    // The samples hold strings the format takes and strings it does not.
    assert.ok(accepted.length > 0 && accepted.length < ZOD_SAMPLES.length, name);
    for (const value of ZOD_SAMPLES)
      for (const [kind, module] of Object.entries(modules)) {
        assert.equal(!module.validate(value).issues, module.is(value), `${name}: ${JSON.stringify(value)}`);
        if (module.is(value) !== accepted.includes(value)) (differ[`${name} ${kind}`] ??= []).push(value);
      }
  }
  // The one difference: the `pattern` Zod writes beside cidrv6 is a regular expression with no IPv6 address that ends in an IPv4 one, which Zod's own check takes. Zod's to fix.
  assert.deepEqual(differ, { "cidrv6 zod": ["::ffff:192.168.1.1/96"] });
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
  for (const properties of [{ a: { type: "string" } }, { a: { type: "string", format: "uuid" } }]) {
    const { code } = await build(properties);
    assert.deepEqual(formatFiles(code), []);
    assert.doesNotMatch(code, /__formats/);
  }
  // date-time requires date and time; nothing of the other date and time formats comes with it.
  const { code, module } = await build({ at: { type: "string", format: "date-time" } });
  assert.deepEqual(formatFiles(code), ["date", "date-time", "time"]);
  assert.match(code, /^const __formats = \{ "date-time": __require\(\d+\) \};$/m);
  assert.deepEqual([module.is({ at: "2026-10-20T08:00:00Z" }), module.is({ at: "2026-10-20T08:00:00+01" })], [true, false]);
  // jwt is its file alone, and base64url requires base64's.
  const jwt = await build({ token: { type: "string", format: "jwt" } });
  assert.deepEqual(formatFiles(jwt.code), ["jwt"]);
  assert.deepEqual([jwt.module.is({ token: "eyJhbGciOiJub25lIn0.e30." }), jwt.module.is({ token: "a.b.c" })], [true, false]);
  assert.deepEqual(formatFiles((await build({ data: { type: "string", format: "base64url" } })).code), ["base64", "base64url"]);
  // idn-hostname and hostname require IDNA2008's checks, idn-email idn-hostname and ipv6, email ipv6; iri and iri-reference RFC 3987's grammar, and it RFC 3986's, each carried once.
  assert.deepEqual(formatFiles((await build({ host: { type: "string", format: "idn-hostname" } })).code), ["idn-hostname"]);
  assert.deepEqual(formatFiles((await build({ mail: { type: "string", format: "idn-email" } })).code), ["idn-email", "idn-hostname", "ipv6"]);
  assert.deepEqual(formatFiles((await build({ mail: { type: "string", format: "email" } })).code), ["email", "ipv6"]);
  const host = (await build({ host: { type: "string", format: "hostname" } })).code;
  assert.deepEqual(formatFiles(host), ["hostname"]);
  assert.equal(host.match(/^\/\/ IDNA2008's validity of a host name/gm)?.length, 1);
  const uri = (await build({ link: { type: "string", format: "uri" } })).code;
  assert.deepEqual(formatFiles(uri), ["uri"]);
  assert.doesNotMatch(uri, /The grammar of RFC 3987/);
  const iri = await build({ a: { type: "string", format: "iri" }, b: { type: "string", format: "iri-reference" } });
  assert.deepEqual(formatFiles(iri.code), ["iri", "iri-reference"]);
  assert.equal(iri.code.match(/^\/\/ The grammar of RFC 3987/gm)?.length, 1);
  assert.equal(iri.code.match(/^\/\/ The grammar of RFC 3986/gm)?.length, 1);
  // A format by Zod's alias carries its format's file, and a module that uses it by both names carries the file once.
  for (const [alias, name] of [["credit_card", "credit-card"], ["currency_code", "currency-code"]]) {
    const byAlias = await build({ a: { type: "string", format: alias } });
    assert.deepEqual(formatFiles(byAlias.code), [name]);
    const both = await build({ a: { type: "string", format: alias }, b: { type: "string", format: name } });
    assert.deepEqual(formatFiles(both.code), [name]);
    assert.match(both.code, new RegExp(`^const __formats = \\{ "${name}": __require\\((\\d+)\\), "${alias}": __require\\(\\1\\) \\};$`, "m"));
  }
  const card = await build({ a: { type: "string", format: "credit_card" }, b: { type: "string", format: "currency_code" } });
  assert.deepEqual([card.module.is({ a: "4111 1111 1111 1111", b: "USD" }), card.module.is({ a: "4111 1111 1111 1112" }), card.module.is({ b: "usd" })], [true, false, false]);
  // A digest by Zod's alias is a regular expression, as by its name: no file.
  assert.deepEqual(formatFiles((await build({ a: { type: "string", format: "sha256_hex" } })).code), []);
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
