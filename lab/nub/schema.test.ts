// Node's test runner under nub, the preload from nub.jsonc: `nub --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import user from "../basic/user.schema.jsonc";

test("a schema imported by a test under nub's preload", () => {
  assert.equal(user["~standard"].vendor, "dotschema");
  assert.deepEqual(user.validate({ name: "", role: "admin" }).issues?.map((issue) => issue.keyword), ["minLength"]);
});
