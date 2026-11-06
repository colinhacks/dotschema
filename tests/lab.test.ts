// The end-to-end checks: the type check through TypeScript's content mapper, the preload, and the
// esbuild plugin, on lab/basic; diagnostics placed in broken schema files; a library's
// declarations; and lab/basic's schemas in every other host: nub and Bun (lab/nub, lab/bun), the
// webpack loader under webpack and Rspack and the Vite plugin under Vite (for Node and the
// browser), Rollup and Rolldown (lab/bundlers), Next.js with Turbopack and with webpack
// (lab/nextjs), Jest and Vitest (lab/jest), and a Cloudflare Worker built and served by Vite in
// workerd (lab/cloudflare). Each of those labs has its own dependencies, installed with
// `nub install` in it, and its tests are skipped where it is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { env, ROOT, run, TSC } from "./helpers.ts";

test("lab/basic type-checks through the content mapper", () => {
  const { status, out } = run(TSC, ["-p", "lab/basic/tsconfig.json", "--noEmit", "--runExternalCode"]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

test("control: without --runExternalCode the imports do not resolve", () => {
  const { status, out } = run(TSC, ["-p", "lab/basic/tsconfig.json", "--noEmit"]);
  assert.equal(status, 2);
  assert.match(out, /TS2307: Cannot find module '\.\/user\.schema\.jsonc'/);
});

test("a broken schema file is a diagnostic at its place in the file", () => {
  const { status, out } = run(TSC, ["-p", "tests/fixtures/errors/tsconfig.json", "--noEmit", "--runExternalCode"]);
  assert.equal(status, 2);
  assert.match(out, /broken\.schema\.jsonc\(1,1\): error dotschema4: The schema is not valid/);
  assert.match(out, /syntax\.schema\.jsonc\(4,50\): error dotschema1: Property Name Expected/);
  // A $ref to a file that is not there is placed at the reference.
  assert.match(out, /broken-ref\.schema\.jsonc\(4,35\): error dotschema4: The \$ref "\.\/missing\.schema\.jsonc" names a file that does not exist\./);
  // A syntax error at the very end of a file, truncated or empty, is placed there:
  // until 2026-10-26 its span ran a byte past the end, and TypeScript refused the module (TS18069).
  assert.match(out, /truncated\.schema\.jsonc\(3,1\): error dotschema1: Close Brace Expected/);
  assert.match(out, /empty\.schema\.jsonc\(1,1\): error dotschema1: Value Expected/);
  assert.doesNotMatch(out, /TS18069/);
});

test("a library that re-exports a schema module emits its declarations: the schema's literal type is inlined, though the module does not export its name", () => {
  const emit = (...flags: string[]) => {
    const out = mkdtempSync(join(tmpdir(), "dotschema-declaration-"));
    const result = run(TSC, ["-p", "tests/fixtures/declaration/tsconfig.json", "--runExternalCode", "--outDir", out, ...flags]);
    assert.equal(result.out, "");
    assert.equal(result.status, 0);
    const declarations = readFileSync(join(out, "tests/fixtures/declaration/main.d.ts"), "utf8");
    rmSync(out, { recursive: true, force: true });
    return declarations;
  };
  const declarations = emit();
  // Here `dotschema` is this repository, so TypeScript names its types by a relative path; installed,
  // it names them `import("dotschema")`, which scripts/check-dist.ts checks.
  // The module's default export writes its root's properties out, so the declarations do too.
  // A plain object is an ObjectSchema, and a picked schema's type is written out too.
  assert.match(declarations, /scores: import\("\.\.\/\.\.\/\.\.\/src\/index\.js"\)\.Schema<\{/);
  assert.match(declarations, /export declare const summary: import\("\.\.\/\.\.\/\.\.\/src\/index\.js"\)\.ObjectSchema<\{\n\s+name: string;\n\}, unknown, "name", \{\n\s+name: string;\n\}>;/);
  assert.match(declarations, /user: import\("\.\.\/\.\.\/\.\.\/src\/index\.js"\)\.ObjectSchema<\{\n\s+name: string;\n\s+role\?: "admin" \| "member";\n\s+\}, \{\n\s+readonly type: "object";/);
  assert.doesNotMatch(declarations, /\bJson\b/);
  assert.match(declarations, /export declare const check: \(value: unknown\) => value is \{\n\s+name: string;\n\s+role\?: "admin" \| "member";\n\};/);
  // The mapper writes an optional key as the project's compiler options read it: under
  // exactOptionalPropertyTypes the `?` no longer admits undefined, which ajv passes as absent, so
  // the input, which `.is()` narrows to, writes `| undefined`, written out as the type is; the type
  // `.validate()` gives drops such a property, and does not.
  const exact = emit("--exactOptionalPropertyTypes");
  assert.match(exact, /export declare const check: \(value: unknown\) => value is \{\n\s+name: string;\n\s+role\?: "admin" \| "member" \| undefined;\n\};/);
  assert.match(exact, /user: import\("\.\.\/\.\.\/\.\.\/src\/index\.js"\)\.ObjectSchema<\{\n\s+name: string;\n\s+role\?: "admin" \| "member";\n\s+\}, \{/);
});

// What lab/basic/main.ts prints, piece by piece.
// user.schema.jsonc's validate: the value, then every issue with its path and keyword, role's with the schema's own message; `~standard.validate` the same function, a missing property's key ending the path; the vendor; an array index a number, through team.schema.jsonc's $ref.
const VALIDATE = '"valid":["Ada",[]],"invalid":"name: must NOT have fewer than 1 characters; email: must match format \\"email\\"; role: must be admin or member","keywords":["minLength","format","enum"],"standard":[true,["role"]],"vendor":"dotschema","memberPath":["members",1,"name"]';
// point.schema.jsonc: an integer, and a label of at most 16 characters.
const POINTS = '"points":[true,false,false]';
// team.schema.jsonc: valid, then failing user.schema.jsonc's and shared/place.schema.jsonc's rules through its $refs.
const TEAM = '"team":[true,false,false]';
// team.schema.jsonc through Standard JSON Schema, in 2020-12 and draft-07: the other two files folded in, its $refs pointers.
const JSON_SCHEMA = '"teamJsonSchema":[["https://json-schema.org/draft/2020-12/schema","#/$defs/user","user,place"],["http://json-schema.org/draft-07/schema#","#/definitions/user","user,place"]]';
// event.schema.jsonc: a click and a visit, then a bad date-time, a bad uri and a click with a visit's field; then main.ts's narrowing functions.
const EVENTS = '"events":[true,true,false,false,false],"described":"3,4","clickX":5,"kept":"at,kind,x,y"';
// user.schema.jsonc's address definition, imported as a validator: valid, then a missing city and an extra key.
const ADDRESS = '"address":[true,["city: required","zip: additionalProperties"]]';
// `.pick()` and `.omit()`: the picked schema's issues in ajv's order, a chain, and its Standard JSON Schema.
const PICKED = `"picked":[["role: must have required property 'role'","email: must NOT have additional properties","name: must NOT have fewer than 1 characters"],true,"name,role"]`;
const EXPECTED = [VALIDATE, POINTS, TEAM, JSON_SCHEMA, EVENTS, ADDRESS, PICKED];

test("lab/basic runs under the preload", () => {
  const { status, out } = run(process.execPath, ["--import", "dotschema/register", "main.ts"], `${ROOT}lab/basic`);
  assert.equal(status, 0, out);
  for (const expected of EXPECTED) assert.ok(out.includes(expected), out);
});

test("lab/basic bundles with the esbuild plugin and runs with nothing installed", () => {
  rmSync(`${ROOT}lab/basic/dist`, { recursive: true, force: true });
  const built = run(process.execPath, ["build-esbuild.ts"], `${ROOT}lab/basic`);
  assert.equal(built.status, 0, built.out);
  // main.ts and the four schemas it imports: shared/place.schema.jsonc, which team.schema.jsonc refers to, is compiled into team's validator.
  assert.match(built.out, /errors=0 inputs=5 node_modules=0/);
  const ran = run(process.execPath, ["dist/main.mjs"], `${ROOT}lab/basic`);
  assert.equal(ran.status, 0, ran.out);
  for (const expected of EXPECTED) assert.ok(ran.out.includes(expected), ran.out);
});

/** A lab's tests are skipped until `nub install` has run in it. */
const installed = (lab: string): string | false => (existsSync(`${ROOT}lab/${lab}/node_modules`) ? false : `lab/${lab} is not installed: run \`nub install\` in lab/${lab}`);
const missing = (tool: string): string | false => (spawnSync(tool, ["--version"]).status === 0 ? false : `${tool} is not installed`);

/** Runs a bundle copied alone into an empty directory, so that nothing it could require is installed above it. */
function runAlone(file: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-alone-"));
  try {
    copyFileSync(file, join(dir, basename(file)));
    return run(process.execPath, [basename(file)], dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// lab/nub: the preload from nub.jsonc, with no flag.
test("lab/nub runs lab/basic and a test under the preload nub.jsonc names", { skip: missing("nub") }, () => {
  const ran = run("nub", ["main.ts"], `${ROOT}lab/nub`);
  assert.equal(ran.status, 0, ran.out);
  for (const expected of EXPECTED) assert.ok(ran.out.includes(expected), ran.out);
  const tested = run("nub", ["--test"], `${ROOT}lab/nub`);
  assert.equal(tested.status, 0, tested.out);
  assert.match(tested.out, /ℹ pass 1\nℹ fail 0/);
});

test("control: under NODE_COMPAT=1 nub runs as plain Node, reads no nub.jsonc, and cannot import a schema", { skip: missing("nub") }, () => {
  const ran = run("nub", ["main.ts"], `${ROOT}lab/nub`, { NODE_COMPAT: "1" });
  assert.notEqual(ran.status, 0);
  assert.match(ran.out, /ERR_UNKNOWN_FILE_EXTENSION.*\.jsonc/);
});

// lab/bun: the preload from bunfig.toml, and Bun.build with the esbuild plugin.
test("lab/bun runs lab/basic and a test under the preload bunfig.toml names, and bundles it with Bun.build", { skip: missing("bun") }, () => {
  const ran = run("bun", ["main.ts"], `${ROOT}lab/bun`);
  assert.equal(ran.status, 0, ran.out);
  for (const expected of EXPECTED) assert.ok(ran.out.includes(expected), ran.out);
  const tested = run("bun", ["test"], `${ROOT}lab/bun`);
  assert.equal(tested.status, 0, tested.out);
  assert.match(tested.out, / 1 pass\n 0 fail/);
  rmSync(`${ROOT}lab/bun/dist`, { recursive: true, force: true });
  const built = run("bun", ["build.ts"], `${ROOT}lab/bun`);
  assert.equal(built.status, 0, built.out);
  assert.match(built.out, /success=true outputs=dist\/main\.js/);
  const alone = runAlone(`${ROOT}lab/bun/dist/main.js`);
  assert.equal(alone.status, 0, alone.out);
  for (const expected of EXPECTED) assert.ok(alone.out.includes(expected), alone.out);
});

// lab/bundlers: lab/basic's schemas through dotschema/webpack and dotschema/vite.
const BUNDLERS = `${ROOT}lab/bundlers`;
for (const [bundler, through, file] of [["webpack", "the webpack loader", "main.cjs"], ["rspack", "the webpack loader", "main.cjs"], ["vite", "the Vite plugin", "main.mjs"], ["vite-browser", "the Vite plugin, for the browser", "main.mjs"], ["rollup", "the Vite plugin", "main.mjs"], ["rolldown", "the Vite plugin", "main.mjs"]] as const) {
  test(`lab/bundlers bundles with ${bundler} through ${through}, and the bundle runs with nothing installed`, { skip: installed("bundlers") }, () => {
    rmSync(`${BUNDLERS}/dist/${bundler}`, { recursive: true, force: true });
    const built = run(process.execPath, ["build.mjs", bundler], BUNDLERS);
    assert.equal(built.status, 0, built.out);
    assert.match(built.out, /errors=0 warnings=0 node_modules=0/);
    const ran = runAlone(`${BUNDLERS}/dist/${bundler}/${file}`);
    assert.equal(ran.status, 0, ran.out);
    for (const expected of EXPECTED) assert.ok(ran.out.includes(expected), ran.out);
  });
}

test("lab/bundlers: the browser bundle has no new Function and no Node.js import, so a Content Security Policy without unsafe-eval allows it", { skip: installed("bundlers") }, () => {
  if (!existsSync(`${BUNDLERS}/dist/vite-browser/main.mjs`)) assert.equal(run(process.execPath, ["build.mjs", "vite-browser"], BUNDLERS).status, 0);
  const code = readFileSync(`${BUNDLERS}/dist/vite-browser/main.mjs`, "utf8");
  assert.doesNotMatch(code, /new Function|\beval\(/);
  assert.doesNotMatch(code, /from\s*["']node:|\bimport\(["']node:/);
  // The one `require(` left is in a string: ajv's `.code` for its own code generation.
  assert.ok([...code.matchAll(/require\(/g)].every((m) => code[m.index - 1] === "`" || code[m.index - 1] === "'" || code[m.index - 1] === '"'), "a require( outside a string");
});

test("lab/bundlers: Vite's, Rollup's and Rolldown's config types each take the plugin", { skip: installed("bundlers") }, () => {
  const { status, out } = run(TSC, ["-p", "lab/bundlers/tsconfig.json"]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

// lab/nextjs: a server component and a client component that import lab/basic's schemas.
const NEXT_LAB = `${ROOT}lab/nextjs`;
const NEXT = `${NEXT_LAB}/node_modules/.bin/next`;
/** What the server component and the client component printed, as the build prerendered them. */
const SERVER = { vendor: "dotschema", valid: true, issues: ["name: minLength", "email: format", "role: enum"], points: [true, false], team: [true, false], events: [true, false] };
const CLIENT = ["name: must NOT have fewer than 1 characters", 'email: must match format "email"'];
function prerendered(): { server: unknown; client: unknown } {
  const html = readFileSync(`${NEXT_LAB}/.next/server/app/index.html`, "utf8").replaceAll("&quot;", '"');
  return { server: JSON.parse(html.match(/id="server">([^<]*)/)![1]!), client: JSON.parse(html.match(/id="client">([^<]*)/)![1]!) };
}

test("lab/nextjs type-checks through the content mapper after next typegen", { skip: installed("nextjs") }, () => {
  const typegen = run(NEXT, ["typegen"], NEXT_LAB);
  assert.equal(typegen.status, 0, typegen.out);
  const { status, out } = run(TSC, ["-p", "lab/nextjs/tsconfig.json", "--noEmit", "--runExternalCode"]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

for (const args of [[], ["--webpack"]]) {
  test(`lab/nextjs builds with ${args.length ? "webpack" : "Turbopack"}, its type check run by next build, the validators in the server's and the browser's modules`, { skip: installed("nextjs") }, () => {
    rmSync(`${NEXT_LAB}/.next`, { recursive: true, force: true });
    const built = run(NEXT, ["build", ...args], NEXT_LAB);
    assert.equal(built.status, 0, built.out);
    assert.match(built.out, /Completed runAfterProductionCompile/);
    assert.deepEqual(prerendered(), { server: SERVER, client: CLIENT });
    // The client component's validator is in a browser chunk.
    const chunks = `${NEXT_LAB}/.next/static/chunks`;
    const files = readdirSync(chunks, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".js"));
    assert.ok(files.some((f) => readFileSync(join(chunks, f), "utf8").includes("must NOT have fewer than 1 characters")), "no browser chunk holds the validator");
  });
}

// lab/jest: Jest's CommonJS and ES module runs through dotschema/jest, and Vitest through
// dotschema/vite. Vitest colours its summary on CI's runners, and Jest under FORCE_COLOR; run()
// strips the colour codes.
const JEST_LAB = `${ROOT}lab/jest`;
const jest = (config: string, extra: Record<string, string> = {}) => run(`${JEST_LAB}/node_modules/.bin/jest`, ["-c", config, "--ci", "--no-cache"], JEST_LAB, extra);

test("lab/jest: a CommonJS test requires lab/basic's schemas through the Jest transformer", { skip: installed("jest") }, () => {
  const { status, out } = jest("jest.cjs.config.cjs");
  assert.equal(status, 0, out);
  assert.match(out, /Tests:\s+1 passed, 1 total/);
});

test("lab/jest: CommonJS and ES module tests load lab/basic's schemas under --experimental-vm-modules", { skip: installed("jest") }, () => {
  const { status, out } = jest("jest.esm.config.cjs", { NODE_OPTIONS: "--experimental-vm-modules" });
  assert.equal(status, 0, out);
  assert.match(out, /Tests:\s+2 passed, 2 total/);
});

test("lab/jest: with dotschema's pattern before a .jsonc transformer's, each file goes to its own", { skip: installed("jest") }, () => {
  const { status, out } = jest("jest.interop.config.cjs");
  assert.equal(status, 0, out);
  assert.match(out, /Tests:\s+1 passed, 1 total/);
});

test("lab/jest: Vitest imports lab/basic's schemas through the Vite plugin", { skip: installed("jest") }, () => {
  const { status, out } = run(`${JEST_LAB}/node_modules/.bin/vitest`, ["run"], JEST_LAB);
  assert.equal(status, 0, out);
  assert.match(out, /Tests\s+1 passed \(1\)/);
});

// Vitest keeps each module on disk across runs, keyed by its file's text, so a schema whose $ref'd
// file changed came back from the cache as it was, in one run after another and in watch mode, until
// 2026-10-26. A project outside the repository, where `team.schema.jsonc` refers to
// `user.schema.jsonc`, whose `minLength` changes between runs: the test writes `team`'s verdict.
function vitestProject(): { dir: string; verdict: () => string; minLength: (n: number) => void } {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-vitest-"));
  mkdirSync(join(dir, "node_modules"));
  symlinkSync(ROOT, join(dir, "node_modules", "dotschema"));
  writeFileSync(join(dir, "package.json"), '{ "private": true, "type": "module" }\n');
  writeFileSync(join(dir, "vitest.config.mjs"), 'import dotschema from "dotschema/vite";\nexport default { plugins: [dotschema()], test: { include: ["ref.test.mjs"], globals: true } };\n');
  writeFileSync(join(dir, "team.schema.jsonc"), '{ "type": "object", "properties": { "lead": { "$ref": "./user.schema.jsonc" } } }\n');
  writeFileSync(join(dir, "ref.test.mjs"), 'import { writeFileSync } from "node:fs";\nimport team from "./team.schema.jsonc";\ntest("ref", () => writeFileSync(new URL("verdict.txt", import.meta.url), String(team.is({ lead: { name: "Al" } }))));\n');
  const minLength = (n: number) => writeFileSync(join(dir, "user.schema.jsonc"), `{ "type": "object", "properties": { "name": { "type": "string", "minLength": ${n} } }, "required": ["name"] }\n`);
  minLength(3);
  return { dir, minLength, verdict: () => (existsSync(join(dir, "verdict.txt")) ? readFileSync(join(dir, "verdict.txt"), "utf8") : "") };
}

test("lab/jest: Vitest makes a schema again when a file it refers to changes between runs", { skip: installed("jest") }, () => {
  const project = vitestProject();
  try {
    const vitest = () => run(`${JEST_LAB}/node_modules/.bin/vitest`, ["run"], project.dir);
    const verdicts = [];
    for (const n of [3, 1, 1, 3]) {
      project.minLength(n);
      const { status, out } = vitest();
      assert.equal(status, 0, out);
      verdicts.push(project.verdict());
    }
    assert.deepEqual(verdicts, ["false", "true", "true", "false"]);
  } finally {
    rmSync(project.dir, { recursive: true, force: true });
  }
});

test("lab/jest: Vitest's watch mode makes a schema again when a file it refers to changes", { skip: installed("jest") }, async () => {
  const project = vitestProject();
  const child = spawn(`${JEST_LAB}/node_modules/.bin/vitest`, ["watch"], { cwd: project.dir, env: env() });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  // Waits for the verdict a run writes, up to 30 seconds.
  const verdict = async (expected: string) => {
    for (const end = Date.now() + 30_000; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 100))) if (project.verdict() === expected) return;
    assert.fail(`no verdict ${expected}, the last ${project.verdict() || "none"}:\n${out}`);
  };
  try {
    await verdict("false");
    // Vitest watches files once it has run, so the change comes after the first run's summary.
    for (const end = Date.now() + 30_000; !/Waiting for file changes/.test(out) && Date.now() < end; ) await new Promise((resolve) => setTimeout(resolve, 100));
    project.minLength(1);
    await verdict("true");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await once(child, "exit");
    }
    rmSync(project.dir, { recursive: true, force: true });
  }
});

// lab/cloudflare: a Worker built with Vite and Cloudflare's plugin, run in workerd under the dev
// server and as the build `wrangler deploy` would upload, with no Cloudflare account.
const CLOUDFLARE = `${ROOT}lab/cloudflare`;
const WORKER = {
  get: { vendor: "dotschema", valid: true, issues: ["name: minLength", "email: format", "role: enum"], team: [true, false], events: [true, false], formats: [true, ["token", "data", "network", "card", "at", "id", "mood", "digest", "host", "mail", "link"]] },
  post: [400, { issues: [{ message: "must NOT have fewer than 1 characters", path: ["name"], keyword: "minLength" }, { message: "must be admin or member", path: ["role"], keyword: "enum" }] }],
};

test("lab/cloudflare type-checks through the content mapper", { skip: installed("cloudflare") }, () => {
  const { status, out } = run(TSC, ["-p", "lab/cloudflare/tsconfig.json", "--noEmit", "--runExternalCode"]);
  assert.equal(out, "");
  assert.equal(status, 0);
});

for (const mode of ["dev", "preview"] as const) {
  test(`lab/cloudflare: the Worker validates in workerd under vite ${mode}`, { skip: installed("cloudflare") }, () => {
    if (mode === "preview") {
      rmSync(`${CLOUDFLARE}/dist`, { recursive: true, force: true });
      const built = run(`${CLOUDFLARE}/node_modules/.bin/vite`, ["build"], CLOUDFLARE);
      assert.equal(built.status, 0, built.out);
      assert.equal(built.out, "");
      // workerd refuses new Function; the bundle's validators need none.
      assert.doesNotMatch(readFileSync(`${CLOUDFLARE}/dist/dotschema_lab/index.js`, "utf8"), /new Function|\beval\(/);
    }
    const served = run(process.execPath, ["serve.mjs", mode], CLOUDFLARE);
    assert.equal(served.status, 0, served.out);
    assert.deepEqual(JSON.parse(served.out.trim().split("\n").at(-1)!), WORKER);
  });
}
