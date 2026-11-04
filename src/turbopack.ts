// The webpack loader under Turbopack's name, for Next.js, which runs webpack loaders:
//   turbopack: { rules: { "*.schema.jsonc": { loaders: ["dotschema/turbopack"], as: "*.js" } } }
// withDotschema (dotschema/next) writes that rule for a Next.js project. Turbopack resolves the run
// time a module imports from the schema's file (universal.ts, toWebpackLoader).
import { standalone } from "./core/standalone.ts";
import { toWebpackLoader } from "./core/universal.ts";
import { loader } from "./loader.ts";

export default toWebpackLoader(standalone(loader), { resolve: false });
