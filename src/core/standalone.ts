// A loader as a package serves it: its own paths, and for any other path TypeScript routes to it (a
// tsconfig entry lists an extension the package does not read) a diagnostic naming what it does
// read. Motherload's `combine` and `standalone` (packages/core/src/module.ts at d21b5ac), for the
// one loader dotschema has.
import { CODES, type Problem } from "./problems.ts";
import type { LoaderPlugin } from "./universal.ts";

/** "a", "a and b", "a, b and c". */
const list = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Types for a file the loader does not read: the problem is the error, and every use of the module stays quiet. */
const FAILED_TYPES = "declare const data: any;\nexport default data;\n";

export function standalone(plugin: LoaderPlugin): LoaderPlugin {
  const unknown = (path: string): Problem => ({
    message: `${plugin.name} reads ${list(plugin.extensions)} files; ${path} is none of them. Remove its extension from ${plugin.name}'s contentMappers entry.`,
    start: 0,
    length: 1,
    code: CODES.unknownFormat,
  });
  return {
    ...plugin,
    load: (source, path) => (plugin.filter.test(path) ? plugin.load(source, path) : { code: "export default undefined;\n", problems: [unknown(path)] }),
    types: (source, path, options) => (plugin.filter.test(path) ? plugin.types(source, path, options) : { types: FAILED_TYPES, problems: [unknown(path)] }),
  };
}
