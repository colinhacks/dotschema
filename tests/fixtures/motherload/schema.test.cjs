// Jest beside Motherload's transformer (tests/motherload.test.ts): dotschema/jest for the schema
// suffixes, first, and motherload/jest for .jsonc and .json5.
const settings = require("./settings.jsonc").default;
const data = require("./data.json5").default;
const user = require("./user.schema.jsonc").default;
const point = require("./point.schema.json5").default;

test("each file through its own package's transformer", () => {
  expect([settings["editor.fontSize"], data.hex]).toEqual([14, 16]);
  expect([user["~standard"].vendor, point["~standard"].vendor]).toEqual(["dotschema", "dotschema"]);
  expect([user.is({ name: "Ada" }), user.is({ name: "" }), point.is({ x: 1.5, y: 2 })]).toEqual([true, false, false]);
});
