<h1 align="center">dotschema</h1>

<p align="center">Import <code>.schema.jsonc</code> files into TypeScript, fully typed</p>

<p align="center">
  <a href="https://github.com/colinhacks/dotschema/actions/workflows/test.yml"><img src="https://github.com/colinhacks/dotschema/actions/workflows/test.yml/badge.svg?branch=main" alt="test status" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/github/license/colinhacks/dotschema?style=flat" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/dotschema"><img src="https://img.shields.io/npm/v/dotschema" alt="npm version" /></a>
</p>

<br/>

<p align="center">
  <img src="https://raw.githubusercontent.com/colinhacks/dotschema/main/assets/readme-demo.gif" alt="An editor: hovering a value that user.is() narrowed shows its type, which follows the JSON Schema as the schema changes" />
</p>

<br/>

If you have a JSON Schema like this:

```jsonc
// user.schema.jsonc
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "role": { "enum": ["admin", "member"] }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

You can import it directly from a TypeScript file, and get its type and a validator:

```ts
// main.ts
import user from "./user.schema.jsonc";

const data = await request.json();

if (user.is(data)) {
  data; // { name: string; role?: "admin" | "member" | undefined }
}
```

It's powered by TypeScript's [_content mappers_](https://github.com/microsoft/typescript-go/pull/4712) (introduced in TypeScript 7.1), which let a package give `tsc` the types of a file it imports. The validator is compiled by [ajv](https://ajv.js.org) when the module is built, so a bundle carries the validator and no validator library.

## Setup

```sh
npm install -D dotschema typescript@beta
```

The package needs Node 24 or later. An application that runs under the preload instead of a bundle loads dotschema at run time, so it lists `dotschema` in `dependencies`.

### TypeScript

Add dotschema to `tsconfig.json` as a content mapper:

```jsonc
{
  "contentMappers": [
    { "package": "dotschema", "extensions": [".schema.jsonc"] }
  ]
}
```

Type-check with `--runExternalCode`, without which `tsc` skips content mappers:

```sh
tsc --noEmit --runExternalCode
```

### Node

Node loads dotschema with `--import`, which turns each schema file into a module as it loads:

```sh
node --import dotschema/register main.ts
```

### Bun

Bun loads the same preload from `bunfig.toml`, for `bun main.ts` and, under `[test]`, for `bun test`:

```toml
preload = ["dotschema/register"]

[test]
preload = ["dotschema/register"]
```

Bun's bundler takes the esbuild plugin:

```ts
import dotschema from "dotschema/esbuild";

await Bun.build({
  entrypoints: ["main.ts"],
  target: "bun",
  plugins: [dotschema()],
  outdir: "dist",
});
```

### nub

nub loads the preload from `nub.jsonc`, for `nub main.ts` and `nub --test`:

```jsonc
{
  "preload": ["dotschema/register"]
}
```

### Vite

Add the Vite plugin to `vite.config.ts`, which builds each schema's module in the dev server and in the build, for the browser and for the server:

```ts
import { defineConfig } from "vite";
import dotschema from "dotschema/vite";

export default defineConfig({
  plugins: [dotschema()],
});
```

Vitest takes the same plugin, so a test imports schemas too.

Rollup and Rolldown take the same plugin, in `rollup.config.mjs` or `rolldown.config.mjs`:

```js
import dotschema from "dotschema/vite";

export default {
  input: "main.js",
  plugins: [dotschema()],
  output: { file: "dist/main.mjs", format: "es" },
};
```

### Next.js

Wrap the config in `next.config.ts` with `withDotschema`, which loads schemas with Turbopack and with webpack, on the server and in the browser:

```ts
import type { NextConfig } from "next";
import { withDotschema } from "dotschema/next";

const nextConfig: NextConfig = {
  // ...
};

