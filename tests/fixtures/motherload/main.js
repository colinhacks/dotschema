// main.ts without its types, for the bundlers that take no TypeScript (tests/motherload.test.ts):
// it prints what main.ts prints.
import settings from "./settings.jsonc";
import data from "./data.json5";
import user from "./user.schema.jsonc";
import point from "./point.schema.json5";

console.log(JSON.stringify({ fontSize: settings["editor.fontSize"], hex: data.hex, vendors: [user["~standard"].vendor, point["~standard"].vendor], valid: user.is({ name: "Ada" }), invalid: user.is({ name: "" }), point: [point.is({ x: 1, y: 2 }), point.is({ x: 1.5, y: 2 })] }));
