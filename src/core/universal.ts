// The loader contract and its projections onto each host (Node's hooks, Bun, esbuild, a webpack
// loader for webpack, Rspack and Turbopack, a Vite plugin for Vite, Vitest, Rollup and Rolldown, a
// Jest transformer, the content mapper), copied from Motherload's `@motherload/core`
// (packages/core/src/universal.ts at d21b5ac, and its webpack, Vite and Jest adapters and the Bun
// branch of its esbuild plugin at 099d7e2) with its names changed to dotschema's (DESIGN.md, "The
// extraction from Motherload" and "The hosts"). A loader
// names the extensions it reads, so that of the loaders in one host the one that claims the longer
// suffix of a file loads it, as TypeScript routes it (`user.schema.jsonc` to dotschema, not to
// Motherload's `.jsonc` loader), whatever order the host was given them in. The two global keys
// below are Motherload's, kept as they are, so that its loaders and dotschema's see each other.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CODES, type Problem } from "./problems.ts";

export interface LoaderPlugin {
  /** The package's name, `dotschema`; also the esbuild plugin's name. */
  name: string;
  /** The extensions it reads, in the order its messages name them. */
  extensions: readonly string[];
  /** Every path the plugin loads. Bun and esbuild take only a RegExp, and esbuild's is RE2, so no lookaround. */
  filter: RegExp;
  /**
   * JavaScript for runtimes and bundlers. Synchronous, because Node's `registerHooks` is.
   * `watchFiles` are the other files the code was made from (a schema's `$ref`s), which a bundler
   * watches so that a change to one rebuilds the module. `options` are what `loadOptions` read in
   * the project being built, and absent for a loader without it.
   */
  load(source: string, path: string, options?: LoadOptions): { code: string; problems: Problem[]; watchFiles?: string[] };
  /**
   * dotschema's own, and optional, so that a loader without it, as Motherload's are, loads as it
   * did: the options `load` takes in the project whose directory is `root`, the one the host builds
   * from, with the file they are read from, which a bundler watches, and the problems of reading it.
   */
  loadOptions?(root: string): { options: LoadOptions; file: string; problems: string[] };
  /**
   * dotschema's own, and optional, as `loadOptions` is: the run time the plugin's modules import, by
   * the specifiers that begin with `prefix` (`dotschema/runtime`), and `from`, the URL of a file of
   * the package that holds it. A host resolves those specifiers from `from`, not from the file a
   * module was made from, which need not be in a project that installs the package.
   */
  runtime?: { prefix: string; from: string };
  /** TypeScript for the type checker, written for the compiler options of the project that asks, where they are known. */
  types(source: string, path: string, options?: TypeOptions): Promise<{ types: string; problems: Problem[] }> | { types: string; problems: Problem[] };
}

/** dotschema's own: the compiler options the types follow, as the content mapper's `openProject` gives them; absent where no project is known. */
export interface TypeOptions {
  exactOptionalPropertyTypes?: boolean;
}

/**
 * dotschema's own: the options a module is made with, from the `dotschema` field of the package.json
 * of the project being built (src/settings.ts); `validators` is how its validators run, `jit` where
 * it is absent.
 */
export interface LoadOptions {
  validators?: "jit" | "interpret" | "aot";
}

/** Every diagnostic is shown as `dotschema<code>`. */
export const DIAGNOSTIC_SOURCE = "dotschema";

/**
 * How strongly `plugin` claims `path`: the length of the longest of its extensions that ends the
 * path, 1 for a path its filter takes by name alone (`.env.local`), 0 for one it does not take.
 */
export function claim(plugin: LoaderPlugin, path: string): number {
  if (!plugin.filter.test(path)) return 0;
  return Math.max(1, ...plugin.extensions.filter((ext) => path.endsWith(ext)).map((ext) => ext.length));
}

/** The plugin that claims `path` the most strongly, the first of them on a tie. */
export function ownerOf(plugins: Iterable<LoaderPlugin>, path: string): LoaderPlugin | undefined {
  let owner: LoaderPlugin | undefined;
  let strength = 0;
  for (const plugin of plugins) {
    const c = claim(plugin, path);
    if (c > strength) [owner, strength] = [plugin, c];
  }
  return owner;
}

