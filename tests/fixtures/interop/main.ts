// A schema and a data file in one host: user.schema.jsonc is dotschema's and app.jsonc the
// stand-in's, whichever loader the host was given first (tests/interop.test.ts).
import user from "./user.schema.jsonc";
import app from "./app.jsonc";

console.log(JSON.stringify({ vendor: user["~standard"].vendor, string: user.is("x"), number: user.is(1), app }));
