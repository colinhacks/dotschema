// The preload: `node --import dotschema/register`, `nub --import dotschema/register`, or
// `bun --preload dotschema/register`.
import { standalone } from "./core/standalone.ts";
import { register } from "./core/universal.ts";
import { loader } from "./loader.ts";

await register(standalone(loader));
