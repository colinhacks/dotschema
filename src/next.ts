// The Next.js integration, `export default withDotschema(nextConfig)` in next.config.ts: the loader
// for Turbopack and webpack, for the server and the browser alike, and a type check that runs the
// content mapper inside `next build`. Motherload's `withMotherload` (its src/next.ts at 099d7e2),
// with dotschema's names and its rule placed first for Turbopack.
//
// Since 16.3, `next build` type-checks with the project's own `tsc` (`experimental.useTypeScriptCli`,
// on by default), which TypeScript 7 is, but with arguments of its own and no `--runExternalCode`
// among them, and TypeScript takes that flag from the command line alone. So its check never runs
// the mapper and fails on every schema import (TS2307, and TS18068 on tsconfig.json). The wrapper
// turns that check off and runs the same one with the flag in `compiler.runAfterProductionCompile`,
// which runs under Turbopack and webpack alike, after the compile and before the prerender
// (DESIGN.md, "Next.js"). Motherload's `withMotherload` and Reylo's `withReylo` do the same: wrapped
// in either order, the outer wrapper finds Next's check off and adds no second one, and the inner
// one's `tsc` runs every content mapper the tsconfig names.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

type AfterCompile = (metadata: { projectDir: string; distDir: string }) => Promise<void>;

// The part of Next's config the wrapper reads or sets, so that dotschema has no dependency on next.
// Each field's type admits Next's own, and the rest of the config passes through as it is. Each
// level is intersected with `object`, which keeps it from being a weak type (one whose properties
// are all optional): an object literal that shares none of a weak type's properties fails the
// constraint and is then checked for excess properties, so `withDotschema({ reactStrictMode: true })`
// would fail the type check of next.config.ts (TS2353, Motherload's finding of 2026-10-23). An index
// signature would admit those too, but not Next's own `NextConfig`, whose nested interfaces have none.
type NextConfig = object & {
  typescript?: object & { ignoreBuildErrors?: boolean; tsconfigPath?: string };
  turbopack?: object & { rules?: Record<string, unknown> };
  webpack?: ((config: any, context: any) => any) | null;
  compiler?: object & { runAfterProductionCompile?: AfterCompile };
};

// The loader's extensions, written out rather than read from the loader, which would load the
// parsers and ajv into next.config.ts; a test holds the list to the loader's.
export const EXTENSIONS = ["schema.jsonc", "schema.json5"];
const GLOB = "*.schema.{jsonc,json5}";
const TEST = /\.schema\.(?:jsonc|json5)$/;

export function withDotschema<Config extends NextConfig>(config: Config = {} as Config): Config {
  const { typescript, turbopack, webpack, compiler } = config;
  // A project that turned Next's type check off has turned dotschema's off with it.
  const check = !typescript?.ignoreBuildErrors;
  return {
    ...config,
    turbopack: {
      ...turbopack,
      // Turbopack runs only the first rule that matches a file, in the object's order, and a schema
      // file also ends in .jsonc or .json5, whose rules (Motherload's `withMotherload`, which adds
      // its own after the project's) would read it as data. So dotschema's rule goes first, before
      // the project's own and whichever wrapper ran before this one (DESIGN.md, "Next.js").
      rules: { [GLOB]: { loaders: ["dotschema/turbopack"], as: "*.js" }, ...turbopack?.rules },
    },
    webpack(webpackConfig: any, context: any) {
      const out = webpack ? webpack(webpackConfig, context) : webpackConfig;
      // webpack runs every rule that matches, and a loader another loader on the file outranks
      // passes it through, so this rule's place does not matter (universal.ts, toWebpackLoader).
      out.module.rules.push({ test: TEST, use: "dotschema/webpack" });
      return out;
    },
    ...(check && {
      typescript: { ...typescript, ignoreBuildErrors: true },
      compiler: {
        ...compiler,
        async runAfterProductionCompile(metadata: { projectDir: string; distDir: string }) {
          await compiler?.runAfterProductionCompile?.(metadata);
          await typeCheck(metadata.projectDir, resolve(metadata.projectDir, typescript?.tsconfigPath ?? "tsconfig.json"));
        },
      },
    }),
  } as Config;
}

// Next's own check (`next/dist/lib/typescript/runTypeCheckCli`), with `--runExternalCode`: the
// project's TypeScript, run with this process's Node from the project directory.
async function typeCheck(dir: string, tsconfig: string): Promise<void> {
  const require = createRequire(join(dir, "package.json"));
  let manifest: string;
  try {
    manifest = require.resolve("typescript/package.json");
  } catch {
    throw stackless("dotschema's type check needs TypeScript 7.1 or later, whose content mappers type schema imports, and the project has no TypeScript.");
  }
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (major < 7 || (major === 7 && minor < 1)) {
    throw stackless(`dotschema's type check needs TypeScript 7.1 or later, whose content mappers type schema imports; the project has TypeScript ${version}.`);
  }
  // Next writes next-env.d.ts after this hook; `next typegen` writes it on a first build, for a
  // project that declares an image import through it.
  if (!existsSync(join(dir, "next-env.d.ts"))) {
    const next = require.resolve("next/package.json");
    const bin = (JSON.parse(readFileSync(next, "utf8")) as { bin: { next: string } }).bin.next;
    const typegen = await run([join(dirname(next), bin), "typegen", dir], dir);
    if (typegen.code !== 0) throw stackless(`next typegen failed:\n${typegen.output}`);
  }
  const tsc = join(dirname(manifest), "lib", "tsc.js");
  const args = ["--project", tsconfig, "--noEmit", "--declarationMap", "false", "--emitDeclarationOnly", "false", "--runExternalCode"];
  const { code, output } = await run([tsc, ...args], dir);
  // Next's spinner pauses for console output, and not for a write to stdout.
  if (output.trim()) console.log(output.trimEnd());
  if (code !== 0) throw stackless("Failed to type check (tsc --runExternalCode).");
}

// A child Node process's exit code and its output, stdout and stderr in the order they came. A
// piped tsc prints no colors unless FORCE_COLOR asks, which Next sets for its own check too.
function run(args: string[], cwd: string): Promise<{ code: number; output: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(process.stdout.isTTY && { FORCE_COLOR: "1" }) },
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

// `next build` prints a failed hook's error whole: a stack would point into dotschema, not at the
// errors, which tsc has printed above it.
function stackless(message: string): Error {
  const error = new Error(message);
  error.stack = message;
  return error;
}
