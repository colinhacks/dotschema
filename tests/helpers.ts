import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { formatDefinitions } from "../src/formats/index.ts";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TSC = `${ROOT}node_modules/.bin/tsc`;

/** An ajv instance with dotschema's formats (src/formats/), as dotschema's own ajv has them, for a test that compiles a schema with ajv itself. */
export function withFormats<T extends { addFormat(name: string, format: unknown): unknown }>(ajv: T): T {
  for (const [name, format] of formatDefinitions()) ajv.addFormat(name, format);
  return ajv;
}

/** Evaluates generated module code as an ES module. */
export async function evaluate(code: string): Promise<Record<string, any>> {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
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
