// The engine's code generator (src/engine/generate.ts) and `link` (src/engine/link.ts): the check it
// writes out of a validator's compiled tree gives the interpreter's `check` verdict on every value of
// the corpora the engine's tests use, the JSON Schema Test Suite of each draft with its format tests,
// the 205 schemas of the keyword measurement and tests/fixtures/engine/messages.ts, both as `jit`
// gives it and ahead of time, the source written into an ES module and linked to the tree of another
// compile of the same resources, as a module built ahead of time links at run time; the source is the
// same text in every compile and process, holds no path and no schema text its checks do not
// compare, and writes every name it compares safely; a runtime that refuses code from strings gets
// no check from `jit` and a working one from a module; and the AOT entry bundles without the generator.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compile, type Validator } from "../src/engine/index.ts";
import { generate, jit } from "../src/engine/generate.ts";
import { duplicate } from "../src/engine/interpret.ts";
import { link, planOf, unique } from "../src/engine/link.ts";
import type { JsonType } from "../src/engine/tree.ts";
import { parseSchemaFile } from "../src/parse.ts";
import { definitionsOf } from "../src/schema-types.ts";
import { engineOfFile, FORMATS, show, suiteEngine, suiteGroups, type SuiteDraft } from "./engine-support.ts";
import { MESSAGE_CASES } from "./fixtures/engine/messages.ts";
import { env, ROOT } from "./helpers.ts";

type Check = (value: unknown) => boolean;
type Factory = (r: any) => Check;

/** A schema of a corpus: how to compile its validator, again for each use, and the values to check. */
interface Entry {
  label: string;
  make: () => Validator;
  values: unknown[];
}

const DRAFTS: SuiteDraft[] = ["draft6", "draft7", "draft2019-09", "draft2020-12"];

function suiteEntries(): Entry[] {
  const out: Entry[] = [];
  for (const draft of DRAFTS)
    for (const kind of ["required", "format"] as const)
      for (const group of suiteGroups(draft, kind)) out.push({ label: group.id, make: () => suiteEngine(group).validator(), values: group.tests.map((t) => t.data) });
  return out;
}

