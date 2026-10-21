// A stand-in for Motherload's `.jsonc` loader, written here against the protocol alone, to test that
// dotschema and Motherload defer to each other in one host (DESIGN.md, "The shared protocol"). It
// mirrors Motherload's adapters (packages/core/src/universal.ts at d21b5ac) and shares nothing with
// dotschema's code but the two global keys: the loaders Node's and Bun's hooks registered in the
// process, under `Symbol.for("motherload.registered")`, and the loader an esbuild plugin object was
// made from, under `Symbol.for("motherload.plugin")`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

type Problem = { message: string; start: number; length: number; code: number };
export type Loader = {
  name: string;
  extensions: readonly string[];
  filter: RegExp;
  load(source: string, path: string): { code: string; problems: Problem[]; watchFiles?: string[] };
  types(source: string, path: string): Promise<{ types: string; problems: Problem[] }> | { types: string; problems: Problem[] };
};

/** What the stand-in's modules start with, so a test can tell who loaded a file. */
export const MARK = "/* stand-in jsonc */";

export const standin: Loader = {
  name: "stand-in-jsonc",
  extensions: [".jsonc"],
  filter: /\.jsonc$/,
  load: (source) => ({ code: `${MARK}\nconst data = ${JSON.stringify(parse(source))};\nexport default data;\n`, problems: [] }),
  types: (source) => ({ types: `declare const data: ${JSON.stringify(parse(source))};\nexport default data;\n`, problems: [] }),
};

export const registered = (): Set<Loader> => ((globalThis as Record<symbol, unknown>)[Symbol.for("motherload.registered")] ??= new Set()) as Set<Loader>;
const PLUGIN = Symbol.for("motherload.plugin");

const claim = (loader: Loader, path: string) => (loader.filter.test(path) ? Math.max(1, ...loader.extensions.filter((ext) => path.endsWith(ext)).map((ext) => ext.length)) : 0);
const outranked = (loader: Loader, path: string, others: Iterable<Loader>) => {
  const mine = claim(loader, path);
  for (const other of others) if (other !== loader && claim(other, path) > mine) return true;
  return false;
};
const ownerOf = (loaders: Iterable<Loader>, path: string) => {
  let owner: Loader | undefined;
  let strength = 0;
  for (const loader of loaders) if (claim(loader, path) > strength) [owner, strength] = [loader, claim(loader, path)];
  return owner;
};
const moduleOf = (loader: Loader, path: string) => {
  const result = loader.load(readFileSync(path, "utf8"), path);
  if (result.problems.length) throw new Error(`${loader.name}: ${path}: ${result.problems.map((p) => p.message).join("; ")}`);
  return result.code;
};

type NodeHooks = Parameters<typeof import("node:module").registerHooks>[0];

export const nodeHooks = (loader: Loader): NodeHooks => ({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:")) return nextLoad(url, context);
    const path = fileURLToPath(url.replace(/[?#].*$/, ""));
    if (!loader.filter.test(path) || outranked(loader, path, registered()) || /[?#]/.test(url)) return nextLoad(url, context);
    return { format: "module", source: moduleOf(loader, path), shortCircuit: true };
  },
});

type BunBuild = { onLoad(options: { filter: RegExp }, callback: (args: { path: string }) => { loader: "js"; contents: string }): void };

export const bunPlugin = (loader: Loader) => ({
  name: loader.name,
  setup(build: BunBuild) {
    build.onLoad({ filter: loader.filter }, (args) => ({ loader: "js", contents: moduleOf(ownerOf([loader, ...registered()], args.path) ?? loader, args.path) }));
  },
});

type EsbuildBuild = {
  initialOptions?: { plugins?: readonly unknown[] };
  onLoad(options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; suffix?: string }) => { contents: string; loader: "js" } | undefined): void;
};

export const esbuildPlugin = (loader: Loader) => ({
  name: loader.name,
  [PLUGIN]: loader,
  setup(build: EsbuildBuild) {
    const siblings = (build.initialOptions?.plugins ?? []).flatMap((p) => ((p as Record<symbol, unknown>)?.[PLUGIN] as Loader | undefined) ?? []);
    build.onLoad({ filter: loader.filter, namespace: "file" }, (args) => (outranked(loader, args.path, siblings) || args.suffix ? undefined : { contents: moduleOf(loader, args.path), loader: "js" }));
  },
});

/** The stand-in's preload, as Motherload's `register` does it under Node. */
export async function register(): Promise<void> {
  registered().add(standin);
  const { registerHooks } = await import("node:module");
  registerHooks(nodeHooks(standin));
}
