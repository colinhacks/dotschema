// dotschema's engine (src/engine/), and the modules `schemaCode` builds on it in each way of running
// their validators, against what dotschema's module gave before it ran on the engine, ajv 8.20.0 as
// `schemaCode` compiled it at 45a7f5e, recorded in tests/fixtures/engine/reference.json
// (tests/engine-support.ts, `referenceOf`), on the same files: the 205 schemas of the keyword
// measurement of 2026-10-27 (tests/fixtures/engine/cases.json, from
// ~/Documents/scratch/dotschema-keywords/cases.ts, a keyword or a form of one to each, with values to
// pass and fail), every schema and value of the JSON Schema Test Suite (tests/engine-support.ts),
// and the schemas of tests/fixtures/engine/messages.ts, which write `errorMessage` or are unions
// dotschema gives a discriminator, which neither of the others does. For each value, as that
// module's `.validate()` checked it (its defaults filled, its strings transformed): the engine's
// `check` gives what `.is()` gave; `errors` is null where `.validate()` passed; its errors, through
// the module's mapping of an error to an issue (src/runtime/issues.ts), are `.validate()`'s issues,
// in order; and they are ajv's errors themselves, every field, and `schemaPath` too where that module
// had one validator for the schema (a plain object had one for each property, whose paths start at
// each). And each module now gives the recorded `.is()` and `.validate()` itself. Each difference
// left is in EXCEPTIONS, with its reason. A file the module at 45a7f5e refused is not compared: the
// engine's verdicts on the suite's are tests/engine-suite.test.ts's. On the messages, the engine's
// errors are also those of ajv itself with dotschema's copy of ajv-errors, so that `schemaPath` is
// compared where that module had a validator for each property.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { compile } from "../src/engine/index.ts";
import { parseSchemaFile } from "../src/parse.ts";
import { issueOf } from "../src/runtime/issues.ts";
import { definitionsOf } from "../src/schema-types.ts";
import { buildModule, comparable, engineOfFile, FORMATS, MODES, referenceOf, sameErrors, SCRATCH, show, suiteGroups, type ReferenceRun, type SuiteDraft, type Validators } from "./engine-support.ts";
import { MESSAGE_CASES } from "./fixtures/engine/messages.ts";
import { ROOT, withFormats } from "./helpers.ts";

/**
 * Where ajv checked a copy of the schema that dotschema rewrote for it (src/schema.ts at 45a7f5e) and
 * the engine checks the schema as written, so its errors are the schema's own.
 */
const CONTAINS_EVALUATED =
  "the module at 45a7f5e checked `unevaluatedItems` beside `contains` through a rewritten copy (`withContainsEvaluated`), an `if` whose errors are the `contains` schema's or its own; the engine checks the schema as written, to the same verdict, and reports `unevaluatedItems`' own errors";
const PROTO_CHECKED = "the module at 45a7f5e checked a `__proto__` property through a copy under `patternProperties` (`withProtoChecked`), so its `schemaPath` was `#/patternProperties/%5E__proto__%24/type`; the engine's is the schema's, `#/properties/__proto__/type`";

/** Each difference between the engine, or a module now, and the module at 45a7f5e, as the test names it, with its reason. */
const EXCEPTIONS: Record<string, string> = {
  "issues case unevaluatedItems-contains #1": CONTAINS_EVALUATED,
  "issues draft2020-12/unevaluatedItems.json [21] #1": CONTAINS_EVALUATED,
  "issues draft2020-12/unevaluatedItems.json [21] #2": CONTAINS_EVALUATED,
  "issues draft2020-12/unevaluatedItems.json [22] #1": CONTAINS_EVALUATED,
  "issues draft2020-12/unevaluatedItems.json [24] #1": CONTAINS_EVALUATED,
  "issues draft2020-12/unevaluatedItems.json [24] #2": CONTAINS_EVALUATED,
  "schemaPath draft6/properties.json [5] #3": PROTO_CHECKED,
  "schemaPath draft7/properties.json [5] #3": PROTO_CHECKED,
  "schemaPath draft2019-09/properties.json [5] #3": PROTO_CHECKED,
  "schemaPath draft2020-12/properties.json [5] #3": PROTO_CHECKED,
};

