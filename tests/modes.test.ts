// The module-level tests run once more for each way of running a module's validators that
// `nub run test` does not run them in (src/settings.ts, `"dotschema": { "validators": ... }`): the
// interpreter alone, and the checks written into the module (`aot`), each under
// DOTSCHEMA_VALIDATORS, which tests/helpers.ts's `schemaCode` builds with; the JIT, the default, is
// how every other run builds them. tests/engine-parity.test.ts compares the three on its corpora.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./helpers.ts";

const FILES = ["schema", "verdicts", "definitions", "pick", "output", "json-schema", "formats", "schema-types"].map((name) => `tests/${name}.test.ts`);

for (const validators of ["interpret", "aot"] as const) {
  test(`the module-level tests pass with "validators": "${validators}"`, { skip: process.env["DOTSCHEMA_VALIDATORS"] ? "already run in one mode" : false }, () => {
    const { status, out } = run(process.execPath, ["--test", "--test-reporter=dot", ...FILES], undefined, { DOTSCHEMA_VALIDATORS: validators });
    assert.equal(status, 0, out);
  });
}
