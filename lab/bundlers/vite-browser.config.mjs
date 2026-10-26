// Vite builds index.html for the browser into dist/vite-browser, each schema through dotschema/vite;
// main.js becomes dist/vite-browser/main.mjs, a module a browser loads and Node can run.
import dotschema from "dotschema/vite";

export default {
  root: import.meta.dirname,
  logLevel: "warn",
  plugins: [dotschema()],
  build: { outDir: "dist/vite-browser", emptyOutDir: true, modulePreload: false, rollupOptions: { output: { entryFileNames: "main.mjs" } } },
};
