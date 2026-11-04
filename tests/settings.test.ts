// The settings a project gives dotschema in its package.json (src/settings.ts): what each shape of
// the `dotschema` field gives, that they are read from the project being built and not the package
// a schema file sits in, and that each host hands them to `schemaCode` or reports their problems.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { standalone } from "../src/core/standalone.ts";
import { toEsbuildPlugin, toJestTransformer, toNodeHooks, toVitePlugin, toWebpackLoader, type LoadOptions, type LoaderPlugin } from "../src/core/universal.ts";
import { loader } from "../src/loader.ts";
import { schemaCode } from "../src/schema.ts";
import { settingsFrom, settingsOf } from "../src/settings.ts";
import { ROOT, run } from "./helpers.ts";

const manifest = (field: unknown) => JSON.stringify({ name: "app", type: "module", dotschema: field });
const ALLOWED = 'it takes "jit", "interpret" or "aot".';

test("a package.json without the field, the field without the key, and each value", () => {
  assert.deepEqual(settingsFrom(JSON.stringify({ name: "app" })), { options: { validators: "jit" }, problems: [] });
  assert.deepEqual(settingsFrom(manifest({})), { options: { validators: "jit" }, problems: [] });
  for (const validators of ["jit", "interpret", "aot"]) assert.deepEqual(settingsFrom(manifest({ validators })), { options: { validators }, problems: [] }, validators);
});

test("each shape of the field that is not a setting is a problem naming what is wrong", () => {
  const problems = (text: string) => settingsFrom(text).problems;
  assert.deepEqual(problems(manifest({ validators: "fast" })), [`The "validators" setting of the "dotschema" field is "fast"; ${ALLOWED}`]);
  assert.deepEqual(problems(manifest({ validators: null })), [`The "validators" setting of the "dotschema" field is null; ${ALLOWED}`]);
  assert.deepEqual(problems(manifest({ validators: ["jit"] })), [`The "validators" setting of the "dotschema" field is ["jit"]; ${ALLOWED}`]);
  assert.deepEqual(problems(manifest({ validator: "jit" })), ['The "dotschema" field has no "validator" setting; its one setting is "validators".']);
  assert.deepEqual(problems(manifest({ validators: "aot", mode: 1 })), ['The "dotschema" field has no "mode" setting; its one setting is "validators".']);
  for (const field of ["aot", null, ["jit"], true, 3]) {
    assert.deepEqual(problems(manifest(field)), [`The "dotschema" field is ${JSON.stringify(field)}; it takes an object, as in "dotschema": { "validators": "jit" }.`], JSON.stringify(field));
  }
  assert.match(problems("{ name: ")[0]!, /^The file is not JSON \(.+\), so dotschema cannot read its "dotschema" field\.$/);
  // A value with problems is never taken: the default stands.
  assert.deepEqual(settingsFrom(manifest({ validators: "fast" })).options, { validators: "jit" });
});

/**
 * An app whose package.json says `interpret`, importing a schema from a package of its own, whose
 * package.json says `aot`: the app's setting is the one that holds.
 */
function app(field: unknown = { validators: "interpret" }) {
  // Its real path, which a process started in it has for its working directory (`/private/var` for `/var` on macOS).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "dotschema-settings-")));
  mkdirSync(join(dir, "packages/schemas"), { recursive: true });
  writeFileSync(join(dir, "package.json"), manifest(field));
  writeFileSync(join(dir, "packages/schemas/package.json"), JSON.stringify({ name: "schemas", dotschema: { validators: "aot" } }));
  writeFileSync(join(dir, "packages/schemas/tag.schema.jsonc"), '{ "type": "string" }');
  writeFileSync(join(dir, "main.js"), 'import tag from "./packages/schemas/tag.schema.jsonc"; console.log(tag.is("x"));');
  return { dir, schema: join(dir, "packages/schemas/tag.schema.jsonc"), file: join(dir, "package.json") };
}

