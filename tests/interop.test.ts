// The package's manifest, and the protocol it shares with Motherload (DESIGN.md, "The shared
// protocol"): of the loaders in one host, the one claiming the longer suffix of a file loads it,
// whatever order the host was given them in, as TypeScript routes it. Checked against a stand-in for
// Motherload's `.jsonc` loader (tests/standin.ts), in Node (both orders of the two preloads), Bun
// (each plugin asked for both files), esbuild (both orders of the two plugins), webpack and Rspack
// (both orders of the two rules), Vite, Rollup and Rolldown (both orders of the two plugins), and
// Next.js's config (both orders of the two wrappers). The bundlers are lab/bundlers' own
// dependencies, and their tests are skipped where it is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { standalone } from "../src/core/standalone.ts";
import { ownerOf, register, toEsbuildPlugin, toNodeHooks, toVitePlugin } from "../src/core/universal.ts";
import { loader } from "../src/loader.ts";
import { withDotschema } from "../src/next.ts";
import { ROOT, run } from "./helpers.ts";
import * as standin from "./standin.ts";

const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, "utf8"));
const FIXTURE = join(ROOT, "tests/fixtures/interop");
const SCHEMA = standalone(loader);

test("the package is private in the repository, points at its sources, and depends on no Motherload package", () => {
  assert.equal(pkg.name, "dotschema");
  assert.equal(pkg.private, true);
  for (const entry of [".", "./register", "./esbuild", "./vite", "./webpack", "./turbopack", "./next", "./jest"]) assert.ok(existsSync(join(ROOT, pkg.exports[entry])), entry);
  assert.deepEqual(pkg.typescript.contentMapper.exec, ["node", "src/mapper.ts"]);
  assert.ok(existsSync(`${ROOT}src/mapper.ts`));
  // A mapper package does not resolve through self-reference, so the repository links itself.
  assert.equal(pkg.devDependencies.dotschema, "link:.");
  // The formats are dotschema's own (src/formats/), so ajv-formats is a development dependency, for the test that compares them.
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["ajv", "json5", "jsonc-parser"]);
  // Each a caret range on the oldest version that passes the checks (DESIGN.md, "Packaging").
  for (const [dep, range] of Object.entries(pkg.dependencies)) assert.match(range as string, /^\^[1-9]\d*\.\d+\.\d+$/, dep);
});

test("dotschema claims its two suffixes, and a longer suffix than a .jsonc or .json5 loader's", () => {
  assert.deepEqual(SCHEMA.extensions, [".schema.jsonc", ".schema.json5"]);
  const json5 = { ...standin.standin, name: "stand-in-json5", extensions: [".json5"], filter: /\.json5$/ };
  for (const loaders of [[standin.standin, json5, SCHEMA], [SCHEMA, json5, standin.standin]]) {
    assert.equal(ownerOf(loaders, "/a/user.schema.jsonc"), SCHEMA);
    assert.equal(ownerOf(loaders, "/a/user.schema.json5"), SCHEMA);
    assert.equal(ownerOf(loaders, "/a/app.jsonc"), standin.standin);
    assert.equal(ownerOf(loaders, "/a/app.json5"), json5);
    assert.equal(ownerOf(loaders, "/a/user.schema.json"), undefined);
  }
});

const SCHEMA_OUT = '"vendor":"dotschema","string":true,"number":false';
const APP_OUT = '"app":{"a":1}';

test("Node: each preload leaves the other's files to it, whichever was registered first", () => {
  const orders = [
    ["--import", "./standin-register.ts", "--import", "dotschema/register"],
    ["--import", "dotschema/register", "--import", "./standin-register.ts"],
  ];
  for (const flags of orders) {
    const { status, out } = run(process.execPath, [...flags, "main.js"], FIXTURE);
    assert.equal(status, 0, out);
    assert.ok(out.includes(SCHEMA_OUT), `${flags.join(" ")}: ${out}`);
    assert.ok(out.includes(APP_OUT), `${flags.join(" ")}: ${out}`);
  }
});

test("Node, in one process: alone, the stand-in reads a schema file as data, as TypeScript routes it with no schema entry; beside dotschema's loader it passes the file on", () => {
  const set = standin.registered();
  set.clear();
  const next = () => ({ format: "next", source: "", shortCircuit: true }) as any;
  const url = (file: string) => pathToFileURL(join(FIXTURE, file)).href;
  const theirs = standin.nodeHooks(standin.standin);
  const ours = toNodeHooks(SCHEMA);
  set.add(standin.standin);
  assert.match((theirs.load!(url("user.schema.jsonc"), {} as any, next) as any).source, /stand-in jsonc/);
  for (const order of [[standin.standin, SCHEMA], [SCHEMA, standin.standin]]) {
    set.clear();
    for (const loader of order) set.add(loader);
    assert.equal((theirs.load!(url("user.schema.jsonc"), {} as any, next) as any).format, "next");
    assert.match((ours.load!(url("user.schema.jsonc"), {} as any, next) as any).source, /vendor: "dotschema"/);
    assert.match((theirs.load!(url("app.jsonc"), {} as any, next) as any).source, /stand-in jsonc/);
    assert.equal((ours.load!(url("app.jsonc"), {} as any, next) as any).format, "next");
  }
  set.clear();
});

