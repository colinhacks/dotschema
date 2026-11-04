// Runs dotschema itself, from the repository's src/, on the docs page's examples. lib/remark-schemas.ts
// calls it in a process of its own, because the site build bundles its own modules and dotschema's
// source runs on Node as it is. Reads one request as JSON on stdin and writes the answer as JSON:
//
// - `projects`: each a directory to write the page's schema files into, as the files a block sees
//   (`files`), and the files it imports (`entries`). Each answer is the module TypeScript gets for
//   each entry under `tsc --runExternalCode` (the loader's `types`, as the content mapper returns it),
//   and for every schema file those modules import in turn, with each file's problems.
// - `diagnostics`: an error example, a file written into its project's directory, and the
//   diagnostics the content mapper's `transform` returns for it, as TypeScript receives them (UTF-8
//   byte ranges).
// - `formats`: the page's format tables, each row a format and a value it is said to accept; the
//   answer is every format dotschema has, and each row's verdict from the module dotschema builds
//   for `{ "format": … }`.
// - `keywords`: asked for when the page has a keyword table; the answer is every keyword of the drafts
//   dotschema reads: the ones ajv's class for each draft knows (ajv, the repository's development
//   dependency, is the tests' reference for the engine), without ajv's own `$async`, `nullable`
//   and `id`, which no draft dotschema reads defines and src/schema.ts takes out of every schema, and
//   with `$anchor`, which ajv reads where it resolves a `$ref` (compile/resolve.js) and not as a rule.
// - `bundles`: a file written into its directory beside the schema files it sees, with a package.json
//   setting `validators` where the request names it, and esbuild's analysis of it bundled and
//   minified with dotschema's esbuild plugin (esbuild, the repository's development dependency, as
//   its own resolution from here finds it), every file of dotschema's src/, its run time and formats,
//   counted as one input, `dotschema`, as an app's bundle holds them from its one package.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import dotschema from "../../src/esbuild.ts";
import { formatDefinition, FORMATS } from "../../src/formats/index.ts";
import { loader } from "../../src/loader.ts";
import { schemaCode } from "../../src/schema.ts";
import { standalone } from "../../src/core/standalone.ts";
import { toMapperHandlers } from "../../src/core/universal.ts";

type File = { name: string; text: string };
type Request = {
  projects?: { dir: string; files: File[]; entries: string[] }[];
  diagnostics?: { dir: string; files: File[]; file: File }[];
  formats?: { format: string; example: string }[];
  keywords?: boolean;
  bundles?: { dir: string; files: File[]; entry: File; validators?: string }[];
};

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input) as Request;

/** The files of an example, written into a directory of its own with a package.json. */
function write(dir: string, files: File[]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), "{}\n");
  for (const file of files) {
    const target = path.join(dir, file.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.text);
  }
}

// The schema files a module's types import: `import type { … } from "./user.schema.jsonc"`.
const IMPORTS = /^import type [^;]*? from "(\.{1,2}\/[^"]+\.schema\.jsonc)";$/gm;

const projects = [];
for (const project of request.projects ?? []) {
  write(project.dir, project.files);
  const modules: Record<string, { types: string; problems: string[] }> = {};
  const pending = [...project.entries];
  for (let name = pending.shift(); name !== undefined; name = pending.shift()) {
    if (name in modules) continue;
    const file = project.files.find((f) => f.name === name);
    if (!file) {
      modules[name] = { types: "", problems: [`no block on the page shows ${name}`] };
      continue;
    }
    // The blocks' compiler options (lib/twoslash.ts) leave exactOptionalPropertyTypes off, as the
    // content mapper would tell the loader of such a project.
    const result = await loader.types(file.text, path.join(project.dir, name), { exactOptionalPropertyTypes: false });
    modules[name] = { types: result.types, problems: result.problems.map((p) => p.message) };
    for (const [, spec] of result.types.matchAll(IMPORTS)) pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name), spec!)));
  }
  projects.push(modules);
}

const handlers = toMapperHandlers(standalone(loader));
const diagnostics = [];
for (const item of request.diagnostics ?? []) {
  write(item.dir, [...item.files, item.file]);
  const result = (await handlers.transform!({ fileName: path.join(item.dir, item.file.name), content: item.file.text })) as {
    diagnostics: { messageText: string; code: number; start: number; length: number }[];
  };
  diagnostics.push(result.diagnostics);
}