test("the settings are the root's package.json, or the nearest above a root without one, and are read again when it changes", () => {
  const { dir, file } = app();
  assert.deepEqual(settingsOf(dir), { options: { validators: "interpret" }, file, problems: [] });
  mkdirSync(join(dir, "src"));
  assert.deepEqual(settingsOf(join(dir, "src")), { options: { validators: "interpret" }, file, problems: [] });
  assert.deepEqual(settingsOf(join(dir, "packages/schemas")).options, { validators: "aot" });
  writeFileSync(file, manifest({ validators: "jit" }));
  assert.deepEqual(settingsOf(dir).options, { validators: "jit" });
  writeFileSync(file, manifest({ validators: "fast" }));
  assert.deepEqual(settingsOf(dir).problems, [`The "validators" setting of the "dotschema" field is "fast"; ${ALLOWED}`]);
});

test("a root with no package.json at or above it gives the default, and the root's own is the one watched", () => {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-settings-bare-"));
  let above: string | undefined;
  for (let d = dir; dirname(d) !== d && !above; d = dirname(d)) if (existsSync(join(d, "package.json"))) above = join(d, "package.json");
  if (above) return assert.equal(settingsOf(dir).file, above);
  assert.deepEqual(settingsOf(dir), { options: { validators: "jit" }, file: join(dir, "package.json"), problems: [] });
});

/** dotschema's loader as the hosts take it, with every options object `schemaCode` is handed. */
function spied() {
  const seen: (LoadOptions | undefined)[] = [];
  assert.equal(loader.load, schemaCode);
  const plugin: LoaderPlugin = standalone({ ...loader, load: (source, path, options) => (seen.push(options), schemaCode(source, path, options)) });
  return { plugin, seen };
}

test("esbuild: the build's working directory names the project, whose setting reaches schemaCode", async () => {
  const { dir, schema, file } = app();
  const { plugin, seen } = spied();
  const result = await build({ entryPoints: [join(dir, "main.js")], absWorkingDir: dir, bundle: true, write: false, format: "esm", plugins: [toEsbuildPlugin(plugin)], logLevel: "silent" });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(seen, [{ validators: "interpret" }]);
  // The package.json is watched with the files a schema refers to.
  let onLoad: ((args: { path: string }) => any) | undefined;
  toEsbuildPlugin(plugin).setup({ initialOptions: { absWorkingDir: dir }, onLoad: (_options, callback) => void (onLoad = callback) });
  assert.deepEqual(onLoad!({ path: schema }).watchFiles, [file]);
  // Without `absWorkingDir`, the project is the working directory's: the repository here.
  toEsbuildPlugin(plugin).setup({ onLoad: (_options, callback) => void (onLoad = callback) });
  assert.deepEqual(onLoad!({ path: schema }).watchFiles, [join(ROOT, "package.json")]);
});

test("esbuild: a setting with a problem fails the build, naming the package.json, which stays watched", async () => {
  const { dir, schema, file } = app({ validators: "fast" });
  const message = `dotschema: ${file}: The "validators" setting of the "dotschema" field is "fast"; ${ALLOWED}`;
  await assert.rejects(build({ entryPoints: [join(dir, "main.js")], absWorkingDir: dir, bundle: true, write: false, plugins: [toEsbuildPlugin(standalone(loader))], logLevel: "silent" }), (error: Error) => error.message.includes(message));
  let onLoad: ((args: { path: string }) => any) | undefined;
  toEsbuildPlugin(standalone(loader)).setup({ initialOptions: { absWorkingDir: dir }, onLoad: (_options, callback) => void (onLoad = callback) });
  const failed = onLoad!({ path: schema });
  assert.deepEqual(failed.errors, [{ text: message }]);
  assert.deepEqual(failed.watchFiles, [file]);
});

/** The Vite plugin's `load` on `id`, after `configResolved` with `root` where one is given, as Rollup and Rolldown call it otherwise. */
function viteLoad(plugin: LoaderPlugin, id: string, root?: string) {
  const vite = toVitePlugin(plugin);
  if (root) vite.configResolved({ plugins: [vite], root });
  const context = { watched: [] as string[], addWatchFile(file: string) { this.watched.push(file); }, error(message: string): never { throw new Error(message); } };
  return { result: vite.load.call(context, id), watched: context.watched };
}

