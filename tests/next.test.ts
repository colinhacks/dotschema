// dotschema/next: `next build` type-checks with the project's own tsc and no --runExternalCode, so
// withDotschema turns that check off and runs it with the flag in compiler.runAfterProductionCompile
// (src/next.ts), as Motherload's withMotherload does (its tests/next.test.ts at 099d7e2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXTENSIONS, withDotschema } from "../src/next.ts";
import { loader } from "../src/loader.ts";
import { ROOT } from "./helpers.ts";

type Built = {
  typescript?: { ignoreBuildErrors?: boolean; tsconfigPath?: string };
  compiler?: { runAfterProductionCompile?: (metadata: { projectDir: string; distDir: string }) => Promise<void> };
};
/** The hook withDotschema leaves in the config it returns, which next build runs after the compile. */
const afterCompile = (config: Built) => (withDotschema(config) as Built).compiler!.runAfterProductionCompile!;

test("withDotschema's rules name the loader's extensions", () => {
  assert.deepEqual([...EXTENSIONS].sort(), loader.extensions.map((ext) => ext.slice(1)).sort());
});

test("withDotschema adds the loader for Turbopack, before the project's own rules, and for webpack, and keeps the project's config", () => {
  const seen: string[] = [];
  const config = withDotschema({
    reactStrictMode: true,
    turbopack: { root: "/app", rules: { "*.{jsonc,json5}": { loaders: ["motherload/turbopack"], as: "*.js" } } },
    webpack(webpackConfig: { module: { rules: unknown[] } }, context: { isServer: boolean }) {
      seen.push(context.isServer ? "server" : "client");
      return webpackConfig;
    },
  });
  assert.equal(config.reactStrictMode, true);
  assert.equal(config.turbopack.root, "/app");
  // Turbopack runs the first rule that matches, and a schema file also ends in .jsonc or .json5.
  assert.deepEqual(Object.entries(config.turbopack.rules), [
    ["*.schema.{jsonc,json5}", { loaders: ["dotschema/turbopack"], as: "*.js" }],
    ["*.{jsonc,json5}", { loaders: ["motherload/turbopack"], as: "*.js" }],
  ]);
  for (const isServer of [true, false]) {
    const [rule] = config.webpack({ module: { rules: [] } }, { isServer }).module.rules as { test: RegExp; use: string }[];
    assert.equal(rule!.use, "dotschema/webpack");
    for (const file of ["a.schema.jsonc", "a.schema.json5", "shared/b.schema.jsonc"]) assert.ok(rule!.test.test(file), file);
    for (const file of ["a.jsonc", "a.json5", "a.schema.json", "a.schema.jsonc.bak"]) assert.ok(!rule!.test.test(file), file);
  }
  assert.deepEqual(seen, ["server", "client"]);
});

test("withDotschema turns Next's type check off for its own, and leaves both off where the project turned Next's off", () => {
  const config: Built = withDotschema({ typescript: { tsconfigPath: "tsconfig.app.json" } });
  assert.deepEqual(config.typescript, { tsconfigPath: "tsconfig.app.json", ignoreBuildErrors: true });
  assert.equal(typeof config.compiler?.runAfterProductionCompile, "function");
  const off: Built = withDotschema({ typescript: { ignoreBuildErrors: true } });
  assert.deepEqual(off.typescript, { ignoreBuildErrors: true });
  assert.equal(off.compiler, undefined);
  // Wrapped again, by itself or by Motherload's withMotherload or Reylo's withReylo, which do the
  // same: Next's check is off, so the outer wrapper adds no second check.
  assert.equal(withDotschema(config).compiler!.runAfterProductionCompile, config.compiler!.runAfterProductionCompile);
});

