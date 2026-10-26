import { join } from "node:path";
import type { NextConfig } from "next";
import { withDotschema } from "dotschema/next";

const nextConfig: NextConfig = {
  turbopack: {
    // Only because dotschema is this repository, outside this directory, and Turbopack resolves
    // nothing outside its root. An app that installs dotschema drops this line.
    root: join(import.meta.dirname, "../.."),
  },
};

// withDotschema sends each schema through dotschema/turbopack and dotschema/webpack, for the server
// and the browser, and runs `tsc --noEmit --runExternalCode` inside next build in place of Next's
// own check, which cannot run the content mapper.
export default withDotschema(nextConfig);
