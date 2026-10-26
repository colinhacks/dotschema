// Checks the package scripts/build.ts wrote to dist/dotschema as a project installs it: packed into a
// tarball, installed from the tarball into projects outside the repository (so nothing resolves to
// the repository's own link), then type-checked through the installed mapper, run under the installed
// preload, bundled with the installed esbuild plugin, webpack loader and Vite plugin, built by Next.js
// through the installed wrapper, and tested with the installed Jest transformer. Seven projects: a
// copy of lab/basic in nub's isolated layout, where a package reaches only its own dependencies;
// tests/fixtures/declaration, whose declarations must name the installed package; lab/basic again in
// a hoisted layout beside ajv 6; and copies of lab/bundlers (webpack, Rspack, Vite for Node and for
// the browser, Rollup and Rolldown), lab/nextjs (Next.js with Turbopack and with webpack), lab/jest
// (Jest and Vitest) and lab/cloudflare (a Worker built and previewed in workerd), each failing on a
// tool's warning. Needs the npm registry for TypeScript, the bundlers, Next.js, Jest, wrangler and the
// dependencies. Run `nub run build` first.
// The package's dependencies are caret ranges (DESIGN.md, "Packaging"). By default each project gets
// what its range resolves to on the registry, as a new project does; with `--lowest`, each project
// overrides dotschema's dependencies to the floor of each range, the oldest versions a project that
// shares them with another package can end up with.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist", "dotschema");
const work = mkdtempSync(join(tmpdir(), "dotschema-check-dist-"));
const tarballs = join(work, "tarballs");

/** The environment of every command: nub reads no nub.jsonc under NODE_COMPAT, Jest prints only its summary under an agent's variables, and Next.js and wrangler send no telemetry. */
const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1", WRANGLER_SEND_METRICS: "false" };
for (const name of ["NODE_COMPAT", "NODE_OPTIONS", "NODE_TEST_CONTEXT", "CLAUDECODE", "AI_AGENT"]) delete env[name];

/** A command's output, stdout and then stderr, without colour codes, which Vitest writes on CI's runners; throws with both when it exits non-zero. */
function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
  const out = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status} in ${cwd}\n${out}${result.error ?? ""}`);
  return out;
}

run("nub", ["pack", "--pack-destination", tarballs], dist);
const tarball = `file:${join(tarballs, readdirSync(tarballs).find((name) => /^dotschema-.*\.tgz$/.test(name))!)}`;
const devDependencies = { typescript: "7.1.0-dev.20261002.1", "@types/node": "^26.6.1", esbuild: "^0.28.2" };

// The manifest's ranges, each `^x.y.z` (scripts/build.ts); under `--lowest`, the floor of each, which
// every project overrides dotschema's dependencies to, by pnpm's `parent>child` selector in npm's
// `overrides` field, which nub reads, so ajv 6 beside it (below) keeps its version.
const ranges: Record<string, string> = JSON.parse(readFileSync(join(dist, "package.json"), "utf8")).dependencies;
const lowest = process.argv.includes("--lowest");
const floors = Object.fromEntries(Object.entries(ranges).map(([dep, range]) => [dep, range.replace(/^\^/, "")]));
const overrides = lowest ? Object.fromEntries(Object.entries(floors).map(([dep, floor]) => [`dotschema>${dep}`, floor])) : undefined;

/** The version of each of dotschema's dependencies that the installed dotschema resolves, which under `--lowest` must be its range's floor. */
function dependencyVersions(name: string, dir: string): string {
  const require = createRequire(realpathSync(join(dir, "node_modules", "dotschema", "package.json")));
  const found = Object.fromEntries(Object.keys(ranges).map((dep) => [dep, require(`${dep}/package.json`).version as string]));
  if (lowest) for (const [dep, floor] of Object.entries(floors)) if (found[dep] !== floor) throw new Error(`${name}: dotschema resolves ${dep} ${found[dep]}, and --lowest overrides it to ${floor}`);
  return Object.entries(found).map(([dep, version]) => `${dep}@${version}`).join(" ");
}

/** The lab's own dependencies, as its package.json in the repository names them. */
const labDependencies = (lab: string): Record<string, string> => {
  const pkg = JSON.parse(readFileSync(join(root, "lab", lab, "package.json"), "utf8"));
  return { ...pkg.dependencies, ...pkg.devDependencies };
};

/** A copy of `from` with a package.json of `dependencies` and the dev tools, installed with `installArgs`; `prepare` changes the copy before it is installed. */
function project(name: string, from: string, dependencies: Record<string, string>, { installArgs = [], extra = {}, prepare }: { installArgs?: string[]; extra?: Record<string, string>; prepare?: (dir: string) => void } = {}): string {
  const dir = join(work, name);
  cpSync(from, dir, { recursive: true, filter: (path) => !/[\\/](node_modules|dist|\.next|\.wrangler)$/.test(path) && !/[\\/](pnpm-lock\.yaml|tsconfig\.tsbuildinfo|next-env\.d\.ts)$/.test(path) });
  prepare?.(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `check-dist-${name}`, private: true, type: "module", dependencies, devDependencies: { ...devDependencies, ...extra }, ...(overrides ? { overrides } : {}) }, null, 2) + "\n");
  run("nub", ["install", ...installArgs], dir);
  console.log(`${name}: dotschema's dependencies ${dependencyVersions(name, dir)}`);
  return dir;
}

