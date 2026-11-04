// Builds main.js with the bundler named on the command line (webpack, rspack, vite, vite-browser,
// rollup or rolldown) from its config file, and prints the build's errors, warnings, how many
// modules came from node_modules, and how many are dotschema's own run time, which each schema's
// module imports, from node_modules or not.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
const { default: config } = await import(`./${name}.config.mjs`);

/** The build's errors, warnings, and the ids of the modules in it. */
async function build() {
  if (name === "webpack" || name === "rspack") {
    const bundler = name === "rspack" ? (await import("@rspack/core")).rspack : (await import("webpack")).default;
    const stats = await new Promise((resolve, reject) => bundler(config, (error, stats) => (error ? reject(error) : resolve(stats))));
    // A module of several concatenated ones (`./main.js + 23 modules`) lists them in `modules`; Rspack
    // 2.2.9 names a module only with the stats' default fields, which `all: false` turns off.
    const { errors, warnings, modules } = stats.toJson({ errors: true, warnings: true, modules: true, nestedModules: true });
    const names = modules.flatMap((m) => [m.name, ...(m.modules ?? []).map((n) => n.name)]).filter((n) => typeof n === "string" && !/ \+ \d+ modules$/.test(n));
    return { errors: errors.map((e) => e.message), warnings: warnings.map((w) => w.message), ids: [...new Set(names)] };
  }
  const warnings = [];
  const onLog = (level, log) => void (level === "warn" && warnings.push(log.message));
  try {
    if (name.startsWith("vite")) {
      const { build } = await import("vite");
      const [output] = [await build({ ...config, configFile: false, customLogger: { info() {}, warn: (m) => warnings.push(m), warnOnce: (m) => warnings.push(m), error() {}, clearScreen() {}, hasErrorLogged: () => false, hasWarned: false } })].flat();
      return { errors: [], warnings, ids: output.output.flatMap((chunk) => chunk.moduleIds ?? []) };
    }
    const { [name]: bundle } = await import(name);
    const result = await bundle({ ...config, onLog });
    const { output } = await result.write(config.output);
    return { errors: [], warnings, ids: output.flatMap((chunk) => chunk.moduleIds ?? []) };
  } catch (error) {
    return { errors: [error.message], warnings, ids: [] };
  }
}

const { errors, warnings, ids } = await build();
for (const message of [...errors, ...warnings]) console.log(message);
// dotschema's files are those of its src/, where its run time is; webpack and Rspack name a module by its path from the config's context.
const own = resolve(dirname(fileURLToPath(import.meta.resolve("dotschema/runtime"))), "..");
const ours = (id) => typeof id === "string" && resolve(config.context ?? import.meta.dirname, id).startsWith(own);
console.log(`errors=${errors.length} warnings=${warnings.length} node_modules=${ids.filter((id) => /node_modules/.test(id) && !ours(id)).length} dotschema=${ids.filter(ours).length}`);
