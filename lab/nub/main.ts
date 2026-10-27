// lab/basic's main.ts under nub, with the preload from nub.jsonc: `nub main.ts`. Then
// codecs/stamp.schema.jsonc, decoded with the codecs of the dotschema.jsonc beside it.
import "../basic/main.ts";
import stamp from "./codecs/stamp.schema.jsonc";

const value = stamp.decode({ at: "2026-10-20T08:00:00+02:00", id: "9007199254740993" }).value!;
console.log(JSON.stringify({ codecs: [value.at instanceof Temporal.Instant, String(value.at), typeof value.id, String(value.id), stamp.encode(value).value] }));