export default withDotschema(nextConfig);
```

Next.js type-checks without `--runExternalCode`, so `withDotschema` turns that check off and runs `tsc --noEmit --runExternalCode` inside `next build` in its place.

To type-check without building, the `typecheck` script in `package.json` runs `next typegen` first, which writes the route types:

```json
{
  "scripts": {
    "typecheck": "next typegen && tsc --noEmit --runExternalCode"
  }
}
```

Beside Motherload's `withMotherload` or Reylo's `withReylo`, the wrappers nest in either order:

```ts
export default withMotherload(withDotschema(nextConfig));
```

### esbuild

The esbuild plugin builds each schema's module at build time, so a bundled app needs no preload:

```js
import * as esbuild from "esbuild";
import dotschema from "dotschema/esbuild";

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  plugins: [dotschema()],
  outfile: "dist/main.mjs",
});
```

### webpack and Rspack

webpack and Rspack load schema files with dotschema's loader, in a rule of `webpack.config.mjs` or `rspack.config.mjs`:

```js
export default {
  // ...
  module: {
    rules: [{ test: /\.schema\.(jsonc|json5)$/, use: "dotschema/webpack" }],
  },
};
```

### Cloudflare Workers

A Worker is built with Vite, with dotschema's plugin beside Cloudflare's in `vite.config.ts`:

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import dotschema from "dotschema/vite";

export default defineConfig({
  plugins: [dotschema(), cloudflare()],
});
```

Deploy with `wrangler deploy` after `vite build`, since Wrangler's own bundler takes no plugin.

### Jest

Jest takes dotschema's transformer in `jest.config.js`:

```js
export default {
  transform: { "\\.schema\\.(jsonc|json5)$": "dotschema/jest" },
  extensionsToTreatAsEsm: [".jsonc", ".json5"],
};
```

Jest runs ES modules only behind a Node flag:

```sh
NODE_OPTIONS=--experimental-vm-modules npx jest
```

Jest runs the first pattern that matches a file, so beside another transformer for `.jsonc` or `.json5`, such as Motherload's, dotschema's pattern comes first:

```js
export default {
  transform: {
    "\\.schema\\.(jsonc|json5)$": "dotschema/jest",
    "\\.(jsonc|json5)$": "motherload/jest",
  },
};
```

### Editors

The editor types schema imports through the TypeScript 7.1 language server, with content mappers on.

In VS Code or Cursor, install the **TypeScript 7** extension (`TypeScriptTeam.native-preview`) and point it at the project's TypeScript, since the extension's own copy is TypeScript 7.0, which has no content mappers:

```jsonc
// .vscode/settings.json
{
  "js/ts.experimental.useTsgo": true,
  "js/ts.tsdk.path": "./node_modules/typescript"
}
```

Then trust the workspace, and click **Allow** when the extension asks to use the workspace's TypeScript. Content mappers run in a trusted workspace only.

In Zed, install the **TypeScript Language Server** extension by Zed Industries (search for "tsgo"), point it at the project's TypeScript with content mappers on, and trust the folder:

```jsonc
// .zed/settings.json
{
  "languages": {
    "TypeScript": {
      "language_servers": ["typescript-ls", "!vtsls", "!typescript-language-server", "..."]
    },
    "TSX": {
      "language_servers": ["typescript-ls", "!vtsls", "!typescript-language-server", "..."]
    }
  },
  "lsp": {
    "typescript-ls": {
      // the extension's own download is TypeScript 7.0, which has no content mappers
      "binary": {
        "path": "node_modules/typescript/bin/tsc",
        "arguments": ["--lsp", "--stdio"]
      },
      "initialization_options": { "runExternalCode": true }
    }
  }
}
```

Zed doesn't send schema files to the language server, so an error inside one shows only in the type check.

## Usage

The `.validate()` method returns the value or every issue:

