// Builds the package into dist/dotschema, published with `npm publish dist/dotschema` (DESIGN.md,
// "Packaging"): the sources compiled to JavaScript with their declarations, the README, the license,
// and a package.json whose exports and content mapper name the compiled files, because Node strips
// no types under node_modules, and whose every dependency is at the exact version installed here.
// The repository's own package.json keeps pointing at the sources, so the tests and the lab run them
// without a build, and it is private, so that it cannot be published by mistake.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const dist = join(root, "dist");
const tsc = join(dist, ".tsc");
const to = join(dist, "dotschema");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const pkg = read(join(root, "package.json"));

rmSync(dist, { recursive: true, force: true });
execFileSync(join(root, "node_modules/.bin/tsc"), ["-p", join(root, "tsconfig.build.json")], { stdio: "inherit" });

/** The installed version of a dependency, which must be the exact version the package declares. */
function installed(dep: string, version: string): string {
  const found: string = read(join(root, "node_modules", dep, "package.json")).version;
  if (found !== version) throw new Error(`${dep} is ${found} here, and package.json pins ${version}`);
  return found;
}

const js = (path: string) => path.replace(/\.ts$/, ".js");
const types = (path: string) => path.replace(/\.ts$/, ".d.ts");

const { private: _private, scripts: _scripts, devDependencies: _dev, devEngines: _engines, ...rest } = pkg;
const built = {
  ...rest,
  exports: Object.fromEntries(Object.entries(pkg.exports as Record<string, string>).map(([key, path]) => [key, { types: types(path), default: js(path) }])),
  typescript: { ...pkg.typescript, contentMapper: { ...pkg.typescript.contentMapper, exec: (pkg.typescript.contentMapper.exec as string[]).map(js) } },
  dependencies: Object.fromEntries(Object.entries(pkg.dependencies as Record<string, string>).map(([dep, version]) => [dep, installed(dep, version)])),
};

mkdirSync(to, { recursive: true });
cpSync(tsc, join(to, "src"), { recursive: true });
writeFileSync(join(to, "package.json"), JSON.stringify(built, null, 2) + "\n");
cpSync(join(root, "README.md"), join(to, "README.md"));
cpSync(join(root, "LICENSE"), join(to, "LICENSE"));

// Nothing TypeScript ships but declarations, and every file the manifest names exists.
const files = readdirSync(to, { recursive: true, encoding: "utf8" });
const sources = files.filter((f) => /\.(c|m)?ts$/.test(f) && !/\.d\.(c|m)?ts$/.test(f));
if (sources.length) throw new Error(`dist/dotschema holds TypeScript sources: ${sources.join(", ")}`);
const named = [...Object.values(built.exports as Record<string, Record<string, string>>).flatMap((e) => Object.values(e)), ...(built.typescript.contentMapper.exec as string[]).slice(1)];
for (const file of named) if (!existsSync(join(to, file))) throw new Error(`dist/dotschema: ${file} is named in package.json and missing`);
// The README goes to npm, where a relative link leads nowhere.
const relative = [...readFileSync(join(root, "README.md"), "utf8").matchAll(/\]\((?!https:\/\/|#)([^)]+)\)/g)].map((m) => m[1]);
if (relative.length) throw new Error(`README.md links to ${relative.join(", ")}: npm shows the README, so every link is absolute`);
console.log(`dist/dotschema: ${built.name}@${built.version}, ${files.length} files, dependencies ${Object.entries(built.dependencies).map(([d, v]) => `${d}@${v}`).join(" ")}`);

rmSync(tsc, { recursive: true, force: true });
