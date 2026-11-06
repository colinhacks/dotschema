// The host adapters (src/core/universal.ts) on dotschema's loader: a query or hash is left to the
// next hook or plugin, a bundler watches the files a schema refers to, the Jest transformer makes
// ESM or CommonJS and keys its cache on the module, and positions are UTF-8 bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { standalone } from "../src/core/standalone.ts";
import { toEsbuildPlugin, toJestTransformer, toNodeHooks, toVitePlugin, toWebpackLoader, utf8Range, type LoaderPlugin } from "../src/core/universal.ts";
import { loader } from "../src/loader.ts";
import { evaluate } from "./helpers.ts";

const plugin = standalone(loader);
const dir = mkdtempSync(join(tmpdir(), "dotschema-adapters-"));
writeFileSync(join(dir, "tag.schema.jsonc"), '{ "type": "string" }');

test("the Node hook loads a schema file and leaves a query or hash to the next hook", () => {
  const hooks = toNodeHooks(plugin, [plugin]);
  const next = () => ({ format: "next", source: "", shortCircuit: true }) as any;
  const url = pathToFileURL(join(dir, "tag.schema.jsonc")).href;
  const loaded = hooks.load!(url, {} as any, next) as any;
  assert.equal(loaded.format, "module");
  assert.match(loaded.source, /vendor: "dotschema"/);
  for (const suffix of ["?raw", "?url", "#raw"]) assert.equal((hooks.load!(url + suffix, {} as any, next) as any).format, "next", suffix);
  assert.equal((hooks.load!(pathToFileURL(join(dir, "app.jsonc")).href, {} as any, next) as any).format, "next");
});

test("esbuild leaves a query to other plugins", async () => {
  writeFileSync(join(dir, "raw.ts"), 'import text from "./tag.schema.jsonc?raw"; console.log(text);');
  await assert.rejects(build({ entryPoints: [join(dir, "raw.ts")], bundle: true, write: false, plugins: [toEsbuildPlugin(plugin)], logLevel: "silent" }), /No loader is configured for "\.jsonc" files/);
});

test("the loader's filter takes the schema suffix and nothing else", () => {
  for (const name of ["a.schema.jsonc", "shared/b.schema.jsonc"]) assert.ok(plugin.filter.test(name), name);
  for (const name of ["a.jsonc", "a.json5", "a.schema.json5", "a.schema.json", "a.schema.jsonc.bak"]) assert.ok(!plugin.filter.test(name), name);
});

test("esbuild watches the files a schema refers to, and still does when one is missing", () => {
  writeFileSync(join(dir, "team.schema.jsonc"), '{ "properties": { "tag": { "$ref": "./tag.schema.jsonc" } } }');
  writeFileSync(join(dir, "lost.schema.jsonc"), '{ "properties": { "tag": { "$ref": "./gone.schema.jsonc" } } }');
  let onLoad: ((args: { path: string; suffix?: string }) => any) | undefined;
  toEsbuildPlugin(plugin).setup({ onLoad: (_options, callback) => void (onLoad = callback) });
  const team = onLoad!({ path: join(dir, "team.schema.jsonc") });
  assert.equal(team.loader, "js");
  assert.deepEqual(team.watchFiles, [join(dir, "tag.schema.jsonc")]);
  const lost = onLoad!({ path: join(dir, "lost.schema.jsonc") });
  assert.match(lost.errors[0].text, /^dotschema: .*The \$ref "\.\/gone\.schema\.jsonc" names a file that does not exist\./);
  assert.deepEqual(lost.watchFiles, [join(dir, "gone.schema.jsonc")]);
  assert.deepEqual(onLoad!({ path: join(dir, "tag.schema.jsonc") }).watchFiles, []);
});

/** A webpack loader's context for one file: its path, its query, the loaders on it, and the files it was told to watch. */
const loaderContext = (path: string, { resourceQuery = "", loaders = [] as { normal?: unknown }[] } = {}) => ({ resourcePath: path, resourceQuery, loaders, watched: [] as string[], addDependency(file: string) { this.watched.push(file); } });
const webpackLoader = toWebpackLoader(plugin);
const TAG = '{ "type": "string" }';

test("the webpack loader makes a schema's module and passes a file with a query through as it came", async () => {
  const path = join(dir, "tag.schema.jsonc");
  const code = webpackLoader.call(loaderContext(path), TAG);
  assert.equal((await evaluate(code)).default.is("x"), true);
  for (const resourceQuery of ["?raw", "?url"]) assert.equal(webpackLoader.call(loaderContext(path, { resourceQuery }), TAG), TAG, resourceQuery);
  assert.throws(() => webpackLoader.call(loaderContext(path), "{ "), /^Error: dotschema: .*tag\.schema\.jsonc: /);
});

test("the webpack loader watches the files a schema refers to, and still does when one is missing", () => {
  const team = loaderContext(join(dir, "team.schema.jsonc"));
  webpackLoader.call(team, '{ "properties": { "tag": { "$ref": "./tag.schema.jsonc" } } }');
  assert.deepEqual(team.watched, [join(dir, "tag.schema.jsonc")]);
  const lost = loaderContext(join(dir, "lost.schema.jsonc"));
  assert.throws(() => webpackLoader.call(lost, '{ "properties": { "tag": { "$ref": "./gone.schema.jsonc" } } }'), /The \$ref "\.\/gone\.schema\.jsonc" names a file that does not exist\./);
  assert.deepEqual(lost.watched, [join(dir, "gone.schema.jsonc")]);
});

