// Bundles main.ts with Motherload's and dotschema's esbuild plugins into dist/main.mjs; the order of
// the two plugins is the first argument, "motherload-first" or "dotschema-first".
import { build } from "esbuild";
import motherload from "motherload/esbuild";
import dotschema from "dotschema/esbuild";

const plugins = process.argv[2] === "dotschema-first" ? [dotschema(), motherload()] : [motherload(), dotschema()];
const result = await build({ entryPoints: [new URL("./main.ts", import.meta.url).pathname], outfile: new URL("./dist/main.mjs", import.meta.url).pathname, bundle: true, format: "esm", platform: "node", plugins, logLevel: "warning", metafile: true });
const inputs = Object.keys(result.metafile.inputs);
console.log(`errors=${result.errors.length} inputs=${inputs.length} node_modules=${inputs.filter((i) => i.includes("node_modules")).length}`);
