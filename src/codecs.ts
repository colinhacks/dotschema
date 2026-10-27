// The codecs dotschema ships (DESIGN.md, "Codecs"): each turns a string a `format` accepts into a
// richer value, and that value back into a string, exactly or not at all. A project turns one on
// for a format in its dotschema.jsonc (config.ts); `.decode()` then gives the value and `.encode()`
// the string, while `.validate()` and `.is()` keep the value as given. A codec decodes strings
// alone, so a schema that also allows a number or null keeps those as they are.

export interface Codec {
  /** Its name in dotschema.jsonc, the type it decodes to. */
  readonly name: string;
  /** The format whose strings it decodes. */
  readonly format: string;
  /** The decoded value's TypeScript type. */
  readonly type: string;
  /** Whether its type is one of Temporal's, which TypeScript declares under `lib: esnext.temporal`. */
  readonly temporal: boolean;
  /**
   * Its run time, as the text of an object `{ what, decode, is, encode }`: `what` names its values
   * in a message, `decode(string)` returns the value or `__refuse(reason)`, `is(value)` whether a
   * value is one it encodes, and `encode(value)` the string or `__refuse(reason)`. The module calls `decode` only on a string the validator has
   * accepted, and `encode` only on a value `is` accepts; nothing in it throws (`__codec` in schema.ts
   * catches what Temporal throws).
   */
  readonly code: string;
}

// Temporal's own checks happen at run time, where a missing Temporal is an issue and not a throw.
const TEMPORAL_MISSING = `if (typeof Temporal === "undefined") return __refuse("Temporal is not defined in this runtime");`;

const OUTSIDE_YEARS = JSON.stringify("an instant outside the years 0000 to 9999 in UTC, which date-time cannot write");

export const CODECS: readonly Codec[] = [
  {
    name: "Temporal.Instant",
    format: "date-time",
    type: "Temporal.Instant",
    temporal: true,
    // The date-time format accepts a leap second, which an Instant reads as the second before it,
    // and any number of digits of a second, of which an Instant holds nine: both are refused, so
    // that encoding gives back the instant that was decoded (Reylo's rule of 2026-10-22: "Every codec
    // is exact or refuses the value, never lossy"). The offset is not kept: `.encode()` writes `Z`,
    // so an instant whose year in UTC is not one of the format's four digits, such as
    // `0000-01-01T00:00:00+00:01`, is refused both ways, since its string in `Z` would not be one.
    code: `{
  what: "a Temporal.Instant",
  decode(value) {
    ${TEMPORAL_MISSING}
    if (/^[^Tt]*[Tt]\\d\\d:\\d\\d:60/.test(value)) return __refuse("a leap second, which a Temporal.Instant cannot hold");
    if (/\\.\\d{10}/.test(value)) return __refuse("more than nine digits of a second, which a Temporal.Instant cannot hold");
    const instant = Temporal.Instant.from(value);
    return /^\\d/.test(instant.toString()) ? instant : __refuse(${OUTSIDE_YEARS});
  },
  is: (value) => typeof Temporal !== "undefined" && value instanceof Temporal.Instant,
  encode(value) {
    const text = value.toString();
    return /^\\d/.test(text) ? text : __refuse(${OUTSIDE_YEARS});
  },
}`,
  },
  {
    name: "Temporal.PlainDate",
    format: "date",
    type: "Temporal.PlainDate",
    temporal: true,
    // A date in another calendar is the same day: its ISO date is written, without the calendar's name.
    code: `{
  what: "a Temporal.PlainDate",
  decode(value) {
    ${TEMPORAL_MISSING}
    return Temporal.PlainDate.from(value);
  },
  is: (value) => typeof Temporal !== "undefined" && value instanceof Temporal.PlainDate,
  encode(value) {
    const text = value.toString({ calendarName: "never" });
    return /^\\d/.test(text) ? text : __refuse("a date outside the years 0000 to 9999, which the date format cannot write");
  },
}`,
  },
  {
    name: "Temporal.Duration",
    format: "duration",
    type: "Temporal.Duration",
    temporal: true,
    code: `{
  what: "a Temporal.Duration",
  decode(value) {
    ${TEMPORAL_MISSING}
    return Temporal.Duration.from(value);
  },
  is: (value) => typeof Temporal !== "undefined" && value instanceof Temporal.Duration,
  encode: (value) => value.toString(),
}`,
  },
  {
    name: "bigint",
    format: "int64",
    type: "bigint",
    temporal: false,
    // A string of a 64-bit integer, as protobuf's JSON and Google's APIs write one: the int64 format
    // checks numbers alone (ajv applies a format to one JSON type), so the codec checks the digits,
    // refusing a leading zero, `-0` and a sign of `+`, which would not come back as written. An
    // int64 written as a JSON number stays a number: JSON.parse has rounded it past 2^53 already.
    code: `{
  what: "a bigint",
  decode(value) {
    if (!/^(?:0|-?[1-9][0-9]*)$/.test(value)) return __refuse("not an integer written as int64 is, without a sign of + or a leading zero");
    const n = BigInt(value);
    if (n < -9223372036854775808n || n > 9223372036854775807n) return __refuse("an integer outside int64's range");
    return n;
  },
  is: (value) => typeof value === "bigint",
  encode(value) {
    if (value < -9223372036854775808n || value > 9223372036854775807n) return __refuse("a bigint outside int64's range");
    return value.toString();
  },
}`,
  },
];

/** The codec of a name in dotschema.jsonc, by its format: undefined when the format has no codec of that name. */
export const codecNamed = (format: string, name: string): Codec | undefined => CODECS.find((codec) => codec.format === format && codec.name === name);
