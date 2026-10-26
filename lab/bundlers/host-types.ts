// Not run: lab/bundlers/tsconfig.json checks that each host's own config type takes the Vite plugin,
// as a project's vite.config.ts, rollup.config.ts or rolldown.config.ts writes it (tests/lab.test.ts).
import { defineConfig } from "vite";
import type { RollupOptions } from "rollup";
import type { RolldownOptions } from "rolldown";
import dotschema from "dotschema/vite";

export const vite = defineConfig({ plugins: [dotschema()] });
export const rollup: RollupOptions = { plugins: [dotschema()] };
export const rolldown: RolldownOptions = { plugins: [dotschema()] };