test("Bun: dotschema's preload adds its loader where the stand-in's plugin finds it, and a schema file either plugin is asked for is loaded with dotschema's", async () => {
  const set = standin.registered();
  set.clear();
  const plugins: { setup(build: { onLoad(options: unknown, callback: (args: { path: string }) => { contents: string }): void }): void }[] = [];
  const global = globalThis as { Bun?: unknown };
  // Under Bun, `register` hands its plugin to Bun.plugin; here a stand-in for Bun takes it.
  global.Bun = { plugin: (plugin: (typeof plugins)[number]) => void plugins.push(plugin) };
  try {
    await register(SCHEMA);
  } finally {
    delete global.Bun;
  }
  assert.ok(set.has(SCHEMA));
  for (const order of [[standin.standin, SCHEMA], [SCHEMA, standin.standin]]) {
    set.clear();
    for (const loader of order) set.add(loader);
    const loads: ((args: { path: string }) => { contents: string })[] = [];
    standin.bunPlugin(standin.standin).setup({ onLoad: (_options, callback) => void loads.push(callback) });
    plugins[0]!.setup({ onLoad: (_options, callback) => void loads.push(callback) });
    const [theirs, ours] = loads;
    assert.match(theirs!({ path: join(FIXTURE, "user.schema.jsonc") }).contents, /vendor: "dotschema"/);
    assert.match(theirs!({ path: join(FIXTURE, "app.jsonc") }).contents, /stand-in jsonc/);
    assert.match(ours!({ path: join(FIXTURE, "user.schema.jsonc") }).contents, /vendor: "dotschema"/);
  }
  set.clear();
});