test("Vite: the resolved root names the project, whose setting reaches schemaCode; Rollup's and Rolldown's is the working directory", () => {
  const { dir, schema, file } = app();
  const { plugin, seen } = spied();
  assert.deepEqual(viteLoad(plugin, schema, dir).watched, [file]);
  assert.deepEqual(viteLoad(plugin, schema).watched, [join(ROOT, "package.json")]);
  assert.deepEqual(seen, [{ validators: "interpret" }, { validators: "jit" }]);
  const broken = app({ mode: "aot" });
  assert.throws(() => viteLoad(standalone(loader), broken.schema, broken.dir), { message: `dotschema: ${broken.file}: The "dotschema" field has no "mode" setting; its one setting is "validators".` });
});

test("webpack: the loader context's rootContext names the project, whose setting reaches schemaCode", () => {
  const { dir, schema, file } = app();
  const { plugin, seen } = spied();
  const context = { resourcePath: schema, rootContext: dir, watched: [] as string[], addDependency(path: string) { this.watched.push(path); } };
  toWebpackLoader(plugin).call(context, '{ "type": "string" }');
  assert.deepEqual(seen, [{ validators: "interpret" }]);
  assert.deepEqual(context.watched, [file]);
  const broken = app("aot");
  assert.throws(() => toWebpackLoader(standalone(loader)).call({ ...context, resourcePath: broken.schema, rootContext: broken.dir }, '{ "type": "string" }'), { message: `dotschema: ${broken.file}: The "dotschema" field is "aot"; it takes an object, as in "dotschema": { "validators": "jit" }.` });
});

test("Jest: the config's rootDir names the project, whose setting reaches schemaCode and is part of the cache key", () => {
  const { dir, schema } = app();
  const other = app({ validators: "aot" });
  const { plugin, seen } = spied();
  const jest = toJestTransformer(plugin);
  const options = (rootDir: string) => ({ supportsStaticESM: true, configString: "{}", config: { rootDir } });
  jest.process('{ "type": "string" }', schema, options(dir));
  assert.deepEqual(seen, [{ validators: "interpret" }]);
  // The module is the same in every mode for now, so only the setting tells the keys apart.
  assert.notEqual(jest.getCacheKey('{ "type": "string" }', schema, options(dir)), jest.getCacheKey('{ "type": "string" }', schema, options(other.dir)));
  const broken = app({ validators: 1 });
  assert.throws(() => toJestTransformer(standalone(loader)).process('{ "type": "string" }', broken.schema, options(broken.dir)), { message: `dotschema: ${broken.file}: The "validators" setting of the "dotschema" field is 1; ${ALLOWED}` });
});

test("the preload: the working directory names the project, whose setting reaches schemaCode", () => {
  const { dir, schema } = app();
  const { plugin, seen } = spied();
  const hooks = toNodeHooks(plugin, [plugin]);
  const before = process.cwd();
  process.chdir(dir);
  try {
    hooks.load!(pathToFileURL(schema).href, {} as any, () => assert.fail("passed on"));
  } finally {
    process.chdir(before);
  }
  assert.deepEqual(seen, [{ validators: "interpret" }]);
});

test("the preload: a setting with a problem is the load error, naming the package.json", () => {
  const { dir, file } = app({ validators: "fast" });
  const { status, out } = run(process.execPath, ["--import", join(ROOT, "src/register.ts"), "main.js"], dir);
  assert.notEqual(status, 0);
  assert.ok(out.includes(`dotschema: ${file}: The "validators" setting of the "dotschema" field is "fast"; ${ALLOWED}`), out);
  // The same app with a valid setting runs.
  writeFileSync(file, manifest({ validators: "aot" }));
  assert.deepEqual(run(process.execPath, ["--import", join(ROOT, "src/register.ts"), "main.js"], dir), { status: 0, out: "true\n" });
});
