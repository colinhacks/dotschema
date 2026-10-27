// The project file, `dotschema.jsonc`, beside a package's `package.json` (DESIGN.md, "The project
// file"): the settings of every schema file in that package, which the type check and every host
// find the same way, from the schema file's own path. Today it holds the codecs.
//
//   { "codecs": { "date-time": "Temporal.Instant", "date": "Temporal.PlainDate" } }
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { CODECS, codecNamed, type Codec } from "./codecs.ts";
import { parseJsoncFile } from "./parse.ts";

export const PROJECT_FILE = "dotschema.jsonc";

export interface Project {
  /** The project file of the package, whether or not it exists; undefined outside any package. */
  path: string | undefined;
  /** Whether it exists. */
  found: boolean;
  /** The codec of each format it turns one on for. */
  codecs: ReadonlyMap<string, Codec>;
  /** What is wrong with it, each message naming the file and the line and column. */
  problems: string[];
}

/** The package a file is in: the nearest directory at or above `from` that holds a `package.json`. */
export function packageOf(from: string): string | undefined {
  for (let dir = from; ; ) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** The project file a schema file's settings come from: `dotschema.jsonc` beside its package's `package.json`, which may not exist. */
export const projectFileOf = (schemaPath: string): string | undefined => {
  const dir = packageOf(dirname(resolve(schemaPath)));
  return dir === undefined ? undefined : join(dir, PROJECT_FILE);
};

const NONE: Project = { path: undefined, found: false, codecs: new Map(), problems: [] };

/** The line and column of an offset, 1-based. */
function lineColumn(source: string, offset: number): string {
  const before = source.slice(0, offset).split("\n");
  return `${before.length}:${before.at(-1)!.length + 1}`;
}

/** The project file's text read as settings. `name` is how its messages name the file. */
export function readProject(path: string, source: string, name = path): Project {
  const problems: string[] = [];
  const codecs = new Map<string, Codec>();
  const at = (needle: string) => {
    const offset = source.indexOf(needle);
    return `${name}:${lineColumn(source, offset === -1 ? 0 : offset)}`;
  };
  const parsed = parseJsoncFile(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  if (!parsed.ok) return { path, found: true, codecs, problems: parsed.problems.map((p) => `${name}:${lineColumn(source, p.start)}: ${p.message}`) };
  const settings = parsed.value;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return { path, found: true, codecs, problems: [`${name}: the project file holds an object, such as { "codecs": { "date-time": "Temporal.Instant" } }.`] };
  const known = CODECS.map((codec) => `"${codec.format}": "${codec.name}"`).join(", ");
  for (const [key, value] of Object.entries(settings)) {
    if (key === "$schema") continue;
    if (key !== "codecs") {
      problems.push(`${at(JSON.stringify(key))}: dotschema reads "codecs" from its project file, not "${key}".`);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      problems.push(`${at(JSON.stringify(key))}: "codecs" names a codec for each format, such as { "date-time": "Temporal.Instant" }.`);
      continue;
    }
    for (const [format, codec] of Object.entries(value)) {
      const found = typeof codec === "string" ? codecNamed(format, codec) : undefined;
      if (found) codecs.set(format, found);
      else {
        const formats = CODECS.filter((c) => c.format === format);
        const why = formats.length ? `the ${format} format decodes to ${formats.map((c) => `"${c.name}"`).join(" or ")}` : `dotschema has no codec for the ${format} format`;
        problems.push(`${at(JSON.stringify(format))}: ${why}; the codecs are ${known}.`);
      }
    }
  }
  return { path, found: true, codecs, problems };
}

/** The settings of a schema file: its package's project file, read; none when there is no such file. */
export function projectOf(schemaPath: string): Project {
  const path = projectFileOf(schemaPath);
  if (path === undefined) return NONE;
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...NONE, path };
    return { path, found: true, codecs: new Map(), problems: [`${path}: ${(error as Error).message}`] };
  }
  return readProject(path, source, relative(dirname(schemaPath), path) || path);
}
