# dotschema

Import a JSON Schema file into TypeScript and get the type it describes and a validator for it.

It's powered by TypeScript's [_content mappers_](https://github.com/microsoft/typescript-go/pull/4712) (introduced in TypeScript 7.1), which let a package give `tsc` the types of a file it imports. The validator is compiled by [ajv](https://ajv.js.org) when the module is built, so a bundle carries the validator and no validator library.

## Setup

```sh
npm install -D dotschema typescript@next
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

### Bun

Bun loads the same preload with `--preload`:

```sh
bun --preload dotschema/register main.ts
```

## Usage

A `.schema.jsonc` file holds a JSON Schema, with comments allowed:

```jsonc
{
  // a user of the app
  "type": "object",
  "properties": {
    "name": { "type": "string", "minLength": 1 },
    "role": { "enum": ["admin", "member"] }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

Importing it gives a validator, whose `.validate()` method returns the value or every issue:

```ts
import user from "./user.schema.jsonc";

const result = user.validate(input);
if (result.issues) {
  // for { name: "" }:
  // [{ message: "must NOT have fewer than 1 characters", path: ["name"], keyword: "minLength" }]
  console.log(result.issues);
} else {
  result.value; // { name: string; role?: "admin" | "member" }
}
```

The `.is()` method checks a value and narrows it:

```ts
if (user.is(input)) {
  input.role; // "admin" | "member" | undefined
}
```

The type is the export `Type`:

```ts
import type { Type as User } from "./user.schema.jsonc";

const ada: User = { name: "Ada", role: "admin" };
const bob: User = { name: "Bob", role: "owner" }; // type error
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
import type { Type as Team } from "./team.schema.jsonc";

type Members = Team["members"]; // User[]
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