```ts
import user from "./user.schema.jsonc";

const result = user.validate(input);
if (result.issues) {
  // for { name: "" }:
  // [{ message: "must NOT have fewer than 1 characters", path: ["name"], keyword: "minLength" }]
  console.log(result.issues);
} else {
  result.value; // { name: string; role?: "admin" | "member" | undefined }
}
```

The type is `.Type` on the import:

```ts
import user from "./user.schema.jsonc";

const ada: user.Type = { name: "Ada", role: "admin" };
const bob: user.Type = { name: "Bob", role: "owner" }; // type error
```

A `/** */` comment above a property is its doc comment, which an editor shows on hover:

```jsonc
{
  "type": "object",
  "properties": {
    /** The name the user signs in with. */
    "name": { "type": "string" }
  }
}
```

```ts
if (user.is(input)) {
  input.name; // the hover shows "The name the user signs in with."
}
```

A `$ref` can point to another schema file, by a path relative to this one:

```jsonc
{
  "type": "object",
  "properties": {
    "members": {
      "type": "array",
      "items": { "$ref": "./user.schema.jsonc" }
    }
  },
  "required": ["members"]
}
```

```ts
import team from "./team.schema.jsonc";

type Members = team.Type["members"]; // User[]
```

Each entry of `$defs` is a validator of its own, imported by its key:

```jsonc
// place.schema.jsonc
{
  "type": "object",
  "properties": { "home": { "$ref": "#/$defs/address" } },
  "$defs": {
    "address": {
      "type": "object",
      "properties": { "city": { "type": "string" } },
      "required": ["city"]
    }
  }
}
```

```ts
import { address } from "./place.schema.jsonc";

if (address.is(input)) {
  input.city; // string
}
```

The `.pick()` method gives the schema with only the properties named, and `.omit()` the schema without them:

```ts
import user from "./user.schema.jsonc";

const named = user.pick("name");
named.validate({ name: "Ada", role: "admin" });
// { issues: [{ message: "must NOT have additional properties", path: ["role"], keyword: "additionalProperties" }] }
```

Its type is the output of a Standard Schema:

```ts
import type { StandardSchemaV1 } from "dotschema";

type Named = StandardSchemaV1.InferOutput<typeof named>; // { name: string }
```

A `oneOf` whose variants a `const` tells apart is a union that narrows:

```jsonc
{
  "type": "object",
  "oneOf": [
    {
      "properties": { "kind": { "const": "click" }, "x": { "type": "number" } },
      "required": ["kind", "x"]
    },
    {
      "properties": { "kind": { "const": "visit" }, "url": { "type": "string" } },
      "required": ["kind", "url"]
    }
  ]
}
```

```ts
import event from "./event.schema.jsonc";

if (event.is(input)) {
  if (input.kind === "click") {
    input.x; // number
  } else {
    input.url; // string
  }
}
```

The module is a [Standard Schema](https://standardschema.dev), so a library that accepts one accepts it:

```ts
user["~standard"].validate(input); // the same function as user.validate
```

It is a Standard JSON Schema too, which gives the schema as one document in draft-07 or 2020-12, with every file it refers to folded in:

```ts
import team from "./team.schema.jsonc";

team["~standard"].jsonSchema.input({ target: "draft-2020-12" });
// { $schema: "https://json-schema.org/draft/2020-12/schema", ..., $defs: { user: { ... } } }
```

The `$schema` keyword picks the draft: 06, 07, 2019-09 or 2020-12, and draft-07 when there is none.

> [!NOTE]
> A schema can also be written in JSON5, as a `.schema.json5` file: add `.schema.json5` to the `extensions` list.

## Errors

An invalid schema is a type error, at its place in the file:

```
$ tsc --noEmit --runExternalCode
team.schema.jsonc:6:27 - error dotschema4: The $ref "./member.schema.jsonc" names a file that does not exist.

6       "items": { "$ref": "./member.schema.jsonc" }
                            ~~~~~~~~~~~~~~~~~~~~~
```

## License

MIT
