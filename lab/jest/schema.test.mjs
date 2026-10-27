// ESM: Jest's own linker (--experimental-vm-modules) loads each schema through dotschema/jest, and
// Vitest through dotschema/vite.
import user, { address } from "../basic/user.schema.jsonc";
import point from "../basic/point.schema.json5";
import event from "../basic/event.schema.jsonc";
// This lab's own, which the dotschema.jsonc beside this lab's package.json gives its codecs.
import stamp from "./stamp.schema.jsonc";

test("lab/basic's schemas, imported by an ES module test", () => {
  expect(user.is({ name: "Ada", role: "admin" })).toBe(true);
  expect([address.is({ city: "Paris" }), user.omit("role").is({ name: "Ada" })]).toEqual([true, true]);
  expect(user["~standard"].validate({ name: "Ada" }).issues[0].path).toEqual(["role"]);
  expect(point.schema.properties.label.maxLength).toBe(16);
  // date-time, its file inlined into the module.
  expect([event.is({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }), event.is({ at: "yesterday", kind: "click", x: 1, y: 2 })]).toEqual([true, false]);
});

test("this lab's schema decodes with the codecs of its dotschema.jsonc, imported by an ES module test", () => {
  const { value } = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" });
  expect(value.at).toBeInstanceOf(Temporal.Instant);
  expect([String(value.at), value.id]).toEqual(["2026-10-20T06:00:00Z", 9007199254740993n]);
  expect(stamp.encode(value)).toEqual({ value: { at: "2026-10-20T06:00:00Z", id: "9007199254740993" } });
  // lab/basic's schemas are the repository's package, which has no dotschema.jsonc: its date-time stays a string.
  expect(event.decode({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }).value.at).toBe("2026-10-20T09:00:00Z");
});
