// dotschema beside a real Motherload checkout, run when MOTHERLOAD_DIR names one (with its
// dependencies installed) and skipped otherwise: a project whose `.jsonc` and `.json5` files are
// Motherload's and whose `.schema.jsonc` and `.schema.json5` files are dotschema's
// (tests/fixtures/motherload), type-checked through both mappers, run under both preloads in each
// order, bundled with both esbuild plugins, both webpack loaders (webpack and Rspack) and both Vite
// plugins (Vite, Rollup and Rolldown) in each order, and tested with both Jest transformers; and
// Motherload's withMotherload composed with withDotschema in each order. The project is a copy
// outside the repository whose node_modules links `motherload` to the checkout and `dotschema` to
// this repository, so each package's sources resolve their own dependencies. The bundlers are
// lab/bundlers' and Jest is lab/jest's, and the tests that need them are skipped where those labs
// are not installed.
//
//   MOTHERLOAD_DIR=~/Documents/motherload nub run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withDotschema } from "../src/next.ts";
import { ROOT, run, TSC } from "./helpers.ts";

const MOTHERLOAD = process.env["MOTHERLOAD_DIR"];
const skip = MOTHERLOAD ? false : "MOTHERLOAD_DIR is not set";
const checkout = MOTHERLOAD ? resolve(MOTHERLOAD) : "";
const BUNDLERS = join(ROOT, "lab/bundlers");
const JEST = join(ROOT, "lab/jest/node_modules/.bin/jest");
const skipBundlers = skip || (!existsSync(join(BUNDLERS, "node_modules")) && "lab/bundlers is not installed: run `nub install` in lab/bundlers");
const skipJest = skip || (!existsSync(JEST) && "lab/jest is not installed: run `nub install` in lab/jest");
const fromBundlers = async (name: string) => import(pathToFileURL(createRequire(join(BUNDLERS, "package.json")).resolve(name)).href);

const EXPECTED = '{"fontSize":14,"hex":16,"vendors":["dotschema","dotschema"],"valid":true,"invalid":false,"point":[true,false]}';

