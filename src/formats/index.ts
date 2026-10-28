// The formats dotschema checks, by the name `format` gives, each as ajv's `addFormat` takes it, which
// `loadAjv` in src/schema.ts registers with every ajv it makes, the build's and the type check's. A
// name no entry has is not checked, as the spec allows (ajv runs with `strict: false`).
//
// A format is one of three things:
// - a regular expression, which ajv writes into the module as a literal, into each validator that
//   uses it; one of over 400 characters is a file instead (below), which a module carries once;
// - `true`, a format that checks nothing but is known (OpenAPI's `password` and `binary`), so that
//   `formatMinimum` beside it is ignored rather than refused;
// - `{ file }`, a file in this directory, which a module that uses the format inlines with the files it
//   requires, and nothing else (`schemaCode`). The file is plain JavaScript, CommonJS, since the
//   inliner pastes its text into the module, and runs in every host a module runs in: no Node API, no
//   `new Function` or `eval`, no `require` but of another file here. Its `module.exports` is the
//   format: a function of the string; `{ validate, compare }`, where `compare(a, b)` orders two valid
//   strings, negative, zero or positive, for `formatMinimum`, `formatMaximum` and the exclusive pair;
//   or `{ type: "number", validate }`, a format of numbers.
//
// The formats ajv-formats 3.0.1 defines are copies of its own (MIT, credited in each file), unchanged
// but where the JSON Schema Test Suite shows a defect: `date-time`, `time`, `duration` and `uuid`
// are changed copies, and `email`, `hostname`, `uri`, `uri-reference`, `uri-template` and
// `regex` dotschema's own (DESIGN.md, "Formats"). Zod's formats are copies of Zod 4.6.7's checks,
// unchanged, named in kebab case, with Zod's own snake-case names as aliases (ALIASES). The IDN and
// IRI formats are dotschema's own. The regular expressions below are ajv-formats' (Copyright (c)
// 2020 Evgeny Poberezkin) and Zod's (Copyright (c) 2025 Colin McDonnell), both under the MIT
// license, whose text each file here carries.
import { createRequire } from "node:module";

export type Format = RegExp | true | { file: string };