/** The 205 schemas, each written into a directory of its own with the files it refers to, as tests/engine-parity.test.ts writes them, its definitions each an entry too. */
function caseEntries(): Entry[] {
  const { cases, draftUris } = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/engine/cases.json"), "utf8")) as {
    draftUris: Record<string, string>;
    cases: { id: string; draft: string; schema?: Record<string, unknown>; text?: string; suffix?: string; files?: Record<string, unknown>; pass: unknown[]; fail?: unknown[]; defs?: { name: string; pass?: unknown[]; fail?: unknown[] }[] }[];
  };
  assert.equal(cases.length, 205);
  const base = mkdtempSync(join(tmpdir(), "dotschema-generate-cases-"));
  const out: Entry[] = [];
  for (const c of cases) {
    const dir = join(base, c.id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{}\n");
    for (const [name, file] of Object.entries(c.files ?? {})) writeFileSync(join(dir, name), typeof file === "string" ? file : JSON.stringify(file, null, 2));
    const path = join(dir, `root${c.suffix ?? ".schema.jsonc"}`);
    const uri = draftUris[c.draft];
    const text = c.text ?? JSON.stringify(uri && !("$schema" in c.schema!) ? { $schema: uri, ...c.schema } : c.schema, null, 2);
    writeFileSync(path, text);
    const compiled = () => {
      const found = engineOfFile(text, path);
      if (!found) throw new Error("dotschema refuses the files");
      return found;
    };
    out.push({ label: `case ${c.id}`, make: () => compiled().engine.validator(), values: [...c.pass, ...(c.fail ?? [])] });
    const parsed = parseSchemaFile(text);
    const definitions = parsed.ok ? definitionsOf(parsed.value, path) : [];
    for (const d of c.defs ?? []) {
      const definition = definitions.find((x) => x.valueName === d.name);
      if (!definition) continue;
      const pointer = `#/${definition.keyword}/${definition.key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      out.push({ label: `case ${c.id} <${d.name}>`, make: () => compiled().engine.validator(`${compiled().root}${pointer}`), values: [...(d.pass ?? []), ...(d.fail ?? [])] });
    }
  }
  return out;
}

function messageEntries(): Entry[] {
  const base = mkdtempSync(join(tmpdir(), "dotschema-generate-messages-"));
  return MESSAGE_CASES.map((c, i) => {
    const dir = join(base, String(i));
    mkdirSync(dir);
    writeFileSync(join(dir, "package.json"), "{}\n");
    const path = join(dir, "root.schema.jsonc");
    const text = JSON.stringify(c.schema, null, 2);
    writeFileSync(path, text);
    return {
      label: `message ${c.id}`,
      make: () => {
        const found = engineOfFile(text, path);
        if (!found) throw new Error("dotschema refuses the files");
        return found.engine.validator();
      },
      values: c.values,
    };
  });
}

/** Factories written into one ES module, as a module built ahead of time holds one, and imported: no `new Function` on the way. */
async function aotFactories(sources: string[]): Promise<Factory[]> {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-generate-aot-"));
  const file = join(dir, "checks.mjs");
  writeFileSync(file, `export default [\n${sources.join(",\n")}\n];\n`);
  return (await import(pathToFileURL(file).href)).default as Factory[];
}

const outcome = (run: () => boolean): string => {
  try {
    return String(run());
  } catch (error) {
    return `threw ${(error as Error).name}`;
  }
};

interface Built {
  entry: Entry;
  validator: Validator;
  source: string;
}

interface Tally {
  schemas: number;
  refused: number;
  values: number;
  static: number;
  dynamic: number;
  scope: number;
}

/** Each entry's validator and source, and the entries whose source differed between two compiles. */
function buildAll(entries: Entry[], tally: Tally, differences: string[]): Built[] {
  const built: Built[] = [];
  for (const entry of entries) {
    let validator: Validator;
    try {
      validator = entry.make();
    } catch {
      tally.refused++;
      continue;
    }
    let source: string;
    try {
      source = generate(validator).source;
    } catch (error) {
      differences.push(`${entry.label}: generate threw ${(error as Error).message}`);
      continue;
    }
    if (generate(entry.make()).source !== source) differences.push(`${entry.label}: another compile of the same resources gave another source`);
    tally.schemas++;
    if (source.includes("props: void 0")) tally.dynamic++;
    else if (/unevaluated/i.test(JSON.stringify(validator.node.schema))) tally.static++;
    if (source.includes("sc.push")) tally.scope++;
    built.push({ entry, validator, source });
  }
  return built;
}

/** The verdict of the interpreter, of `jit` and of the AOT check on each value, the AOT check linked to a validator of another compile. */
async function agree(built: Built[], values: (b: Built) => unknown[], tally: Tally, differences: string[]): Promise<void> {
  const factories = await aotFactories(built.map((b) => b.source));
  built.forEach((b, i) => {
    const jitted = jit(b.validator);
    if (!jitted) return void differences.push(`${b.entry.label}: jit gave nothing where new Function runs`);
    let aot: Check;
    try {
      aot = link(b.entry.make(), factories[i]!);
    } catch (error) {
      return void differences.push(`${b.entry.label}: link threw ${(error as Error).message}`);
    }
    values(b).forEach((value, n) => {
      tally.values++;
      const want = outcome(() => b.validator.check(value));
      const fromJit = outcome(() => jitted(value));
      const fromAot = outcome(() => aot(value));
      if (fromJit !== want) differences.push(`jit ${b.entry.label} #${n} ${show(value, 100)}: ${fromJit} where check gives ${want}`);
      if (fromAot !== want) differences.push(`aot ${b.entry.label} #${n} ${show(value, 100)}: ${fromAot} where check gives ${want}`);
    });
  });
}

const newTally = (): Tally => ({ schemas: 0, refused: 0, values: 0, static: 0, dynamic: 0, scope: 0 });
const report = (tally: Tally) =>
  `${tally.schemas} schemas (${tally.refused} the engine refuses), ${tally.values} values, each by jit and by AOT; unevaluated* checked statically in ${tally.static}, through the interpreter's record in ${tally.dynamic}; dynamic scope kept in ${tally.scope}`;

const CORPORA: [name: string, entries: () => Entry[]][] = [
  ["the JSON Schema Test Suite, required and format tests of draft6, draft7, 2019-09 and 2020-12", suiteEntries],
  ["the 205 schemas of the keyword measurement and their definitions", caseEntries],
  ["the schemas of tests/fixtures/engine/messages.ts", messageEntries],
];

