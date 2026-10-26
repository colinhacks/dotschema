"use client";
// A client component: user.schema.jsonc's validator in the browser's bundle.
import user from "../../basic/user.schema.jsonc";

export function Signup() {
  const result = user.validate({ name: "", role: "admin", email: "ada@example" });
  return <pre id="client">{JSON.stringify(result.issues?.map((issue) => `${issue.path.join(".")}: ${issue.message}`))}</pre>;
}
