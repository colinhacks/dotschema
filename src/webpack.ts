// The webpack loader, for webpack and Rspack, which take a loader for a file type:
//   module.rules: [{ test: /\.schema\.jsonc$/, use: "dotschema/webpack" }]
// Next.js's Turbopack takes the same loader as dotschema/turbopack.
import { standalone } from "./core/standalone.ts";
import { toWebpackLoader } from "./core/universal.ts";
import { loader } from "./loader.ts";

export default toWebpackLoader(standalone(loader));
