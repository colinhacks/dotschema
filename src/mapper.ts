// The content mapper process: tsc spawns `node src/mapper.ts` in this package and speaks JSON-RPC
// over stdio.
import { serve } from "./core/rpc.ts";
import { standalone } from "./core/standalone.ts";
import { toMapperHandlers } from "./core/universal.ts";
import { loader } from "./loader.ts";

serve(toMapperHandlers(standalone(loader)));
