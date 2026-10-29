// Each definition of a schema file as a validator of its own, a named export of its module
// (src/schema.ts, DESIGN.md "Each definition a validator"): its name, its validators, its Standard
// JSON Schema, and a bundle that leaves out what nothing imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { schemaCode, schemaTypes } from "../src/schema.ts";
import { evaluate, ROOT, withFormats } from "./helpers.ts";

const require = createRequire(import.meta.url);
const PATH = join(ROOT, "tests/fixtures/definitions.schema.jsonc");
const D2020 = "https://json-schema.org/draft/2020-12/schema";

const load = async (schema: string, path = PATH) => {
  const { code, problems } = schemaCode(schema, path);
  assert.deepEqual(problems, []);
  return evaluate(code);
};

/** ajv with dotschema's options, for the draft of a converted schema. */
function ajvFor(schema: { $schema: string }) {
  const mod = require(schema.$schema.includes("2020-12") ? "ajv/dist/2020" : "ajv");
  const Ajv = mod.default ?? mod;
  const ajv = new Ajv({ allErrors: true, strict: false, logger: false, ownProperties: true, multipleOfPrecision: 7 });
  return withFormats(ajv).compile(schema);
}

test("each definition is a named export, its name the key in camelCase, never a reserved word or a name taken", async () => {
  const definitions = {
    address: { type: "object", properties: { city: { type: "string", minLength: 1 } }, required: ["city"], additionalProperties: false },
    "my-address": { type: "string" },
    myAddress: { type: "number" },
    HTTPServer: { const: "h" },
    URL: { const: "u" },
    default: { const: "d" },
    delete: { const: "x" },
    schema: { const: "s" },
    string: { const: "t" },
    "2fa": { const: 2 },
    "--": { const: "-" },
    __proto__x: { const: "p" },
    yes: true,
    no: false,
    input: { const: "i" },
    output: { const: "o" },
  };
  const source = JSON.stringify({ $schema: D2020, type: "object", properties: { home: { $ref: "#/$defs/address" } }, $defs: definitions });
  const module = await load(source);
  const names = Object.keys(module).filter((name) => name !== "default");
  assert.deepEqual(names.sort(), ["address", "definition", "default_", "delete_", "httpServer", "myAddress", "myAddress2", "no", "protoX", "schema_", "string_", "url", "yes", "_2fa2", "input2", "output2"].sort());
  const { types, problems } = schemaTypes(source, PATH);
  assert.deepEqual(problems, []);
  // The type of "2fa" is `_2fa`, so its validator takes `_2fa2`; each carries its type as `.output` and `.input`.
  assert.match(types, /\nexport declare const _2fa2: __DotschemaSchema<2, Json\["\$defs"\]\["2fa"\]>;\nexport declare namespace _2fa2 \{ export type \{ _2fa as output \}; export type input = _2fa; \}/);
  // The root's types are `output` and `input`, so the validators of "input" and "output" take `input2` and `output2`.
  assert.match(types, /\nexport declare const input2: __DotschemaSchema<"i", Json\["\$defs"\]\["input"\]>;\nexport declare namespace input2 \{ export type \{ Input as output \}; export type input = Input; \}/);
  // The root is open, so the values `.validate()` accepts are typed apart, `DefinitionsInput`, which
  // refers to `Address` itself, a definition whose input is its output.
  assert.match(types, /\nexport type \{ Definitions as output \};\ninterface DefinitionsInput \{\n  home\?: Address \| undefined;\n[^]*?\n\}\nexport type \{ DefinitionsInput as input \};\n/);
  assert.match(types, /\nexport declare const myAddress2: __DotschemaSchema<number, Json\["\$defs"\]\["myAddress"\]>;/);
  assert.match(types, /\nexport declare const address: __DotschemaObjectSchema<\{\n  city: string;\n\}, Json\["\$defs"\]\["address"\], "city">;\nexport declare namespace address \{ export type \{ Address as output \}; export type input = Address; \}/);
  // Each validates as its definition does, on its own.
  assert.deepEqual([module.address.is({ city: "Paris" }), module.address.is({ city: "" }), module.myAddress2.is(1), module.myAddress.is(1), module.default_.is("d"), module.yes.is(1), module.no.is(1)], [true, false, true, false, true, true, false]);
  assert.deepEqual(module.address.validate({}).issues, [{ message: "must have required property 'city'", path: ["city"], keyword: "required" }]);
  assert.deepEqual(module.address.schema, definitions.address);
  // Every name is a binding the module exports and the CommonJS rewrite keeps.
  for (const name of names) assert.match(name, /^[A-Za-z_]\w*$/);
});

