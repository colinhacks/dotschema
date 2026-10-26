// ESM: Jest's own linker (--experimental-vm-modules) loads each schema through dotschema/jest, and
// Vitest through dotschema/vite.
import user, { address } from "../basic/user.schema.jsonc";
import point from "../basic/point.schema.json5";
import event from "../basic/event.schema.jsonc";

test("lab/basic's schemas, imported by an ES module test", () => {
  expect(user.is({ name: "Ada", role: "admin" })).toBe(true);
  expect([address.is({ city: "Paris" }), user.omit("role").is({ name: "Ada" })]).toEqual([true, true]);
  expect(user["~standard"].validate({ name: "Ada" }).issues[0].path).toEqual(["role"]);
  expect(point.schema.properties.label.maxLength).toBe(16);
  // ajv-formats' date-time, inlined into the module.
  expect([event.is({ at: "2026-10-20T09:00:00Z", kind: "click", x: 1, y: 2 }), event.is({ at: "yesterday", kind: "click", x: 1, y: 2 })]).toEqual([true, false]);
});
