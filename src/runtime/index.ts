// `dotschema/runtime`, the run time a schema module imports by default (`"validators": "jit"`, or no
// setting; src/settings.ts): each validator's check is code the engine's generator writes from the
// compiled schema and runs through `new Function`, the first time it is needed, and where the runtime
// refuses code generation from strings (a Cloudflare Worker, a page whose Content Security Policy has
// no `unsafe-eval`), the interpreter's check, as Zod falls back. Every error `.validate()` lists is the
// interpreter's. The package's `workerd`, `edge-light` and `react-native` conditions give
// `dotschema/runtime/interpret` in its place, which never asks.
import type { Draft, FormatDefinition } from "../engine/index.ts";
import { jit, link } from "../engine/generate.ts";
import { define, type Fast, type ModuleOptions, type Resource } from "./make.ts";

export { pre, post, postOne } from "./output.ts";

const fast: Fast = (validator, factory) => (factory ? link(validator, factory) : (jit(validator) ?? validator.check));

/** A schema module's run time: its draft, its schema resources, the root's first, the formats they use, and what the run time reads beside them; it gives each entry, the root and each definition. */
export const schemaModule = (draft: Draft, resources: readonly Resource[], formats: Readonly<Record<string, FormatDefinition>>, options?: ModuleOptions) => define(fast, draft, resources, formats, options);
