// CommonJS: Jest's own require() loads each schema through dotschema/jest.
const user = require("../basic/user.schema.jsonc").default;
// A definition's validator is a named export, which the CommonJS module carries as a property.
const { address } = require("../basic/user.schema.jsonc");
const point = require("../basic/point.schema.json5").default;
const team = require("../basic/team.schema.jsonc").default;

test("lab/basic's schemas, required by a CommonJS test", () => {
  expect(user.validate({ name: "Ada", role: "admin" })).toEqual({ value: { name: "Ada", role: "admin" } });
  expect(user.validate({ name: "", role: "owner" }).issues.map((issue) => issue.keyword)).toEqual(["minLength", "enum"]);
  expect(user["~standard"].vendor).toBe("dotschema");
  expect([address.is({ city: "Paris" }), address.is({ city: "" })]).toEqual([true, false]);
  expect([point.is({ x: 1, y: 2 }), point.is({ x: 1.5, y: 2 })]).toEqual([true, false]);
  // team.schema.jsonc refers to user.schema.jsonc and shared/place.schema.jsonc.
  expect(team.validate({ lead: { name: "Ada", role: "admin" }, members: [{ name: "", role: "member" }] }).issues[0].path).toEqual(["members", 0, "name"]);
});
