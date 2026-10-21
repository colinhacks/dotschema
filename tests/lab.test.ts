// The end-to-end checks: the type check through TypeScript's content mapper, the preload, and the
// esbuild plugin, on lab/basic; diagnostics placed in broken schema files; and a library's
// declarations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, run, TSC } from "./helpers.ts";

test("lab/basic type-checks through the content mapper", () => {
  const { status, out } = run(TSC, ["-p", "lab/basic/tsconfig.json", "--noEmit", "--runExternalCode"]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

test("control: without --runExternalCode the imports do not resolve", () => {
  const { status, out } = run(TSC, ["-p", "lab/basic/tsconfig.json", "--noEmit"]);
  assert.equal(status, 2);
  assert.match(out, /TS2307: Cannot find module '\.\/user\.schema\.jsonc'/);
});

test("a broken schema file is a diagnostic at its place in the file", () => {
  const { status, out } = run(TSC, ["-p", "tests/fixtures/errors/tsconfig.json", "--noEmit", "--runExternalCode"]);
  assert.equal(status, 2);
  assert.match(out, /broken\.schema\.jsonc\(1,1\): error dotschema4: The schema is not valid/);
  assert.match(out, /broken\.schema\.json5\(3,44\): error dotschema1: invalid character ','/);
  // A $ref to a file that is not there is placed at the reference.
  assert.match(out, /broken-ref\.schema\.jsonc\(4,35\): error dotschema4: The \$ref "\.\/missing\.schema\.jsonc" names a file that does not exist\./);
  // An $id below a schema file's root is placed at the $id's value.
  assert.match(out, /embedded-id\.schema\.jsonc\(6,24\): error dotschema4: The \$id "https:\/\/example\.com\/inner" gives a schema inside the file a base URI of its own/);
});

test("a library that re-exports a schema module emits its declarations: the schema's literal type is inlined, though the module does not export its name", () => {
  const out = mkdtempSync(join(tmpdir(), "dotschema-declaration-"));
  const result = run(TSC, ["-p", "tests/fixtures/declaration/tsconfig.json", "--runExternalCode", "--outDir", out]);
  assert.equal(result.out, "");
  assert.equal(result.status, 0);
  const declarations = readFileSync(join(out, "tests/fixtures/declaration/main.d.ts"), "utf8");
  // Here `dotschema` is this repository, so TypeScript names its types by a relative path; installed,
  // it names them `import("dotschema")`, which scripts/check-dist.ts checks.
  assert.match(declarations, /user: import\("\.\.\/\.\.\/\.\.\/src\/index\.js"\)\.Schema<import\("\.\/user\.schema\.jsonc"\)\.Type, \{\n\s+readonly type: "object";/);
  assert.doesNotMatch(declarations, /\bJson\b/);
  assert.match(declarations, /export declare const check: \(value: unknown\) => value is import\("\.\/user\.schema\.jsonc"\)\.Type;/);
  rmSync(out, { recursive: true, force: true });
});

// What lab/basic/main.ts prints, piece by piece.
// user.schema.jsonc's validate: the value, then every issue with its path and keyword; `~standard.validate` the same function, a missing property's key ending the path; the vendor; an array index a number, through team.schema.jsonc's $ref.
const VALIDATE = '"valid":"Ada","invalid":"name: must NOT have fewer than 1 characters; email: must match format \\"email\\"; role: must be equal to one of the allowed values","keywords":["minLength","format","enum"],"standard":[true,["role"]],"vendor":"dotschema","memberPath":["members",1,"name"]';
// point.schema.json5: an integer, and a label of at most 0x10 characters.
const POINTS = '"points":[true,false,false]';
// team.schema.jsonc: valid, then failing user.schema.jsonc's and shared/place.schema.jsonc's rules through its $refs.
const TEAM = '"team":[true,false,false]';
// team.schema.jsonc through Standard JSON Schema, in 2020-12 and draft-07: the other two files folded in, its $refs pointers.
const JSON_SCHEMA = '"teamJsonSchema":[["https://json-schema.org/draft/2020-12/schema","#/$defs/user","user,place"],["http://json-schema.org/draft-07/schema#","#/definitions/user","user,place"]]';
// event.schema.jsonc: a click and a visit, then a bad date-time, a bad uri and a click with a visit's field; then main.ts's narrowing functions.
const EVENTS = '"events":[true,true,false,false,false],"described":"3,4","clickX":5';
const EXPECTED = [VALIDATE, POINTS, TEAM, JSON_SCHEMA, EVENTS];

test("lab/basic runs under the preload", () => {
  const { status, out } = run(process.execPath, ["--import", "dotschema/register", "main.ts"], `${ROOT}lab/basic`);
  assert.equal(status, 0, out);
  for (const expected of EXPECTED) assert.ok(out.includes(expected), out);
});

test("lab/basic bundles with the esbuild plugin and runs with nothing installed", () => {
  rmSync(`${ROOT}lab/basic/dist`, { recursive: true, force: true });
  const built = run(process.execPath, ["build-esbuild.ts"], `${ROOT}lab/basic`);
  assert.equal(built.status, 0, built.out);
  // main.ts and the four schemas it imports: shared/place.schema.jsonc, which team.schema.jsonc refers to, is compiled into team's validator.
  assert.match(built.out, /errors=0 inputs=5 node_modules=0/);
  const ran = run(process.execPath, ["dist/main.mjs"], `${ROOT}lab/basic`);
  assert.equal(ran.status, 0, ran.out);
  for (const expected of EXPECTED) assert.ok(ran.out.includes(expected), ran.out);
});