for (const [name, entries] of CORPORA)
  test(`on ${name}, the generated check gives check()'s verdict on every value, JIT and AOT, the same source from every compile`, async (t) => {
    const tally = newTally();
    const differences: string[] = [];
    const built = buildAll(entries(), tally, differences);
    await agree(built, (b) => b.entry.values, tally, differences);
    t.diagnostic(report(tally));
    assert.ok(tally.values > 200);
    assert.deepEqual(differences, []);
  });

/** Values JSON cannot hold, or that JSON.parse makes and a literal does not, for each schema to be checked on. */
function exoticValues(): unknown[] {
  const inherits = Object.create({ inherited: 1, foo: "x" });
  inherits.own = 2;
  const holes: unknown[] = [];
  holes[1] = 1;
  return [
    undefined, null, 0, -0, NaN, Infinity, -Infinity, 1.5, 2 ** 53, "", "\ud800", "😀", "a\u2028b", true, false,
    {}, [], Object.create(null), { a: undefined }, { foo: undefined, bar: undefined }, inherits, holes, [undefined], [null, null], [-0, 0], [NaN, NaN],
    JSON.parse('{"__proto__": {"a": 1}}'), JSON.parse('{"__proto__": 1, "foo": 1}'), ["__proto__", "__proto__"], ["__proto_", "__proto_"], new Date(0), [1, "1"], [{ a: 1 }, { a: 1 }],
    Object.assign(Object.create(null), { foo: 1, bar: "x" }), [[1], [1]], { length: 2 }, Object.assign([1, 2], { foo: 1 }),
  ];
}

test("on every value of a suite file checked by each schema of that file, and on values only JavaScript holds, the generated check gives check()'s verdict", async (t) => {
  const tally = newTally();
  const differences: string[] = [];
  const entries = [...suiteEntries(), ...messageEntries()];
  const fileOf = (label: string) => label.replace(/ \[\d+\]$/, "");
  const byFile = new Map<string, unknown[]>();
  for (const entry of entries) byFile.set(fileOf(entry.label), [...(byFile.get(fileOf(entry.label)) ?? []), ...entry.values]);
  const exotic = exoticValues();
  const built = buildAll(entries, tally, differences);
  await agree(built, (b) => [...(b.entry.label.startsWith("message ") ? b.entry.values : byFile.get(fileOf(b.entry.label))!), ...exotic], tally, differences);
  t.diagnostic(report(tally));
  assert.ok(tally.values > 100_000);
  assert.deepEqual(differences, []);
});

// ---- determinism and linking --------------------------------------------------------------------

const DRAFT_2020 = "https://json-schema.org/draft/2020-12/schema";

/** A schema that reaches most of what `r` holds: patterns, formats and their comparisons, an `enum` past the literal limit, a `const` object, `uniqueItems`, references in and out of the file, and a dynamic reference. */
const RICH: { id: string; schema: unknown }[] = [
  {
    id: "https://example.com/rich",
    schema: {
      $schema: DRAFT_2020,
      $dynamicAnchor: "node",
      type: "object",
      properties: {
        code: { type: "string", pattern: "^[A-Z]{3}$" },
        email: { type: "string", format: "email" },
        day: { type: "string", format: "date", formatMinimum: "2020-01-01" },
        size: { enum: ["xs", "s", "m", "l", "xl", "xxl", "3xl", "4xl", "5xl", { custom: true }] },
        origin: { const: { x: 0, y: 0 } },
        tags: { type: "array", uniqueItems: true, items: { type: "string" } },
        child: { $dynamicRef: "#node" },
        place: { $ref: "place#/$defs/city" },
      },
      patternProperties: { "^x-": { type: "string" } },
      unevaluatedProperties: false,
    },
  },
  { id: "https://example.com/place", schema: { $schema: DRAFT_2020, $defs: { city: { type: "object", properties: { name: { type: "string", minLength: 2 } }, required: ["name"] } } } },
];

const richValues = [
  { code: "ABC", email: "a@b.co", day: "2021-05-05", size: "m", origin: { x: 0, y: 0 }, tags: ["a", "b"], child: { code: "XYZ" }, place: { name: "Rome" }, "x-a": "y" },
  { code: "abc" },
  { email: "nope" },
  { day: "2019-12-31" },
  { size: { custom: true } },
  { size: "6xl" },
  { origin: { x: 0 } },
  { tags: ["a", "a"] },
  { child: { code: "abc" } },
  { child: { child: { other: 1 } } },
  { place: { name: "R" } },
  { "x-a": 1 },
  { other: 1 },
];

