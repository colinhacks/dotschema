// esbuild: `plugins: [dotschema()]`, from `import dotschema from "dotschema/esbuild"`.
import { standalone } from "./core/standalone.ts";
import { toEsbuildPlugin } from "./core/universal.ts";
import { loader } from "./loader.ts";

export default function dotschema() {
  return toEsbuildPlugin(standalone(loader));
}
