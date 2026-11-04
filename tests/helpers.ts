import { spawnSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import type { LoadOptions } from "../src/core/universal.ts";
import { formatDefinitions } from "../src/formats/index.ts";
import { schemaCode as build } from "../src/schema.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TSC = `${ROOT}node_modules/.bin/tsc`;

/** An ajv instance with dotschema's formats (src/formats/), as dotschema's own ajv has them, for a test that compiles a schema with ajv itself. */
export function withFormats<T extends { addFormat(name: string, format: unknown): unknown }>(ajv: T): T {
  for (const [name, format] of formatDefinitions()) ajv.addFormat(name, format);
  return ajv;
}

/**
 * How the tests' modules run their validators: `jit`, the default, or the mode `DOTSCHEMA_VALIDATORS`
 * names, under which tests/modes.test.ts runs the tests of the module again, once for each other mode.
 */
export const VALIDATORS: NonNullable<LoadOptions["validators"]> = (process.env["DOTSCHEMA_VALIDATORS"] as NonNullable<LoadOptions["validators"]> | undefined) ?? "jit";

/** `schemaCode` (src/schema.ts) in the tests' mode, unless the options name another. */
export const schemaCode = (source: string, path: string, options: LoadOptions & { discriminators?: boolean } = {}) => build(source, path, { validators: VALIDATORS, ...options });

/**
 * Evaluates generated module code as an ES module. A module imports its run time and its formats
 * from `dotschema/...`, which a `data:` URL does not resolve, so each such specifier is resolved from
 * here first, to the repository's own files: `dotschema` is the repository, linked into itself.
 */
export async function evaluate(code: string): Promise<Record<string, any>> {
  const linked = code.replace(/^(import [^;\n]* from )"(dotschema\/[^"]+)";$/gm, (_, head: string, specifier: string) => `${head}${JSON.stringify(import.meta.resolve(specifier))};`);
  return import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`);
}

/**
 * The environment a command runs in. nub runs as plain Node under NODE_COMPAT=1, which its `node`
 * shim passes on, and then reads no nub.jsonc; Node's test runner skips a child's test files under
 * the NODE_TEST_CONTEXT this test runs in; Jest prints only its summary when it sees an agent's
 * variables; and Next.js and wrangler send no telemetry here.
 */
export function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "", NEXT_TELEMETRY_DISABLED: "1", WRANGLER_SEND_METRICS: "false" };
  for (const name of ["NODE_COMPAT", "NODE_TEST_CONTEXT", "CLAUDECODE", "AI_AGENT"]) delete out[name];
  return { ...out, ...extra };
}

/** Runs a command and returns its exit status and output, without colour codes; never throws on a non-zero exit. */
export function run(command: string, args: string[], cwd = ROOT, extra: Record<string, string> = {}): { status: number | null; out: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: env(extra) });
  return { status: result.status, out: stripVTControlCharacters(`${result.stdout}${result.stderr}${result.error ?? ""}`) };
}

/**
 * What Rspack and Rollup need to bundle a schema's module in this repository, whose dotschema is
 * its TypeScript sources, the run time a module imports among them: Rspack's own SWC loader for a
 * `.ts` file, and for Rollup, which reads no TypeScript, Node's stripping of its types. webpack,
 * esbuild, Vite and Rolldown read TypeScript themselves, and an installed dotschema is JavaScript.
 */
export const RSPACK_TYPESCRIPT = { test: /\.ts$/, loader: "builtin:swc-loader", options: { jsc: { parser: { syntax: "typescript" } } }, type: "javascript/auto" };
export const ROLLUP_TYPESCRIPT = { name: "typescript", transform: (code: string, id: string) => (id.endsWith(".ts") ? { code: stripTypeScriptTypes(code), map: null } : null) };