const compileRich = (formats = FORMATS) => compile(RICH, { draft: "2020-12", formats }).validator();

test("two compiles of the same resources give the same plan, entry by entry, and the same source, and a check linked to the tree of the other gives its verdicts", () => {
  const a = compileRich();
  const b = compileRich();
  const pa = planOf(a);
  const pb = planOf(b);
  const shape = (p: ReturnType<typeof planOf>) => ({
    sig: p.sig,
    roots: p.roots.map((n) => n.location),
    resources: p.resources.map((r) => r.uri),
    dynamics: p.dynamics.map((k) => k.path),
    candidates: p.dynamics.map((k) => p.candidates.get(k)),
    regexps: p.regexps.map(String),
    formats: [...p.formatOf.keys()],
    compares: [...p.compareOf.keys()],
    values: p.values.map((v) => (v instanceof Set ? [...v] : v)),
  });
  assert.deepEqual(shape(pb), shape(pa));
  assert.ok(pa.regexps.length >= 2 && pa.formats.length >= 2 && pa.compares.length === 1 && pa.values.length >= 3 && pa.dynamics.length === 1);
  // Each entry is the run-time tree's own object, not one equal to it.
  assert.notEqual(pb.regexps[0], pa.regexps[0]);
  const source = generate(a).source;
  assert.equal(generate(b).source, source);
  const factory = new Function(`return ${source}`)() as Factory;
  const linked = link(b, factory);
  for (const value of richValues) assert.equal(linked(value), a.check(value), show(value));
  assert.deepEqual(
    richValues.map((v) => a.check(v)),
    [true, false, false, false, true, false, false, false, false, false, false, false, false],
  );
});

test("a linked check reads the formats of the tree it is linked to, and refuses a tree other than the one its source was written from", () => {
  const seen: string[] = [];
  const spy = { ...FORMATS, email: (s: string) => (seen.push(s), s.includes("@")) };
  const factory = new Function(`return ${generate(compileRich()).source}`)() as Factory;
  const linked = link(compileRich(spy), factory);
  assert.equal(linked({ email: "x@y" }), true);
  assert.deepEqual(seen, ["x@y"]);
  const other = compile([{ id: "https://example.com/rich", schema: { $schema: DRAFT_2020, type: "object", properties: { code: { type: "string", pattern: "^[A-Z]{4}$" } } } }], { draft: "2020-12" }).validator();
  assert.throws(() => link(other, factory), /linked to a schema other than its own/);
  // Formats are part of the tree: one the run time does not know leaves its keyword out.
  const { email: _email, ...withoutEmail } = FORMATS;
  assert.throws(() => link(compileRich(withoutEmail), factory), /linked to a schema other than its own/);
});

// ---- the source -----------------------------------------------------------------------------------

/** Property names, values and tags that would break out of a string literal, a comment or a template if written raw. */
const HOSTILE = ['"); globalThis.__dotschemaPwned = 1; ("', "'); globalThis.__dotschemaPwned = 1; ('", "`${globalThis.__dotschemaPwned = 1}`", "*/ globalThis.__dotschemaPwned = 1; /*", "\\", '\\"', "a\u2028b\u2029c", "</script>", "\ud800", "__proto__", "constructor", "toString", "\n\r\t\0", ""];

