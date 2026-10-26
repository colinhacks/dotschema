// Vite, Rollup and Rolldown: `plugins: [dotschema()]`, from `import dotschema from "dotschema/vite"`.
// Vitest takes the same plugin, and so does a Cloudflare Worker built with Vite, beside `cloudflare()`.
import { standalone } from "./core/standalone.ts";
import { toVitePlugin } from "./core/universal.ts";
import { loader } from "./loader.ts";

export default function dotschema() {
  return toVitePlugin(standalone(loader));
}
