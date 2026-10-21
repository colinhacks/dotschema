// A parsed value as JavaScript source (the schema the module exports, and its Standard JSON Schema)
// and as TypeScript type text (the schema's literal type), typed the way `as const` would. Copied
// from Motherload's `@motherload/core` (packages/core/src/serialize.ts at d21b5ac), without the
// check that a value is one a module can carry, which a JSONC or JSON5 file always is.

/** What the parsers hand over: JSON's values plus the few that JSON lacks (JSON5's `Infinity` and `NaN`; `bigint` and `Date` come from Motherload's other formats and are kept so the serializer stays the same). */
export type Value = null | boolean | number | bigint | string | Date | readonly Value[] | { readonly [key: string]: Value };

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** A property name in an object type or literal: bare when it can be, quoted otherwise. */
export const propertyName = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));

function number(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

/** JavaScript source that evaluates to `value`. */
export function toJs(value: Value): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return number(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "boolean") return String(value);
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`;
  if (Array.isArray(value)) return `[${value.map(toJs).join(", ")}]`;
  const object = value as { readonly [key: string]: Value };
  // `__proto__: x` in an object literal sets the prototype; a computed key defines the property.
  const entries = Object.keys(object).map((name) => `${name === "__proto__" ? `["__proto__"]` : JSON.stringify(name)}: ${toJs(object[name]!)}`);
  return `{${entries.join(", ")}}`;
}

/** The type `as const` would give: every primitive its literal type, arrays readonly tuples, objects readonly. */
export function literal(value: Value): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "number") {
    // TypeScript has no literal type for NaN or the infinities, and `-0` is the literal `0`.
    if (!Number.isFinite(value)) return "number";
    return value < 0 ? `-${-value}` : String(value === 0 ? 0 : value);
  }
  if (value instanceof Date) return "Date";
  if (Array.isArray(value)) return `readonly [${value.map(literal).join(", ")}]`;
  const object = value as { readonly [key: string]: Value };
  const names = Object.keys(object);
  return names.length === 0 ? "{}" : `{ ${names.map((name) => `readonly ${propertyName(name)}: ${literal(object[name]!)}`).join("; ")} }`;
}
