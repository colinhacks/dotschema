// Builds the package into dist/dotschema, which release.yml stages on npm (DESIGN.md, "Packaging" and
// "Releasing"): the sources compiled to JavaScript with their declarations, the README, the license,
// and a package.json whose exports and content mapper name the compiled files, because Node strips
// no types under node_modules, whose every dependency is the caret range package.json declares,
// which the version installed here must satisfy, and which carries the repository, homepage, bugs
// and author fields as written.
// The repository's own package.json keeps pointing at the sources, so the tests and the lab run them
// without a build, and it is private, so that it cannot be published by mistake.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const tsc = join(dist, ".tsc");
const to = join(dist, "dotschema");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const pkg = read(join(root, "package.json"));

rmSync(dist, { recursive: true, force: true });
execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });

/**
 * A dependency's range as package.json declares it, a caret range on its lowest version
 * (DESIGN.md, "Packaging"), which the version installed here must satisfy: the same major, and no
 * lower than the range's floor. A project's package manager then shares one copy with any other
 * package whose range overlaps, and `nub run check-dist -- --lowest` installs each at its floor.
 */
function range(dep: string, declared: string): string {
  const parse = (version: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
  const floor = /^\^(.*)$/.exec(declared)?.[1];
  const low = floor === undefined ? undefined : parse(floor);
  if (!low || low[0] === 0) throw new Error(`package.json: ${dep} is "${declared}", and a dependency is a caret range on a version 1.0.0 or later, "^x.y.z"`);
  const found: string = read(join(root, "node_modules", dep, "package.json")).version;
  const have = parse(found);
  const atLeast = have !== undefined && have[0] === low[0] && (have[1]! > low[1]! || (have[1] === low[1] && have[2]! >= low[2]!));
  if (!atLeast) throw new Error(`${dep} is ${found} here, outside the range package.json declares, ${declared}`);
  return declared;
}

const js = (path: string) => path.replace(/\.ts$/, ".js");
const types = (path: string) => path.replace(/\.ts$/, ".d.ts");

const { private: _private, scripts: _scripts, devDependencies: _dev, devEngines: _engines, overrides: _overrides, ...rest } = pkg;
const built = {
  ...rest,
  exports: Object.fromEntries(Object.entries(pkg.exports as Record<string, string>).map(([key, path]) => [key, { types: types(path), default: js(path) }])),
  typescript: { ...pkg.typescript, contentMapper: { ...pkg.typescript.contentMapper, exec: (pkg.typescript.contentMapper.exec as string[]).map(js) } },
  dependencies: Object.fromEntries(Object.entries(pkg.dependencies as Record<string, string>).map(([dep, declared]) => [dep, range(dep, declared)])),
};

// npm's links to the source, the README and the issues; and release.yml stages with --provenance, which
// npm checks against the manifest's repository, so that has to name the repository that runs it.
const repository = "git+https://github.com/colinhacks/dotschema.git";
if (built.repository?.url !== repository) throw new Error(`package.json: "repository.url" is ${JSON.stringify(built.repository?.url)}, and release.yml runs in ${repository}`);
for (const field of ["homepage", "bugs", "author", "license"]) if (!built[field]) throw new Error(`package.json: no "${field}" to publish`);

mkdirSync(to, { recursive: true });
cpSync(tsc, join(to, "src"), { recursive: true });
// The format files (src/formats/index.ts), plain JavaScript a module inlines, which tsc does not copy.
for (const file of readdirSync(join(root, "src", "formats"))) if (file.endsWith(".cjs")) cpSync(join(root, "src", "formats", file), join(to, "src", "formats", file));
// The same for ajv-errors' keyword (src/keywords/), which schema.ts requires.
cpSync(join(root, "src", "keywords"), join(to, "src", "keywords"), { recursive: true });
writeFileSync(join(to, "package.json"), JSON.stringify(built, null, 2) + "\n");
cpSync(join(root, "README.md"), join(to, "README.md"));
cpSync(join(root, "LICENSE"), join(to, "LICENSE"));

// Nothing TypeScript ships but declarations, and every file the manifest names exists.
const files = readdirSync(to, { recursive: true, encoding: "utf8" });
const sources = files.filter((f) => /\.(c|m)?ts$/.test(f) && !/\.d\.(c|m)?ts$/.test(f));
if (sources.length) throw new Error(`dist/dotschema holds TypeScript sources: ${sources.join(", ")}`);
const named = [...Object.values(built.exports as Record<string, Record<string, string>>).flatMap((e) => Object.values(e)), ...(built.typescript.contentMapper.exec as string[]).slice(1)];
for (const file of named) if (!existsSync(join(to, file))) throw new Error(`dist/dotschema: ${file} is named in package.json and missing`);
// And every format's file loads from it, with each file it requires.
const { formatDefinitions } = await import(pathToFileURL(join(to, "src", "formats", "index.js")).href);
formatDefinitions();
// The README goes to npm, where a relative link leads nowhere.
const relative = [...readFileSync(join(root, "README.md"), "utf8").matchAll(/\]\((?!https:\/\/|#)([^)]+)\)/g)].map((m) => m[1]);
if (relative.length) throw new Error(`README.md links to ${relative.join(", ")}: npm shows the README, so every link is absolute`);
console.log(`dist/dotschema: ${built.name}@${built.version}, ${files.length} files, dependencies ${Object.entries(built.dependencies).map(([d, v]) => `${d}@${v} (${read(join(root, "node_modules", d, "package.json")).version} here)`).join(" ")}`);

rmSync(tsc, { recursive: true, force: true });
