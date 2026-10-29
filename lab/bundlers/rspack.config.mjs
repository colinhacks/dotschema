// Rspack bundles main.js into dist/rspack/main.cjs, each schema through dotschema/webpack.
export default {
  mode: "production",
  context: import.meta.dirname,
  entry: "./main.js",
  target: "node",
  output: { path: `${import.meta.dirname}/dist/rspack`, filename: "main.cjs" },
  module: {
    rules: [{ test: /\.schema\.jsonc$/, use: "dotschema/webpack" }],
  },
};