/** Whether another of `others` claims `path` more strongly than `plugin` does. */
const outranked = (plugin: LoaderPlugin, path: string, others: Iterable<LoaderPlugin>) => {
  const mine = claim(plugin, path);
  for (const other of others) if (other !== plugin && claim(other, path) > mine) return true;
  return false;
};

/**
 * The loaders registered in this process, dotschema's and Motherload's alike: Node's and Bun's hooks
 * are process-wide. The key is Motherload's, so that one set holds both (DESIGN.md, "The shared
 * protocol").
 */
const REGISTERED: Set<LoaderPlugin> = ((globalThis as Record<symbol, unknown>)[Symbol.for("motherload.registered")] ??= new Set()) as Set<LoaderPlugin>;

/** What a load error says: the plugin, the file and every problem. */
const loadError = (plugin: LoaderPlugin, path: string, problems: Problem[]) => `${plugin.name}: ${path}: ${problems.map((p) => p.message).join("; ")}`;

/**
 * `plugin.load` in the project whose directory is `root`, with the options the plugin reads there:
 * the module, the files it was made from, the one its options were read from among them, and the
 * load error where the options or the module have problems. Options that have problems fail every
 * module, naming the file they are read from.
 */
function loadIn(plugin: LoaderPlugin, root: string, source: string, path: string): { code: string; watchFiles: string[]; error?: string } {
  const read = plugin.loadOptions?.(root);
  const optionFiles = read ? [read.file] : [];
  if (read?.problems.length) return { code: "", watchFiles: optionFiles, error: `${plugin.name}: ${read.file}: ${read.problems.join(" ")}` };
  const result = plugin.load(source, path, read?.options);
  const watchFiles = [...(result.watchFiles ?? []), ...optionFiles];
  return { code: result.code, watchFiles, ...(result.problems.length > 0 && { error: loadError(plugin, path, result.problems) }) };
}

/** Whether `specifier`, imported by the module of the file at `path`, names the plugin's run time. */
const runtimeOf = (plugin: LoaderPlugin, specifier: string, path: string | undefined): LoaderPlugin["runtime"] => (plugin.runtime && specifier.startsWith(plugin.runtime.prefix) && path !== undefined && plugin.filter.test(path) ? plugin.runtime : undefined);