type Value = { def?: string; value: unknown };
/** A schema file of a corpus, named as the reference names it, written where the tests say it is, with its values. */
type File = { label: string; source: string; path: string; values: Value[] };
type Tally = { files: number; refused: number; lifted: number; values: number; failing: number };
const tally = (): Tally => ({ files: 0, refused: 0, lifted: 0, values: 0, failing: 0 });
const report = (t: Tally) => `${t.files} schemas built by the module at 45a7f5e (${t.refused} refused, ${t.lifted} of them built now), ${t.values} values compared, ${t.failing} of them failing`;

/** The 205 cases, each in a directory of its own. */
function caseFiles(): File[] {
  const { cases, draftUris } = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/engine/cases.json"), "utf8")) as {
    draftUris: Record<string, string>;
    cases: { id: string; draft: string; schema?: Record<string, unknown>; text?: string; suffix?: string; files?: Record<string, unknown>; pass: unknown[]; fail?: unknown[]; defs?: { name: string; pass?: unknown[]; fail?: unknown[] }[] }[];
  };
  assert.equal(cases.length, 205);
  const base = mkdtempSync(join(tmpdir(), "dotschema-engine-cases-"));
  return cases.map((c) => {
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
    return { label: `case ${c.id}`, source: text, path, values };
  });
}

/** Every group of the suite, each said to be in a directory of SCRATCH. */
function suiteFiles(): File[] {
  return (["draft6", "draft7", "draft2019-09", "draft2020-12"] as SuiteDraft[]).flatMap((draft) =>
    (["required", "format"] as const).flatMap((kind) =>
      suiteGroups(draft, kind).map((group) => ({ label: group.id, source: JSON.stringify(group.schema), path: join(SCRATCH, group.id.replace(/[ [\]/]/g, "_"), "root.schema.jsonc"), values: group.tests.map((t) => ({ value: t.data })) })),
    ),
  );
}

/** The messages and the discriminated unions, each in a directory of its own. */
function messageFiles(): File[] {
  const base = mkdtempSync(join(tmpdir(), "dotschema-engine-messages-"));
  return MESSAGE_CASES.map((c, i) => {
    const dir = join(base, String(i));
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), "{}\n");
    const path = join(dir, "root.schema.jsonc");
    const text = JSON.stringify(c.schema, null, 2);
    writeFileSync(path, text);
    assert.equal((engineOfFile(text, path)?.discriminators ?? 0) > 0, c.discriminator ?? false, `${c.id}: the discriminators dotschema gives`);
    return { label: `message ${c.id}`, source: text, path, values: c.values.map((value) => ({ value })) };
  });
}

/** What the module at 45a7f5e gave the file's values, or undefined where it refused the file. */
function recorded(file: File, found: Map<string, string>, count: Tally): ReferenceRun[] | undefined {
  const reference = referenceOf(file.label);
  if (!reference) return void found.set(`reference ${file.label}`, "no reference recorded for the file");
  if ("problems" in reference) {
    count.refused++;
    return undefined;
  }
  if (reference.runs.length !== file.values.length) return void found.set(`reference ${file.label}`, `${reference.runs.length} runs recorded for ${file.values.length} values`);
  count.files++;
  return reference.runs;
}

/** Errors as the reference holds them, written as JSON: a param that is undefined, the tag a value lacks, left out. */
const asRecorded = (errors: Record<string, unknown>[]): Record<string, unknown>[] => JSON.parse(JSON.stringify(errors));

/** A recorded error without its `schemaPath`, nor those of the errors a message replaced. */
const withoutPaths = (error: Record<string, unknown>): Record<string, unknown> => {
  const { schemaPath: _, ...rest } = error;
  const params = rest["params"] as Record<string, unknown>;
  return rest["keyword"] === "errorMessage" && Array.isArray(params["errors"]) ? { ...rest, params: { ...params, errors: (params["errors"] as Record<string, unknown>[]).map(withoutPaths) } } : rest;
};

