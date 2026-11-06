// The webpack loader under Turbopack's name, for Next.js, which runs webpack loaders:
//   turbopack: { rules: { "*.schema.jsonc": { loaders: ["dotschema/turbopack"], as: "*.js" } } }
// withDotschema (dotschema/next) writes that rule for a Next.js project.
export { default } from "./webpack.ts";