/** A `.jsonc` loader of the protocol, as Motherload's is, whose module the webpack loader may be handed under Rspack. */
const JSONC: LoaderPlugin = { name: "jsonc", extensions: [".jsonc"], filter: /\.jsonc$/, load: (source) => ({ code: `export default ${source};`, problems: [] }), types: () => ({ types: "", problems: [] }) };
const marked = (loader: LoaderPlugin) => ({ normal: Object.assign(() => "", { [Symbol.for("motherload.plugin")]: loader }) });

test("the webpack loader reads a schema file from disk where a loader it outranks is on the file, which under Rspack may have made its own module of it first", async () => {
  const path = join(dir, "tag.schema.jsonc");
  const handed = "export default {};";
  // With the .jsonc loader beside it, what it is handed may be that loader's module: it reads the file.
  const code = webpackLoader.call(loaderContext(path, { loaders: [marked(standalone(loader)), marked(JSONC)] }), handed);
  assert.equal((await evaluate(code)).default.is("x"), true);
  // Alone, or beside a loader it does not outrank, it reads what it is handed, as a loader does.
  assert.throws(() => webpackLoader.call(loaderContext(path, { loaders: [marked(standalone(loader))] }), handed), /tag\.schema\.jsonc: /);
  // And the .jsonc loader, outranked, passes a schema file through.
  assert.equal(toWebpackLoader(JSONC).call(loaderContext(path, { loaders: [marked(JSONC), marked(standalone(loader))] }), TAG), TAG);
});

/** The Vite plugin's `load` with a context that keeps what it is told to watch and throws what it is told is an error. */
function viteLoad(id: string) {
  const context = { watched: [] as string[], addWatchFile(file: string) { this.watched.push(file); }, error(message: string): never { throw new Error(message); } };
  return { result: toVitePlugin(plugin).load.call(context, id), watched: context.watched };
}

test("the Vite plugin loads a schema as JavaScript, watches the files it refers to, and leaves an id with a query to other plugins", async () => {
  const { result } = viteLoad(join(dir, "tag.schema.jsonc"));
  assert.equal((await evaluate(result!.code)).default.is("x"), true);
  assert.equal(result!.moduleType, "js");
  for (const query of ["?raw", "?url", "#x"]) assert.equal(viteLoad(join(dir, "tag.schema.jsonc") + query).result, null, query);
  assert.equal(viteLoad(join(dir, "app.jsonc")).result, null);
  assert.deepEqual(viteLoad(join(dir, "team.schema.jsonc")).watched, [join(dir, "tag.schema.jsonc")]);
  assert.throws(() => viteLoad(join(dir, "lost.schema.jsonc")), /^Error: dotschema: .*The \$ref "\.\/gone\.schema\.jsonc" names a file that does not exist\./);
});

const jest = toJestTransformer(plugin);
/** CommonJS code run as Node runs a module: its exports, given `require` and `__filename`. */
const commonJsModule = (code: string, filename: string) => {
  const module = { exports: {} as Record<string, any> };
  new Function("exports", "require", "module", "__filename", code)(module.exports, createRequire(filename), module, filename);
  return module.exports;
};

test("the Jest transformer makes ESM when Jest loads the file as ESM, and CommonJS otherwise", async () => {
  const path = join(dir, "team.schema.jsonc");
  const source = '{ "properties": { "tag": { "$ref": "./tag.schema.jsonc" } } }';
  const esm = jest.process(source, path, { supportsStaticESM: true }).code;
  assert.equal((await evaluate(esm)).default.is({ tag: "x" }), true);
  const cjs = jest.process(source, path, { supportsStaticESM: false }).code;
  assert.doesNotMatch(cjs, /^(import|export)\b/m);
  const exports = commonJsModule(cjs, path);
  assert.equal(exports.__esModule, true);
  assert.equal(exports.default.is({ tag: "x" }), true);
  assert.equal(exports.default.is({ tag: 1 }), false);
  assert.deepEqual(exports.default.validate({ tag: 1 }).issues, [{ message: "must be string", path: ["tag"], keyword: "type" }]);
  assert.throws(() => jest.process("{ ", join(dir, "bad.schema.jsonc"), { supportsStaticESM: false }), /bad\.schema\.jsonc: /);
});

test("the Jest transformer's cache key follows the module, a file the schema refers to included, and how Jest loads it", () => {
  const path = join(dir, "keyed.schema.jsonc");
  writeFileSync(join(dir, "keyed-tag.schema.jsonc"), '{ "type": "string" }');
  const source = '{ "properties": { "tag": { "$ref": "./keyed-tag.schema.jsonc" } } }';
  const key = (esm: boolean) => jest.getCacheKey(source, path, { supportsStaticESM: esm, configString: "{}" });
  const before = key(false);
  assert.equal(key(false), before);
  assert.notEqual(key(true), before);
  writeFileSync(join(dir, "keyed-tag.schema.jsonc"), '{ "type": "number" }');
  assert.notEqual(key(false), before);
});

test("ranges convert from UTF-16 code units to UTF-8 bytes", () => {
  assert.deepEqual(utf8Range("é = x", 4, 1), { start: 5, length: 1 });
  assert.deepEqual(utf8Range("a = 😀", 4, 2), { start: 4, length: 4 });
});
