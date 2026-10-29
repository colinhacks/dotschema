// Jest beside Motherload's transformer (tests/motherload.test.ts): dotschema/jest for the schema
// suffix, first, and motherload/jest for .jsonc and .json5.
const settings = require("./settings.jsonc").default;
const data = require("./data.json5").default;
const user = require("./user.schema.jsonc").default;

test("each file through its own package's transformer", () => {
  expect([settings["editor.fontSize"], data.hex]).toEqual([14, 16]);
  expect(user["~standard"].vendor).toBe("dotschema");
  expect([user.is({ name: "Ada" }), user.is({ name: "" })]).toEqual([true, false]);
});
