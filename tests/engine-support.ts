// Shared by the engine's tests (tests/engine-suite.test.ts, tests/engine-parity.test.ts): the JSON
// Schema Test Suite as the fixtures hold it, the engine compiled for a suite group or for a schema
// file as dotschema reads it, dotschema's module for the same file in each way of running its
// validators, and what the module gave before it ran on the engine, ajv 8.20.0 at 45a7f5e, recorded
// (`referenceOf`).
//
// The suite is tests/fixtures/test-suite, copied from json-schema-org/JSON-Schema-Test-Suite at
// 89e83a7 (2026-10-22, the copy in ~/Documents/repos): tests/draft6, draft7, draft2019-09 and
// draft2020-12, the required tests, unchanged, and of remotes/ every file but those of draft3, draft4
// and v1; its LICENSE beside them. The format tests are tests/fixtures/format-suite (draft2020-12's,
// tests/formats.test.ts), run under each draft with that draft's `$schema` and only the files that
// draft's optional/format holds: draft6's and draft7's own copies order some tests otherwise and
// draft6's hostname.json holds older ones, while a format's verdict is src/formats' and the same in
// every draft.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { compile, type Draft, type Engine, type EngineError, type FormatDefinition, type ResourceInput } from "../src/engine/index.ts";
import { metaResources, type MetaDraft } from "../src/engine/meta/index.ts";
import { formatDefinitions } from "../src/formats/index.ts";
import { parseSchemaFile } from "../src/parse.ts";
import { forEngine } from "../src/refs.ts";
import type { LoadOptions } from "../src/core/universal.ts";
import { draftOf, filesOf, schemaCode, withDiscriminators } from "../src/schema.ts";
import { evaluate, ROOT } from "./helpers.ts";

export const FORMATS = Object.fromEntries(formatDefinitions()) as Record<string, FormatDefinition>;

const SUITE = join(ROOT, "tests/fixtures/test-suite");
const FORMAT_SUITE = join(ROOT, "tests/fixtures/format-suite");

export type SuiteDraft = "draft6" | "draft7" | "draft2019-09" | "draft2020-12";

const DRAFT6_FORMATS = ["date-time", "email", "hostname", "ipv4", "ipv6", "json-pointer", "unknown", "uri-reference", "uri-template", "uri"];
const DRAFT7_FORMATS = [...DRAFT6_FORMATS, "date", "ecmascript-regex", "idn-email", "idn-hostname", "iri-reference", "iri", "regex", "relative-json-pointer", "time"];

export const SUITE_DRAFTS: Record<SuiteDraft, { draft: Draft; uri: string; meta: MetaDraft; formats: readonly string[] }> = {
  draft6: { draft: "draft-07", uri: "http://json-schema.org/draft-06/schema#", meta: "draft-06", formats: DRAFT6_FORMATS },
  draft7: { draft: "draft-07", uri: "http://json-schema.org/draft-07/schema#", meta: "draft-07", formats: DRAFT7_FORMATS },
  "draft2019-09": { draft: "2019-09", uri: "https://json-schema.org/draft/2019-09/schema", meta: "2019-09", formats: [...DRAFT7_FORMATS, "duration", "uuid"] },
  "draft2020-12": { draft: "2020-12", uri: "https://json-schema.org/draft/2020-12/schema", meta: "2020-12", formats: [...DRAFT7_FORMATS, "duration", "uuid"] },
};

export interface SuiteTest {
  description: string;
  data: unknown;
  valid: boolean;
}

export interface SuiteGroup {
  /** `draft2020-12/ref.json [3]`, or `draft7/format/uri.json [0]`. */
  id: string;
  draft: SuiteDraft;
  description: string;
  /** The group's schema with the draft's `$schema` where it declares none, as dotschema's harness gave it; a format group's set to the draft's. */
  schema: unknown;
  tests: SuiteTest[];
}

const withSchema = (schema: unknown, uri: string, force = false): unknown => (schema && typeof schema === "object" && !Array.isArray(schema) && (force || !("$schema" in schema)) ? { ...schema, $schema: uri } : schema);

/** The required tests of a draft, or its format tests. */
export function suiteGroups(draft: SuiteDraft, kind: "required" | "format"): SuiteGroup[] {
  const { uri, formats } = SUITE_DRAFTS[draft];
  const dir = kind === "required" ? join(SUITE, draft) : FORMAT_SUITE;
  const files = kind === "required" ? readdirSync(dir).filter((file) => file.endsWith(".json")).sort() : formats.map((name) => `${name}.json`);
  return files.flatMap((file) =>
    (JSON.parse(readFileSync(join(dir, file), "utf8")) as { description: string; schema: unknown; tests: SuiteTest[] }[]).map((group, index) => ({
      id: `${draft}/${kind === "format" ? "format/" : ""}${file} [${index}]`,
      draft,
      description: group.description,
      schema: kind === "format" ? withSchema(group.schema, uri, true) : withSchema(group.schema, uri),
      tests: group.tests,
    })),
  );
}

const remoteCache = new Map<SuiteDraft, ResourceInput[]>();

/** The suite's remotes for a draft, served at http://localhost:1234/ as its runner serves them, with the draft's meta-schemas, which the suite takes as known. */
export function remotes(draft: SuiteDraft): ResourceInput[] {
  const known = remoteCache.get(draft);
  if (known) return known;
  const base = join(SUITE, "remotes");
  const others = ["draft6", "draft7", "draft2019-09", "draft2020-12"].filter((d) => d !== draft);
  const out: ResourceInput[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (!others.includes(relative(base, path))) walk(path);
      } else if (name.endsWith(".json")) out.push({ id: `http://localhost:1234/${relative(base, path)}`, schema: JSON.parse(readFileSync(path, "utf8")) });
    }
  };
  walk(base);
  out.push(...metaResources(SUITE_DRAFTS[draft].meta));
  remoteCache.set(draft, out);
  return out;
}

