// The settings a project gives dotschema, in the `dotschema` field of its package.json, as in
// `"dotschema": { "validators": "jit" }`: read from the package.json of the project being built, not
// the one nearest a schema file, since how a validator runs belongs to the app (a `packages/schemas`
// imported by a Worker and by a Node server follows each), and from package.json, not tsconfig, so
// that a project without TypeScript has them too (the maintainer's decision: "That way, it'll
// actually work even for non-TypeScript projects"). Each host's adapter names the project's
// directory (src/core/universal.ts); the content mapper reads none, since no type depends on them.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { LoadOptions } from "./core/universal.ts";

/**
 * How a module's validators run: `jit`, code generated at run time, or an interpreter where the
 * runtime refuses `new Function`; `interpret`, never generated code; `aot`, code generated at build
 * time. The first is the default.
 */
export type Validators = NonNullable<LoadOptions["validators"]>;
export const VALIDATORS: readonly Validators[] = ["jit", "interpret", "aot"];

/** What `settingsOf` reads: the options, the package.json they come from (or would, where there is none), which a bundler watches, and what is wrong with the field. */
export type Settings = { options: Required<LoadOptions>; file: string; problems: string[] };

/** "a", "a or b", "a, b or c", each quoted. */
const either = (items: readonly string[]) => {
  const quoted = items.map((item) => JSON.stringify(item));
  return quoted.length < 2 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
};

/** The settings a package.json's text gives, and the problems of its `dotschema` field. */
export function settingsFrom(text: string): { options: Required<LoadOptions>; problems: string[] } {
  const options: Required<LoadOptions> = { validators: "jit" };
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    return { options, problems: [`The file is not JSON (${(error as Error).message}), so dotschema cannot read its "dotschema" field.`] };
  }
  if (typeof manifest !== "object" || manifest === null || !Object.hasOwn(manifest, "dotschema")) return { options, problems: [] };
  const field = (manifest as Record<string, unknown>)["dotschema"];
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    return { options, problems: [`The "dotschema" field is ${JSON.stringify(field)}; it takes an object, as in "dotschema": { "validators": "jit" }.`] };
  }
  const problems: string[] = [];
  for (const [key, value] of Object.entries(field)) {
    if (key !== "validators") problems.push(`The "dotschema" field has no "${key}" setting; its one setting is "validators".`);
    else if (VALIDATORS.includes(value as Validators)) options.validators = value as Validators;
    else problems.push(`The "validators" setting of the "dotschema" field is ${JSON.stringify(value)}; it takes ${either(VALIDATORS)}.`);
  }
  return { options, problems };
}

/** The package.json each root's settings are read from, the root's own or the nearest above it; the walk is made once per root. */
const manifests = new Map<string, string>();
/** Each package.json's reading, with the size and times of the file it was made from, so a change is read again. */
const readings = new Map<string, { stamp: string; settings: Settings }>();

function manifestOf(root: string): string {
  let file = manifests.get(root);
  if (file) return file;
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      file = join(dir, "package.json");
      break;
    }
    // None up to the filesystem's root: the root's own is where one would be, and is watched.
    if (dirname(dir) === dir) {
      file = join(root, "package.json");
      break;
    }
  }
  manifests.set(root, file);
  return file;
}

/**
 * The settings of the project at `root`, the directory the host builds from: its package.json, or
 * the nearest above it. A missing file, field or key gives the default. The reading is kept per
 * file and made again when the file's size or times change, so a bundler in watch mode, which
 * watches the file, rebuilds with the new settings.
 */
export function settingsOf(root: string): Settings {
  const file = manifestOf(resolve(root));
  const stat = statSync(file, { throwIfNoEntry: false });
  const stamp = stat ? `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : "none";
  const kept = readings.get(file);
  if (kept?.stamp === stamp) return kept.settings;
  const settings: Settings = stat ? { ...settingsFrom(readFileSync(file, "utf8")), file } : { options: { validators: "jit" }, file, problems: [] };
  readings.set(file, { stamp, settings });
  return settings;
}