test("a definition's Standard JSON Schema is the definition at the root, with what it refers to folded in and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dotschema-definitions-"));
  const write = (name: string, schema: unknown) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), JSON.stringify(schema));
    return join(dir, name);
  };
  write("tag.schema.jsonc", { type: "string", minLength: 1 });
  write("unused.schema.jsonc", { type: "number" });
  const path = write("main.schema.jsonc", {
    $schema: D2020,
    type: "object",
    properties: { other: { $ref: "./unused.schema.jsonc" }, owner: { $ref: "#/$defs/owner" } },
    $defs: {
      owner: { type: "object", properties: { tag: { $ref: "./tag.schema.jsonc" }, boss: { $ref: "#/$defs/owner" }, pet: { $ref: "#/$defs/pet" } } },
      pet: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
      lonely: { type: "object", properties: { back: { $ref: "#" } } },
      island: { type: "boolean" },
    },
  });
  const module = await load(readFileSync(path, "utf8"), path);
  const owner = module.owner["~standard"].jsonSchema.input({ target: "draft-2020-12" });
  // Itself at the root, the definitions and the file it reaches beside it; the root, `island` and unused.schema.jsonc left out.
  assert.deepEqual(owner, {
    $schema: D2020,
    type: "object",
    properties: { tag: { $ref: "#/$defs/tag" }, boss: { $ref: "#" }, pet: { $ref: "#/$defs/pet" } },
    $defs: { pet: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, tag: { type: "string", minLength: 1 } },
  });
  // A definition that refers to the file's root has the root folded in under the file's name.
  const lonely = module.lonely["~standard"].jsonSchema.input({ target: "draft-07" });
  assert.equal(lonely.properties.back.$ref, "#/definitions/main");
  assert.deepEqual(Object.keys(lonely.definitions).sort(), ["main", "owner", "pet", "tag", "unused"].sort());
  // Each document validates as the definition's validator does.
  for (const [name, values] of [["owner", [{}, { tag: "" }, { boss: { pet: { name: 1 } } }, { pet: { name: "Rex" }, tag: "a" }, 5]], ["lonely", [{ back: {} }, { back: { other: "x" } }, { back: { owner: { tag: "" } } }]]] as const) {
    for (const target of ["draft-07", "draft-2020-12"] as const) {
      const check = ajvFor(module[name]["~standard"].jsonSchema.input({ target }));
      for (const value of values) assert.equal(module[name].is(value), check(value), `${name} ${target} ${JSON.stringify(value)}`);
    }
  }
});

test("a bundler leaves out a definition nothing imports, and the root when only a definition is imported", async () => {
  const { build } = require("esbuild");
  const { default: dotschema } = await import("../src/esbuild.ts");
  const bundle = async (contents: string) => {
    const result = await build({ stdin: { contents, resolveDir: join(ROOT, "lab/basic"), loader: "js" }, bundle: true, write: false, format: "esm", platform: "node", plugins: [dotschema()], logLevel: "silent" });
    return result.outputFiles[0].text as string;
  };
  const onlyDefault = await bundle('import user from "./user.schema.jsonc"; console.log(user.is({}));');
  const both = await bundle('import user, { address } from "./user.schema.jsonc"; console.log(user.is({}), address.is({}));');
  const onlyAddress = await bundle('import { address } from "./user.schema.jsonc"; console.log(address.is({}));');
  assert.doesNotMatch(onlyDefault, /__schema\["definitions"\]\["address"\]/);
  assert.match(both, /__schema\["definitions"\]\["address"\]/);
  assert.doesNotMatch(onlyAddress, /__make\(__validateAll/);
  assert.ok(onlyDefault.length < both.length && onlyAddress.length < both.length, `${onlyDefault.length} ${onlyAddress.length} ${both.length}`);
});