/** The engine for a suite group: its schema, at a base URI of its own, then the remotes. */
export function suiteEngine(group: SuiteGroup): Engine {
  return compile([{ id: "http://json-schema-test-suite.local/root.json", schema: group.schema }, ...remotes(group.draft)], { draft: SUITE_DRAFTS[group.draft].draft, formats: FORMATS });
}

// ---- dotschema's module, at 45a7f5e and now ----------------------------------------------------

/** A directory for schema files no test writes, where a suite group's schema is said to be. */
export const SCRATCH = join(tmpdir(), "dotschema-engine-tests");

export interface Issue {
  message: string;
  path: (string | number)[];
  keyword: string;
}

/**
 * What dotschema's module gave a value before it ran on the engine: `.is()`, `.validate()`'s issues
 * where it failed, ajv's errors behind them (`comparable`, with `schemaPath`), `joined` where they came
 * from one validator for each property of a plain object, whose `schemaPath`s start at each, and the
 * value it checked where its defaults or transforms changed it.
 */
export interface ReferenceRun {
  is: boolean;
  issues?: Issue[];
  errors?: Record<string, unknown>[];
  joined?: true;
  input?: unknown;
}

/** A file as that module built it: the problems it refused it with, or what it gave each value. */
export type ReferenceFile = { problems: string[] } | { runs: ReferenceRun[] };

/**
 * dotschema's module before the engine, ajv 8.20.0 as `schemaCode` compiled it at 45a7f5e, on the
 * corpora of tests/engine-parity.test.ts, by file as the tests name them (`case <id>`, a suite
 * group's id, `message <id>`): tests/fixtures/engine/reference.json, written by
 * tests/fixtures/engine/record-reference.ts from a checkout of that commit.
 */
export function referenceOf(label: string): ReferenceFile | undefined {
  reference ??= (JSON.parse(readFileSync(join(ROOT, "tests/fixtures/engine/reference.json"), "utf8")) as { files: Record<string, ReferenceFile> }).files;
  return reference[label];
}
let reference: Record<string, ReferenceFile> | undefined;

export type Validators = NonNullable<LoadOptions["validators"]>;
export const MODES: readonly Validators[] = ["jit", "interpret", "aot"];

/** dotschema's module for a schema file, as `schemaCode` builds it with `validators`, or its problems where it refuses the schema. */
export async function buildModule(source: string, path: string, validators: Validators): Promise<{ problems: string[]; exports?: Record<string, any> }> {
  const built = schemaCode(source, path, { validators });
  if (built.problems.length) return { problems: built.problems.map((p) => p.message) };
  return { problems: [], exports: await evaluate(built.code) };
}

/** The meta-schemas a schema of each draft may refer to, as ajv knew them: its class's own, and draft-06's beside draft-07's (src/schema.ts's `KNOWN_META`). */
const KNOWN_META: Record<Draft, MetaDraft[]> = { "draft-07": ["draft-07", "draft-06"], "2019-09": ["2019-09"], "2020-12": ["2020-12"] };

/**
 * The engine compiled from a schema file as dotschema reads it for its validator: the file and every
 * file it reaches (`filesOf`), with the discriminators dotschema adds (`withDiscriminators`), each
 * file under the id `forEngine` gives it; and the meta-schemas, which a schema may refer to. Undefined
 * where dotschema refuses the files.
 */
export function engineOfFile(source: string, path: string): { engine: Engine; root: string; discriminators: number } | undefined {
  const parsed = parseSchemaFile(source);
  if (!parsed.ok) return undefined;
  const files = filesOf(source, path, parsed.value);
  if (files.problems.length) return undefined;
  const tagged = withDiscriminators(files);
  const prepared = forEngine(tagged.files, path);
  const root = String((prepared.root as Record<string, unknown>)["$id"]).replace(/#$/, "");
  const draft = draftOf(parsed.value) ?? "draft-07";
  const resources: ResourceInput[] = [{ id: root, schema: prepared.root }, ...prepared.others.map(({ id, schema }) => ({ id, schema })), ...KNOWN_META[draft].flatMap(metaResources)];
  return { engine: compile(resources, { draft, formats: FORMATS, discriminator: tagged.count > 0 }), root, discriminators: tagged.count };
}

/** An error as the tests compare it: every field ajv gives, `schemaPath` only where `withPath`, and the errors a message replaced in the same form. */
export function comparable(error: EngineError, withPath: boolean): Record<string, unknown> {
  const params: Record<string, unknown> = { ...error.params };
  if (error.keyword === "errorMessage" && Array.isArray(params["errors"])) params["errors"] = (params["errors"] as EngineError[]).map((e) => comparable(e, withPath));
  return {
    instancePath: error.instancePath,
    ...(withPath ? { schemaPath: error.schemaPath } : {}),
    keyword: error.keyword,
    params,
    message: error.message,
    ...(error.propertyName !== undefined ? { propertyName: error.propertyName } : {}),
    ...(error.emUsed ? { emUsed: true } : {}),
  };
}

export const sameErrors = (a: EngineError[] | undefined, b: EngineError[] | undefined, withPath: boolean): boolean => isDeepStrictEqual((a ?? []).map((e) => comparable(e, withPath)), (b ?? []).map((e) => comparable(e, withPath)));

/** A value printed in a report, short. */
export const show = (value: unknown, max = 160): string => {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
};