test("esbuild: dotschema's plugin loads a schema file and the stand-in the data file, in either order", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-interop-"));
  for (const [i, plugins] of [[standin.esbuildPlugin(standin.standin), toEsbuildPlugin(SCHEMA)], [toEsbuildPlugin(SCHEMA), standin.esbuildPlugin(standin.standin)]].entries()) {
    const outfile = join(dir, `main${i}.mjs`);
    await build({ entryPoints: [join(FIXTURE, "main.js")], outfile, bundle: true, format: "esm", platform: "node", plugins: plugins as any, logLevel: "silent" });
    const { status, out } = run(process.execPath, [outfile], dir);
    assert.equal(status, 0, out);
    assert.ok(out.includes(SCHEMA_OUT), `order ${i}: ${out}`);
    assert.ok(out.includes(APP_OUT), `order ${i}: ${out}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

// lab/bundlers has the bundlers, installed with `nub install` in lab/bundlers.
const BUNDLERS = join(ROOT, "lab/bundlers");
const bundlersInstalled = existsSync(join(BUNDLERS, "node_modules")) || "lab/bundlers is not installed: run `nub install` in lab/bundlers";
const fromBundlers = async (name: string) => import(pathToFileURL(createRequire(join(BUNDLERS, "package.json")).resolve(name)).href);

/** Runs a bundle written to `file` and checks that each file was loaded by its own loader. */
function ranBoth(file: string, label: string) {
  const { status, out } = run(process.execPath, [file], FIXTURE);
  assert.equal(status, 0, `${label}: ${out}`);
  assert.ok(out.includes(SCHEMA_OUT), `${label}: ${out}`);
  assert.ok(out.includes(APP_OUT), `${label}: ${out}`);
}

for (const name of ["webpack", "Rspack"] as const) {
  test(`${name}: dotschema's loader and the stand-in's each make their own files' modules, whichever rule comes first`, { skip: bundlersInstalled !== true && bundlersInstalled }, async () => {
    const bundler = name === "Rspack" ? (await fromBundlers("@rspack/core")).rspack : (await fromBundlers("webpack")).default;
    const dir = mkdtempSync(join(tmpdir(), "dotschema-interop-"));
    const ours = { test: /\.schema\.(jsonc|json5)$/, use: "dotschema/webpack" };
    const theirs = { test: /\.jsonc$/, use: join(FIXTURE, "standin-webpack.ts") };
    try {
      for (const [i, rules] of [[ours, theirs], [theirs, ours]].entries()) {
        const config = { mode: "none", context: FIXTURE, entry: "./main.js", target: "node", output: { path: join(dir, String(i)), filename: "main.cjs" }, module: { rules } };
        const stats: any = await new Promise((resolve, reject) => bundler(config, (error: Error | null, stats: unknown) => (error ? reject(error) : resolve(stats))));
        assert.equal(stats.hasErrors(), false, stats.toString());
        ranBoth(join(dir, String(i), "main.cjs"), `${name}, rules in order ${i}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const name of ["Vite", "Rollup", "Rolldown"] as const) {
  test(`${name}: dotschema's plugin and the stand-in's each load their own files, whichever plugin comes first`, { skip: bundlersInstalled !== true && bundlersInstalled }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "dotschema-interop-"));
    try {
      for (const [i, plugins] of [[toVitePlugin(SCHEMA), standin.vitePlugin(standin.standin)], [standin.vitePlugin(standin.standin), toVitePlugin(SCHEMA)]].entries()) {
        let code: string;
        if (name === "Vite") {
          const { build } = await fromBundlers("vite");
          const out = await build({ configFile: false, logLevel: "silent", root: FIXTURE, plugins, build: { write: false, ssr: join(FIXTURE, "main.js"), minify: false } });
          code = out.output[0].code;
        } else {
          const bundle = await (await fromBundlers(name.toLowerCase()))[name.toLowerCase()]({ input: join(FIXTURE, "main.js"), plugins, onLog: () => {} });
          code = (await bundle.generate({ format: "es" })).output[0].code;
        }
        writeFileSync(join(dir, `main${i}.mjs`), code);
        ranBoth(join(dir, `main${i}.mjs`), `${name}, plugins in order ${i}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("control: in Rollup without dotschema's plugin, the stand-in reads a schema file as data", { skip: bundlersInstalled !== true && bundlersInstalled }, async () => {
  const { rollup } = await fromBundlers("rollup");
  const bundle = await rollup({ input: join(FIXTURE, "main.js"), plugins: [standin.vitePlugin(standin.standin)], onLog: () => {} });
  const code: string = (await bundle.generate({ format: "es" })).output[0].code;
  assert.equal(code.match(/stand-in jsonc/g)?.length, 2);
  assert.doesNotMatch(code, /vendor: "dotschema"/);
});

type Rules = Record<string, { loaders: string[] }>;
type Built = { turbopack: { rules: Rules }; webpack(config: unknown, context: unknown): { module: { rules: { use: string }[] } }; typescript?: { ignoreBuildErrors?: boolean }; compiler?: { runAfterProductionCompile?: (metadata: unknown) => Promise<void> } };

test("Next.js: withDotschema and a Motherload-shaped wrapper compose in either order, dotschema's Turbopack rule first and one type check", async () => {
  const STANDIN = "/stand-in/turbopack";
  const inner = (config: object) => withDotschema(config);
  for (const [order, wrap] of [["dotschema inside", (c: object, checked: string[]) => standin.withStandin(inner(c), STANDIN, checked)], ["dotschema outside", (c: object, checked: string[]) => withDotschema(standin.withStandin(c, STANDIN, checked))]] as const) {
    const checked: string[] = [];
    const config = wrap({ turbopack: { rules: { "*.svg": { loaders: ["@svgr/webpack"], as: "*.js" } } } }, checked) as unknown as Built;
    // Turbopack runs only the first rule that matches a file: dotschema's has to precede the .jsonc rule.
    const keys = Object.keys(config.turbopack.rules);
    assert.ok(keys.indexOf("*.schema.{jsonc,json5}") < keys.indexOf("*.{jsonc,json5}"), `${order}: ${keys.join(", ")}`);
    assert.ok(keys.includes("*.svg"), order);
    // webpack runs every rule that matches, and each loader passes on what the other outranks it on.
    const uses = config.webpack({ module: { rules: [] } }, { isServer: true }).module.rules.map((rule) => rule.use);
    assert.deepEqual([...uses].sort(), ["/stand-in/turbopack", "dotschema/webpack"], order);
    // Next's own check is off, and the inner wrapper's check is the one that runs.
    assert.equal(config.typescript?.ignoreBuildErrors, true, order);
    assert.equal(typeof config.compiler?.runAfterProductionCompile, "function", order);
  }
  // With the stand-in inside, its check is the one: withDotschema finds Next's off and adds none.
  const checked: string[] = [];
  const built = withDotschema(standin.withStandin({}, STANDIN, checked)) as unknown as Built;
  await built.compiler!.runAfterProductionCompile!({ projectDir: "/nowhere", distDir: "/nowhere/.next" });
  assert.deepEqual(checked, ["stand-in"]);
});