/** The differences between the engine and the module at 45a7f5e on one file's values, each named as EXCEPTIONS names one. */
function compareEngine(file: File, count: Tally, found: Map<string, string>): void {
  const runs = recorded(file, found, count);
  if (!runs) {
    if (engineOfFile(file.source, file.path)) count.lifted++;
    return;
  }
  const compiled = engineOfFile(file.source, file.path);
  if (!compiled) return void found.set(`engine ${file.label}`, "the module at 45a7f5e built and the engine read no files");
  const parsed = parseSchemaFile(file.source);
  const definitions = parsed.ok ? definitionsOf(parsed.value, file.path) : [];
  file.values.forEach(({ def, value }, index) => {
    const name = `${file.label} #${index}`;
    const run = runs[index]!;
    const input = "input" in run ? run.input : value;
    let uri: string | undefined;
    if (def) {
      const definition = definitions.find((d) => d.valueName === def);
      if (!definition) return void found.set(`definition ${name}`, `no definition ${def}`);
      uri = `${compiled.root}#/${definition.keyword}/${definition.key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    }
    let check: boolean;
    let errors: ReturnType<ReturnType<typeof compiled.engine.validator>["errors"]>;
    try {
      const validator = compiled.engine.validator(uri);
      check = validator.check(input);
      errors = validator.errors(input);
    } catch (error) {
      return void found.set(`threw ${name}`, (error as Error).message);
    }
    count.values++;
    if (errors) count.failing++;
    const shown = `${def ? `<${def}> ` : ""}${show(value, 120)}`;
    if (check !== run.is) found.set(`check ${name}`, `${shown}: check ${check}, .is() ${run.is}`);
    if ((errors === null) !== !run.issues) found.set(`valid ${name}`, `${shown}: errors ${errors === null ? "null" : "given"}, .validate() ${run.issues ? "failed" : "passed"}`);
    const issues = errors?.map((error) => issueOf(input, error));
    if (!isDeepStrictEqual(issues, run.issues)) found.set(`issues ${name}`, `${shown}\n  engine ${show(issues, 400)}\n  module ${show(run.issues, 400)}`);
    else if (errors && !isDeepStrictEqual(asRecorded(errors.map((e) => comparable(e, false))), run.errors!.map(withoutPaths))) found.set(`errors ${name}`, `${shown}\n  engine ${show(errors, 600)}\n  module ${show(run.errors, 600)}`);
    else if (errors && !run.joined && !isDeepStrictEqual(asRecorded(errors.map((e) => comparable(e, true))), run.errors)) found.set(`schemaPath ${name}`, `${shown}\n  engine ${show(errors.map((e) => e.schemaPath), 300)}\n  module ${show(run.errors!.map((e) => e["schemaPath"]), 300)}`);
  });
}

/**
 * What the engine gives a file's values, as a module's `.is()` and `.validate()` give it, for a file
 * the module at 45a7f5e refused: its root's, or undefined where a value is a definition's.
 */
function engineRuns(file: File): ReferenceRun[] | undefined {
  const compiled = engineOfFile(file.source, file.path);
  if (!compiled || file.values.some((v) => v.def)) return undefined;
  const validator = compiled.engine.validator();
  return file.values.map(({ value }) => {
    const errors = validator.errors(value);
    return { is: validator.check(value), ...(errors ? { issues: errors.map((error) => issueOf(value, error)) } : {}) };
  });
}

/**
 * The differences between a module now, in a way of running its validators, and the module at
 * 45a7f5e, on one file's values, named as EXCEPTIONS names one; on a file that module refused, which
 * a module now builds, the differences from the engine's verdicts and issues, named `lifted`.
 */
async function compareModule(file: File, validators: Validators, count: Tally, found: Map<string, string>): Promise<void> {
  let runs = recorded(file, found, count);
  const built = await buildModule(file.source, file.path, validators);
  let lifted = false;
  if (!runs) {
    if (!built.exports) return;
    count.lifted++;
    runs = engineRuns(file);
    if (!runs) return void found.set(`lifted ${file.label}`, "the engine reads no files where the module builds");
    lifted = true;
  }
  if (!built.exports) return void found.set(`refused ${file.label}`, built.problems.join("; "));
  file.values.forEach(({ def, value }, index) => {
    const name = `${lifted ? "lifted " : ""}${file.label} #${index}`;
    const run = runs[index]!;
    const target = built.exports![def ?? "default"];
    if (!target) return void found.set(`definition ${name}`, `no export ${def}`);
    count.values++;
    const is = target.is(value);
    const result = target.validate(value);
    if (result.issues) count.failing++;
    const shown = `${def ? `<${def}> ` : ""}${show(value, 120)}`;
    if (is !== run.is) found.set(`check ${name}`, `${shown}: .is() ${is}, at 45a7f5e ${run.is}`);
    if (!result.issues !== !run.issues) found.set(`valid ${name}`, `${shown}: .validate() ${result.issues ? "fails" : "passes"}, at 45a7f5e it ${run.issues ? "failed" : "passed"}`);
    else if (!isDeepStrictEqual(result.issues, run.issues)) found.set(`issues ${name}`, `${shown}\n  now ${show(result.issues, 400)}\n  at 45a7f5e ${show(run.issues, 400)}`);
  });
}

/** The differences found that EXCEPTIONS does not list, and the exceptions of `kinds` no longer found. */
function unexplained(found: Map<string, string>, corpus: (label: string) => boolean, kinds: readonly string[]): { differences: string[]; stale: string[] } {
  const exceptions = Object.keys(EXCEPTIONS).filter((name) => kinds.includes(name.split(" ")[0]!) && corpus(name.slice(name.indexOf(" ") + 1)));
  return {
    differences: [...found].filter(([name]) => !exceptions.includes(name)).map(([name, detail]) => `${name}: ${detail}`),
    stale: exceptions.filter((name) => !found.has(name)),
  };
}

const ENGINE_KINDS = ["check", "valid", "issues", "errors", "schemaPath"];
const MODULE_KINDS = ["check", "valid", "issues"];
const isCase = (label: string) => label.startsWith("case ");
const isMessage = (label: string) => label.startsWith("message ");
const isSuite = (label: string) => !isCase(label) && !isMessage(label);

const CORPORA = [
  ["the 205 schemas of the keyword measurement", caseFiles, isCase],
  ["every schema and value of the JSON Schema Test Suite", suiteFiles, isSuite],
  ["schemas that write errorMessage and unions dotschema gives a discriminator", messageFiles, isMessage],
] as const;

for (const [corpus, files, within] of CORPORA) {
  test(`on ${corpus}, the engine gives the verdicts, issues and errors of the module at 45a7f5e`, (t) => {
    const count = tally();
    const found = new Map<string, string>();
    for (const file of files()) compareEngine(file, count, found);
    t.diagnostic(report(count));
    assert.deepEqual(unexplained(found, within, ENGINE_KINDS), { differences: [], stale: [] });
  });
}

for (const validators of MODES) {
  test(`with "validators": "${validators}", each module gives the .is() and .validate() of the module at 45a7f5e on the same corpora`, async (t) => {
    for (const [corpus, files, within] of CORPORA) {
      const count = tally();
      const found = new Map<string, string>();
      for (const file of files()) await compareModule(file, validators, count, found);
      t.diagnostic(`${corpus}: ${report(count)}`);
      assert.deepEqual(unexplained(found, within, MODULE_KINDS), { differences: [], stale: [] }, corpus);
    }
  });
}

test("on the messages, the engine's errors are those of ajv with dotschema's copy of ajv-errors, schemaPath included", () => {
  const require = createRequire(join(ROOT, "package.json"));
  const errorMessage = require("./tests/fixtures/engine/error-message.cjs");
  const differences: string[] = [];
  let compared = 0;
  for (const c of MESSAGE_CASES) {
    const declared = String(c.schema["$schema"] ?? "");
    const [entry, draft] = declared.includes("2020-12") ? (["ajv/dist/2020", "2020-12"] as const) : declared.includes("2019-09") ? (["ajv/dist/2019", "2019-09"] as const) : (["ajv", "draft-07"] as const);
    const ajv = withFormats(new (require(entry).default)({ allErrors: true, strict: false, logger: false, ownProperties: true, multipleOfPrecision: 7 }));
    errorMessage(ajv);
    const validate = ajv.compile(c.schema);
    const validator = compile([{ id: "dotschema:0", schema: c.schema }], { draft, formats: FORMATS }).validator();
    c.values.forEach((value, i) => {
      compared++;
      const theirs = validate(value) ? null : validate.errors;
      const ours = validator.errors(value);
      if ((ours === null) !== (theirs === null) || !sameErrors(ours ?? [], theirs ?? [], true)) differences.push(`${c.id} #${i} ${show(value)}\n  engine ${show(ours, 600)}\n  ajv ${show(theirs, 600)}`);
    });
  }
  assert.ok(compared > 200);
  assert.deepEqual(differences, []);
});