/** Every format, by name, in an object with no prototype, so a name such as `constructor` is no format. */
export const FORMATS: Readonly<Record<string, Format>> = Object.freeze(Object.assign(Object.create(null) as Record<string, Format>, {
  // RFC 3339 and ajv-formats' own date and time formats, each with its order for formatMinimum.
  date: { file: "date.cjs" },
  time: { file: "time.cjs" },
  "date-time": { file: "date-time.cjs" },
  "iso-time": { file: "iso-time.cjs" },
  "iso-date-time": { file: "iso-date-time.cjs" },
  // RFC 3339's duration (appendix A), whose parts come in its order: dotschema's, where ajv-formats'
  // took a year beside a day without the month between them (`P1Y2D`), and an hour beside a second
  // without the minute (`PT1H2S`).
  duration: /^P(?:(?:\d+D|\d+M(?:\d+D)?|\d+Y(?:\d+M(?:\d+D)?)?)(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S)|\d+W)$/,
  uri: { file: "uri.cjs" },
  "uri-reference": { file: "uri-reference.cjs" },
  // RFC 6570's URI Template (section 2), with its erratum 6937, which puts the apostrophe among the
  // literals (the JSON Schema Test Suite's reading): a literal is a character its ABNF lists, a
  // `ucschar` or an `iprivate` (a code point from U+00A0 up but the surrogates, U+FFF0 to U+FFFD,
  // U+E0000 to U+E0FFF and the noncharacters), or a percent-encoded octet; an expression an operator
  // and variables, a name dotted between its characters, each with a prefix of 1 to 9999 or an
  // explode. dotschema's, where ajv-formats' refused a dotted name and an apostrophe and took a DEL.
  "uri-template": /^(?:(?:(?![\uFFF0-\uFFFD\u{E0000}-\u{E0FFF}]|\p{Noncharacter_Code_Point})[\x21\x23\x24\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E\u00A0-\uD7FF\uE000-\u{10FFFF}]|%[0-9A-Fa-f]{2})|\{[+#./;?&=,!@|]?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9][0-9]{0,3}|\*)?)*\})*$/u,
  url: { file: "url.cjs" },
  // The internationalized formats, dotschema's own: idn-hostname as IDNA2008 has it after UTS #46's
  // mapping, idn-email as RFC 6531 has it, iri and iri-reference as RFC 3987 has them.
  "idn-hostname": { file: "idn-hostname.cjs" },
  "idn-email": { file: "idn-email.cjs" },
  iri: { file: "iri.cjs" },
  "iri-reference": { file: "iri-reference.cjs" },
  email: { file: "email.cjs" },
  hostname: { file: "hostname.cjs" },
  ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
  ipv6: { file: "ipv6.cjs" },
  regex: { file: "regex.cjs" },
  // RFC 4122's UUID, without the `urn:uuid:` prefix ajv-formats took, which is a URN and not a UUID.
  uuid: /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
  "json-pointer": /^(?:\/(?:[^~/]|~0|~1)*)*$/,
  "json-pointer-uri-fragment": /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
  "relative-json-pointer": /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
  // OpenAPI's formats.
  byte: { file: "byte.cjs" },
  int32: { file: "int32.cjs" },
  int64: { file: "int64.cjs" },
  float: { file: "float.cjs" },
  double: { file: "double.cjs" },
  password: true,
  binary: true,
  // Zod's formats, each checked as Zod 4.6.7 checks it: by its regular expression, copied from Zod's
  // src/v4/core/regexes.ts, or by a function, copied from its src/v4/core/schemas.ts into a file
  // (MIT, credited in each). Named in kebab case, as JSON Schema names its own (`date-time`), where
  // z.toJSONSchema writes some in snake case, which ALIASES keeps (below). Zod writes each with a
  // `pattern` beside it but for jwt; a schema written by hand needs only the `format`.
  jwt: { file: "jwt.cjs" },
  "credit-card": { file: "credit-card.cjs" },
  iban: { file: "iban.cjs" },
  base64: { file: "base64.cjs" },
  base64url: { file: "base64url.cjs" },
  cidrv4: /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  cidrv6: { file: "cidrv6.cjs" },
  // z.mac() with its default delimiter, a colon; z.mac({ delimiter }) writes the same format beside its own pattern.
  mac: /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/,
  e164: /^\+[1-9]\d{6,14}$/,
  emoji: /^(?=[\s\S]*[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3])[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u,
  // z.nanoid() with its default length, 21.
  nanoid: /^[a-zA-Z0-9_-]{21}$/,
  cuid: /^[cC][0-9a-z]{6,}$/,
  cuid2: /^[0-9a-z]+$/,
  ulid: /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/,
  xid: /^[0-9a-vA-V]{20}$/,
  ksuid: /^[A-Za-z0-9]{27}$/,
  hex: /^[0-9a-fA-F]*$/,
  "currency-code": { file: "currency-code.cjs" },
  lowercase: /^[^A-Z]*$/,
  uppercase: /^[^a-z]*$/,
  // z.hash(algorithm, { enc }), each digest's length in hex, in base64 with its padding, and in base64url without.
  "md5-hex": /^[0-9a-fA-F]{32}$/,
  "md5-base64": /^[A-Za-z0-9+/]{22}==$/,
  "md5-base64url": /^[A-Za-z0-9_-]{22}$/,
  "sha1-hex": /^[0-9a-fA-F]{40}$/,
  "sha1-base64": /^[A-Za-z0-9+/]{27}=$/,
  "sha1-base64url": /^[A-Za-z0-9_-]{27}$/,
  "sha256-hex": /^[0-9a-fA-F]{64}$/,
  "sha256-base64": /^[A-Za-z0-9+/]{43}=$/,
  "sha256-base64url": /^[A-Za-z0-9_-]{43}$/,
  "sha384-hex": /^[0-9a-fA-F]{96}$/,
  "sha384-base64": /^[A-Za-z0-9+/]{64}$/,
  "sha384-base64url": /^[A-Za-z0-9_-]{64}$/,
  "sha512-hex": /^[0-9a-fA-F]{128}$/,
  "sha512-base64": /^[A-Za-z0-9+/]{86}==$/,
  "sha512-base64url": /^[A-Za-z0-9_-]{86}$/,
}));

/**
 * Zod's spellings of its formats where they are not dotschema's, each with the name of the format in
 * FORMATS it is: the names z.toJSONSchema writes in snake case (Zod 4.6.7's `z.creditCard()`,
 * `z.currencyCode()` and `z.hash(algorithm, { enc })`), so a schema it wrote is checked as one written
 * with the kebab-case name. Apart from FORMATS, which lists each format once by its own name; ajv
 * registers both (`formatDefinitions`), and a module that uses an alias carries its format's file
 * (`formatFile`).
 */
export const ALIASES: Readonly<Record<string, string>> = Object.freeze(Object.assign(Object.create(null) as Record<string, string>, {
  credit_card: "credit-card",
  currency_code: "currency-code",
  md5_hex: "md5-hex",
  md5_base64: "md5-base64",
  md5_base64url: "md5-base64url",
  sha1_hex: "sha1-hex",
  sha1_base64: "sha1-base64",
  sha1_base64url: "sha1-base64url",
  sha256_hex: "sha256-hex",
  sha256_base64: "sha256-base64",
  sha256_base64url: "sha256-base64url",
  sha384_hex: "sha384-hex",
  sha384_base64: "sha384-base64",
  sha384_base64url: "sha384-base64url",
  sha512_hex: "sha512-hex",
  sha512_base64: "sha512-base64",
  sha512_base64url: "sha512-base64url",
}));

const require = createRequire(import.meta.url);

const fileOf = (format: Format | undefined): string | undefined => (typeof format === "object" && !(format instanceof RegExp) ? format.file : undefined);

/** The format a name gives, by its own name or an alias; undefined for a name no format has. */
const formatOf = (name: string): Format | undefined => FORMATS[ALIASES[name] ?? name];

/** Each format as ajv's `addFormat` takes it, a file's `module.exports` in place of the file, by its name and then by each alias. */
export function formatDefinitions(): [name: string, definition: unknown][] {
  return [...Object.keys(FORMATS), ...Object.keys(ALIASES)].map((name) => {
    const format = formatOf(name)!;
    const file = fileOf(format);
    return [name, file ? require(`./${file}`) : format];
  });
}

/** The absolute path of the file a format is checked by, which a module that uses it, by its name or an alias, inlines; undefined for a regular expression, `true`, or a name no format has. */
export function formatFile(name: string): string | undefined {
  const file = fileOf(formatOf(name));
  return file ? require.resolve(`./${file}`) : undefined;
}
