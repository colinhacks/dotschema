// A schema and a data file in one Jest run (jest.interop.config.cjs): user.schema.jsonc through
// dotschema/jest and app.jsonc through the stand-in for Motherload's `.jsonc` transformer.
const user = require("../../tests/fixtures/interop/user.schema.jsonc").default;
const app = require("../../tests/fixtures/interop/app.jsonc").default;

test("dotschema's pattern, first, takes the schema file, and the stand-in's the data file", () => {
  expect(user["~standard"].vendor).toBe("dotschema");
  expect([user.is("x"), user.is(1)]).toEqual([true, false]);
  expect(app).toEqual({ a: 1 });
});
