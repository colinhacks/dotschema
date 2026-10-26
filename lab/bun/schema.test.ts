// Bun's test runner, the preload from bunfig.toml's [test]: `bun test`.
import { expect, test } from "bun:test";
import user from "../basic/user.schema.jsonc";

test("a schema imported by a test under Bun's preload", () => {
  expect(user["~standard"].vendor).toBe("dotschema");
  expect(user.validate({ name: "", role: "admin" }).issues?.map((issue) => issue.keyword)).toEqual(["minLength"]);
});