test("names and values that would break out of a literal are written as JSON strings: the source runs, compares them as given and does nothing else", () => {
  // A lone surrogate is a value here, not a name: the engine writes each name into a URI as it compiles, and encodeURIComponent refuses one.
  const names = HOSTILE.filter((name) => name !== "\ud800");
  const properties = Object.fromEntries(names.map((name) => [name, { type: "string", enum: HOSTILE.slice(0, 5) }]));
  const schema = {
    $schema: DRAFT_2020,
    type: "object",
    properties,
    required: HOSTILE.slice(0, 3),
    additionalProperties: false,
    $defs: { variant: { const: HOSTILE[0] } },
  };
  const validator = compile([{ id: "dotschema:0", schema }], { draft: "2020-12" }).validator();
  const { source } = generate(validator);
  const check = jit(validator)!;
  const good = Object.fromEntries(HOSTILE.slice(0, 3).map((name) => [name, HOSTILE[0]]));
  const values = [good, { ...good, [HOSTILE[3]!]: HOSTILE[4] }, { ...good, [HOSTILE[3]!]: "other" }, { ...good, extra: HOSTILE[0] }, JSON.parse(JSON.stringify({ ...good, __proto__: HOSTILE[1] })), HOSTILE.slice(0, 2)];
  for (const value of values) assert.equal(check(value), validator.check(value), show(value));
  assert.deepEqual(values.map(check), [true, true, false, false, true, false]);
  assert.equal((globalThis as Record<string, unknown>)["__dotschemaPwned"], undefined);
  for (const name of HOSTILE.slice(0, 4)) assert.ok(source.includes(JSON.stringify(name)), `${name} written as a JSON string`);
  // A tag of a discriminator is a `case` label.
  const tagged = compile([{ id: "dotschema:0", schema: { type: "object", required: ["kind"], discriminator: { propertyName: "kind" }, oneOf: HOSTILE.slice(0, 4).map((tag) => ({ properties: { kind: { const: tag } } })) } }], { draft: "draft-07", discriminator: true }).validator();
  const tagCheck = jit(tagged)!;
  for (const tag of [...HOSTILE.slice(0, 4), "other"]) assert.equal(tagCheck({ kind: tag }), tagged.check({ kind: tag }), tag);
  assert.equal((globalThis as Record<string, unknown>)["__dotschemaPwned"], undefined);
});

test("the source holds no path, no URI, no pattern, no format name and no annotation, only the names and values its checks compare", () => {
  const schema = {
    $schema: DRAFT_2020,
    $id: "file:///Users/secret/project/user.schema.json",
    title: "Secret title",
    description: "Secret description",
    $comment: "Secret comment",
    type: "object",
    properties: { name: { type: "string", pattern: "^secret-pattern$", format: "email", examples: ["secret example"] }, home: { $ref: "#/$defs/place" } },
    $defs: { place: { $anchor: "secretAnchor", type: "object", properties: { city: { type: "string" } }, default: { city: "Secret default" } } },
  };
  const validator = compile([{ id: "file:///Users/secret/project/user.schema.json", schema }], { draft: "2020-12", formats: FORMATS }).validator();
  const { source } = generate(validator);
  for (const text of ["/Users", "file:", "secret", "Secret", "email", "$defs", "#/", "schema.json"]) assert.ok(!source.includes(text), `the source holds ${text}`);
  assert.ok(source.includes('"name"') && source.includes('"city"'));
});

test("the source of a schema of ordinary keywords makes no object, array, Set or key list when it runs", () => {
  const validator = compile([{ id: "dotschema:0", schema: RICH[1]!.schema }, ...RICH.slice(0, 1)], { draft: "2020-12", formats: FORMATS }).validator("dotschema:0#/$defs/city");
  const sources = [generate(validator).source, generate(compile([{ id: "dotschema:0", schema: lab() }], { draft: "draft-07", formats: FORMATS }).validator()).source];
  for (const source of sources) {
    const body = source.slice(source.indexOf("function "));
    assert.doesNotMatch(body, /\bnew\b|Object\.keys|props: void 0|\[\s*\]|\{\s*\}/);
  }
});

/** A schema like lab/basic's user.schema.jsonc, the one the speed measurement checks. */
function lab(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
      email: { type: "string", format: "email" },
      role: { enum: ["admin", "member"] },
      tags: { type: "array", items: { type: "string" }, uniqueItems: true },
      count: { type: "integer", minimum: 0, maximum: 1000 },
      address: { $ref: "#/definitions/address" },
    },
    required: ["name", "role"],
    additionalProperties: false,
    definitions: { address: { type: "object", properties: { street: { type: "string" }, city: { type: "string", minLength: 1 } }, required: ["city"], additionalProperties: false } },
  };
}

// ---- where code cannot be built from a string -----------------------------------------------------

