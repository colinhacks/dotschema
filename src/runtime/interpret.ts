// `dotschema/runtime/interpret`, the run time of a module whose project sets `"validators":
// "interpret"` or `"aot"` (src/settings.ts), and of every module where the package's `workerd`,
// `edge-light` or `react-native` condition holds: each validator's check is the engine's interpreter,
// or, in a module built with `"aot"`, the code the engine's generator wrote into the module when it
// was built, linked to the compiled schema. It never generates code at run time, and does not carry
// the generator.
import type { Draft, FormatDefinition } from "../engine/index.ts";
import { link } from "../engine/link.ts";
import { define, type Fast, type ModuleOptions, type Resource } from "./make.ts";

export { pre, post, postOne } from "./output.ts";

const fast: Fast = (validator, factory) => (factory ? link(validator, factory) : validator.check);

/** A schema module's run time: its draft, its schema resources, the root's first, the formats they use, and what the run time reads beside them; it gives each entry, the root and each definition. */
export const schemaModule = (draft: Draft, resources: readonly Resource[], formats: Readonly<Record<string, FormatDefinition>>, options?: ModuleOptions) => define(fast, draft, resources, formats, options);
