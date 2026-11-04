// dotschema's engine (src/engine/) against the JSON Schema Test Suite: the required tests of draft6,
// draft7, 2019-09 and 2020-12 with the suite's remotes, and the format tests under each draft
// (tests/engine-support.ts says which fixtures). Each test is passed by `check` and by `errors` alike,
// but those listed in KNOWN, each a decision of dotschema's; and no test dotschema's module passed
// before it ran on the engine, ajv 8.20.0 as `schemaCode` compiled it at 45a7f5e (recorded in
// tests/fixtures/engine/reference.json), is failed by the engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceOf, suiteEngine, suiteGroups, type SuiteDraft, type SuiteGroup } from "./engine-support.ts";

const DRAFTS: SuiteDraft[] = ["draft6", "draft7", "draft2019-09", "draft2020-12"];

const REF_SIBLINGS = "a keyword beside a `$ref` applies in draft-06 and draft-07, as ajv applies it, where the spec ignores it (DESIGN.md, The types: the maintainer's pick of 2026-10-28, \"Apply them, as ajv does\")";
const VOCABULARY = "`$vocabulary` is not read, as ajv 8.20.0 does not read it: a meta-schema without the validation vocabulary still has `minimum` checked";
const FORMAT_ASSERTS = "`format` asserts in every draft (DESIGN.md, The validator), where 2020-12 makes it an annotation by default";

/** The suite's tests the engine fails, by group and the index of each test, each with its reason. */
const KNOWN: Record<string, { tests: number[]; reason: string }> = {
  "draft6/ref.json [5]": { tests: [1], reason: REF_SIBLINGS },
  "draft7/ref.json [5]": { tests: [1], reason: REF_SIBLINGS },
  "draft2019-09/vocabulary.json [0]": { tests: [2], reason: VOCABULARY },
  ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`draft2020-12/format.json [${i}]`, { tests: [6], reason: FORMAT_ASSERTS }])),
  "draft2020-12/vocabulary.json [0]": { tests: [2], reason: VOCABULARY },
};

/** A group's tests run on the engine, each passed or failed with what went wrong. */
type Run = { group: SuiteGroup; results: { passed: boolean; detail?: string }[] };

/** Each test of a draft's groups run on the engine, `check` and `errors` both. */
function runEngine(draft: SuiteDraft, kind: "required" | "format"): Run[] {
  return suiteGroups(draft, kind).map((group) => {
    let validator: ReturnType<ReturnType<typeof suiteEngine>["validator"]>;
    try {
      validator = suiteEngine(group).validator();
    } catch (error) {
      return { group, results: group.tests.map(() => ({ passed: false, detail: `compile threw: ${(error as Error).message}` })) };
    }
    const results = group.tests.map((t) => {
      try {
        const check = validator.check(t.data);
        const errors = validator.errors(t.data);
        if (check !== (errors === null)) return { passed: false, detail: `check ${check}, errors ${JSON.stringify(errors)}` };
        return { passed: check === t.valid };
      } catch (error) {
        return { passed: false, detail: `threw: ${(error as Error).message}` };
      }
    });
    return { group, results };
  });
}

const runs = new Map<SuiteDraft, { required: Run[]; format: Run[] }>(DRAFTS.map((draft) => [draft, { required: runEngine(draft, "required"), format: runEngine(draft, "format") }]));

test("the engine passes every test of the suite but the ones KNOWN lists, check and errors agreeing on each", (t) => {
  const failed: string[] = [];
  for (const draft of DRAFTS) {
    const { required, format } = runs.get(draft)!;
    const count = (list: Run[]) => `${list.reduce((n, run) => n + run.results.filter((r) => r.passed).length, 0)}/${list.reduce((n, run) => n + run.results.length, 0)}`;
    t.diagnostic(`${draft}: required ${count(required)}, optional/format ${count(format)}`);
    for (const { group, results } of [...required, ...format]) results.forEach((r, i) => r.passed || failed.push(`${group.id} #${i}${r.detail ? `: ${r.detail}` : ""}`));
  }
  const known = Object.entries(KNOWN).flatMap(([id, { tests }]) => tests.map((index) => `${id} #${index}`));
  assert.deepEqual(failed, known);
});

test("the engine fails no test of the suite that dotschema's module passed at 45a7f5e", (t) => {
  const regressions: string[] = [];
  for (const draft of DRAFTS) {
    const counts: string[] = [];
    for (const kind of ["required", "format"] as const) {
      let passed = 0;
      let total = 0;
      for (const { group, results } of runs.get(draft)![kind]) {
        const reference = referenceOf(group.id);
        const recorded = reference && "runs" in reference ? reference.runs : undefined;
        group.tests.forEach((test, i) => {
          total++;
          if (!recorded || recorded[i]!.is !== test.valid) return;
          passed++;
          if (!results[i]!.passed) regressions.push(`${group.id} #${i}`);
        });
      }
      assert.ok(passed > 0);
      counts.push(`${kind === "format" ? "optional/format" : kind} ${passed}/${total}`);
    }
    t.diagnostic(`${draft}: dotschema's module at 45a7f5e passed ${counts.join(", ")}`);
  }
  assert.deepEqual(regressions, []);
});
