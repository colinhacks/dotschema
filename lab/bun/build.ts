// Bun.build bundles main.ts, lab/basic's main.ts and codecs/stamp.schema.jsonc, into dist/main.js with
// dotschema's esbuild plugin: `bun build.ts`.
import dotschema from "dotschema/esbuild";

const result = await Bun.build({ entrypoints: [`${import.meta.dir}/main.ts`], outdir: `${import.meta.dir}/dist`, target: "bun", plugins: [dotschema()] });
console.log(`success=${result.success} outputs=${result.outputs.map((output) => output.path.slice(import.meta.dir.length + 1)).join(",")}`);
for (const log of result.logs) console.log(log);
