// Vite builds and serves the Worker in workerd, Cloudflare's runtime, each schema through
// dotschema/vite beside Cloudflare's plugin.
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import dotschema from "dotschema/vite";

export default defineConfig({
  logLevel: "warn",
  plugins: [dotschema(), cloudflare()],
});
