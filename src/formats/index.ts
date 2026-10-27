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
// (DESIGN.md, "Formats"). Zod's formats are copies of Zod 4.6.7's checks, unchanged. The IDN and IRI
// formats are dotschema's own. The regular
// expressions below are ajv-formats' (Copyright (c) 2020 Evgeny Poberezkin) and Zod's (Copyright (c)
// 2025 Colin McDonnell), both under the MIT license, whose text each file here carries.
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
  "uri-template": /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
  url: { file: "url.cjs" },
  // The internationalized formats, dotschema's own: idn-hostname as IDNA2008 has it after UTS #46's
  // mapping, idn-email as RFC 6531 has it, iri and iri-reference as RFC 3987 has them.
  "idn-hostname": { file: "idn-hostname.cjs" },
  "idn-email": { file: "idn-email.cjs" },
  iri: { file: "iri.cjs" },
  "iri-reference": { file: "iri-reference.cjs" },
  email: /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i,
  hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i,
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
  // Zod's formats, by the names z.toJSONSchema writes, each checked as Zod 4.6.7 checks it: by its
  // regular expression, copied from Zod's src/v4/core/regexes.ts, or by a function, copied from its
  // src/v4/core/schemas.ts into a file (MIT, credited in each). Zod writes each with a `pattern`
  // beside it but for jwt; a schema written by hand needs only the `format`.
  jwt: { file: "jwt.cjs" },
  credit_card: { file: "credit_card.cjs" },
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
  currency_code: { file: "currency_code.cjs" },
  lowercase: /^[^A-Z]*$/,
  uppercase: /^[^a-z]*$/,
  // z.hash(algorithm, { enc }), each digest's length in hex, in base64 with its padding, and in base64url without.
  md5_hex: /^[0-9a-fA-F]{32}$/,
  md5_base64: /^[A-Za-z0-9+/]{22}==$/,
  md5_base64url: /^[A-Za-z0-9_-]{22}$/,
  sha1_hex: /^[0-9a-fA-F]{40}$/,
  sha1_base64: /^[A-Za-z0-9+/]{27}=$/,
  sha1_base64url: /^[A-Za-z0-9_-]{27}$/,
  sha256_hex: /^[0-9a-fA-F]{64}$/,
  sha256_base64: /^[A-Za-z0-9+/]{43}=$/,
  sha256_base64url: /^[A-Za-z0-9_-]{43}$/,
  sha384_hex: /^[0-9a-fA-F]{96}$/,
  sha384_base64: /^[A-Za-z0-9+/]{64}$/,
  sha384_base64url: /^[A-Za-z0-9_-]{64}$/,
  sha512_hex: /^[0-9a-fA-F]{128}$/,
  sha512_base64: /^[A-Za-z0-9+/]{86}==$/,
  sha512_base64url: /^[A-Za-z0-9_-]{86}$/,
}));

const require = createRequire(import.meta.url);

const fileOf = (format: Format | undefined): string | undefined => (typeof format === "object" && !(format instanceof RegExp) ? format.file : undefined);

/** Each format as ajv's `addFormat` takes it, a file's `module.exports` in place of the file. */
export function formatDefinitions(): [name: string, definition: unknown][] {
  return Object.entries(FORMATS).map(([name, format]) => {
    const file = fileOf(format);
    return [name, file ? require(`./${file}`) : format];
  });
}

/** The absolute path of the file a format is checked by, which a module that uses it inlines; undefined for a regular expression, `true`, or a name no format has. */
export function formatFile(name: string): string | undefined {
  const file = fileOf(FORMATS[name]);
  return file ? require.resolve(`./${file}`) : undefined;
}
