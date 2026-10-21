// Checks the package scripts/build.ts wrote to dist/dotschema as a project installs it: packed into a
// tarball, installed from the tarball into projects outside the repository (so nothing resolves to
// the repository's own link), then type-checked through the installed mapper, run under the installed
// preload and bundled with the installed esbuild plugin. Three projects: a copy of lab/basic in nub's
// isolated layout, where a package reaches only its own dependencies; tests/fixtures/declaration,
// whose declarations must name the installed package; and lab/basic again in a hoisted layout beside
// ajv 6. Needs the npm registry for TypeScript, esbuild and the dependencies. Run `nub run build` first.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist", "dotschema");
const work = mkdtempSync(join(tmpdir(), "dotschema-check-dist-"));
const tarballs = join(work, "tarballs");
const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

run("nub", ["pack", "--pack-destination", tarballs], dist);
const tarball = `file:${join(tarballs, readdirSync(tarballs).find((name) => /^dotschema-.*\.tgz$/.test(name))!)}`;
const devDependencies = { typescript: "7.1.0-dev.20261002.1", "@types/node": "^26.6.1", esbuild: "^0.28.2" };

/** A copy of `from` with a package.json of `dependencies` and the dev tools, installed with `installArgs`. */
function project(name: string, from: string, dependencies: Record<string, string>, installArgs: string[] = []): string {
  const dir = join(work, name);
  cpSync(from, dir, { recursive: true });
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `check-dist-${name}`, private: true, type: "module", dependencies, devDependencies }, null, 2) + "\n");
  run("nub", ["install", ...installArgs], dir);
  return dir;
}

function check(name: string, dir: string, commands: [string, string[], string][]) {
  const checked = run(join(dir, "node_modules/.bin/tsc"), ["-p", "tsconfig.json", "--noEmit", "--runExternalCode"], dir);
  if (checked !== "") throw new Error(`${name}: the type check printed\n${checked}`);
  for (const [command, args, expected] of commands) {
    const out = run(command, args, dir);
    if (!out.includes(expected)) throw new Error(`${name}: ${command} ${args.join(" ")} printed\n${out}`);
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
  if (!/user: import\("dotschema"\)\.Schema<import\("\.\/user\.schema\.jsonc"\)\.Type, \{\n\s+readonly type: "object";/.test(declarations)) throw new Error(`declaration: main.d.ts is\n${declarations}`);
  console.log('declaration: a library re-exporting a schema module names import("dotschema").Schema in its declarations');
}

// lab/basic in a hoisted (npm-style) layout beside ajv 6, as npm lays out a project with eslint
// (which depends on ajv ^6): ajv 6 at the top, ajv 8 under dotschema and again under ajv-formats.
// Until 2026-10-20 ajv-formats wrote the formats' code with its own copy of ajv, which the compiling
// copy wrote out as JSON, and every format it checks with a function (event.schema.jsonc's date-time
// and uri) threw when it ran (DESIGN.md, "The validator").
{
  const dir = project("basic-hoisted-ajv6", join(root, "lab", "basic"), { dotschema: tarball, ajv: "6.12.6" }, ["--node-linker", "hoisted"]);
  const version = (at: string) => run(process.execPath, ["-p", `require(${JSON.stringify(`./${at}/package.json`)}).version`], dir).trim();
  const versions = ["node_modules/ajv", "node_modules/dotschema/node_modules/ajv", "node_modules/ajv-formats/node_modules/ajv"].map(version);
  if (!versions[0]!.startsWith("6.") || !versions[1]!.startsWith("8.") || !versions[2]!.startsWith("8.")) throw new Error(`basic-hoisted-ajv6: expected ajv 6 at the top and ajv 8 twice below it, found ${versions.join(", ")}`);
  check("basic-hoisted-ajv6", dir, [preload(EVENTS), preload(VALIDATE), [process.execPath, ["build-esbuild.ts"], "node_modules=0"], bundled(EVENTS), bundled(VALIDATE)]);
  console.log(`basic-hoisted-ajv6: type-checked, ran under the preload and bundled, hoisted beside ajv ${versions[0]}, with ajv ${versions[1]} and ${versions[2]} below it`);
}
rmSync(work, { recursive: true, force: true });
