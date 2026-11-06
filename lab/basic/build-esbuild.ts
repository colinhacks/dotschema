// Bundles main.ts with dotschema's esbuild plugin into dist/main.mjs, which imports nothing.
import { build } from "esbuild";
import dotschema from "dotschema/esbuild";

const result = await build({ entryPoints: [new URL("./main.ts", import.meta.url).pathname], outfile: new URL("./dist/main.mjs", import.meta.url).pathname, bundle: true, format: "esm", platform: "node", plugins: [dotschema()], logLevel: "warning", metafile: true });
const inputs = Object.keys(result.metafile.inputs);
console.log(`errors=${result.errors.length} inputs=${inputs.length} node_modules=${inputs.filter((i) => i.includes("node_modules")).length}`);
