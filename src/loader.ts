// A schema file's module: the type the schema describes and a validator (schema.ts). A schema is
// written as JSON with comments, in a `.schema.jsonc` file.
import type { LoaderPlugin } from "./core/universal.ts";
import { schemaCode, schemaTypes } from "./schema.ts";

export const loader: LoaderPlugin = {
  name: "dotschema",
  extensions: [".schema.jsonc"],
  filter: /\.schema\.jsonc$/,
  load: schemaCode,
  types: schemaTypes,
};
