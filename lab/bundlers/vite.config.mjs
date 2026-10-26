// Vite builds main.js for Node into dist/vite/main.mjs, each schema through dotschema/vite.
import dotschema from "dotschema/vite";

export default {
  root: import.meta.dirname,
  logLevel: "warn",
  plugins: [dotschema()],
  build: { ssr: "main.js", outDir: "dist/vite", emptyOutDir: true, rollupOptions: { output: { entryFileNames: "main.mjs" } } },
};
