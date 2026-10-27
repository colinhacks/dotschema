// A schema file's module: the type the schema describes and a validator (schema.ts). A schema is
// written as JSON with comments, `.schema.jsonc`, or as JSON5, `.schema.json5`.
import type { LoaderPlugin } from "./core/universal.ts";
import { schemaCode, schemaTypes } from "./schema.ts";

export const loader: LoaderPlugin = {
  name: "dotschema",
  extensions: [".schema.jsonc", ".schema.json5"],
  filter: /\.schema\.(?:jsonc|json5)$/,
  load: schemaCode,
  types: schemaTypes,
};
