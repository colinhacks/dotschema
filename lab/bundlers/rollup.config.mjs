// Rollup bundles main.js into dist/rollup/main.mjs, each schema through dotschema/vite.
import dotschema from "dotschema/vite";

export default {
  input: `${import.meta.dirname}/main.js`,
  plugins: [dotschema()],
  output: { file: `${import.meta.dirname}/dist/rollup/main.mjs`, format: "es" },
};