/** A Next.js app's directory with a schema file and this repository's TypeScript 7.1 and dotschema. */
function app(main: string): string {
  const root = mkdtempSync(join(tmpdir(), "dotschema-next-"));
  writeFileSync(join(root, "package.json"), `{ "private": true, "type": "module" }`);
  writeFileSync(join(root, "user.schema.jsonc"), '{ "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }\n');
  writeFileSync(join(root, "main.ts"), main);
  writeFileSync(join(root, "next-env.d.ts"), "");
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "esnext", module: "nodenext", types: [], strict: true, noEmit: true, skipLibCheck: true },
      contentMappers: [{ package: "dotschema", extensions: [".schema.jsonc"] }],
      include: ["*.ts"],
    }),
  );
  mkdirSync(join(root, "node_modules"));
  symlinkSync(ROOT, join(root, "node_modules", "dotschema"));
  symlinkSync(join(ROOT, "node_modules", "typescript"), join(root, "node_modules", "typescript"));
  return root;
}

test("the type check runs the content mapper after the project's own hook, and fails on an error at its line and column", async (t) => {
  const printed = t.mock.method(console, "log", () => {});
  const order: string[] = [];
  const hook = afterCompile({
    compiler: {
      async runAfterProductionCompile() {
        order.push("project");
      },
    },
  });

  // Without --runExternalCode, the schema import would be an error: TS2307.
  const good = app(`import type { Type as User } from "./user.schema.jsonc";\nexport const ada: User = { name: "Ada" };\n`);
  await hook({ projectDir: good, distDir: join(good, ".next") });
  assert.deepEqual(order, ["project"]);
  assert.equal(printed.mock.callCount(), 0);

  const bad = app(`import type { Type as User } from "./user.schema.jsonc";\nexport const ada: User = { name: 1 };\n`);
  await assert.rejects(hook({ projectDir: bad, distDir: join(bad, ".next") }), /Failed to type check/);
  const output = printed.mock.calls.map((call) => String(call.arguments[0])).join("\n");
  assert.match(output, /main\.ts\(2,28\): error TS2322: Type 'number' is not assignable to type 'string'\./);
  for (const dir of [good, bad]) rmSync(dir, { recursive: true, force: true });
});

test("on a first build the type check runs next typegen, which writes next-env.d.ts", async (t) => {
  t.mock.method(console, "log", () => {});
  const root = app(`import type { Type as User } from "./user.schema.jsonc";\nexport const ada: User = { name: "Ada" };\n`);
  const next = join(root, "node_modules", "next");
  mkdirSync(join(next, "dist", "bin"), { recursive: true });
  writeFileSync(join(next, "package.json"), JSON.stringify({ name: "next", bin: { next: "./dist/bin/next" } }));
  writeFileSync(
    join(next, "dist", "bin", "next"),
    `require("node:fs").writeFileSync(require("node:path").join(process.argv[3], "next-env.d.ts"), "// " + process.argv.slice(2).join(" ") + "\\n");\n`,
  );
  rmSync(join(root, "next-env.d.ts"));
  await afterCompile({})({ projectDir: root, distDir: join(root, ".next") });
  assert.equal(readFileSync(join(root, "next-env.d.ts"), "utf8"), `// typegen ${root}\n`);
  rmSync(root, { recursive: true, force: true });
});

test("the type check refuses a TypeScript older than 7.1, which has no content mappers", async () => {
  const root = mkdtempSync(join(tmpdir(), "dotschema-next-"));
  writeFileSync(join(root, "package.json"), "{}");
  mkdirSync(join(root, "node_modules", "typescript"), { recursive: true });
  writeFileSync(join(root, "node_modules", "typescript", "package.json"), `{ "name": "typescript", "version": "6.0.3" }`);
  await assert.rejects(
    afterCompile({})({ projectDir: root, distDir: join(root, ".next") }),
    /needs TypeScript 7\.1 or later, whose content mappers type schema imports; the project has TypeScript 6\.0\.3/,
  );
  assert.equal(existsSync(join(root, "next-env.d.ts")), false);
  rmSync(root, { recursive: true, force: true });
});
