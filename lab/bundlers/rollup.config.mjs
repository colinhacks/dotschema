// Rollup bundles main.js into dist/rollup/main.mjs, each schema through dotschema/vite.
import dotschema from "dotschema/vite";
import { stripTypeScriptTypes } from "node:module";

// Rollup reads no TypeScript, and dotschema's run time, which each schema's module imports, is
// TypeScript in dotschema's repository: Node strips its types, as a project's TypeScript plugin would.
const typescript = { name: "typescript", transform: (code, id) => (id.endsWith(".ts") ? { code: stripTypeScriptTypes(code), map: null } : null) };

export default {
  input: `${import.meta.dirname}/main.js`,
  plugins: [dotschema(), typescript],
  output: { file: `${import.meta.dirname}/dist/rollup/main.mjs`, format: "es" },
};
