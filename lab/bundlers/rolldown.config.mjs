// Rolldown bundles main.js into dist/rolldown/main.mjs, each schema through dotschema/vite.
import dotschema from "dotschema/vite";

export default {
  input: `${import.meta.dirname}/main.js`,
  platform: "node",
  plugins: [dotschema()],
  output: { file: `${import.meta.dirname}/dist/rolldown/main.mjs`, format: "es" },
};