/** Type-checks the project through the installed mapper, then runs each command, which must print `expected` and no tool's warning. */
function check(name: string, dir: string, commands: [string, string[], string][]) {
  // A Next.js app's layout reads the route types `next typegen` writes.
  if (existsSync(join(dir, "next.config.ts"))) run(join(dir, "node_modules/.bin/next"), ["typegen"], dir);
  if (existsSync(join(dir, "tsconfig.json"))) {
    const checked = run(join(dir, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--noEmit", "--runExternalCode"], dir);
    if (checked !== "") throw new Error(`${name}: the type check printed\n${checked}`);
  }
  for (const [command, args, expected] of commands) {
    const out = run(command, args, dir);
    if (!out.includes(expected)) throw new Error(`${name}: ${command} ${args.join(" ")} printed\n${out}`);
    // A file read back with cat or grep is not a tool's output; and Node's own notice that Jest's ES
    // modules (`--experimental-vm-modules`) are experimental is not a tool's warning.
    if (command !== "cat" && command !== "grep" && /\bwarn(ing)?\b/i.test(out.replace(/^.*(ExperimentalWarning|--trace-warnings).*$/gm, ""))) throw new Error(`${name}: ${command} ${args.join(" ")} warned\n${out}`);
  }
}

// What lab/basic prints, as tests/lab.test.ts checks it in the repository.
const VALIDATE = '"valid":"Ada","invalid":"name: must NOT have fewer than 1 characters; email: must match format \\"email\\"; role: must be equal to one of the allowed values","keywords":["minLength","format","enum"],"standard":[true,["role"]],"vendor":"dotschema","memberPath":["members",1,"name"]';
const TEAM = '"team":[true,false,false]';
const EVENTS = '"events":[true,true,false,false,false],"described":"3,4","clickX":5';
const preload = (expected: string): [string, string[], string] => [process.execPath, ["--import", "dotschema/register", "main.ts"], expected];
const bundled = (expected: string): [string, string[], string] => [process.execPath, ["dist/main.mjs"], expected];

{
  const dir = project("basic", join(root, "lab", "basic"), { dotschema: tarball });
  check("basic", dir, [preload(VALIDATE), preload(TEAM), preload(EVENTS), [process.execPath, ["build-esbuild.ts"], "errors=0 inputs=5 node_modules=0"], bundled(VALIDATE), bundled(TEAM), bundled(EVENTS)]);
  console.log("basic: type-checked, ran under the preload and bundled, from the dotschema tarball, in nub's isolated layout");
}

// A library's declarations name the installed package's `Schema` (in the repository, where
// `dotschema` is the repository itself, TypeScript names it by a relative path).
{
  const dir = project("declaration", join(root, "tests", "fixtures", "declaration"), { dotschema: tarball });
  const tsconfig = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"));
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ ...tsconfig, compilerOptions: { ...tsconfig.compilerOptions, rootDir: ".", outDir: "out" } }, null, 2) + "\n");
  const emitted = run(join(dir, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--runExternalCode"], dir);
  if (emitted !== "") throw new Error(`declaration: tsc printed\n${emitted}`);
  const declarations = readFileSync(join(dir, "out", "main.d.ts"), "utf8");
  if (!/user: import\("dotschema"\)\.ObjectSchema<\{\n\s+name: string;\n\s+role\?: "admin" \| "member" \| undefined;\n\s+\}, \{\n\s+readonly type: "object";/.test(declarations)) throw new Error(`declaration: main.d.ts is\n${declarations}`);
  console.log('declaration: a library re-exporting a schema module names import("dotschema").ObjectSchema in its declarations');
}

// lab/basic in a hoisted (npm-style) layout beside ajv 6, as npm lays out a project with eslint
// (which depends on ajv ^6): ajv 6 at the top, ajv 8 under dotschema and again under ajv-formats.
// Until 2026-10-20 ajv-formats wrote the formats' code with its own copy of ajv, which the compiling
// copy wrote out as JSON, and every format it checks with a function (event.schema.jsonc's date-time
// and uri) threw when it ran (DESIGN.md, "The validator").
{
  const dir = project("basic-hoisted-ajv6", join(root, "lab", "basic"), { dotschema: tarball, ajv: "6.12.6" }, { installArgs: ["--node-linker", "hoisted"] });
  const version = (at: string) => run(process.execPath, ["-p", `require(${JSON.stringify(`./${at}/package.json`)}).version`], dir).trim();
  const versions = ["node_modules/ajv", "node_modules/dotschema/node_modules/ajv", "node_modules/ajv-formats/node_modules/ajv"].map(version);
  if (!versions[0]!.startsWith("6.") || !versions[1]!.startsWith("8.") || !versions[2]!.startsWith("8.")) throw new Error(`basic-hoisted-ajv6: expected ajv 6 at the top and ajv 8 twice below it, found ${versions.join(", ")}`);
  check("basic-hoisted-ajv6", dir, [preload(EVENTS), preload(VALIDATE), [process.execPath, ["build-esbuild.ts"], "node_modules=0"], bundled(EVENTS), bundled(VALIDATE)]);
  console.log(`basic-hoisted-ajv6: type-checked, ran under the preload and bundled, hoisted beside ajv ${versions[0]}, with ajv ${versions[1]} and ${versions[2]} below it`);
}

// lab/bundlers reads lab/basic's schemas from the copy beside it, work/basic, above; the bundlers come from the registry.
{
  const dir = project("bundlers", join(root, "lab", "bundlers"), { dotschema: tarball }, { extra: labDependencies("bundlers") });
  const bundle = (bundler: string, file: string): [string, string[], string][] => [
    [process.execPath, ["build.mjs", bundler], "errors=0 warnings=0 node_modules=0"],
    [process.execPath, [`dist/${bundler}/${file}`], VALIDATE],
    [process.execPath, [`dist/${bundler}/${file}`], TEAM],
    [process.execPath, [`dist/${bundler}/${file}`], EVENTS],
  ];
  check("bundlers", dir, [...bundle("webpack", "main.cjs"), ...bundle("rspack", "main.cjs"), ...bundle("vite", "main.mjs"), ...bundle("vite-browser", "main.mjs"), ...bundle("rollup", "main.mjs"), ...bundle("rolldown", "main.mjs")]);
  console.log("bundlers: webpack and Rspack through dotschema/webpack, Vite (for Node and the browser), Rollup and Rolldown through dotschema/vite, from the dotschema tarball, with no warning");
}

// lab/nextjs, built with Turbopack and then with webpack. Turbopack's root is the lab's parent's
// parent in the repository, and here the work directory, which holds the copy of lab/basic.
{
  const dir = project("nextjs", join(root, "lab", "nextjs"), { dotschema: tarball, ...JSON.parse(readFileSync(join(root, "lab", "nextjs", "package.json"), "utf8")).dependencies }, {
    extra: JSON.parse(readFileSync(join(root, "lab", "nextjs", "package.json"), "utf8")).devDependencies,
    prepare(dir) {
      const config = readFileSync(join(dir, "next.config.ts"), "utf8");
      if (!config.includes('join(import.meta.dirname, "../..")')) throw new Error("lab/nextjs/next.config.ts no longer sets Turbopack's root to the repository");
      writeFileSync(join(dir, "next.config.ts"), config.replace('join(import.meta.dirname, "../..")', 'join(import.meta.dirname, "..")'));
    },
  });
  const SERVER = "&quot;vendor&quot;:&quot;dotschema&quot;,&quot;valid&quot;:true,&quot;issues&quot;:[&quot;name: minLength&quot;,&quot;email: format&quot;,&quot;role: enum&quot;]";
  const CLIENT = "id=\"client\">[&quot;name: must NOT have fewer than 1 characters&quot;";
  const next = (args: string[]): [string, string[], string][] => [
    [join(dir, "node_modules/.bin/next"), ["build", ...args], "prerendered as static content"],
    ["cat", [".next/server/app/index.html"], SERVER],
    ["cat", [".next/server/app/index.html"], CLIENT],
    ["grep", ["-rl", "must NOT have fewer than 1 characters", ".next/static/chunks"], ".next/static/chunks/"],
  ];
  check("nextjs", dir, [...next([]), ...next(["--webpack"])]);
  console.log("nextjs: next build with Turbopack and with webpack through withDotschema, the type check run inside it, the validators in the server's and the browser's modules, from the dotschema tarball, with no warning");
}

// lab/jest: Jest's CommonJS and ES module runs through dotschema/jest, and Vitest through dotschema/vite.
{
  const dir = project("jest", join(root, "lab", "jest"), { dotschema: tarball }, { extra: labDependencies("jest") });
  const jest = join(dir, "node_modules/.bin/jest");
  check("jest", dir, [
    [jest, ["-c", "jest.cjs.config.cjs", "--ci"], "Tests:       1 passed, 1 total"],
    ["env", ["NODE_OPTIONS=--experimental-vm-modules", jest, "-c", "jest.esm.config.cjs", "--ci"], "Tests:       2 passed, 2 total"],
    [join(dir, "node_modules/.bin/vitest"), ["run"], "Tests  1 passed (1)"],
  ]);
  console.log("jest: Jest's CommonJS and ES module runs through dotschema/jest, and Vitest through dotschema/vite, from the dotschema tarball");
}

// lab/cloudflare: the Worker built by Vite with Cloudflare's plugin and dotschema/vite, then served in workerd by vite preview.
{
  const dir = project("cloudflare", join(root, "lab", "cloudflare"), { dotschema: tarball }, { extra: labDependencies("cloudflare") });
  check("cloudflare", dir, [
    [join(dir, "node_modules/.bin/vite"), ["build"], ""],
    ["cat", ["dist/dotschema_lab/index.js"], 'vendor: "dotschema"'],
    [process.execPath, ["serve.mjs", "preview"], '"post":[400,{"issues":[{"message":"must NOT have fewer than 1 characters","path":["name"],"keyword":"minLength"}'],
    [process.execPath, ["serve.mjs", "dev"], '"get":{"vendor":"dotschema","valid":true'],
  ]);
  console.log("cloudflare: the Worker built with dotschema/vite and Cloudflare's plugin, validating in workerd under vite preview and vite dev, from the dotschema tarball");
}
rmSync(work, { recursive: true, force: true });
