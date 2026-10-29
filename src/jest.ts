// The Jest transformer: `transform: { "\\.schema\\.jsonc$": "dotschema/jest" }` in Jest's config,
// before any pattern for `.jsonc`, since Jest runs the first that matches.
import { standalone } from "./core/standalone.ts";
import { toJestTransformer } from "./core/universal.ts";
import { loader } from "./loader.ts";

export default toJestTransformer(standalone(loader));
