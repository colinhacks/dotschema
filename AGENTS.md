# Agent notes

Read [PLAN.md](./PLAN.md) first: what dotschema is, what the maintainer decided, the steps, and what is open. [DESIGN.md](./DESIGN.md) holds one section per design decision with its alternatives and evidence; a change to a decision updates its section.

The dotschema package types `.schema.jsonc` and `.schema.json5` imports: each becomes the TypeScript type its JSON Schema describes plus a validator compiled by ajv. It is a TypeScript 7.1 content mapper, a preload and an esbuild plugin, taken out of Motherload (`~/Documents/motherload`) on 2026-10-21. Motherload, the data loaders, is its sibling: read its repository, do not write to it. The two share a protocol for loaders in one host, whose global keys are Motherload's ([DESIGN.md](./DESIGN.md#the-shared-protocol)); a change to it is made in both.

## Layout

| Path | What it is |
| --- | --- |
| `src/schema.ts` | The module a schema file becomes: `.validate()` and `.is()`, each with its own ajv standalone validator, inlined with the helpers they require; the `contains` guard; the discriminators added to the copy ajv compiles; the types' text |
| `src/schema-types.ts` | The emitter: a JSON Schema as TypeScript declarations |
| `src/refs.ts` | The `$ref`s a schema follows into other schema files, and the problems of `$dynamicRef` and of an `$id` below a file's root |
| `src/json-schema.ts` | The schema as one self-contained JSON Schema in draft-07 or 2020-12, for Standard JSON Schema |
| `src/parse.ts` | The two dialects, JSONC and JSON5, read with their positions kept |
| `src/index.ts` | The types: `Schema`, `SchemaResult`, `SchemaIssue`, and the Standard Schema and Standard JSON Schema v1 interfaces |
| `src/loader.ts`, `src/mapper.ts`, `src/register.ts`, `src/esbuild.ts` | The loader and its entry points: the content mapper process, the preload (`dotschema/register`) and the esbuild plugin (`dotschema/esbuild`) |
| `src/core/` | The part of Motherload's `@motherload/core` the schema code uses, copied at d21b5ac: the loader contract and its adapters for Node, Bun, esbuild and the content mapper (`universal.ts`), the JSON-RPC server (`rpc.ts`), the serializer (`serialize.ts`), problems and codes (`problems.ts`), and a loader as a package serves it (`standalone.ts`) |
| `tests/` | The node tests. `tests/interop.test.ts` checks the shared protocol against a stand-in for Motherload's `.jsonc` loader (`tests/standin.ts`); `tests/motherload.test.ts` checks it against a real Motherload checkout when `MOTHERLOAD_DIR` names one, and is skipped otherwise. Fixtures: `tests/fixtures/errors` (broken schemas), `tests/fixtures/declaration` (a library that re-exports schema modules), `tests/fixtures/json-schema`, `tests/fixtures/interop` and `tests/fixtures/motherload` |
| `lab/basic/` | A project that imports every kind of schema: type-checked through the content mapper, run under the preload, bundled with esbuild; `team.schema.jsonc` refers to `user.schema.jsonc` and to `shared/place.schema.jsonc`, which nothing else imports, and `event.schema.jsonc` is a discriminated union that `main.ts` narrows |
| `scripts/build.ts`, `tsconfig.build.json` | `nub run build`: the package compiled into `dist/dotschema`, with a manifest naming the compiled files and exact dependency versions, published with `npm publish dist/dotschema` |
| `scripts/check-dist.ts` | `nub run check-dist`, after a build: the package packed, installed from the tarball into copies of `lab/basic` and `tests/fixtures/declaration` outside the repository, then type-checked, preloaded and bundled there, and `lab/basic` once more in a hoisted layout beside ajv 6; needs the npm registry |
| `README.md` | The only documentation, also published to npm: absolute links only, and nothing about the repository's internals |

The `package.json` links `dotschema` to the repository itself (`link:.`), because a mapper package does not resolve through self-reference. It is private and points at the TypeScript sources; only `dist/dotschema` is published.

## JavaScript: nub

Prefer `nub` over `node`, `bun`, `npm`, `npx`, `pnpm` and `yarn`: run files with `nub <file>`, package scripts with `nub run <script>`, local CLIs with `nubx <tool>`, installs with `nub install` and `nub add`. The lockfile is `pnpm-lock.yaml`, which nub reads and keeps.

- Running `nub run typecheck` type-checks the sources and runs the content mapper on `lab/basic` (`tsc --runExternalCode`).
- Running `nub run test` runs `tests/**/*.test.ts` with `node --test`. With `MOTHERLOAD_DIR` set to a Motherload checkout with its dependencies installed, it also runs the interop test against it: `MOTHERLOAD_DIR=~/Documents/motherload nub run test`.
- Running `nub run build` writes `dist/`, and `nub run check-dist` then installs it outside the repository and runs it.
- Setting `TS_CONTENT_MAPPER_DEBUG=1` on `nubx tsc -p lab/basic/tsconfig.json --noEmit --runExternalCode` prints the JSON-RPC traffic.
- The nub installer refuses a package version younger than 24 hours (`minimumReleaseAge`); the TypeScript nightly is pinned to the one Motherload pins. Do not bypass the gate.

## Git

Work lands on `main` directly, with no branch or pull request. When a task is done and `nub run typecheck` and `nub run test` pass, commit it to `main`. The repository has no remote yet ([PLAN.md](./PLAN.md#open)); once it has one, push to it. Several sessions can work in this checkout at once, so stage only the files the task changed. A commit message is one prose paragraph: what changed, why (quoting the maintainer where the maintainer asked for it), and what was verified.

## Writing conventions

The product is dotschema, lowercase, in prose; `dotschema` in code is the package, the import specifier, the diagnostic source and the Standard Schema vendor. Never hard-wrap Markdown: every paragraph, list item and table row is one line. Write a method with its dot and parentheses, `.is()` and `.validate()`, never a bare `is`. Never open a sentence with inline code: a word that names the thing leads, as in "The `$schema` keyword picks the draft". In the README, show a behavior as an example, a sentence that leads into its own code block, one fact to each example (the maintainer, 2026-10-21: "It's just one piece of information at a time, always."), and leave out what a reader does not need: an edge case, a rule ajv or TypeScript already enforces, a reason behind a name. Never put three paragraphs in a row, and never a list of dense rules with code inline in place of examples (the maintainer, 2026-10-21, of such a list in Motherload's docs: "not acceptable. It's just not even needed ... Just break up that section into a series of examples with different code blocks ... The vast majority of that does not need to be stated"). A fact the README leaves out stays in DESIGN.md. Never estimate developer time. Anything stated as fact traces to a file read or a command run; a guess goes in PLAN.md's Open section as a question.