test("under --disallow-code-generation-from-strings, jit gives undefined without throwing, generate gives the same source as here, and a module holding the source links and checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-generate-noeval-"));
  const engine = pathToFileURL(join(ROOT, "src/engine/")).href;
  const values = [...richValues, null, "x", [], { code: 1 }];
  const source = generate(compileRich()).source;
  // The module a build writes: the factory in its text, `link` imported, nothing built from a string.
  writeFileSync(
    join(dir, "module.mjs"),
    `import { compile } from ${JSON.stringify(`${engine}index.ts`)};\nimport { link } from ${JSON.stringify(`${engine}link.ts`)};\nimport { formats, resources } from "./setup.mjs";\nexport const validator = compile(resources, { draft: "2020-12", formats }).validator();\nexport const is = link(validator, ${source});\n`,
  );
  writeFileSync(join(dir, "setup.mjs"), `import { formatDefinitions } from ${JSON.stringify(pathToFileURL(join(ROOT, "src/formats/index.ts")).href)};\nexport const formats = Object.fromEntries(formatDefinitions());\nexport const resources = ${JSON.stringify(RICH)};\n`);
  writeFileSync(
    join(dir, "run.mjs"),
    `import { is, validator } from "./module.mjs";\nimport { generate, jit } from ${JSON.stringify(`${engine}generate.ts`)};\nlet refused = false;\ntry { new Function(""); } catch { refused = true; }\nconst jitted = jit(validator);\nconst values = ${JSON.stringify(values)};\nconsole.log(JSON.stringify({ refused, jit: jitted === undefined ? "undefined" : typeof jitted, source: generate(validator).source, aot: values.map((v) => is(v)), check: values.map((v) => validator.check(v)) }));\n`,
  );
  const result = spawnSync(process.execPath, ["--disallow-code-generation-from-strings", join(dir, "run.mjs")], { encoding: "utf8", env: env() });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as { refused: boolean; jit: string; source: string; aot: boolean[]; check: boolean[] };
  assert.equal(out.refused, true);
  assert.equal(out.jit, "undefined");
  assert.equal(out.source, source);
  assert.deepEqual(out.aot, out.check);
  assert.deepEqual(out.check, values.map((v) => compileRich().check(v)));
});

test("the AOT entry, link.ts, bundles with the interpreter and without the generator, building no code from a string", async () => {
  const result = await build({ stdin: { contents: `export { compile } from "./src/engine/index.ts";\nexport { link } from "./src/engine/link.ts";\n`, resolveDir: ROOT, loader: "ts" }, bundle: true, write: false, platform: "neutral", format: "esm", metafile: true, logLevel: "silent" });
  const inputs = Object.keys(result.metafile.inputs).map((input) => input.replace(/^.*src\/engine\//, "")).sort();
  assert.deepEqual(inputs.filter((input) => input !== "<stdin>"), ["equal.ts", "index.ts", "interpret.ts", "link.ts", "resources.ts", "tree.ts", "uri.ts"]);
  assert.doesNotMatch(result.outputFiles[0]!.text, /\bnew Function\b|\bFunction\(|\beval\(/);
  const jitEntry = await build({ entryPoints: [join(ROOT, "src/engine/generate.ts")], bundle: true, write: false, platform: "neutral", format: "esm", logLevel: "silent" });
  assert.equal(jitEntry.outputFiles[0]!.text.match(/new Function\(/g)?.length, 2, "the probe and jit's");
});

// ---- the comparisons --------------------------------------------------------------------------------

test("unique gives the verdict of the interpreter's duplicate on arrays of every item type, short and long", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pool: unknown[] = [0, -0, 1, 1.5, NaN, Infinity, "", "1", "a", "__proto__", "__proto_", "constructor", "toString", true, false, null, [], [1], {}, { a: 1 }, undefined];
  const typeSets: JsonType[][] = [[], ["string"], ["number"], ["integer"], ["boolean"], ["null"], ["string", "number"], ["number", "null"], ["string", "boolean", "null"], ["integer", "string"], ["object"], ["array", "string"]];
  let compared = 0;
  for (const types of typeSets)
    for (let round = 0; round < 400; round++) {
      const length = round % 40 === 0 ? 17 + Math.floor(random() * 10) : Math.floor(random() * 7);
      const items = Array.from({ length }, () => {
        const v = pool[Math.floor(random() * pool.length)];
        return v && typeof v == "object" ? structuredClone(v) : v;
      });
      compared++;
      assert.equal(unique(items, types), duplicate(items, types) === undefined, `${show(items)} of ${types.join(",")}`);
    }
  assert.ok(compared > 4000);
});