/** A copy of tests/fixtures/motherload outside the repository, with both packages linked into its node_modules; removed after `body`. */
async function project(body: (dir: string) => void | Promise<void>): Promise<void> {
  assert.equal(JSON.parse(readFileSync(join(checkout, "package.json"), "utf8")).name, "motherload", `${checkout} is not a Motherload checkout`);
  assert.ok(existsSync(join(checkout, "node_modules")), `${checkout} has no node_modules: run nub install there first`);
  const dir = mkdtempSync(join(tmpdir(), "dotschema-motherload-"));
  try {
    cpSync(join(ROOT, "tests/fixtures/motherload"), dir, { recursive: true });
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(checkout, join(dir, "node_modules/motherload"));
    symlinkSync(ROOT, join(dir, "node_modules/dotschema"));
    for (const name of ["@types", "esbuild"]) symlinkSync(join(ROOT, "node_modules", name), join(dir, "node_modules", name));
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("beside Motherload: both mappers type the project, and both preloads and both esbuild plugins load each file with its own package, in either order", { skip }, () =>
  project((dir) => {
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
  }));

for (const name of ["webpack", "Rspack"] as const) {
  test(`beside Motherload, in ${name}: each package's webpack loader makes its own files' modules, whichever rule comes first`, { skip: skipBundlers }, () =>
    project(async (dir) => {
      const bundler = name === "Rspack" ? (await fromBundlers("@rspack/core")).rspack : (await fromBundlers("webpack")).default;
      const motherload = { test: /\.(jsonc|json5)$/, use: "motherload/webpack" };
      const dotschema = { test: /\.schema\.(jsonc|json5)$/, use: "dotschema/webpack" };
      for (const [order, rules] of [["motherload first", [motherload, dotschema]], ["dotschema first", [dotschema, motherload]]] as const) {
        const output = join(dir, "dist", order.replace(" ", "-"));
        const config = { mode: "none", context: dir, entry: "./main.js", target: "node", output: { path: output, filename: "main.cjs" }, module: { rules } };
        const stats: any = await new Promise((done, fail) => bundler(config, (error: Error | null, stats: unknown) => (error ? fail(error) : done(stats))));
        assert.equal(stats.hasErrors(), false, `${order}: ${stats.toString()}`);
        const ran = run(process.execPath, [join(output, "main.cjs")], dir);
        assert.equal(ran.status, 0, ran.out);
        assert.equal(ran.out.trim(), EXPECTED, `${name}, ${order}`);
      }
    }));
}

for (const name of ["Vite", "Rollup", "Rolldown"] as const) {
  test(`beside Motherload, in ${name}: each package's Vite plugin loads its own files, whichever plugin comes first`, { skip: skipBundlers }, () =>
    project(async (dir) => {
      const { default: motherload } = await import(pathToFileURL(join(checkout, "src/vite.ts")).href);
      const { default: dotschema } = await import(pathToFileURL(join(ROOT, "src/vite.ts")).href);
      for (const [order, plugins] of [["motherload first", [motherload(), dotschema()]], ["dotschema first", [dotschema(), motherload()]]] as const) {
        let code: string;
        if (name === "Vite") {
          const { build } = await fromBundlers("vite");
          const out = await build({ configFile: false, logLevel: "silent", root: dir, plugins, build: { write: false, ssr: join(dir, "main.js"), minify: false } });
          code = out.output[0].code;
        } else {
          const bundle = await (await fromBundlers(name.toLowerCase()))[name.toLowerCase()]({ input: join(dir, "main.js"), plugins, onLog: () => {} });
          code = (await bundle.generate({ format: "es" })).output[0].code;
        }
        const file = join(dir, `${name}-${order.replace(" ", "-")}.mjs`);
        writeFileSync(file, code);
        const ran = run(process.execPath, [file], dir);
        assert.equal(ran.status, 0, ran.out);
        assert.equal(ran.out.trim(), EXPECTED, `${name}, ${order}`);
      }
    }));
}

test("beside Motherload, in Jest: dotschema's transformer, its pattern first, takes the schema files, and Motherload's the data files", { skip: skipJest }, () =>
  project((dir) => {
    const { status, out } = run(JEST, ["-c", "jest.config.cjs", "--ci", "--no-cache"], dir);
    assert.equal(status, 0, out);
    assert.match(out, /Tests:\s+1 passed, 1 total/);
  }));

type Rules = Record<string, { loaders: string[] }>;
type Built = { turbopack: { rules: Rules }; webpack(config: unknown, context: unknown): { module: { rules: { use: string }[] } }; typescript?: { ignoreBuildErrors?: boolean }; compiler?: { runAfterProductionCompile?: unknown } };

test("beside Motherload, in Next.js: withMotherload and withDotschema compose in either order, dotschema's Turbopack rule first, both webpack rules, and one type check", { skip }, async () => {
  const { withMotherload } = await import(pathToFileURL(join(checkout, "src/next.ts")).href);
  const project = { reactStrictMode: true, turbopack: { rules: { "*.svg": { loaders: ["@svgr/webpack"], as: "*.js" } } } };
  for (const [order, config] of [["withMotherload(withDotschema())", withMotherload(withDotschema(project))], ["withDotschema(withMotherload())", withDotschema(withMotherload(project))]] as [string, Built][]) {
    const keys = Object.keys(config.turbopack.rules);
    const ours = keys.indexOf("*.schema.{jsonc,json5}");
    const theirs = keys.findIndex((key) => config.turbopack.rules[key]!.loaders.includes("motherload/turbopack"));
    assert.ok(ours !== -1 && theirs !== -1 && ours < theirs, `${order}: ${keys.join(", ")}`);
    const uses = config.webpack({ module: { rules: [] } }, { isServer: false }).module.rules.map((rule) => rule.use).sort();
    assert.deepEqual(uses, ["dotschema/webpack", "motherload/webpack"], order);
    assert.equal(config.typescript?.ignoreBuildErrors, true, order);
    assert.equal(typeof config.compiler?.runAfterProductionCompile, "function", order);
  }
  // The outer wrapper adds no check of its own: the hook is the inner one's, whichever that is.
  const hook = (config: unknown) => (config as Built).compiler!.runAfterProductionCompile;
  const inner = withDotschema(project);
  assert.equal(hook(withMotherload(inner)), hook(inner));
  const innerMotherload = withMotherload(project);
  assert.equal(hook(withDotschema(innerMotherload)), hook(innerMotherload));
});
