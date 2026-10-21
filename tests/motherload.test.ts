// dotschema beside a real Motherload checkout, run when MOTHERLOAD_DIR names one (with its
// dependencies installed) and skipped otherwise: a project whose `.jsonc` and `.json5` files are
// Motherload's and whose `.schema.jsonc` and `.schema.json5` files are dotschema's
// (tests/fixtures/motherload), type-checked through both mappers, run under both preloads in each
// order and bundled with both esbuild plugins in each order. The project is a copy outside the
// repository whose node_modules links `motherload` to the checkout and `dotschema` to this
// repository, so each package's sources resolve their own dependencies.
//
//   MOTHERLOAD_DIR=~/Documents/motherload nub run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT, run, TSC } from "./helpers.ts";

const MOTHERLOAD = process.env["MOTHERLOAD_DIR"];
const skip = MOTHERLOAD ? false : "MOTHERLOAD_DIR is not set";

const EXPECTED = '{"fontSize":14,"hex":16,"vendors":["dotschema","dotschema"],"valid":true,"invalid":false,"point":[true,false]}';

test("beside Motherload: both mappers type the project, and both preloads and both esbuild plugins load each file with its own package, in either order", { skip }, () => {
  const checkout = resolve(MOTHERLOAD!);
  assert.equal(JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")).name, "motherload", `${checkout} is not a Motherload checkout`);
  assert.ok(existsSync(join(checkout, "node_modules")), `${checkout} has no node_modules: run nub install there first`);
  const dir = mkdtempSync(join(tmpdir(), "dotschema-motherload-"));
  try {
    cpSync(join(ROOT, "tests/fixtures/motherload"), dir, { recursive: true });
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(checkout, join(dir, "node_modules/motherload"));
    symlinkSync(ROOT, join(dir, "node_modules/dotschema"));
    for (const name of ["@types", "esbuild"]) symlinkSync(join(ROOT, "node_modules", name), join(dir, "node_modules", name));

    const checked = run(TSC, ["-p", "tsconfig.json", "--noEmit", "--runExternalCode"], dir);
    assert.equal(checked.out, "");
    assert.equal(checked.status, 0);

    for (const order of [["motherload", "dotschema"], ["dotschema", "motherload"]]) {
      const ran = run(process.execPath, [...order.flatMap((name) => ["--import", `${name}/register`]), "main.ts"], dir);
      assert.equal(ran.status, 0, ran.out);
      assert.equal(ran.out.trim(), EXPECTED, `preloads ${order.join(", ")}`);
    }

    for (const order of ["motherload-first", "dotschema-first"]) {
      rmSync(join(dir, "dist"), { recursive: true, force: true });
      const built = run(process.execPath, ["build-esbuild.ts", order], dir);
      assert.equal(built.status, 0, built.out);
      assert.match(built.out, /errors=0 inputs=5 node_modules=0/, order);
      const ran = run(process.execPath, ["dist/main.mjs"], dir);
      assert.equal(ran.status, 0, ran.out);
      assert.equal(ran.out.trim(), EXPECTED, `esbuild ${order}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
