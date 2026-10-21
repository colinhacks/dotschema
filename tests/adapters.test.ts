// The host adapters (src/core/universal.ts) on dotschema's loader: a query or hash is left to the
// next hook or plugin, a bundler watches the files a schema refers to, and positions are UTF-8 bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { standalone } from "../src/core/standalone.ts";
import { toEsbuildPlugin, toNodeHooks, utf8Range } from "../src/core/universal.ts";
import { loader } from "../src/loader.ts";

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

test("the loader's filter takes both schema suffixes and nothing else", () => {
  for (const name of ["a.schema.jsonc", "a.schema.json5"]) assert.ok(plugin.filter.test(name), name);
  for (const name of ["a.jsonc", "a.json5", "a.schema.json", "a.schema.jsonc.bak"]) assert.ok(!plugin.filter.test(name), name);
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

test("ranges convert from UTF-16 code units to UTF-8 bytes", () => {
  assert.deepEqual(utf8Range("é = x", 4, 1), { start: 5, length: 1 });
  assert.deepEqual(utf8Range("a = 😀", 4, 2), { start: 4, length: 4 });
});
