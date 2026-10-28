<h1 align="center">dotschema</h1>

<p align="center">Import JSON Schemas into TypeScript. Fully typed, scary fast.</p>

<p align="center">
  <a href="https://github.com/colinhacks/dotschema/actions/workflows/test.yml"><img src="https://github.com/colinhacks/dotschema/actions/workflows/test.yml/badge.svg?branch=main" alt="test status" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/github/license/colinhacks/dotschema?style=flat" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/dotschema"><img src="https://img.shields.io/npm/v/dotschema" alt="npm version" /></a>
</p>

<p align="center"><b><a href="https://dotschema.dev">Documentation</a></b></p>

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
  data; // { name: string; role?: "admin" | "member" }
}
```

It's powered by TypeScript's [_content mappers_](https://github.com/microsoft/typescript-go/pull/4712) (introduced in TypeScript 7.1), which let a package give `tsc` the types of a file it imports. The validator is compiled by [ajv](https://ajv.js.org) when the module is built, so a bundle carries the validator and no validator library.

## Setup

You'll need TypeScript 7.1 (currently in beta) and Node 24 or later:

```sh
npm install -D dotschema typescript@beta
```

An app that runs under the preload, not as a bundle, builds each schema's module at run time, so it installs dotschema as a dependency: `npm install dotschema`.

Add dotschema to `tsconfig.json` as a content mapper:

```jsonc
// tsconfig.json
{
  "compilerOptions": { /* ... */ },
  "contentMappers": [
    { "package": "dotschema", "extensions": [".schema.jsonc"] }
  ]
}
```

> [!NOTE]
> A schema can also be written in JSON5, as a `.schema.json5` file: add `.schema.json5` to the `extensions` list.

Then type-check with `--runExternalCode`, which lets `tsc` run content mappers:

```jsonc
// package.json
{
  "scripts": {
    "typecheck": "tsc --noEmit --runExternalCode"
  }
}
```

Load dotschema wherever your code runs, so that a schema import works at run time too:

| Runtime or bundler | Setup |
| --- | --- |
| Node | `node --import dotschema/register main.ts` ([setup](https://dotschema.dev/#setup-node)) |
| Bun | `preload = ["dotschema/register"]` in `bunfig.toml` ([setup](https://dotschema.dev/#setup-bun)) |
| nub | `"preload": ["dotschema/register"]` in `nub.jsonc` ([setup](https://dotschema.dev/#setup-nub)) |
| Vite, Vitest, Rollup, Rolldown | `import dotschema from "dotschema/vite"`, then `dotschema()` in `plugins` ([setup](https://dotschema.dev/#setup-vite)) |
| Next.js | `import { withDotschema } from "dotschema/next"`, then `export default withDotschema(nextConfig)` ([setup](https://dotschema.dev/#setup-nextjs)) |
| esbuild, `Bun.build` | `import dotschema from "dotschema/esbuild"`, then `dotschema()` in `plugins` ([setup](https://dotschema.dev/#setup-esbuild)) |
| webpack, Rspack | `use: "dotschema/webpack"` in a rule for the schema files, in `module.rules` ([setup](https://dotschema.dev/#setup-webpack)) |
| Cloudflare Workers | dotschema's Vite plugin beside Cloudflare's ([setup](https://dotschema.dev/#setup-cloudflare-workers)) |
| Jest | `"dotschema/jest"` in `transform`, for the schema files ([setup](https://dotschema.dev/#setup-jest)) |

Your editor types schema imports through the TypeScript 7.1 language server, with content mappers on: in VS Code and Cursor, the **TypeScript 7** extension pointed at your project's TypeScript, and in Zed, the **TypeScript Language Server** extension. The settings for each are in [Editors](https://dotschema.dev/#editors).

## Documentation

The rest is on [dotschema.dev](https://dotschema.dev):

- [Usage](https://dotschema.dev/#usage): `.validate()`, `.is()`, `.pick()`, `.omit()`, `.partial()`, `.required()` and `.keyof()`, definitions, and Standard Schema
- [Inference](https://dotschema.dev/#inference): the type each shape of schema gives, a `$ref` to another file, and every [format](https://dotschema.dev/#formats) the validator checks
- [Doc comments](https://dotschema.dev/#doc-comments): a schema's comments, `description` and tags on the type
- [Errors](https://dotschema.dev/#errors): an invalid schema as a type error
- [Reference](https://dotschema.dev/#reference): what [every keyword](https://dotschema.dev/#keywords) does to the type, and the drafts
- [FAQ](https://dotschema.dev/#faq)

## License

MIT
