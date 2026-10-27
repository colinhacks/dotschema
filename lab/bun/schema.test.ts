// Bun's test runner, the preload from bunfig.toml's [test]: `bun test`.
import { expect, test } from "bun:test";
import user from "../basic/user.schema.jsonc";
import stamp from "./codecs/stamp.schema.jsonc";

test("a schema imported by a test under Bun's preload", () => {
  expect(user["~standard"].vendor).toBe("dotschema");
  expect(user.validate({ name: "", role: "admin" }).issues?.map((issue) => issue.keyword)).toEqual(["minLength"]);
});

test("codecs/stamp.schema.jsonc decodes with the codecs of the dotschema.jsonc beside it", () => {
  const decoded = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" }).value!;
  expect(decoded.at).toBeInstanceOf(Temporal.Instant);
  expect(decoded.id).toBe(9007199254740993n);
  expect(stamp.encode(decoded).value).toEqual({ at: "2026-10-20T06:00:00Z", id: "9007199254740993" });
});
