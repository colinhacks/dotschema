// A schema file's module: the type the schema describes and a validator (schema.ts). A schema is
// written as JSON with comments, `.schema.jsonc`, or as JSON5, `.schema.json5`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LoaderPlugin } from "./core/universal.ts";
import { PROJECT_FILE, packageOf } from "./config.ts";
import { schemaCode, schemaTypes } from "./schema.ts";

export const loader: LoaderPlugin = {
  name: "dotschema",
  extensions: [".schema.jsonc", ".schema.json5"],
  filter: /\.schema\.(?:jsonc|json5)$/,
  load: schemaCode,
  types: schemaTypes,
  // The project file of the tsconfig's package, watched whether or not it exists, so that writing,
  // changing or removing it types the schemas again; one in another package of a monorepo is read
  // when a schema there is typed, and not watched (DESIGN.md, "The project file").
  project(configFileName) {
    const dir = packageOf(dirname(configFileName));
    const file = dir === undefined ? undefined : join(dir, PROJECT_FILE);
    let text: string | null = null;
    try {
      text = file === undefined ? null : readFileSync(file, "utf8");
    } catch {}
    return {
      watchedFiles: file === undefined ? [] : [file],
      configIdentity: createHash("sha256").update(JSON.stringify([file ?? null, text])).digest("hex"),
      option: (key) => `dotschema takes no options: its settings go in ${PROJECT_FILE}, beside package.json. Remove "${key}" here.`,
    };
  },
};
