// Rspack bundles main.js into dist/rspack/main.cjs, each schema through dotschema/webpack.
export default {
  mode: "production",
  context: import.meta.dirname,
  entry: "./main.js",
  target: "node",
  output: { path: `${import.meta.dirname}/dist/rspack`, filename: "main.cjs" },
  module: {
    rules: [
      { test: /\.schema\.jsonc$/, use: "dotschema/webpack" },
      // TypeScript, through Rspack's own SWC loader, as an Rspack project reads its own: dotschema's
      // run time, which each schema's module imports, is TypeScript in dotschema's repository.
      { test: /\.ts$/, loader: "builtin:swc-loader", options: { jsc: { parser: { syntax: "typescript" } } }, type: "javascript/auto" },
    ],
  },
};
