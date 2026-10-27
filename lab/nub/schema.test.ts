// Node's test runner under nub, the preload from nub.jsonc: `nub --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import user from "../basic/user.schema.jsonc";
import stamp from "./codecs/stamp.schema.jsonc";

test("a schema imported by a test under nub's preload", () => {
  assert.equal(user["~standard"].vendor, "dotschema");
  assert.deepEqual(user.validate({ name: "", role: "admin" }).issues?.map((issue) => issue.keyword), ["minLength"]);
});

test("codecs/stamp.schema.jsonc decodes with the codecs of the dotschema.jsonc beside it", () => {
  const decoded = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" });
  if (decoded.issues) throw new Error(JSON.stringify(decoded.issues));
  assert.ok(decoded.value.at instanceof Temporal.Instant);
  assert.equal(decoded.value.id, 9007199254740993n);
  assert.deepEqual(stamp.encode(decoded.value), { value: { at: "2026-10-20T06:00:00Z", id: "9007199254740993" } });
});
