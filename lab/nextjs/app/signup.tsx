"use client";
// A client component: user.schema.jsonc's validator in the browser's bundle, and stamp.schema.jsonc's
// codecs with it.
import user from "../../basic/user.schema.jsonc";
import stamp from "../stamp.schema.jsonc";

export function Signup() {
  const result = user.validate({ name: "", role: "admin", email: "not an email" });
  const { value } = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" });
  return (
    <>
      <pre id="client">{JSON.stringify(result.issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`))}</pre>
      <pre id="client-codecs">{JSON.stringify(value && [value.at instanceof Temporal.Instant, String(value.at), typeof value.id, String(value.id), stamp.encode(value).value])}</pre>
    </>
  );
}