/** The path a file URL names, its query and hash left out; undefined for another URL. */
const pathOf = (url: string | undefined): string | undefined => (url?.startsWith("file:") ? fileURLToPath(url.replace(/[?#].*$/, "")) : undefined);

/** A module for a runtime, whose project is the working directory's. */
function runtimeModule(plugin: LoaderPlugin, path: string): string {
  const result = loadIn(plugin, process.cwd(), readFileSync(path, "utf8"), path);
  if (result.error) throw new Error(result.error);
  return result.code;
}

// ---- Node and nub: module.registerHooks ------------------------------------------------------

type NodeHooks = Parameters<typeof import("node:module").registerHooks>[0];

/**
 * `registered` is every loader in the process; a file one of them claims more strongly goes on to
 * the next hook, which is that loader's or reaches it. The run time a module imports is resolved as
 * the plugin's own file would resolve it.
 */
export function toNodeHooks(plugin: LoaderPlugin, registered: Iterable<LoaderPlugin> = REGISTERED): NodeHooks {
  return {
    resolve(specifier, context, nextResolve) {
      const runtime = runtimeOf(plugin, specifier, pathOf(context.parentURL));
      return nextResolve(specifier, runtime ? { ...context, parentURL: runtime.from } : context);
    },
    load(url, context, nextLoad) {
      if (!url.startsWith("file:")) return nextLoad(url, context);
      const { search, hash } = new URL(url);
      const path = fileURLToPath(url.replace(/[?#].*$/, ""));
      if (!plugin.filter.test(path) || outranked(plugin, path, registered)) return nextLoad(url, context);
      // A query or hash asks for something this plugin does not make: leave it to the next hook.
      if (search || hash) return nextLoad(url, context);
      return { format: "module", source: runtimeModule(plugin, path), shortCircuit: true };
    },
  };
}

// ---- Bun runtime and Bun.build: Bun.plugin ---------------------------------------------------

type BunBuild = { onLoad(options: { filter: RegExp; namespace?: string }, callback: (args: { path: string }) => { loader: "js"; contents: string }): void };

export function toBunPlugin(plugin: LoaderPlugin, registered: Iterable<LoaderPlugin> = REGISTERED): { name: string; setup(build: BunBuild): void } {
  return {
    name: plugin.name,
    setup(build) {
      // The filter must be exact: Bun's runtime throws when onLoad returns undefined (oven-sh/bun#5303),
      // so a file another registered plugin claims more strongly is loaded with that plugin here.
      build.onLoad({ filter: plugin.filter }, (args) => ({ loader: "js", contents: runtimeModule(ownerOf([plugin, ...registered], args.path) ?? plugin, args.path) }));
    },
  };
}

/** The preload: the plugin's hooks for Node and nub, or its Bun plugin under Bun. */
export async function register(plugin: LoaderPlugin): Promise<void> {
  REGISTERED.add(plugin);
  const bun = (globalThis as { Bun?: { plugin(p: ReturnType<typeof toBunPlugin>): void } }).Bun;
  if (bun) {
    bun.plugin(toBunPlugin(plugin));
  } else {
    const { registerHooks } = await import("node:module");
    registerHooks(toNodeHooks(plugin));
  }
}

// ---- esbuild ----------------------------------------------------------------------------------

/**
 * A module as an esbuild plugin's onLoad returns it, in the one shape esbuild and `Bun.build`, which
 * takes esbuild's plugins, both accept, so that the plugin type-checks in either.
 */
type EsbuildModule = { contents: string; loader: "js"; watchFiles?: string[] };
type EsbuildResolved = { path: string; namespace: string; external: boolean; sideEffects: boolean };
/** `Kind` is the host's kinds of import (esbuild's `ImportKind`), which `resolve` is given back. */
type EsbuildBuild<Kind extends string = string> = {
  initialOptions?: { plugins?: readonly unknown[]; absWorkingDir?: string };
  onLoad(options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; suffix?: string }) => EsbuildModule | undefined): void;
  /** esbuild's; `Bun.build` has `onResolve` but not `resolve`. */
  onResolve?(options: { filter: RegExp }, callback: (args: { path: string; importer: string; kind: Kind; pluginData?: unknown }) => Promise<EsbuildResolved | undefined>): void;
  resolve?(path: string, options: { kind: Kind; resolveDir: string; pluginData?: unknown }): Promise<EsbuildResolved & { errors: readonly unknown[] }>;
};

/** A RegExp that matches a string beginning with `prefix`. */
const startingWith = (prefix: string) => new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);

/** The loader a plugin object (esbuild's, Vite's) or a webpack loader's function was made from, so that the loaders in one build can see each other; Motherload's key, kept as it is. */
const PLUGIN = Symbol.for("motherload.plugin");

export function toEsbuildPlugin(plugin: LoaderPlugin): { name: string; setup<Kind extends string>(build: EsbuildBuild<Kind>): void } {
  return {
    name: plugin.name,
    [PLUGIN]: plugin,
    setup(build) {
      const siblings = (build.initialOptions?.plugins ?? []).flatMap((p) => ((p as Record<symbol, unknown>)?.[PLUGIN] as LoaderPlugin | undefined) ?? []);
      // The project is esbuild's working directory, the working directory unless the build names
      // one; `Bun.build` has no such option (its `root` lays out the output), so there it is always
      // the working directory.
      const root = build.initialOptions?.absWorkingDir ?? process.cwd();
      // The run time a module imports, resolved by esbuild, with the build's conditions, from the
      // plugin's own directory; the resolution this asks for is marked, so as not to come back here.
      const { runtime } = plugin;
      // `Bun.build`'s `build.resolve` throws "not implemented yet" (oven-sh/bun#2771, Bun 1.4.3), and
      // Bun resolves the run time from the schema's file.
      if (runtime && build.onResolve && build.resolve && !process.versions.bun) {
        const resolve = build.resolve.bind(build);
        const resolveDir = dirname(fileURLToPath(runtime.from));
        const asked = Symbol("runtime");
        build.onResolve({ filter: startingWith(runtime.prefix) }, async (args) => {
          if (args.pluginData === asked || !runtimeOf(plugin, args.path, args.importer)) return undefined;
          const found = await resolve(args.path, { kind: args.kind, resolveDir, pluginData: asked });
          return found.errors.length ? undefined : { path: found.path, namespace: found.namespace, external: found.external, sideEffects: found.sideEffects };
        });
      }
      // esbuild resolves `./app.toml?url` to app.toml and keeps `?url` in `suffix`; as in the Node
      // hook, a suffix is left to other plugins, as is a file another loader in the build claims
      // more strongly.
      build.onLoad({ filter: plugin.filter, namespace: "file" }, (args) => {
        if (outranked(plugin, args.path, siblings)) return undefined;
        if (args.suffix) return undefined;
        // The files a module was made from are watched even when it fails, so fixing one rebuilds it.
        const result = loadIn(plugin, root, readFileSync(args.path, "utf8"), args.path);
        const watchFiles = result.watchFiles;
        if (result.error) {
          const text = result.error;
          // `Bun.build` does not take an onLoad's `errors`: it fails with "onLoad plugins must return
          // an object with "contents" as a string or Uint8Array" in place of the problem, so under
          // Bun the problem is thrown, which Bun prints as it is (Motherload's finding, Bun 1.4.3).
          if (process.versions.bun) throw new Error(text);
          return { errors: [{ text }], watchFiles } as unknown as EsbuildModule;
        }
        return { contents: result.code, loader: "js", watchFiles };
      });
    },
  } as { name: string; setup<Kind extends string>(build: EsbuildBuild<Kind>): void };
}

// ---- webpack, Rspack and Turbopack: a webpack loader -----------------------------------------

type WebpackLoaderContext = {
  resourcePath: string;
  resourceQuery?: string;
  /**
   * The project's directory: webpack's and Rspack's `context`, the working directory by default.
   * Under Next.js it is the project's directory with Turbopack and webpack alike, also where
   * `turbopack.root` is a directory above it and `next build` runs from another (next 16.4.2,
   * measured on 2026-11-03), so `withDotschema` passes the loader no directory of its own.
   */
  rootContext?: string;
  /** Every loader that runs on the resource, each module's function as `normal` once it has loaded. */
  loaders?: readonly { normal?: unknown }[];
  addDependency(file: string): void;
  /** webpack's and Rspack's: the callback an asynchronous loader hands its module to. */
  async?(): (error: Error | null, code?: string) => void;
  /** webpack's and Rspack's: the build's resolver, which gives a promise where no callback is passed. */
  getResolve?(options?: object): (context: string, request: string) => Promise<string | false>;
};

/**
 * A loader for a rule that sends the plugin's files to it. Every rule that matches a file runs its
 * loaders on it, one after another, so a file another loader on the resource claims more strongly
 * (Motherload's `.jsonc` loader is outranked on `user.schema.jsonc`), or one with a query, passes
 * through as it came: whichever order the two run in, the other one makes the module. Its siblings
 * are the functions of the resource's other loaders, each marked with its plugin under
 * `Symbol.for("motherload.plugin")`, as an esbuild plugin object is. Turbopack runs only the first
 * rule that matches a file, so there the order of the rules decides (`withDotschema`, next.ts).
 * Where the build hands the loader its resolver, each import of the run time is resolved from the
 * plugin's own directory, with the build's conditions, and the module imports the file found
 * (`runtimeResolved`), as under the other hosts; with `resolve: false`, and where that fails, the
 * build resolves it from the schema's file. Turbopack takes `resolve: false` (src/turbopack.ts): it
 * hands a loader a resolver too, but reads an absolute path in a module as one from its root, and
 * fails to find the file (next 16.4.2, measured on 2026-11-03).
 */
export function toWebpackLoader(plugin: LoaderPlugin, { resolve: resolves = true }: { resolve?: boolean } = {}): (this: WebpackLoaderContext, source: string) => string | undefined {
  function loader(this: WebpackLoaderContext, source: string): string | undefined {
    const siblings = (this.loaders ?? []).flatMap((l) => ((l.normal as Record<symbol, unknown> | undefined)?.[PLUGIN] as LoaderPlugin | undefined) ?? []);
    if (outranked(plugin, this.resourcePath, siblings) || this.resourceQuery) return source;
    // Rspack loads a loader only when its turn comes (2.2.9's runLoaders), where webpack loads every
    // loader on the resource before the first runs, so under Rspack a loader that runs before this
    // one sees no mark of this one's and makes its own module of the file: with dotschema's rule
    // first, Motherload's `.jsonc` loader runs first and hands dotschema a data module of
    // `user.schema.jsonc` (measured on 2026-10-25). A loader this one outranks on the file is so a
    // sign that `source` may be its module, and the file is read as it is on disk; under webpack,
    // where that loader passes the file through, the two are the same text.
    const mine = claim(plugin, this.resourcePath);
    const weaker = siblings.some((other) => other !== plugin && claim(other, this.resourcePath) > 0 && claim(other, this.resourcePath) < mine);
    const result = loadIn(plugin, this.rootContext ?? process.cwd(), weaker ? readFileSync(this.resourcePath, "utf8") : source, this.resourcePath);
    // The files a module was made from are watched even when it fails, so fixing one rebuilds it.
    for (const file of result.watchFiles) this.addDependency(file);
    if (result.error) throw new Error(result.error);
    if (!resolves || !plugin.runtime || !this.getResolve || !this.async) return result.code;
    const resolve = this.getResolve({ dependencyType: "esm" });
    const done = this.async();
    runtimeResolved(plugin, result.code, (dir, specifier) => resolve(dir, specifier)).then(
      (code) => done(null, code),
      (error: Error) => done(error),
    );
    return undefined;
  }
  return Object.assign(loader, { [PLUGIN]: plugin });
}

/** A line of a schema module importing another module, `import { a, b } from "x";` or `import x from "x";`, its specifier written with JSON.stringify. */
const IMPORT_LINE = /^import (\{[^}\n]*\}|[\w$]+) from ("(?:[^"\\\n]|\\.)*");$/gm;

/** A module whose imports of the run time name the file `resolve` finds for each from the plugin's own directory, each it finds none for left as it is. */
async function runtimeResolved(plugin: LoaderPlugin, code: string, resolve: (dir: string, specifier: string) => Promise<string | false>): Promise<string> {
  const { runtime } = plugin;
  if (!runtime) return code;
  const dir = dirname(fileURLToPath(runtime.from));
  const specifiers = new Set([...code.matchAll(IMPORT_LINE)].map((match) => JSON.parse(match[2]!) as string).filter((specifier) => specifier.startsWith(runtime.prefix)));
  const found = new Map(await Promise.all([...specifiers].map(async (specifier) => [specifier, await resolve(dir, specifier).catch(() => false as const)] as const)));
  return code.replace(IMPORT_LINE, (line, bindings: string, quoted: string) => {
    const path = found.get(JSON.parse(quoted) as string);
    return typeof path === "string" ? `import ${bindings} from ${JSON.stringify(path)};` : line;
  });
}

// ---- Vite, Rollup and Rolldown: a Rollup-shaped plugin ---------------------------------------

type RollupContext = { addWatchFile(id: string): void; error(message: string): never };
type RollupResolveContext = { resolve(source: string, importer?: string, options?: object): Promise<{ id: string } | null> };
/** What Vitest hands a plugin's `configureVitest`, as far as it is used here. */
type VitestCacheKey = (module: { id: string }) => string | undefined;
type VitestContext = {
  vitest: { invalidateFile(file: string): void };
  defineCacheKeyGenerator?(generate: VitestCacheKey): void;
  experimental_defineCacheKeyGenerator?(generate: VitestCacheKey): void;
};

/** The loaders among a host's plugins (a plugin or a list of them, nested), each plugin object marked as an esbuild plugin object is. */
const marked = (plugins: unknown): LoaderPlugin[] => [plugins].flat(Infinity).flatMap((p) => ((p as Record<symbol, unknown> | null)?.[PLUGIN] as LoaderPlugin | undefined) ?? []);

/**
 * One `load` hook, which Vite, Rollup and Rolldown each take. `enforce: "pre"` runs it before
 * Vite's own handling of a file type, and `moduleType: "js"` tells Rolldown, which reads a module's
 * type from its extension, that the code is JavaScript; Rollup ignores both. An id with a query
 * (`./user.schema.jsonc?raw`) is left to other plugins, as is a file another loader in the build
 * claims more strongly: Vite hands its resolved plugins to `configResolved`, and Rollup and
 * Rolldown their input options to `options`. Vitest keeps a module across runs on disk, keyed by its
 * file's text, its own version, the config and the lockfile it can find, so `configureVitest` adds
 * the module itself to the key, as the Jest transformer's key is: a change to a file the module was
 * made from, or a new version of the plugin where Vitest sees no lockfile, then makes it again. The
 * module made for a key is kept for the `load` that follows it, which Vitest calls only on a miss.
 * In watch mode Vitest keeps each module's key until that module's own file changes, so a change to
 * another file a module was made from is passed on to Vitest as a change to the module's file.
 * The project is Vite's and Vitest's resolved `root`, and under Rollup and Rolldown, which have no
 * root, the working directory. The run time a module imports is resolved by the host, with its
 * conditions, as the plugin's own file would resolve it, and by Node's resolution under a Rollup
 * that has no plugin to resolve a package.
 */
export function toVitePlugin(plugin: LoaderPlugin): {
  name: string;
  enforce: "pre";
  configResolved(config: { plugins: unknown; root?: string }): void;
  options(options: { plugins?: unknown }): null;
  resolveId(this: RollupResolveContext, source: string, importer: string | undefined, options: object): Promise<{ id: string } | string | null>;
  load(this: RollupContext, id: string): { code: string; map: null; moduleType: "js" } | null;
  configureVitest(context: VitestContext): void;
  watchChange(id: string): void;
} {
  let siblings: LoaderPlugin[] = [];
  let root: string | undefined;
  const make = (source: string, id: string) => loadIn(plugin, root ?? process.cwd(), source, id);
  const handles = (id: string) => !/[?#]/.test(id) && plugin.filter.test(id) && !outranked(plugin, id, siblings);
  // The module last made for a key, by id, with the text of the file it was made from.
  const made = new Map<string, { source: string; result: ReturnType<typeof loadIn> }>();
  // Under Vitest: Vitest itself, and the files each module was last made from, by id.
  let vitest: VitestContext["vitest"] | undefined;
  const reached = new Map<string, readonly string[]>();
  return {
    name: plugin.name,
    enforce: "pre" as const,
    [PLUGIN]: plugin,
    configResolved(config: { plugins: unknown; root?: string }) {
      siblings = marked(config.plugins);
      root = config.root;
    },
    options(options: { plugins?: unknown }) {
      if (options.plugins) siblings = marked(options.plugins);
      return null;
    },
    configureVitest(context: VitestContext) {
      vitest = context.vitest;
      const key: VitestCacheKey = ({ id }) => {
        if (!handles(id)) return undefined;
        const source = readFileSync(id, "utf8");
        const result = make(source, id);
        made.set(id, { source, result });
        reached.set(id, result.watchFiles);
        return createHash("sha256").update(result.code).update(result.error ?? "").digest("hex");
      };
      // Vitest 5.0.5 keeps the experimental name as a deprecated one, with a warning.
      if (context.defineCacheKeyGenerator) context.defineCacheKeyGenerator(key);
      else context.experimental_defineCacheKeyGenerator?.(key);
    },
    async resolveId(this: RollupResolveContext, source: string, importer: string | undefined, options: object) {
      const runtime = importer !== undefined && handles(importer) ? runtimeOf(plugin, source, importer) : undefined;
      if (!runtime) return null;
      const from = fileURLToPath(runtime.from);
      const resolved = await this.resolve(source, from, { ...options, skipSelf: true });
      if (resolved) return resolved;
      try {
        return createRequire(from).resolve(source);
      } catch {
        return null;
      }
    },
    load(this: RollupContext, id: string) {
      if (!handles(id)) return null;
      const source = readFileSync(id, "utf8");
      const kept = made.get(id);
      made.delete(id);
      const result = kept?.source === source ? kept.result : make(source, id);
      // The files a module was made from are watched even when it fails, so fixing one rebuilds it.
      for (const file of result.watchFiles) this.addWatchFile(file);
      if (vitest) reached.set(id, result.watchFiles);
      if (result.error) this.error(result.error);
      return { code: result.code, map: null, moduleType: "js" };
    },
    watchChange(id: string) {
      for (const [module, files] of reached) if (module !== id && files.includes(id)) vitest?.invalidateFile(module);
    },
  } as ReturnType<typeof toVitePlugin>;
}

// ---- Jest: a transformer ---------------------------------------------------------------------

type JestOptions = { supportsStaticESM?: boolean; configString?: string; config?: { rootDir?: string } };

/**
 * A transformer for `transform` in Jest's config. Jest reads and compiles a test's modules itself,
 * never through Node's loader, so the preload's hooks never see a schema file there, and a
 * transformer is where Jest takes one. Its module is ESM when Jest loads the file as one
 * (`--experimental-vm-modules` with the extension in `extensionsToTreatAsEsm`), and CommonJS
 * otherwise. Jest keeps a transformer's output across runs, keyed by the file unless the
 * transformer says otherwise, so the key is the module itself, which a change to a file the schema
 * refers to changes, and the options it was made with, which the module need not show. The project
 * is the config's `rootDir`. Jest runs only the first pattern of `transform` that matches a file, so
 * there the order of the patterns decides. The run time a module imports is required from the
 * plugin's file (`runtimeRequired`).
 */
export function toJestTransformer(plugin: LoaderPlugin) {
  const root = (options: JestOptions) => options.config?.rootDir ?? process.cwd();
  const make = (source: string, path: string, options: JestOptions): string => {
    const result = loadIn(plugin, root(options), source, path);
    if (result.error) throw new Error(result.error);
    const code = runtimeRequired(plugin, result.code, options.supportsStaticESM === true);
    return options.supportsStaticESM ? code : commonJs(plugin, path, code);
  };
  return {
    getCacheKey(source: string, path: string, options: JestOptions): string {
      let code: string;
      try {
        code = make(source, path, options);
      } catch (error) {
        code = String(error);
      }
      const settings = JSON.stringify(plugin.loadOptions?.(root(options)).options ?? {});
      return createHash("sha256").update(code).update(settings).update(String(options.supportsStaticESM)).update(options.configString ?? "").digest("hex");
    },
    process(source: string, path: string, options: JestOptions): { code: string } {
      return { code: make(source, path, options) };
    },
  };
}

/**
 * A module whose imports of the plugin's run time, each a line of its own, are `require` calls made
 * from the plugin's file. Jest loads a test's modules itself and runs a transformer only on the files
 * its patterns match, so it would read the run time as it is: TypeScript in a checkout of
 * dotschema's repository, and once installed an ES module, which Jest's `require` loads only under
 * `--experimental-vm-modules`. A CommonJS module so calls Node's own `require`, which reads both but
 * loads the run time outside the test's realm: an object it makes, such as a failed result's issues,
 * has the process's `Object` for its prototype, not the test's, so `instanceof Object` is false in
 * the test, though Jest's `toEqual` and `toStrictEqual` take it (jest 30.5.2, measured on
 * 2026-11-03). An ES module, which Jest loads only under that flag, calls Jest's.
 */
function runtimeRequired(plugin: LoaderPlugin, code: string, esm: boolean): string {
  const { runtime } = plugin;
  if (!runtime) return code;
  let found = false;
  const out = code.replace(IMPORT_LINE, (line, bindings: string, quoted: string) => {
    if (!(JSON.parse(quoted) as string).startsWith(runtime.prefix)) return line;
    found = true;
    return bindings.startsWith("{") ? `const ${bindings.replace(/ as /g, ": ")} = __runtime(${quoted});` : `const ${bindings} = __runtime(${quoted}).default;`;
  });
  if (!found) return code;
  // Jest hands a test its own `node:module` and `process.getBuiltinModule`, whose `createRequire` is
  // Jest's `require` (jest-runtime 30.5.2's CoreModuleProvider). Under `--experimental-vm-modules`
  // that loads an ES module itself, in the test's realm; otherwise it cannot, and the process's own
  // `process`, which `node:vm` evaluates in the process's context, gives Node's.
  const from = JSON.stringify(runtime.from);
  return `${esm ? `import { createRequire as __createRequire } from "node:module";\nconst __runtime = __createRequire(${from});` : `const __runtime = require("node:vm").runInThisContext("process").getBuiltinModule("node:module").createRequire(${from});`}\n${out}`;
}

/**
 * A module as CommonJS, once its imports are `require` calls (`runtimeRequired`). A schema module's
 * exports are `export default schema;` and an `export const` for each definition, each at the start
 * of a line of its own; the rest is declarations and strings written with JSON.stringify, which never
 * hold a line break. So each `export` at the start of a line is rewritten, stepping over strings for
 * `import.meta.url`, as Motherload's transformer does for its data modules, and a module with any
 * other import or export is refused.
 */
function commonJs(plugin: LoaderPlugin, path: string, code: string): string {
  const out = code
    .replace(/"(?:[^"\\]|\\.)*"|import\.meta\.url/g, (match) => (match.startsWith('"') ? match : 'require("node:url").pathToFileURL(__filename).href'))
    .replace(/^export const (\w+) = /gm, "const $1 = exports.$1 = ")
    .replace(/^export default /m, "exports.default = ")
    .replace(/^export \{\};\n?/m, "");
  if (/^(import|export)\b/m.test(out)) throw new Error(`${plugin.name}: ${path}: the module has a shape the Jest transformer cannot make CommonJS.`);
  return `Object.defineProperty(exports, "__esModule", { value: true });\n${out}`;
}

// ---- TypeScript 7.1 content mapper ------------------------------------------------------------

/**
 * A UTF-16 range of `source` as UTF-8 bytes, at least one byte long and within the text. TypeScript
 * refuses a whole transform response whose diagnostic runs past the end of the file, with TS18069
 * ("invalid transform response") in place of every diagnostic, and the parsers place a syntax error
 * at the end of a truncated or empty file there, one character long; so a range that would pass the
 * end ends at it, and one at the end is empty (measured on 2026-10-26, dotschema's DESIGN.md, Diagnostics).
 */
export function utf8Range(source: string, start: number, length: number): { start: number; length: number } {
  const total = Buffer.byteLength(source, "utf8");
  const before = Math.min(Buffer.byteLength(source.slice(0, start), "utf8"), total);
  const inside = Buffer.byteLength(source.slice(start, start + length), "utf8");
  return { start: before, length: Math.min(Math.max(inside, 1), total - before) };
}

type MapperHandlers = Record<string, (params: unknown) => unknown>;

export function toMapperHandlers(plugin: LoaderPlugin): MapperHandlers {
  // The compiler options each open project's types follow, by the handle TypeScript gave it.
  const projects = new Map<string, TypeOptions>();
  return {
    initialize(params) {
      // Builds from 2026-09-18 on send `protocolVersion: 1` and refuse a mapper that does not answer with it.
      const { protocolVersion } = (params ?? {}) as { protocolVersion?: number };
      return { protocolVersion: protocolVersion ?? 1, positionEncoding: "utf-8", diagnosticSource: DIAGNOSTIC_SOURCE };
    },
    openProject(params) {
      // dotschema takes no options; a key in a tsconfig entry's `options` is a mistake worth showing.
      const { options, projectHandle, compilerOptions } = (params ?? {}) as { options?: Record<string, unknown> | null; projectHandle?: string; compilerOptions?: Record<string, unknown> | null };
      const typeOptions: TypeOptions = { exactOptionalPropertyTypes: compilerOptions?.["exactOptionalPropertyTypes"] === true };
      if (typeof projectHandle === "string") projects.set(projectHandle, typeOptions);
      const optionDiagnostics = Object.keys(options ?? {}).map((key) => ({ path: [key], messageText: `dotschema takes no options; remove "${key}".`, code: CODES.option }));
      // With `dynamicConfig`, the project's fingerprint is the compiler options the types follow, so
      // that turning one on types the schemas again; no file is watched.
      return { configIdentity: typeOptions.exactOptionalPropertyTypes ? "exact" : "loose", watchedFiles: [], optionDiagnostics };
    },
    async transform(params) {
      const { fileName, content, projectHandle } = params as { fileName: string; content: string; projectHandle?: string };
      const result = await plugin.types(content, fileName, projectHandle === undefined ? undefined : projects.get(projectHandle));
      return {
        // An ES module whatever the nearest package.json says, as the preload and the plugin load it:
        // TypeScript takes a `.ts` module in a package with no "type" for CommonJS.
        extension: ".mts",
        text: result.types,
        diagnostics: result.problems.map((p) => ({ messageText: p.message, code: p.code, ...utf8Range(content, p.start, p.length) })),
      };
    },
    closeProject(params) {
      const { projectHandle } = (params ?? {}) as { projectHandle?: string };
      if (projectHandle !== undefined) projects.delete(projectHandle);
      return {};
    },
  };
}
