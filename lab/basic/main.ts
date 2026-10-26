// Every import below is typed by dotschema's content mapper (`tsc --runExternalCode`) and loaded by
// its preload (`node --import dotschema/register main.ts`) or its esbuild plugin.
import type { SchemaResult, StandardJSONSchemaV1 } from "dotschema";
import user, { address, type Type as User } from "./user.schema.jsonc";
import point, { type Type as Point } from "./point.schema.json5";
import team, { type Type as Team } from "./team.schema.jsonc";
import event, { type Type as Event } from "./event.schema.jsonc";

// Exact equality of two types, not mere assignability.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};

expect<Equal<User, { name: string; email?: string; role: "admin" | "member"; tags?: string[]; address?: address.Type }>>();
// Each definition is a validator of its own, named for its key, with its type as `.Type`.
expect<Equal<address.Type, { street?: string; city: string }>>();
expect<Equal<ReturnType<typeof address.validate>, SchemaResult<address.Type>>>();
// The default import names the type too.
expect<Equal<user.Type, User>>();
expect<Equal<team.Type, Team>>();
expect<Equal<ReturnType<typeof user.validate>, SchemaResult<User>>>();
// `.is()` is a type guard: the value it accepts is a User where it returns true.
const someone: unknown = { name: "Ada", role: "admin" };
if (user.is(someone)) expect<Equal<typeof someone, User>>();
// @ts-expect-error a schema module has no parse: nothing on it throws
user.parse;
// A schema written in JSON5 is the same module.
expect<Equal<Point, { x: number; y: number; label?: string }>>();
expect<Equal<typeof point.schema.properties.label.maxLength, 16>>();
// A $ref to another schema file is that file's type: its root, or the definition it points to.
// Nothing here imports shared/place.schema.jsonc; TypeScript reaches it through team's module.
expect<Equal<Team, { lead: User; members: User[]; office?: { city: string; manager?: User } }>>();
// A schema module is a Standard JSON Schema too.
const teamAsJsonSchema: StandardJSONSchemaV1<Team> = team;
// @ts-expect-error a member is a User, whose role is required
const noRole: Team = { lead: { name: "Ada", role: "admin" }, members: [{ name: "Grace" }] };
// A oneOf whose variants a `const` tells apart narrows: each case sees its own variant, and with no
// default the switch type-checks only because it is exhaustive.
const describe = (e: Event): string => {
  switch (e.kind) {
    case "click":
      return `${e.x},${e.y}`;
    case "visit":
      return e.url;
  }
};
const clickX = (e: Event): number => {
  if (e.kind === "click") return e.x;
  // @ts-expect-error past the click branch e is a visit, whose x is not known to be a number
  return e.x;
};

// `.validate()` gives the value it was given, or every issue: each with its path, its keyword and ajv's message.
const checked = user.validate({ name: "Ada", role: "admin", email: "ada@example.com" });
const failed = user.validate({ name: "", role: "owner", email: "not an email" });
const standard = user["~standard"].validate({ name: "Ada" });
expect<Equal<typeof standard, SchemaResult<User>>>();
// `.is()` narrows an unknown value to an Event; past `.validate()`'s issues, its value is one.
const click: unknown = { at: "2026-10-20T09:00:00Z", kind: "click", x: 3, y: 4 };
const fifth = event.validate({ at: "2026-10-20T09:00:00Z", kind: "click", x: 5, y: 6 });

console.log(
  JSON.stringify({
    valid: checked.issues ? checked.issues.length : checked.value.name,
    invalid: failed.issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    keywords: failed.issues?.map((issue) => issue.keyword),
    // The Standard Schema validate is the module's own: a missing role, its key the end of the path.
    standard: [user.validate === user["~standard"].validate, standard.issues?.[0]?.path],
    vendor: user["~standard"].vendor,
    // An array index is a number in the path, through team's $ref to user.schema.jsonc.
    memberPath: team.validate({ lead: { name: "Ada", role: "admin" }, members: [{ name: "Grace", role: "member" }, { name: "", role: "member" }] }).issues?.[0]?.path,
    points: [point.is({ x: 1, y: 2, label: "origin" }), point.is({ x: 1.5, y: 2 }), point.is({ x: 1, y: 2, label: "seventeen letters" })],
    // Valid; a member with an empty name (user.schema.jsonc's minLength); an office with no city (shared/place.schema.jsonc's).
    team: [
      team.is({ lead: { name: "Ada", role: "admin" }, members: [{ name: "Grace", role: "member" }], office: { city: "London", manager: { name: "Ada", role: "admin" } } }),
      team.is({ lead: { name: "Ada", role: "admin" }, members: [{ name: "", role: "member" }] }),
      team.is({ lead: { name: "Ada", role: "admin" }, members: [], office: { city: "" } }),
    ],
    // team.schema.jsonc as one JSON Schema in each target: user.schema.jsonc and shared/place.schema.jsonc folded in, its $refs pointers.
    teamJsonSchema: (["draft-2020-12", "draft-07"] as const).map((target) => {
      const json = teamAsJsonSchema["~standard"].jsonSchema.input({ target }) as { $schema: string; properties: { lead: { $ref: string } }; $defs?: object; definitions?: object };
      return [json.$schema, json.properties.lead.$ref, Object.keys(json.$defs ?? json.definitions ?? {}).join()];
    }),
    // A click and a visit; then a date-time, a uri and a variant that fail (ajv-formats' function formats, inlined).
    events: [
      event.is({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }),
      event.is({ at: "2026-10-20T09:00:00Z", kind: "visit", url: "https://example.com/a" }),
      event.is({ at: "yesterday", kind: "click", x: 1, y: 2 }),
      event.is({ at: "2026-10-20T09:00:00Z", kind: "visit", url: "not a uri" }),
      event.is({ at: "2026-10-20T09:00:00Z", kind: "click", url: "https://example.com/a" }),
    ],
    described: event.is(click) ? describe(click) : "not an event",
    clickX: fifth.issues ? fifth.issues.length : clickX(fifth.value),
    // user.schema.jsonc's address definition, imported as a validator: valid, then a missing city and an extra key.
    address: [address.is({ city: "Paris" }), address.validate({ street: "Rue de Rivoli", zip: "75001" }).issues?.map((issue) => `${issue.path.join(".")}: ${issue.keyword}`)],
  }),
);
