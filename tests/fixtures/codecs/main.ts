// The types of schemas a codec decodes, checked with `tsc --runExternalCode` on `lib: es2022`, which
// declares no Temporal: the module of a schema with a Temporal codec brings `esnext.temporal` in.
import type { SchemaResult, StandardSchemaV1 } from "dotschema";
import event from "./event.schema.jsonc";
import log from "./log.schema.jsonc";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const expect = <T extends true>() => {};

// `.Type` is the decoded value, and `.Input` the value as given.
expect<Equal<log.Type, { at: Temporal.Instant; message: string }>>();
expect<Equal<log.Input, { at: string; message: string }>>();
expect<Equal<event.Type["at"], Temporal.Instant>>();
expect<Equal<event.Input["at"], string>>();
expect<Equal<event.Type["day"], Temporal.PlainDate | undefined>>();
expect<Equal<event.Type["seen"], Temporal.Instant[] | undefined>>();
expect<Equal<event.Type["id"], bigint | undefined>>();
expect<Equal<event.Type["every"], Temporal.Duration | null | undefined>>();
expect<Equal<event.Type["note"], string | undefined>>();
// A schema of another package is typed by that package's project, which has no codec.
expect<Equal<NonNullable<event.Type["stamp"]>["on"], string | undefined>>();
// `.validate()` and `.is()` keep the value as given; `.decode()` gives the decoded one, and `.encode()` takes it back.
expect<Equal<ReturnType<typeof event.validate>, SchemaResult<event.Input>>>();
expect<Equal<ReturnType<typeof event.decode>, SchemaResult<event.Type>>>();
expect<Equal<Parameters<typeof event.encode>[0], event.Type>>();
expect<Equal<ReturnType<typeof event.encode>, SchemaResult<event.Input>>>();
const body: unknown = JSON.parse("{}");
if (event.is(body)) expect<Equal<typeof body, event.Input>>();
// Standard Schema's input is the value as given, and its output the decoded value.
expect<Equal<StandardSchemaV1.InferInput<typeof event>, event.Input>>();
expect<Equal<StandardSchemaV1.InferOutput<typeof event>, event.Type>>();
// A decoded union narrows as the value as given does.
const decoded = event.decode(body);
if (!decoded.issues && decoded.value.kind === "visit") expect<Equal<typeof decoded.value.until, Temporal.Instant>>();
// A picked schema keeps the codecs of the properties it keeps.
const message = log.pick("message");
expect<Equal<StandardSchemaV1.InferOutput<typeof message>, { message: string }>>();
const at = log.omit("message");
expect<Equal<StandardSchemaV1.InferOutput<typeof at>, { at: Temporal.Instant }>>();
expect<Equal<StandardSchemaV1.InferInput<typeof at>, { at: string }>>();
// @ts-expect-error .encode() takes the decoded value, not a string
log.encode({ at: "2026-10-26T00:00:00Z", message: "m" });
log.encode({ at: Temporal.Instant.from("2026-10-26T00:00:00Z"), message: "m" });
