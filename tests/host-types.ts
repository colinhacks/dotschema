// Not a test file: `nub run typecheck` checks that withDotschema takes a Next.js config as
// next.config.ts writes it, with fields the wrapper does not name, at the top and inside the ones it
// does (src/next.ts, NextConfig). Next's own `NextConfig` passing through it is checked by
// lab/nextjs's next.config.ts, and the Vite plugin in each host's config type by lab/bundlers.
import { withDotschema } from "../src/next.ts";

export const next = withDotschema({ reactStrictMode: true });
export const nextNested = withDotschema({ turbopack: { root: "/app" }, typescript: { tsconfigPath: "tsconfig.json" }, compiler: { removeConsole: true } });
// @ts-expect-error a field the wrapper reads still has its type checked
withDotschema({ typescript: { ignoreBuildErrors: "yes" } });
