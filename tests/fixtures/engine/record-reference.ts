// Writes tests/fixtures/engine/reference.json: what dotschema's module gave before it ran on the
// engine, ajv 8.20.0 as `schemaCode` compiled it at 45a7f5e, on the corpora tests/engine-parity.test.ts
// and tests/engine-suite.test.ts compare the engine and the modules with: the 205 schemas of the
// keyword measurement (cases.json), every schema and value of the JSON Schema Test Suite
// (tests/engine-support.ts), and the schemas of messages.ts. For each file, the problems the module
// refused it with, or for each value, in the order the tests give them: `.is()`, `.validate()`'s
// issues where it fails, ajv's errors behind them, every field, with `joined` where they came from
// one validator for each property of a plain object, whose `schemaPath`s start at each, and the
// value it checked where its defaults or transforms changed it.
//
// That module is gone from the repository, so the reference is regenerated, if ever, from a
// checkout of 45a7f5e with its dependencies, outside this one:
//
//   mkdir -p ~/Documents/scratch/dotschema-reference/tree
//   git archive 45a7f5e | tar -x -C ~/Documents/scratch/dotschema-reference/tree
//   (link node_modules there: ajv, jsonc-parser, and dotschema to the tree itself)
//   env -u NODE_COMPAT nub tests/fixtures/engine/record-reference.ts ~/Documents/scratch/dotschema-reference/tree
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { EngineError } from "../../../src/engine/index.ts";
import { comparable, SCRATCH, suiteGroups, type ReferenceFile, type ReferenceRun, type SuiteDraft } from "../../engine-support.ts";
import { ROOT } from "../../helpers.ts";
import { MESSAGE_CASES } from "./messages.ts";

const checkout = process.argv[2];
if (!checkout) throw new Error("usage: record-reference.ts <a checkout of 45a7f5e with its dependencies>");
const { schemaCode } = (await import(join(checkout, "src/schema.ts"))) as { schemaCode(source: string, path: string): { code: string; problems: { message: string }[] } };

type Probe = { input?: unknown; raw?: EngineError[] };
const probe = (): Probe => (globalThis as unknown as { __dotschemaEngineProbe: Probe }).__dotschemaEngineProbe;

/** Hooks into the module's `.validate()`, found by its text: ajv's errors, and the value it checked. */
function instrument(code: string): string {
  const errors = "all.errors.map((error) => __issue(";
  if (!code.includes(errors)) throw new Error("the module's validate() no longer reads all.errors");
  let out = code.replace(errors, "(globalThis.__dotschemaEngineProbe.raw = all.errors).map((error) => __issue(");
  const pre = "input = __in(value);\n      if (all(input))";
  if (out.includes(pre)) out = out.replace(pre, "input = __in(value);\n      globalThis.__dotschemaEngineProbe.input = input;\n      if (all(input))");
  return out;
}

type Value = { def?: string; value: unknown };

/** The module's results on one file's values, or its problems. */
async function record(source: string, path: string, values: Value[]): Promise<ReferenceFile> {
  const built = schemaCode(source, path);
  if (built.problems.length) return { problems: built.problems.map((p) => p.message) };
  const exports = await import(`data:text/javascript;base64,${Buffer.from(instrument(built.code)).toString("base64")}`);
  return {
    runs: values.map(({ def, value }) => {
      const target = def ? exports[def] : exports["default"];
      (globalThis as unknown as { __dotschemaEngineProbe: Probe }).__dotschemaEngineProbe = {};
      const result = target.validate(value);
      const seen = probe();
      const run: ReferenceRun = { is: target.is(value) };
      if (result.issues) {
        run.issues = result.issues;
        run.errors = (seen.raw ?? []).map((error) => comparable(error, true));
        if (typeof target.pick === "function") run.joined = true;
      }
      if ("input" in seen && !isDeepStrictEqual(seen.input, value)) run.input = seen.input;
      return run;
    }),
  };
}

const files: Record<string, ReferenceFile> = {};

// The 205 cases, each in a directory of its own, as tests/engine-parity.test.ts writes them.
const { cases, draftUris } = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/engine/cases.json"), "utf8")) as {
  draftUris: Record<string, string>;
  cases: { id: string; draft: string; schema?: Record<string, unknown>; text?: string; suffix?: string; files?: Record<string, unknown>; pass: unknown[]; fail?: unknown[]; defs?: { name: string; pass?: unknown[]; fail?: unknown[] }[] }[];
};
const base = mkdtempSync(join(tmpdir(), "dotschema-reference-cases-"));
for (const c of cases) {
  const dir = join(base, c.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}\n");
  for (const [name, file] of Object.entries(c.files ?? {})) writeFileSync(join(dir, name), typeof file === "string" ? file : JSON.stringify(file, null, 2));
  const path = join(dir, `root${c.suffix ?? ".schema.jsonc"}`);
  const uri = draftUris[c.draft];
  const text = c.text ?? JSON.stringify(uri && !("$schema" in c.schema!) ? { $schema: uri, ...c.schema } : c.schema, null, 2);
  writeFileSync(path, text);
  const values: Value[] = [...c.pass, ...(c.fail ?? [])].map((value) => ({ value }));
  for (const d of c.defs ?? []) values.push(...[...(d.pass ?? []), ...(d.fail ?? [])].map((value) => ({ def: d.name, value })));
  files[`case ${c.id}`] = await record(text, path, values);
}

// The suite's groups, each said to be in a directory of SCRATCH.
for (const draft of ["draft6", "draft7", "draft2019-09", "draft2020-12"] as SuiteDraft[])
  for (const kind of ["required", "format"] as const)
    for (const group of suiteGroups(draft, kind)) {
      const path = join(SCRATCH, group.id.replace(/[ [\]/]/g, "_"), "root.schema.jsonc");
      files[group.id] = await record(JSON.stringify(group.schema), path, group.tests.map((t) => ({ value: t.data })));
    }

// The messages and the discriminated unions.
const messages = mkdtempSync(join(tmpdir(), "dotschema-reference-messages-"));
for (const [i, c] of MESSAGE_CASES.entries()) {
  const dir = join(messages, String(i));
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), "{}\n");
  const path = join(dir, "root.schema.jsonc");
  const text = JSON.stringify(c.schema, null, 2);
  writeFileSync(path, text);
  files[`message ${c.id}`] = await record(text, path, c.values.map((value) => ({ value })));
}

// One file to a line, so that a change shows as the files it changes.
const lines = Object.entries(files).map(([label, file]) => `  ${JSON.stringify(label)}: ${JSON.stringify(file)}`);
writeFileSync(join(ROOT, "tests/fixtures/engine/reference.json"), `{\n  "commit": "45a7f5e",\n  "files": {\n${lines.map((line) => `  ${line}`).join(",\n")}\n  }\n}\n`);
console.log(`${Object.keys(files).length} files, ${Object.values(files).filter((f) => "problems" in f).length} refused`);