const require = createRequire(import.meta.url);
// The repository's own package, which resolves `dotschema/...` to its files by its own name.
const repository = createRequire(new URL("../../package.json", import.meta.url));
/** A module's code with each `dotschema/...` it imports resolved to the repository's file, which a `data:` URL cannot resolve. */
const linked = (code: string) => code.replace(/^(import [^;\n]* from )"(dotschema\/[^"]+)";$/gm, (_, head: string, specifier: string) => `${head}${JSON.stringify(pathToFileURL(repository.resolve(specifier)).href)};`);
/** A format of numbers (`int32`) checks a number; every other format a string. */
const isNumberFormat = (name: string): boolean => (formatDefinition(name) as { type?: string } | undefined)?.type === "number";

const verdicts = [];
for (const { format, example } of request.formats ?? []) {
  if (!(format in FORMATS)) {
    verdicts.push({ format, ok: false, why: "dotschema has no such format" });
    continue;
  }
  const value = isNumberFormat(format) ? Number(example) : example;
  const { code, problems } = schemaCode(JSON.stringify({ format }), path.join(process.cwd(), "format.schema.jsonc"));
  if (problems.length) {
    verdicts.push({ format, ok: false, why: problems.map((p) => p.message).join("; ") });
    continue;
  }
  const module = (await import(`data:text/javascript;base64,${Buffer.from(linked(code)).toString("base64")}`)) as { default: { is(value: unknown): boolean } };
  verdicts.push({ format, ok: module.default.is(value), why: `${JSON.stringify(value)} is refused` });
}

// ajv's class for each draft dotschema reads: 2020-12, 2019-09, and draft-07, which reads draft-06 too.
type AjvClass = new (options: object) => { RULES: { keywords: Record<string, unknown> } };
const AJV_ONLY = new Set(["$async", "nullable", "id"]);
const keywords = request.keywords
  ? [
      ...new Set([
        ...["ajv/dist/2020", "ajv/dist/2019", "ajv"].flatMap((entry) => {
          const mod = require(entry) as AjvClass & { default?: AjvClass };
          const Ajv = mod.default ?? mod;
          return Object.keys(new Ajv({ strict: false, logger: false }).RULES.keywords).filter((name) => !AJV_ONLY.has(name));
        }),
        "$anchor",
      ]),
    ]
  : undefined;

// dotschema's own files, its run time and formats, which an app's bundle holds from its one package.
const SOURCES = path.resolve(import.meta.dirname, "../../src") + path.sep;
/** The metafile with every input from dotschema's src/ counted as one, `dotschema`, in each output. */
function grouped(metafile: esbuild.Metafile, dir: string): esbuild.Metafile {
  const outputs = Object.fromEntries(
    Object.entries(metafile.outputs).map(([name, output]) => {
      const inputs: Record<string, { bytesInOutput: number }> = {};
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        const key = path.resolve(dir, input).startsWith(SOURCES) ? "dotschema" : input;
        inputs[key] = { bytesInOutput: (inputs[key]?.bytesInOutput ?? 0) + bytesInOutput };
      }
      return [name, { ...output, inputs }];
    }),
  );
  return { ...metafile, outputs };
}

const bundles = [];
for (const item of request.bundles ?? []) {
  write(item.dir, [...item.files, item.entry]);
  if (item.validators) writeFileSync(path.join(item.dir, "package.json"), JSON.stringify({ dotschema: { validators: item.validators } }) + "\n");
  const result = await esbuild.build({
    absWorkingDir: item.dir,
    entryPoints: [item.entry.name],
    bundle: true,
    platform: "node",
    format: "esm",
    minify: true,
    write: false,
    metafile: true,
    logLevel: "silent",
    outfile: path.posix.join("dist", item.entry.name.replace(/\.[^.]+$/, ".mjs")),
    plugins: [dotschema()],
  });
  bundles.push(await esbuild.analyzeMetafile(grouped(result.metafile, item.dir)));
}

process.stdout.write(JSON.stringify({ projects, diagnostics, formats: request.formats ? { all: Object.keys(FORMATS), verdicts } : undefined, keywords, bundles }));
