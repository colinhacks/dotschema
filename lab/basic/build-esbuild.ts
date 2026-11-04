// Bundles main.ts with dotschema's esbuild plugin into dist/main.mjs, which imports nothing, and
// prints how many of the bundle's files are the project's, how many of those come from
// node_modules, and how many are dotschema's own run time, which each schema's module imports.
import { build } from "esbuild";
import dotschema from "dotschema/esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const result = await build({ entryPoints: [new URL("./main.ts", import.meta.url).pathname], outfile: new URL("./dist/main.mjs", import.meta.url).pathname, bundle: true, format: "esm", platform: "node", plugins: [dotschema()], logLevel: "warning", metafile: true });
// dotschema's files are those of its src/, where its run time is.
const own = resolve(dirname(fileURLToPath(import.meta.resolve("dotschema/runtime"))), "..");
const inputs = Object.keys(result.metafile.inputs).filter((input) => !resolve(input).startsWith(own));
console.log(`errors=${result.errors.length} inputs=${inputs.length} node_modules=${inputs.filter((i) => i.includes("node_modules")).length} dotschema=${Object.keys(result.metafile.inputs).length - inputs.length}`);
