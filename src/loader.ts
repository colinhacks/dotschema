// A schema file's module: the type the schema describes and a validator (schema.ts). A schema is
// written as JSON with comments, in a `.schema.jsonc` file. The module is made with the settings of
// the project being built, from its package.json (settings.ts), and imports its run time,
// `dotschema/runtime` (runtime/), which a host resolves from this file.
import type { LoaderPlugin } from "./core/universal.ts";
import { schemaCode, schemaTypes } from "./schema.ts";
import { settingsOf } from "./settings.ts";

export const loader: LoaderPlugin = {
  name: "dotschema",
  extensions: [".schema.jsonc"],
  filter: /\.schema\.jsonc$/,
  load: schemaCode,
  loadOptions: settingsOf,
  runtime: { prefix: "dotschema/", from: import.meta.url },
  types: schemaTypes,
};
